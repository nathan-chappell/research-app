from __future__ import annotations

from pydantic import BaseModel, Field


class TranscriptChunkManifest(BaseModel):
    chunk_index: int
    file_name: str
    start_ms: int = 0
    overlap_ms: int = 0
    duration_ms: int | None = None


class TranscriptSegmentResponse(BaseModel):
    id: str
    chunk_index: int
    start_ms: int
    end_ms: int
    text: str
    speaker: str | None = None
    token_count: int = 0
    confidence: float | None = None


class TranscriptionResponse(BaseModel):
    segments: list[TranscriptSegmentResponse] = Field(default_factory=list)
