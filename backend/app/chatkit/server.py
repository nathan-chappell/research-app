from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

from chatkit.server import ChatKitServer
from chatkit.store import default_generate_id
from chatkit.types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ClientToolCallItem,
    EntitySource,
    ProgressUpdateEvent,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdatedEvent,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

from app.api.deps import RequestContext
from app.models import ChatMessage, ChatMessageEvidenceRef
from app.services.openai_service import ConversationState, OpenAIService


DEFAULT_EVIDENCE_INSTRUCTIONS = [
    "Answer only from the supplied evidence.",
    "If the evidence is incomplete, say so plainly.",
    "Use concise prose and mention timestamps when helpful.",
]


def _extract_question(message: UserMessageItem | None) -> str:
    if message is None:
        return ""
    parts = []
    for content in message.content:
        if getattr(content, "type", None) == "input_text":
            parts.append(content.text)
    return "\n".join(parts).strip()


def _timestamp_label(timestamp_ms: int | None) -> str:
    if timestamp_ms is None:
        return "Unknown time"
    total_seconds = int(timestamp_ms // 1000)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _unique_strings(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        text = _coerce_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        unique.append(text)
    return unique


class ResearchChatKitServer(ChatKitServer[RequestContext]):
    def __init__(self, store, attachment_store, openai_service: OpenAIService):
        super().__init__(store=store, attachment_store=attachment_store)
        self.openai_service = openai_service

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: RequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        if input_user_message is not None:
            async for event in self._respond_to_user_message(thread, input_user_message, context):
                yield event
            return

        async for event in self._respond_to_client_tool_output(thread, context):
            yield event

    async def _respond_to_user_message(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem,
        context: RequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        question = _extract_question(input_user_message)
        corpus_item_ids = self._requested_corpus_item_ids(thread, context)
        conversation_state = self.openai_service.get_conversation_state(context.db, thread_id=thread.id)
        self._set_thread_metadata(
            thread,
            phase="retrieving_evidence",
            question=question,
            library_id=context.library_id,
            corpus_item_ids=corpus_item_ids,
            conversation_state=conversation_state,
            last_evidence_ref_count=0,
        )

        yield ProgressUpdateEvent(icon="search", text="Searching local evidence")

        tool_call = ClientToolCallItem(
            id=self.store.generate_item_id("tool_call", thread, context),
            thread_id=thread.id,
            created_at=datetime.now(),
            call_id=default_generate_id("tool_call"),
            name="retrieve_local_evidence",
            arguments={
                "query": question,
                "libraryId": context.library_id,
                "corpusItemIds": corpus_item_ids,
                "topK": 6,
            },
            status="pending",
        )
        yield ThreadItemDoneEvent(item=tool_call)

    async def _respond_to_client_tool_output(
        self,
        thread: ThreadMetadata,
        context: RequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        thread_items = await self.store.load_thread_items(thread.id, None, 50, "desc", context)
        latest_user = next((item for item in thread_items.data if item.type == "user_message"), None)
        latest_retrieval = next(
            (
                item
                for item in thread_items.data
                if item.type == "client_tool_call"
                and item.name == "retrieve_local_evidence"
                and item.status == "completed"
            ),
            None,
        )

        question = _coerce_text(thread.metadata.get("active_query")) or _extract_question(latest_user)
        evidence = self._normalize_evidence(
            question=question,
            raw_output=latest_retrieval.output if latest_retrieval and isinstance(latest_retrieval.output, dict) else {},
        )

        if latest_retrieval is not None:
            latest_retrieval.output = evidence
            await self.store.save_item(thread.id, latest_retrieval, context=context)

        corpus_item_ids = self._evidence_corpus_item_ids(evidence) or self._requested_corpus_item_ids(thread, context)
        conversation_state = self.openai_service.get_conversation_state(context.db, thread_id=thread.id)
        self._set_thread_metadata(
            thread,
            phase="answering",
            question=question,
            library_id=context.library_id,
            corpus_item_ids=corpus_item_ids,
            conversation_state=conversation_state,
            last_evidence_ref_count=len(evidence["refs"]),
        )

        yield ProgressUpdateEvent(icon="sparkle", text="Synthesizing answer")

        assistant_item = AssistantMessageItem(
            id=self.store.generate_item_id("message", thread, context),
            thread_id=thread.id,
            created_at=datetime.now(),
            content=[],
        )
        yield ThreadItemAddedEvent(item=assistant_item)

        final_result = None
        for answer_event in self.openai_service.stream_answer(
            db=context.db,
            user_id=context.user.id,
            library_id=context.library_id,
            thread_id=thread.id,
            evidence=evidence,
        ):
            if answer_event.delta:
                yield ThreadItemUpdatedEvent(
                    item_id=assistant_item.id,
                    update=AssistantMessageContentPartTextDelta(content_index=0, delta=answer_event.delta),
                )
            if answer_event.result is not None:
                final_result = answer_event.result

        if final_result is None:
            raise RuntimeError("Answer streaming completed without a final result.")

        annotations = self._build_annotations(evidence["refs"])
        final_content = AssistantMessageContent(text=final_result.text, annotations=annotations)
        assistant_item.content = [final_content]

        yield ThreadItemUpdatedEvent(
            item_id=assistant_item.id,
            update=AssistantMessageContentPartDone(content_index=0, content=final_content),
        )

        updated_conversation_state = self.openai_service.get_conversation_state(context.db, thread_id=thread.id)
        self._set_thread_metadata(
            thread,
            phase=final_result.phase,
            question=question,
            library_id=context.library_id,
            corpus_item_ids=corpus_item_ids,
            conversation_state=updated_conversation_state,
            last_evidence_ref_count=len(evidence["refs"]),
        )

        yield ThreadItemDoneEvent(item=assistant_item)
        self._persist_assistant_metadata(
            context=context,
            thread_id=thread.id,
            message_id=assistant_item.id,
            phase=final_result.phase,
            evidence_refs=evidence["refs"],
            response_metadata=final_result.response_metadata,
        )

    def _requested_corpus_item_ids(self, thread: ThreadMetadata, context: RequestContext) -> list[str]:
        metadata = dict(thread.metadata or {})
        requested = []
        if context.active_corpus_item_id:
            requested.append(context.active_corpus_item_id)
        requested.extend(metadata.get("corpus_item_ids", []))
        return _unique_strings(requested)

    def _evidence_corpus_item_ids(self, evidence: dict[str, Any]) -> list[str]:
        corpus_item_ids: list[Any] = []
        for segment in evidence.get("segments", []):
            corpus_item_ids.append(segment.get("corpusItemId"))
        for screenshot in evidence.get("screenshots", []):
            corpus_item_ids.append(screenshot.get("corpusItemId"))
        for ref in evidence.get("refs", []):
            corpus_item_ids.append(ref.get("corpusItemId"))
        return _unique_strings(corpus_item_ids)

    def _set_thread_metadata(
        self,
        thread: ThreadMetadata,
        *,
        phase: str,
        question: str,
        library_id: str,
        corpus_item_ids: list[str],
        conversation_state: ConversationState,
        last_evidence_ref_count: int,
    ) -> None:
        metadata = dict(thread.metadata or {})
        metadata.update(
            {
                "phase": phase,
                "active_query": question,
                "library_id": library_id,
                "corpus_item_ids": corpus_item_ids,
                "openai_conversation_id": conversation_state.conversation_id,
                "previous_response_id": conversation_state.previous_response_id,
                "last_evidence_ref_count": last_evidence_ref_count,
            }
        )
        thread.metadata = metadata

    def _normalize_evidence(self, *, question: str, raw_output: dict[str, Any]) -> dict[str, Any]:
        raw_segments = raw_output.get("segments") or []
        raw_screenshots = raw_output.get("screenshots") or []
        raw_refs = raw_output.get("refs") or []

        segments = []
        for index, raw_segment in enumerate(raw_segments):
            if not isinstance(raw_segment, dict):
                continue
            corpus_item_id = _coerce_text(
                raw_segment.get("corpusItemId") or raw_segment.get("corpus_item_id")
            )
            text = _coerce_text(raw_segment.get("text"))
            timestamp_ms = _coerce_int(
                raw_segment.get("timestampMs")
                or raw_segment.get("timestamp_ms")
                or raw_segment.get("startMs")
                or raw_segment.get("start_ms")
            )
            if not corpus_item_id or not text:
                continue
            segments.append(
                {
                    "id": _coerce_text(raw_segment.get("id")) or f"segment_{index}",
                    "corpusItemId": corpus_item_id,
                    "startMs": _coerce_int(
                        raw_segment.get("startMs") or raw_segment.get("start_ms"),
                        timestamp_ms,
                    ),
                    "endMs": _coerce_int(
                        raw_segment.get("endMs") or raw_segment.get("end_ms"),
                        timestamp_ms,
                    ),
                    "timestampMs": timestamp_ms,
                    "timestampLabel": _coerce_text(raw_segment.get("timestampLabel"))
                    or _timestamp_label(timestamp_ms),
                    "text": text,
                    "score": _coerce_float(raw_segment.get("score")),
                    "speaker": raw_segment.get("speaker"),
                }
            )

        screenshots = []
        for index, raw_screenshot in enumerate(raw_screenshots):
            if not isinstance(raw_screenshot, dict):
                continue
            corpus_item_id = _coerce_text(
                raw_screenshot.get("corpusItemId") or raw_screenshot.get("corpus_item_id")
            )
            timestamp_ms = _coerce_int(
                raw_screenshot.get("timestampMs") or raw_screenshot.get("timestamp_ms")
            )
            if not corpus_item_id:
                continue
            screenshots.append(
                {
                    "id": _coerce_text(raw_screenshot.get("id")) or f"screenshot_{index}",
                    "corpusItemId": corpus_item_id,
                    "timestampMs": timestamp_ms,
                    "timestampLabel": _coerce_text(raw_screenshot.get("timestampLabel"))
                    or _timestamp_label(timestamp_ms),
                    "opfsPath": _coerce_text(raw_screenshot.get("opfsPath") or raw_screenshot.get("opfs_path")),
                }
            )

        refs = []
        for index, raw_ref in enumerate(raw_refs):
            if not isinstance(raw_ref, dict):
                continue
            corpus_item_id = _coerce_text(raw_ref.get("corpusItemId") or raw_ref.get("corpus_item_id"))
            timestamp_ms = _coerce_int(raw_ref.get("timestampMs") or raw_ref.get("timestamp_ms"))
            kind = _coerce_text(raw_ref.get("kind")) or "transcript"
            if not corpus_item_id:
                continue
            refs.append(
                {
                    "id": _coerce_text(raw_ref.get("id")) or f"ref_{index}",
                    "title": _coerce_text(raw_ref.get("title")) or _timestamp_label(timestamp_ms),
                    "kind": kind,
                    "corpusItemId": corpus_item_id,
                    "timestampMs": timestamp_ms,
                    "excerpt": _coerce_text(raw_ref.get("excerpt"))
                    or (
                        _coerce_text(raw_ref.get("text"))
                        or (f"Screenshot at {_timestamp_label(timestamp_ms)}" if kind == "screenshot" else "")
                    ),
                    "screenshotPath": _coerce_text(
                        raw_ref.get("screenshotPath") or raw_ref.get("screenshot_path")
                    )
                    or None,
                }
            )

        if not refs:
            refs.extend(
                {
                    "id": segment["id"],
                    "title": segment["timestampLabel"],
                    "kind": "transcript",
                    "corpusItemId": segment["corpusItemId"],
                    "timestampMs": segment["timestampMs"],
                    "excerpt": segment["text"],
                    "screenshotPath": None,
                }
                for segment in segments
            )
            refs.extend(
                {
                    "id": screenshot["id"],
                    "title": screenshot["timestampLabel"],
                    "kind": "screenshot",
                    "corpusItemId": screenshot["corpusItemId"],
                    "timestampMs": screenshot["timestampMs"],
                    "excerpt": f"Screenshot at {screenshot['timestampLabel']}",
                    "screenshotPath": screenshot["opfsPath"] or None,
                }
                for screenshot in screenshots
            )

        instructions = []
        for raw_instruction in raw_output.get("instructions") or []:
            text = _coerce_text(raw_instruction)
            if text:
                instructions.append(text)
        if not instructions:
            instructions = list(DEFAULT_EVIDENCE_INSTRUCTIONS)

        return {
            "query": _coerce_text(raw_output.get("query")) or question,
            "segments": segments,
            "screenshots": screenshots,
            "refs": refs,
            "instructions": instructions,
        }

    def _build_annotations(self, evidence_refs: list[dict[str, Any]]) -> list[Annotation]:
        annotations: list[Annotation] = []
        for index, ref in enumerate(evidence_refs[:3]):
            timestamp_ms = _coerce_int(ref.get("timestampMs"))
            annotations.append(
                Annotation(
                    index=None,
                    source=EntitySource(
                        id=f"local-evidence-{index}",
                        title=_coerce_text(ref.get("title")) or _timestamp_label(timestamp_ms),
                        description=_coerce_text(ref.get("excerpt")) or None,
                        timestamp=_timestamp_label(timestamp_ms),
                        label="Jump",
                        inline_label="Jump",
                        interactive=True,
                        data={
                            "corpusItemId": ref.get("corpusItemId"),
                            "timestampMs": timestamp_ms,
                            "kind": ref.get("kind"),
                        },
                    ),
                )
            )
        return annotations

    def _persist_assistant_metadata(
        self,
        *,
        context: RequestContext,
        thread_id: str,
        message_id: str,
        phase: str,
        evidence_refs: list[dict[str, Any]],
        response_metadata: dict[str, Any],
    ) -> None:
        message = (
            context.db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id, ChatMessage.id == message_id)
            .one_or_none()
        )
        if message is None:
            return

        message.phase = phase
        message.evidence_refs_json = evidence_refs
        message.metadata_json = {
            **response_metadata,
            "phase": phase,
            "response_id": response_metadata.get("response_id"),
            "conversation_id": response_metadata.get("conversation_id"),
        }
        context.db.add(message)

        context.db.query(ChatMessageEvidenceRef).filter(ChatMessageEvidenceRef.message_id == message_id).delete()
        for ref in evidence_refs:
            context.db.add(
                ChatMessageEvidenceRef(
                    message_id=message_id,
                    corpus_item_id=ref.get("corpusItemId"),
                    timestamp_ms=_coerce_int(ref.get("timestampMs")),
                    excerpt=_coerce_text(ref.get("excerpt")) or None,
                    local_ref_json=ref,
                )
            )

        context.db.commit()
