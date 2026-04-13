from __future__ import annotations

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class ChatAttachment(TimestampMixin, Base):
    __tablename__ = "chat_attachments"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    library_id: Mapped[str] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), index=True)
    thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("chat_threads.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    attachment_json: Mapped[dict] = mapped_column(JSON, default=dict)

    thread = relationship("ChatThread", back_populates="attachments")
