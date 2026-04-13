from __future__ import annotations

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class Library(TimestampMixin, Base):
    __tablename__ = "libraries"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="My Library")

    user = relationship("User", back_populates="libraries")
    chat_threads = relationship("ChatThread", back_populates="library")
    semantic_corpus_items = relationship(
        "SemanticCorpusItem",
        back_populates="library",
        cascade="all, delete-orphan",
    )
    semantic_chunks = relationship(
        "SemanticChunk",
        back_populates="library",
        cascade="all, delete-orphan",
    )
