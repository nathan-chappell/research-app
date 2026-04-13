from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SemanticCapabilitiesResponse(BaseModel):
    enabled: bool
    retrieval_backend: str
    fallback_backend: str | None = None
    embedding_model: str
    embedding_dimensions: int
    working_set_size: int


class SemanticCorpusItemInput(BaseModel):
    id: str
    title: str
    source_file_name: str
    media_type: str
    duration_ms: int | None = None
    imported_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class SemanticChunkInput(BaseModel):
    id: str
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None
    token_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class SemanticTranscriptSyncRequest(BaseModel):
    library_id: str
    corpus_item: SemanticCorpusItemInput
    chunks: list[SemanticChunkInput] = Field(default_factory=list)


class SemanticTranscriptSyncResponse(BaseModel):
    corpus_item_id: str
    chunk_ids: list[str]
    embedded_chunk_ids: list[str]
    chunk_count: int
    embedding_model: str
    embedding_dimensions: int
    last_synced_at: datetime


class SemanticSearchRequest(BaseModel):
    library_id: str
    query: str
    top_k: int = Field(default=200, ge=1, le=500)
    corpus_item_ids: list[str] = Field(default_factory=list)


class SemanticSearchHitResponse(BaseModel):
    id: str
    corpus_item_id: str
    title: str
    source_file_name: str
    text: str
    start_ms: int
    end_ms: int
    speaker: str | None = None
    token_count: int = 0
    score: float
    embedding: list[float] = Field(default_factory=list)


class SemanticSearchResponse(BaseModel):
    query: str
    retrieval_backend: str
    hosted: bool
    hits: list[SemanticSearchHitResponse] = Field(default_factory=list)


class ThemeRepresentativeInput(BaseModel):
    id: str
    text: str
    title: str | None = None
    timestamp_ms: int | None = None


class ThemeClusterInput(BaseModel):
    cluster_id: int
    representatives: list[ThemeRepresentativeInput] = Field(default_factory=list)


class ThemeLabelsRequest(BaseModel):
    library_id: str
    clusters: list[ThemeClusterInput] = Field(default_factory=list)


class ThemeLabelResponse(BaseModel):
    cluster_id: int
    label: str
    explanation: str
    representative_ids: list[str] = Field(default_factory=list)


class ThemeLabelsResponse(BaseModel):
    labels: list[ThemeLabelResponse] = Field(default_factory=list)
