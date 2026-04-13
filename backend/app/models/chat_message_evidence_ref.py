from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ChatMessageEvidenceRef(Base):
    __tablename__ = "chat_message_evidence_refs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        index=True,
    )
    corpus_item_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    timestamp_ms: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    excerpt: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    local_ref_json: Mapped[dict] = mapped_column(JSON, default=dict)

    message = relationship("ChatMessage", back_populates="evidence_refs")
