from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import SemanticChunk, SemanticCorpusItem, UsageEvent
from app.services.openai_service import OpenAIService


@dataclass
class SemanticCapabilities:
    enabled: bool
    retrieval_backend: str
    fallback_backend: str | None
    embedding_model: str
    embedding_dimensions: int
    working_set_size: int


@dataclass
class SemanticTranscriptSyncResult:
    corpus_item_id: str
    chunk_ids: list[str]
    embedded_chunk_ids: list[str]
    chunk_count: int
    embedding_model: str
    embedding_dimensions: int
    last_synced_at: datetime


@dataclass
class SemanticSearchHit:
    id: str
    corpus_item_id: str
    title: str
    source_file_name: str
    text: str
    start_ms: int
    end_ms: int
    speaker: str | None
    token_count: int
    score: float
    embedding: list[float]


class SemanticSearchService:
    def __init__(self, settings: Settings, engine: Engine, openai_service: OpenAIService):
        self.settings = settings
        self.engine = engine
        self.openai_service = openai_service
        self._pgvector_available = False

    def initialize(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self._pgvector_available = False
            return

        try:
            with self.engine.begin() as connection:
                connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
            self._pgvector_available = True
        except Exception:
            self._pgvector_available = False

    def capabilities(self) -> SemanticCapabilities:
        return SemanticCapabilities(
            enabled=self._pgvector_available,
            retrieval_backend="pgvector" if self._pgvector_available else "python",
            fallback_backend="local-browser" if not self._pgvector_available else None,
            embedding_model=self.settings.embedding_model,
            embedding_dimensions=self.settings.embedding_dimensions,
            working_set_size=self.settings.semantic_working_set_size,
        )

    def _record_usage(
        self,
        db: Session,
        *,
        user_id: str,
        library_id: str,
        kind: str,
        quantity: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        db.add(
            UsageEvent(
                user_id=user_id,
                library_id=library_id,
                thread_id=None,
                kind=kind,
                model=self.settings.embedding_model,
                quantity=quantity,
                metadata_json=metadata or {},
            )
        )
        db.commit()

    def _content_hash(self, chunk: dict[str, Any]) -> str:
        payload = "|".join(
            [
                str(chunk.get("start_ms") or 0),
                str(chunk.get("end_ms") or 0),
                str(chunk.get("speaker") or ""),
                str(chunk.get("text") or ""),
            ]
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _vector_text(self, vector: list[float]) -> str:
        return "[" + ",".join(f"{value:.8f}" for value in vector) + "]"

    def _cosine_similarity(self, left: list[float], right: list[float]) -> float:
        dot = 0.0
        left_norm = 0.0
        right_norm = 0.0
        for left_value, right_value in zip(left, right, strict=False):
            dot += left_value * right_value
            left_norm += left_value * left_value
            right_norm += right_value * right_value
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return dot / (math.sqrt(left_norm) * math.sqrt(right_norm))

    def upsert_transcript(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        corpus_item: dict[str, Any],
        chunks: list[dict[str, Any]],
    ) -> SemanticTranscriptSyncResult:
        now = datetime.now(timezone.utc)
        row = (
            db.query(SemanticCorpusItem)
            .filter(
                SemanticCorpusItem.id == corpus_item["id"],
                SemanticCorpusItem.library_id == library_id,
            )
            .one_or_none()
        )
        if row is None:
            row = SemanticCorpusItem(id=corpus_item["id"], library_id=library_id)

        row.title = corpus_item.get("title") or "Untitled"
        row.source_file_name = corpus_item.get("source_file_name") or ""
        row.media_type = corpus_item.get("media_type") or ""
        row.duration_ms = corpus_item.get("duration_ms")
        row.imported_at = corpus_item.get("imported_at")
        row.last_synced_at = now
        row.metadata_json = corpus_item.get("metadata") or {}
        db.add(row)
        db.flush()

        existing_chunks = {
            chunk.id: chunk
            for chunk in db.query(SemanticChunk)
            .filter(
                SemanticChunk.library_id == library_id,
                SemanticChunk.corpus_item_id == row.id,
            )
            .all()
        }
        incoming_ids: set[str] = set()
        changed_ids: list[str] = []
        texts_to_embed: list[str] = []

        for chunk in chunks:
            incoming_ids.add(chunk["id"])
            chunk_hash = self._content_hash(chunk)
            existing = existing_chunks.get(chunk["id"])
            if existing is None or existing.content_hash != chunk_hash or not existing.embedding_json:
                changed_ids.append(chunk["id"])
                texts_to_embed.append(chunk.get("text") or "")

        if changed_ids:
            embedding_model, embedding_dimensions, embeddings = self.openai_service.create_embeddings(
                db=db,
                user_id=user_id,
                library_id=library_id,
                texts=texts_to_embed,
            )
            embeddings_by_id = dict(zip(changed_ids, embeddings, strict=True))
        else:
            embedding_model = self.settings.embedding_model
            embedding_dimensions = self.settings.embedding_dimensions
            embeddings_by_id = {}

        for chunk in chunks:
            chunk_id = chunk["id"]
            chunk_hash = self._content_hash(chunk)
            semantic_chunk = existing_chunks.get(chunk_id)
            if semantic_chunk is None:
                semantic_chunk = SemanticChunk(
                    id=chunk_id,
                    library_id=library_id,
                    corpus_item_id=row.id,
                )

            vector = list(semantic_chunk.embedding_json or [])
            if chunk_id in embeddings_by_id:
                vector = embeddings_by_id[chunk_id]

            semantic_chunk.library_id = library_id
            semantic_chunk.corpus_item_id = row.id
            semantic_chunk.start_ms = int(chunk.get("start_ms") or 0)
            semantic_chunk.end_ms = int(chunk.get("end_ms") or 0)
            semantic_chunk.text = str(chunk.get("text") or "")
            semantic_chunk.speaker = chunk.get("speaker")
            semantic_chunk.token_count = int(chunk.get("token_count") or 0)
            semantic_chunk.content_hash = chunk_hash
            semantic_chunk.embedding_model = (
                embedding_model if chunk_id in embeddings_by_id else semantic_chunk.embedding_model or self.settings.embedding_model
            )
            semantic_chunk.embedding_dimensions = (
                embedding_dimensions
                if chunk_id in embeddings_by_id
                else semantic_chunk.embedding_dimensions or self.settings.embedding_dimensions
            )
            semantic_chunk.embedding_json = vector
            semantic_chunk.embedding_text = self._vector_text(vector)
            semantic_chunk.metadata_json = chunk.get("metadata") or {}
            db.add(semantic_chunk)

        for existing_id, existing in existing_chunks.items():
            if existing_id not in incoming_ids:
                db.delete(existing)

        db.commit()
        return SemanticTranscriptSyncResult(
            corpus_item_id=row.id,
            chunk_ids=[chunk["id"] for chunk in chunks],
            embedded_chunk_ids=changed_ids,
            chunk_count=len(chunks),
            embedding_model=embedding_model,
            embedding_dimensions=embedding_dimensions,
            last_synced_at=now,
        )

    def search(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        query: str,
        top_k: int,
        corpus_item_ids: list[str],
    ) -> tuple[str, list[SemanticSearchHit]]:
        _, _, embeddings = self.openai_service.create_embeddings(
            db=db,
            user_id=user_id,
            library_id=library_id,
            texts=[query],
        )
        query_vector = embeddings[0] if embeddings else []

        backend = "pgvector" if self._pgvector_available else "python"
        hits = (
            self._search_pgvector(
                db=db,
                library_id=library_id,
                query_vector=query_vector,
                top_k=top_k,
                corpus_item_ids=corpus_item_ids,
            )
            if self._pgvector_available
            else []
        )
        if not hits:
            backend = "python"
            hits = self._search_python(
                db=db,
                library_id=library_id,
                query_vector=query_vector,
                top_k=top_k,
                corpus_item_ids=corpus_item_ids,
            )

        self._record_usage(
            db,
            user_id=user_id,
            library_id=library_id,
            kind="semantic_search",
            quantity=len(hits),
            metadata={
                "backend": backend,
                "query_length": len(query),
                "top_k": top_k,
                "corpus_item_ids": corpus_item_ids,
            },
        )
        return backend, hits

    def _search_pgvector(
        self,
        *,
        db: Session,
        library_id: str,
        query_vector: list[float],
        top_k: int,
        corpus_item_ids: list[str],
    ) -> list[SemanticSearchHit]:
        try:
            sql = """
                SELECT
                    sc.id,
                    sc.corpus_item_id,
                    sci.title,
                    sci.source_file_name,
                    sc.text,
                    sc.start_ms,
                    sc.end_ms,
                    sc.speaker,
                    sc.token_count,
                    sc.embedding_json,
                    1 - (CAST(sc.embedding_text AS vector) <=> CAST(:query_vector AS vector)) AS score
                FROM semantic_chunks sc
                JOIN semantic_corpus_items sci ON sci.id = sc.corpus_item_id
                WHERE sc.library_id = :library_id
            """
            if corpus_item_ids:
                sql += " AND sc.corpus_item_id IN :corpus_item_ids"
            sql += """
                ORDER BY CAST(sc.embedding_text AS vector) <=> CAST(:query_vector AS vector)
                LIMIT :top_k
            """
            statement = text(sql)
            if corpus_item_ids:
                statement = statement.bindparams(bindparam("corpus_item_ids", expanding=True))
            rows = db.execute(
                statement,
                {
                    "library_id": library_id,
                    "query_vector": self._vector_text(query_vector),
                    "corpus_item_ids": corpus_item_ids,
                    "top_k": top_k,
                },
            ).mappings()
        except Exception:
            return []

        return [
            SemanticSearchHit(
                id=str(row["id"]),
                corpus_item_id=str(row["corpus_item_id"]),
                title=str(row["title"] or "Untitled"),
                source_file_name=str(row["source_file_name"] or ""),
                text=str(row["text"] or ""),
                start_ms=int(row["start_ms"] or 0),
                end_ms=int(row["end_ms"] or 0),
                speaker=row["speaker"],
                token_count=int(row["token_count"] or 0),
                score=float(row["score"] or 0.0),
                embedding=list(row["embedding_json"] or []),
            )
            for row in rows
        ]

    def _search_python(
        self,
        *,
        db: Session,
        library_id: str,
        query_vector: list[float],
        top_k: int,
        corpus_item_ids: list[str],
    ) -> list[SemanticSearchHit]:
        query = (
            db.query(SemanticChunk, SemanticCorpusItem)
            .join(SemanticCorpusItem, SemanticCorpusItem.id == SemanticChunk.corpus_item_id)
            .filter(SemanticChunk.library_id == library_id)
        )
        if corpus_item_ids:
            query = query.filter(SemanticChunk.corpus_item_id.in_(corpus_item_ids))

        ranked: list[SemanticSearchHit] = []
        for chunk, corpus_item in query.all():
            embedding = list(chunk.embedding_json or [])
            if not embedding:
                continue
            ranked.append(
                SemanticSearchHit(
                    id=chunk.id,
                    corpus_item_id=chunk.corpus_item_id,
                    title=corpus_item.title,
                    source_file_name=corpus_item.source_file_name,
                    text=chunk.text,
                    start_ms=chunk.start_ms,
                    end_ms=chunk.end_ms,
                    speaker=chunk.speaker,
                    token_count=chunk.token_count,
                    score=self._cosine_similarity(query_vector, embedding),
                    embedding=embedding,
                )
            )

        ranked.sort(key=lambda hit: hit.score, reverse=True)
        return ranked[:top_k]

    def label_themes(
        self,
        *,
        db: Session,
        user_id: str,
        library_id: str,
        clusters: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return self.openai_service.label_themes(
            db=db,
            user_id=user_id,
            library_id=library_id,
            clusters=clusters,
        )
