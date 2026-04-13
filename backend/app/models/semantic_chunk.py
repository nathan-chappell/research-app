from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class SemanticChunk(TimestampMixin, Base):
    __tablename__ = "semantic_chunks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    library_id: Mapped[str] = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), index=True)
    corpus_item_id: Mapped[str] = mapped_column(
        ForeignKey("semantic_corpus_items.id", ondelete="CASCADE"),
        index=True,
    )
    start_ms: Mapped[int] = mapped_column(Integer, default=0)
    end_ms: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")
    speaker: Mapped[str | None] = mapped_column(String(255), nullable=True)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    embedding_model: Mapped[str] = mapped_column(String(128), default="")
    embedding_dimensions: Mapped[int] = mapped_column(Integer, default=0)
    embedding_json: Mapped[list[float]] = mapped_column(JSON, default=list)
    embedding_text: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)

    library = relationship("Library", back_populates="semantic_chunks")
    corpus_item = relationship("SemanticCorpusItem", back_populates="chunks")
