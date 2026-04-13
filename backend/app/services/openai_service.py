from __future__ import annotations

import hashlib
import json
import math
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from fastapi import UploadFile
from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import OpenAIConversation, UsageEvent


@dataclass
class ConversationState:
    conversation_id: str | None
    previous_response_id: str | None


@dataclass
class AnswerResult:
    text: str
    phase: str
    response_metadata: dict[str, Any]


@dataclass
class AnswerStreamEvent:
    delta: str | None = None
    result: AnswerResult | None = None


class OpenAIService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = (
            OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
            if settings.openai_api_key
            else None
        )

    @property
    def enabled(self) -> bool:
        return self.client is not None

    def _record_usage(
        self,
        db: Session,
        *,
        user_id: str,
        library_id: str | None,
        thread_id: str | None,
        kind: str,
        model: str | None,
        quantity: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        event = UsageEvent(
            user_id=user_id,
            library_id=library_id,
            thread_id=thread_id,
            kind=kind,
            model=model,
            quantity=quantity,
            metadata_json=metadata or {},
        )
        db.add(event)
        db.commit()

    def _lookup_conversation(self, db: Session, *, thread_id: str) -> OpenAIConversation | None:
        return db.query(OpenAIConversation).filter(OpenAIConversation.thread_id == thread_id).one_or_none()

    def get_conversation_state(self, db: Session, *, thread_id: str) -> ConversationState:
        conversation = self._lookup_conversation(db, thread_id=thread_id)
        if conversation is None:
            return ConversationState(conversation_id=None, previous_response_id=None)
        return ConversationState(
            conversation_id=conversation.conversation_id,
            previous_response_id=conversation.last_response_id,
        )

    def _ensure_conversation(
        self,
        db: Session,
        *,
        user_id: str,
        library_id: str,
        thread_id: str,
    ) -> OpenAIConversation:
        conversation = self._lookup_conversation(db, thread_id=thread_id)
        if conversation is None:
            conversation = OpenAIConversation(
                thread_id=thread_id,
                conversation_id=None,
                last_response_id=None,
                metadata_json={"library_id": library_id, "user_id": user_id},
            )
            db.add(conversation)
            db.commit()
            db.refresh(conversation)

        if self.client is not None and conversation.conversation_id is None:
            created = self.client.conversations.create(
                metadata={"thread_id": thread_id, "library_id": library_id, "user_id": user_id}
            )
            conversation.conversation_id = created.id
            conversation.metadata_json = {
                **(conversation.metadata_json or {}),
                "library_id": library_id,
                "user_id": user_id,
            }
            db.add(conversation)
            db.commit()
            db.refresh(conversation)

        return conversation

    def _deterministic_embedding(self, text: str) -> list[float]:
        dims = self.settings.embedding_dimensions
        values: list[float] = []
        seed = text.encode("utf-8")
        counter = 0
        while len(values) < dims:
            digest = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
            counter += 1
            for index in range(0, len(digest), 4):
                chunk = digest[index : index + 4]
                if len(chunk) < 4:
                    chunk = chunk.ljust(4, b"\0")
                integer = int.from_bytes(chunk, "big", signed=False)
                values.append((integer / 2**31) - 1.0)
                if len(values) >= dims:
                    break

        norm = math.sqrt(sum(value * value for value in values)) or 1.0
        return [value / norm for value in values]

    def create_embeddings(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        texts: list[str],
    ) -> tuple[str, int, list[list[float]]]:
        if not texts:
            return (self.settings.embedding_model, self.settings.embedding_dimensions, [])

        if self.client is None:
            embeddings = [self._deterministic_embedding(text) for text in texts]
            self._record_usage(
                db,
                user_id=user_id,
                library_id=library_id,
                thread_id=None,
                kind="embeddings_fallback",
                model=self.settings.embedding_model,
                quantity=len(texts),
                metadata={"reason": "missing_openai_api_key"},
            )
            return (self.settings.embedding_model, self.settings.embedding_dimensions, embeddings)

        response = self.client.embeddings.create(
            model=self.settings.embedding_model,
            input=texts,
            dimensions=self.settings.embedding_dimensions,
            encoding_format="float",
            user=user_id,
        )
        embeddings = [item.embedding for item in response.data]
        self._record_usage(
            db,
            user_id=user_id,
            library_id=library_id,
            thread_id=None,
            kind="embeddings",
            model=self.settings.embedding_model,
            quantity=len(texts),
            metadata=response.usage.model_dump() if response.usage else {},
        )
        return (self.settings.embedding_model, self.settings.embedding_dimensions, embeddings)

    def transcribe_chunks(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        files: list[UploadFile],
        manifests: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        all_segments: list[dict[str, Any]] = []
        manifest_by_name = {item["file_name"]: item for item in manifests}

        for chunk_index, upload in enumerate(files):
            manifest = manifest_by_name.get(upload.filename or "", {})
            start_ms = int(manifest.get("start_ms", 0))
            overlap_ms = int(manifest.get("overlap_ms", 0))

            if self.client is None:
                text = f"Transcription unavailable for {upload.filename or 'chunk'} until RESEARCH_APP_OPENAI_API_KEY is configured."
                all_segments.append(
                    {
                        "id": f"seg_{uuid.uuid4().hex[:8]}",
                        "chunk_index": chunk_index,
                        "start_ms": start_ms,
                        "end_ms": start_ms + int(manifest.get("duration_ms") or 30_000),
                        "text": text,
                        "speaker": None,
                        "token_count": len(text.split()),
                        "confidence": None,
                    }
                )
                continue

            upload.file.seek(0)
            response = self.client.audio.transcriptions.create(
                file=upload.file,
                model=self.settings.transcription_model,
                response_format="diarized_json",
                chunking_strategy="auto",
            )
            payload = response.model_dump() if hasattr(response, "model_dump") else {"text": str(response)}
            segments = payload.get("segments") or []
            if not segments and payload.get("text"):
                segments = [{"start": 0, "end": 0, "text": payload["text"], "speaker": None}]

            for raw_segment in segments:
                text = (raw_segment.get("text") or "").strip()
                segment_start = max(0, int(float(raw_segment.get("start") or 0) * 1000))
                segment_end = max(segment_start, int(float(raw_segment.get("end") or 0) * 1000))
                adjusted_start = max(start_ms, start_ms + segment_start - overlap_ms)
                adjusted_end = max(adjusted_start, start_ms + segment_end)
                all_segments.append(
                    {
                        "id": f"seg_{uuid.uuid4().hex[:8]}",
                        "chunk_index": chunk_index,
                        "start_ms": adjusted_start,
                        "end_ms": adjusted_end,
                        "text": text,
                        "speaker": raw_segment.get("speaker"),
                        "token_count": len(text.split()),
                        "confidence": raw_segment.get("avg_logprob"),
                    }
                )

        self._record_usage(
            db,
            user_id=user_id,
            library_id=library_id,
            thread_id=None,
            kind="transcriptions" if self.client else "transcriptions_fallback",
            model=self.settings.transcription_model,
            quantity=len(files),
            metadata={"chunks": len(files)},
        )
        return sorted(all_segments, key=lambda item: (item["start_ms"], item["end_ms"], item["id"]))

    def _iter_text_chunks(self, text: str, *, target_size: int = 120) -> Iterator[str]:
        stripped = text.strip()
        if not stripped:
            return

        words = stripped.split()
        buffer: list[str] = []
        current_length = 0
        for word in words:
            addition = len(word) if not buffer else len(word) + 1
            if buffer and current_length + addition > target_size:
                yield " ".join(buffer) + " "
                buffer = [word]
                current_length = len(word)
            else:
                buffer.append(word)
                current_length += addition
        if buffer:
            yield " ".join(buffer)

    def _stream_static_answer(
        self,
        *,
        text: str,
        phase: str,
        response_metadata: dict[str, Any],
    ) -> Iterator[AnswerStreamEvent]:
        yielded_delta = False
        for chunk in self._iter_text_chunks(text):
            yielded_delta = True
            yield AnswerStreamEvent(delta=chunk)
        if not yielded_delta and text:
            yield AnswerStreamEvent(delta=text)
        yield AnswerStreamEvent(result=AnswerResult(text=text, phase=phase, response_metadata=response_metadata))

    def stream_answer(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        thread_id: str,
        evidence: dict[str, Any],
    ) -> Iterator[AnswerStreamEvent]:
        segments = evidence.get("segments") or []
        screenshots = evidence.get("screenshots") or []
        conversation_state = self.get_conversation_state(db, thread_id=thread_id)

        if not segments and not screenshots:
            yield from self._stream_static_answer(
                text="I do not have enough local evidence to answer that yet. Try broadening the search or importing more transcript context.",
                phase="insufficient_evidence",
                response_metadata={
                    "reason": "empty_retrieval",
                    "response_id": None,
                    "conversation_id": conversation_state.conversation_id,
                    "previous_response_id": conversation_state.previous_response_id,
                    "model": self.settings.answer_model,
                },
            )
            return

        if self.client is None:
            bullet_points = []
            for segment in segments[:3]:
                bullet_points.append(
                    f"- [{segment.get('timestampLabel', 'n/a')}] {segment.get('text', '').strip()}"
                )
            summary = "\n".join(bullet_points) if bullet_points else "- Visual evidence retrieved without transcript text."
            yield from self._stream_static_answer(
                text=(
                    "OpenAI is not configured on the server, so this is a local fallback summary based on the retrieved evidence:\n"
                    f"{summary}"
                ),
                phase="answered_fallback",
                response_metadata={
                    "reason": "missing_openai_api_key",
                    "response_id": None,
                    "conversation_id": conversation_state.conversation_id,
                    "previous_response_id": conversation_state.previous_response_id,
                    "model": self.settings.answer_model,
                },
            )
            return

        conversation = self._ensure_conversation(
            db,
            user_id=user_id,
            library_id=library_id,
            thread_id=thread_id,
        )

        params: dict[str, Any] = {
            "model": self.settings.answer_model,
            "input": json.dumps(evidence, ensure_ascii=True),
            "conversation": {"id": conversation.conversation_id} if conversation.conversation_id else None,
            "reasoning": {"effort": self.settings.answer_reasoning_effort},
            "text": {"verbosity": self.settings.answer_text_verbosity},
            "store": True,
            "user": user_id,
            "metadata": {"thread_id": thread_id, "library_id": library_id},
        }
        if conversation.last_response_id:
            params["previous_response_id"] = conversation.last_response_id
        if params["conversation"] is None:
            params.pop("conversation")

        streamed_text: list[str] = []
        with self.client.responses.stream(**params) as stream:
            for event in stream:
                if event.type == "response.output_text.delta" and event.delta:
                    streamed_text.append(event.delta)
                    yield AnswerStreamEvent(delta=event.delta)
                    continue
                if event.type == "error":
                    raise RuntimeError(event.message)
                if event.type == "response.failed":
                    error_message = None
                    if event.response.error is not None:
                        error_message = getattr(event.response.error, "message", None) or str(event.response.error)
                    raise RuntimeError(error_message or "OpenAI response failed.")
                if event.type == "response.incomplete":
                    raise RuntimeError(
                        f"OpenAI response incomplete: {event.response.incomplete_details or 'no details provided'}"
                    )

            final_response = stream.get_final_response()

        final_text = final_response.output_text or "".join(streamed_text).strip()
        if not final_text:
            final_text = "I could not produce an answer from the retrieved evidence."

        if final_response.conversation is not None:
            conversation.conversation_id = final_response.conversation.id
        conversation.last_response_id = final_response.id
        conversation.metadata_json = {
            **(conversation.metadata_json or {}),
            "library_id": library_id,
            "user_id": user_id,
            "model": self.settings.answer_model,
            "response_id": final_response.id,
        }
        db.add(conversation)
        db.commit()

        usage = final_response.usage.model_dump() if final_response.usage else {}
        self._record_usage(
            db,
            user_id=user_id,
            library_id=library_id,
            thread_id=thread_id,
            kind="responses",
            model=self.settings.answer_model,
            quantity=usage.get("total_tokens", 0),
            metadata=usage,
        )

        yield AnswerStreamEvent(
            result=AnswerResult(
                text=final_text,
                phase="answered",
                response_metadata={
                    "response_id": final_response.id,
                    "conversation_id": conversation.conversation_id,
                    "previous_response_id": final_response.previous_response_id,
                    "usage": usage,
                    "model": final_response.model,
                    "status": final_response.status,
                },
            )
        )
