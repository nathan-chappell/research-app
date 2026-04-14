from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import asc, desc

from chatkit.store import AttachmentStore, NotFoundError, Store, default_generate_id
from chatkit.types import Attachment, Page, ThreadItem, ThreadMetadata

from app.api.deps import RequestContext
from app.models import (
    ChatAttachment,
    ChatMessage,
    ChatMessageEvidenceRef,
    ChatThread,
)


THREAD_METADATA_ADAPTER: TypeAdapter[ThreadMetadata] = TypeAdapter(ThreadMetadata)
THREAD_ITEM_ADAPTER: TypeAdapter[ThreadItem] = TypeAdapter(ThreadItem)
ATTACHMENT_ADAPTER: TypeAdapter[Attachment] = TypeAdapter(Attachment)


def _item_role(item: ThreadItem) -> str:
    if item.type == "user_message":
        return "user"
    if item.type == "assistant_message":
        return "assistant"
    if item.type == "client_tool_call":
        return "tool"
    return item.type


def _extract_evidence_refs(item: ThreadItem) -> list[dict[str, Any]] | None:
    if item.type != "client_tool_call" or item.name != "retrieve_local_evidence":
        return None
    if not isinstance(item.output, dict):
        return None
    refs = item.output.get("refs")
    return refs if isinstance(refs, list) else None


class SQLAlchemyAttachmentStore(AttachmentStore[RequestContext]):
    async def delete_attachment(self, attachment_id: str, context: RequestContext) -> None:
        raise NotImplementedError("Chat attachments are not supported in this MVP.")

    async def create_attachment(self, input, context: RequestContext) -> Attachment:
        raise NotImplementedError("Chat attachments are not supported in this MVP.")


