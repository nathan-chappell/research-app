from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ThreadSummaryResponse(BaseModel):
    id: str
    library_id: str
    title: str | None = None
    status: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime
    created_at: datetime
    last_message_preview: str | None = None


class ThreadMessageResponse(BaseModel):
    id: str
    role: str
    item_type: str
    phase: str | None = None
    item: dict[str, Any]
    evidence_refs: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime


class ThreadDetailResponse(BaseModel):
    id: str
    library_id: str
    title: str | None = None
    status: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    messages: list[ThreadMessageResponse] = Field(default_factory=list)
