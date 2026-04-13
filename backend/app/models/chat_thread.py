from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ChatThread(TimestampMixin, Base):
    __tablename__ = "chat_threads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    library_id: Mapped[str] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status_json: Mapped[dict] = mapped_column(JSON, default=dict)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    thread_json: Mapped[dict] = mapped_column(JSON, default=dict)

    user = relationship("User", back_populates="chat_threads")
    library = relationship("Library", back_populates="chat_threads")
    messages = relationship("ChatMessage", back_populates="thread", cascade="all, delete-orphan")
    attachments = relationship("ChatAttachment", back_populates="thread", cascade="all, delete-orphan")
    openai_conversation = relationship(
        "OpenAIConversation",
        back_populates="thread",
        cascade="all, delete-orphan",
        uselist=False,
    )
