from __future__ import annotations

from pydantic import BaseModel, Field


class EmbeddingsRequest(BaseModel):
    library_id: str
    texts: list[str] = Field(default_factory=list)
    owner_type: str = "transcript_segment"
    owner_ids: list[str] = Field(default_factory=list)


class EmbeddingsResponse(BaseModel):
    model: str
    dimensions: int
    embeddings: list[list[float]]
