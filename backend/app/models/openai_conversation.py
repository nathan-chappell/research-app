from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class OpenAIConversation(TimestampMixin, Base):
    __tablename__ = "openai_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[str] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    conversation_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    last_response_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    thread = relationship("ChatThread", back_populates="openai_conversation")