class SQLAlchemyChatKitStore(Store[RequestContext]):
    def _require_thread(self, thread_id: str, context: RequestContext) -> ChatThread:
        thread = (
            context.db.query(ChatThread)
            .filter(
                ChatThread.id == thread_id,
                ChatThread.user_id == context.user.id,
                ChatThread.library_id == context.library_id,
            )
            .one_or_none()
        )
        if thread is None:
            raise NotFoundError(f"Thread {thread_id} not found")
        return thread

    def generate_thread_id(self, context: RequestContext) -> str:
        return default_generate_id("thread")

    async def load_thread(self, thread_id: str, context: RequestContext) -> ThreadMetadata:
        thread = self._require_thread(thread_id, context)
        payload = thread.thread_json or {
            "id": thread.id,
            "title": thread.title,
            "created_at": thread.created_at,
            "status": thread.status_json or {"type": "active"},
            "metadata": thread.metadata_json or {},
        }
        return THREAD_METADATA_ADAPTER.validate_python(payload)

    async def save_thread(self, thread: ThreadMetadata, context: RequestContext) -> None:
        row = (
            context.db.query(ChatThread)
            .filter(
                ChatThread.id == thread.id,
                ChatThread.user_id == context.user.id,
                ChatThread.library_id == context.library_id,
            )
            .one_or_none()
        )
        payload = thread.model_dump(mode="json")
        if row is None:
            row = ChatThread(
                id=thread.id,
                user_id=context.user.id,
                library_id=context.library_id,
                title=thread.title,
                status_json=payload.get("status") or {"type": "active"},
                metadata_json=thread.metadata,
                thread_json=payload,
                created_at=thread.created_at,
                updated_at=thread.created_at,
            )
        else:
            row.title = thread.title
            row.status_json = payload.get("status") or {"type": "active"}
            row.metadata_json = thread.metadata
            row.thread_json = payload
            row.updated_at = datetime.now()
        context.db.add(row)
        context.db.commit()

    async def load_thread_items(
        self,
        thread_id: str,
        after: str | None,
        limit: int,
        order: str,
        context: RequestContext,
    ) -> Page[ThreadItem]:
        self._require_thread(thread_id, context)
        query = context.db.query(ChatMessage).filter(ChatMessage.thread_id == thread_id).order_by(
            desc(ChatMessage.created_at) if order == "desc" else asc(ChatMessage.created_at)
        )
        if after:
            cursor = (
                context.db.query(ChatMessage)
                .filter(ChatMessage.thread_id == thread_id, ChatMessage.id == after)
                .one_or_none()
            )
            if cursor is not None:
                comparator = ChatMessage.created_at < cursor.created_at if order == "desc" else ChatMessage.created_at > cursor.created_at
                query = query.filter(comparator)

        rows: Sequence[ChatMessage] = query.limit(limit + 1).all()
        has_more = len(rows) > limit
        page_rows = list(rows[:limit])
        data = [THREAD_ITEM_ADAPTER.validate_python(row.item_json) for row in page_rows]
        return Page(data=data, has_more=has_more, after=page_rows[-1].id if page_rows else None)

    async def save_attachment(self, attachment: Attachment, context: RequestContext) -> None:
        row = (
            context.db.query(ChatAttachment)
            .filter(ChatAttachment.id == attachment.id, ChatAttachment.user_id == context.user.id)
            .one_or_none()
        )
        payload = attachment.model_dump(mode="json")
        if row is None:
            row = ChatAttachment(
                id=attachment.id,
                user_id=context.user.id,
                library_id=context.library_id,
                thread_id=attachment.thread_id,
                attachment_json=payload,
                created_at=datetime.now(),
                updated_at=datetime.now(),
            )
        else:
            row.thread_id = attachment.thread_id
            row.attachment_json = payload
            row.updated_at = datetime.now()
        context.db.add(row)
        context.db.commit()

    async def load_attachment(self, attachment_id: str, context: RequestContext) -> Attachment:
        row = (
            context.db.query(ChatAttachment)
            .filter(ChatAttachment.id == attachment_id, ChatAttachment.user_id == context.user.id)
            .one_or_none()
        )
        if row is None:
            raise NotFoundError(f"Attachment {attachment_id} not found")
        return ATTACHMENT_ADAPTER.validate_python(row.attachment_json)

    async def delete_attachment(self, attachment_id: str, context: RequestContext) -> None:
        row = (
            context.db.query(ChatAttachment)
            .filter(ChatAttachment.id == attachment_id, ChatAttachment.user_id == context.user.id)
            .one_or_none()
        )
        if row is None:
            raise NotFoundError(f"Attachment {attachment_id} not found")
        context.db.delete(row)
        context.db.commit()

    async def load_threads(
        self,
        limit: int,
        after: str | None,
        order: str,
        context: RequestContext,
    ) -> Page[ThreadMetadata]:
        query = context.db.query(ChatThread).filter(
            ChatThread.user_id == context.user.id,
            ChatThread.library_id == context.library_id,
        ).order_by(desc(ChatThread.updated_at) if order == "desc" else asc(ChatThread.updated_at))
        if after:
            cursor = (
                context.db.query(ChatThread)
                .filter(
                    ChatThread.id == after,
                    ChatThread.user_id == context.user.id,
                    ChatThread.library_id == context.library_id,
                )
                .one_or_none()
            )
            if cursor is not None:
                comparator = ChatThread.updated_at < cursor.updated_at if order == "desc" else ChatThread.updated_at > cursor.updated_at
                query = query.filter(comparator)
        rows: Sequence[ChatThread] = query.limit(limit + 1).all()
        has_more = len(rows) > limit
        page_rows = list(rows[:limit])
        data = [THREAD_METADATA_ADAPTER.validate_python(row.thread_json) for row in page_rows]
        return Page(data=data, has_more=has_more, after=page_rows[-1].id if page_rows else None)

    async def add_thread_item(self, thread_id: str, item: ThreadItem, context: RequestContext) -> None:
        self._require_thread(thread_id, context)
        payload = item.model_dump(mode="json")
        row = ChatMessage(
            id=item.id,
            thread_id=thread_id,
            user_id=context.user.id,
            role=_item_role(item),
            item_type=item.type,
            item_json=payload,
            evidence_refs_json=_extract_evidence_refs(item),
            metadata_json={},
            created_at=item.created_at,
            updated_at=item.created_at,
        )
        context.db.add(row)
        context.db.commit()

    async def save_item(self, thread_id: str, item: ThreadItem, context: RequestContext) -> None:
        self._require_thread(thread_id, context)
        row = (
            context.db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id, ChatMessage.id == item.id)
            .one_or_none()
        )
        payload = item.model_dump(mode="json")
        refs = _extract_evidence_refs(item)
        if row is None:
            row = ChatMessage(
                id=item.id,
                thread_id=thread_id,
                user_id=context.user.id,
                role=_item_role(item),
                item_type=item.type,
                item_json=payload,
                evidence_refs_json=refs,
                metadata_json={},
                created_at=item.created_at,
                updated_at=item.created_at,
            )
        else:
            row.role = _item_role(item)
            row.item_type = item.type
            row.item_json = payload
            if refs is not None:
                row.evidence_refs_json = refs
            row.updated_at = datetime.now()
        context.db.add(row)
        context.db.commit()

    async def load_item(self, thread_id: str, item_id: str, context: RequestContext) -> ThreadItem:
        row = (
            context.db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id, ChatMessage.id == item_id)
            .one_or_none()
        )
        if row is None:
            raise NotFoundError(f"Item {item_id} not found")
        return THREAD_ITEM_ADAPTER.validate_python(row.item_json)

    async def delete_thread(self, thread_id: str, context: RequestContext) -> None:
        thread = self._require_thread(thread_id, context)
        context.db.delete(thread)
        context.db.commit()

    async def delete_thread_item(self, thread_id: str, item_id: str, context: RequestContext) -> None:
        row = (
            context.db.query(ChatMessage)
            .filter(ChatMessage.thread_id == thread_id, ChatMessage.id == item_id)
            .one_or_none()
        )
        if row is None:
            raise NotFoundError(f"Item {item_id} not found")
        context.db.query(ChatMessageEvidenceRef).filter(ChatMessageEvidenceRef.message_id == item_id).delete()
        context.db.delete(row)
        context.db.commit()
