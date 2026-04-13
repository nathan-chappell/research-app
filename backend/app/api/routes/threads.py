from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import RequestContext, get_request_context
from app.models import ChatThread
from app.schemas.thread import ThreadDetailResponse, ThreadMessageResponse, ThreadSummaryResponse


router = APIRouter(prefix="/threads", tags=["threads"])


@router.get("", response_model=list[ThreadSummaryResponse])
def list_threads(context: RequestContext = Depends(get_request_context)) -> list[ThreadSummaryResponse]:
    rows = (
        context.db.query(ChatThread)
        .filter(ChatThread.user_id == context.user.id, ChatThread.library_id == context.library_id)
        .order_by(ChatThread.updated_at.desc())
        .all()
    )
    response: list[ThreadSummaryResponse] = []
    for row in rows:
        last_message = row.messages[-1] if row.messages else None
        preview = None
        if last_message and isinstance(last_message.item_json, dict):
            content = last_message.item_json.get("content") or []
            if content and isinstance(content, list):
                preview = content[0].get("text")
        response.append(
            ThreadSummaryResponse(
                id=row.id,
                library_id=row.library_id,
                title=row.title,
                status=row.status_json or {},
                metadata=row.metadata_json or {},
                created_at=row.created_at,
                updated_at=row.updated_at,
                last_message_preview=preview,
            )
        )
    return response


@router.get("/{thread_id}", response_model=ThreadDetailResponse)
def get_thread(thread_id: str, context: RequestContext = Depends(get_request_context)) -> ThreadDetailResponse:
    row = (
        context.db.query(ChatThread)
        .filter(ChatThread.id == thread_id, ChatThread.user_id == context.user.id, ChatThread.library_id == context.library_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Thread not found.")
    messages = [
        ThreadMessageResponse(
            id=message.id,
            role=message.role,
            item_type=message.item_type,
            phase=message.phase,
            item=message.item_json,
            evidence_refs=message.evidence_refs_json or [],
            created_at=message.created_at,
        )
        for message in sorted(row.messages, key=lambda item: item.created_at)
    ]
    return ThreadDetailResponse(
        id=row.id,
        library_id=row.library_id,
        title=row.title,
        status=row.status_json or {},
        metadata=row.metadata_json or {},
        created_at=row.created_at,
        updated_at=row.updated_at,
        messages=messages,
    )
