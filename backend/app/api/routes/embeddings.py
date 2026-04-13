from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import RequestContext, get_request_context
from app.schemas.embeddings import EmbeddingsRequest, EmbeddingsResponse
from app.services.deps import get_openai_service
from app.services.openai_service import OpenAIService


router = APIRouter(prefix="/embeddings", tags=["embeddings"])


@router.post("", response_model=EmbeddingsResponse)
def create_embeddings(
    payload: EmbeddingsRequest,
    context: RequestContext = Depends(get_request_context),
    openai_service: OpenAIService = Depends(get_openai_service),
) -> EmbeddingsResponse:
    if payload.library_id != context.library_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload library_id does not match active library header.",
        )
    model, dimensions, embeddings = openai_service.create_embeddings(
        db=context.db,
        user_id=context.user.id,
        library_id=context.library_id,
        texts=payload.texts,
    )
    return EmbeddingsResponse(model=model, dimensions=dimensions, embeddings=embeddings)
