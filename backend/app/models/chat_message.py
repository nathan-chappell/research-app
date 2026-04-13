from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ChatMessage(TimestampMixin, Base):
    __tablename__ = "chat_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    item_type: Mapped[str] = mapped_column(String(64), index=True)
    phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    item_json: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence_refs_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    thread = relationship("ChatThread", back_populates="messages")
    evidence_refs = relationship(
        "ChatMessageEvidenceRef",
        back_populates="message",
        cascade="all, delete-orphan",
    )
