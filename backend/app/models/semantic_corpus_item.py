from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class SemanticCorpusItem(TimestampMixin, Base):
    __tablename__ = "semantic_corpus_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    library_id: Mapped[str] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255), default="Untitled")
    source_file_name: Mapped[str] = mapped_column(String(255), default="")
    media_type: Mapped[str] = mapped_column(String(128), default="")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    library = relationship("Library", back_populates="semantic_corpus_items")
    chunks = relationship("SemanticChunk", back_populates="corpus_item", cascade="all, delete-orphan")
