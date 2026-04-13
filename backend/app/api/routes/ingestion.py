from __future__ import annotations

import json

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import RequestContext, get_request_context
from app.schemas.ingestion import TranscriptChunkManifest, TranscriptSegmentResponse, TranscriptionResponse
from app.services.deps import get_openai_service
from app.services.openai_service import OpenAIService


router = APIRouter(prefix="/ingestion", tags=["ingestion"])


@router.post("/transcriptions", response_model=TranscriptionResponse)
def transcribe_chunks(
    files: list[UploadFile] = File(default_factory=list),
    chunk_manifest_json: str = Form(default="[]"),
    context: RequestContext = Depends(get_request_context),
    openai_service: OpenAIService = Depends(get_openai_service),
) -> TranscriptionResponse:
    manifests = [item.model_dump() for item in [TranscriptChunkManifest.model_validate(raw) for raw in json.loads(chunk_manifest_json or "[]")]]
    segments = openai_service.transcribe_chunks(
        db=context.db,
        user_id=context.user.id,
        library_id=context.library_id,
        files=files,
        manifests=manifests,
    )
    return TranscriptionResponse(segments=[TranscriptSegmentResponse.model_validate(segment) for segment in segments])
