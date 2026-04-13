from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import RequestContext, get_request_context
from app.schemas.semantic import (
    SemanticCapabilitiesResponse,
    SemanticSearchHitResponse,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SemanticTranscriptSyncRequest,
    SemanticTranscriptSyncResponse,
    ThemeLabelResponse,
    ThemeLabelsRequest,
    ThemeLabelsResponse,
)
from app.services.deps import get_semantic_service
from app.services.semantic_service import SemanticSearchService


router = APIRouter(prefix="/semantic", tags=["semantic"])


@router.get("/capabilities", response_model=SemanticCapabilitiesResponse)
def semantic_capabilities(
    semantic_service: SemanticSearchService = Depends(get_semantic_service),
) -> SemanticCapabilitiesResponse:
    capabilities = semantic_service.capabilities()
    return SemanticCapabilitiesResponse(
        enabled=capabilities.enabled,
        retrieval_backend=capabilities.retrieval_backend,
        fallback_backend=capabilities.fallback_backend,
        embedding_model=capabilities.embedding_model,
        embedding_dimensions=capabilities.embedding_dimensions,
        working_set_size=capabilities.working_set_size,
    )


@router.post("/sync", response_model=SemanticTranscriptSyncResponse)
def sync_transcript(
    payload: SemanticTranscriptSyncRequest,
    context: RequestContext = Depends(get_request_context),
    semantic_service: SemanticSearchService = Depends(get_semantic_service),
) -> SemanticTranscriptSyncResponse:
    if payload.library_id != context.library_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload library_id does not match active library header.",
        )

    result = semantic_service.upsert_transcript(
        db=context.db,
        user_id=context.user.id,
        library_id=context.library_id,
        corpus_item=payload.corpus_item.model_dump(),
        chunks=[chunk.model_dump() for chunk in payload.chunks],
    )
    return SemanticTranscriptSyncResponse(
        corpus_item_id=result.corpus_item_id,
        chunk_ids=result.chunk_ids,
        embedded_chunk_ids=result.embedded_chunk_ids,
        chunk_count=result.chunk_count,
        embedding_model=result.embedding_model,
        embedding_dimensions=result.embedding_dimensions,
        last_synced_at=result.last_synced_at,
    )


@router.post("/search", response_model=SemanticSearchResponse)
def semantic_search(
    payload: SemanticSearchRequest,
    context: RequestContext = Depends(get_request_context),
    semantic_service: SemanticSearchService = Depends(get_semantic_service),
) -> SemanticSearchResponse:
    if payload.library_id != context.library_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload library_id does not match active library header.",
        )

    backend, hits = semantic_service.search(
        db=context.db,
        user_id=context.user.id,
        library_id=context.library_id,
        query=payload.query,
        top_k=payload.top_k,
        corpus_item_ids=payload.corpus_item_ids,
    )
    return SemanticSearchResponse(
        query=payload.query,
        retrieval_backend=backend,
        hosted=semantic_service.capabilities().enabled,
        hits=[
            SemanticSearchHitResponse(
                id=hit.id,
                corpus_item_id=hit.corpus_item_id,
                title=hit.title,
                source_file_name=hit.source_file_name,
                text=hit.text,
                start_ms=hit.start_ms,
                end_ms=hit.end_ms,
                speaker=hit.speaker,
                token_count=hit.token_count,
                score=hit.score,
                embedding=hit.embedding,
            )
            for hit in hits
        ],
    )


@router.post("/themes/labels", response_model=ThemeLabelsResponse)
def theme_labels(
    payload: ThemeLabelsRequest,
    context: RequestContext = Depends(get_request_context),
    semantic_service: SemanticSearchService = Depends(get_semantic_service),
) -> ThemeLabelsResponse:
    if payload.library_id != context.library_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload library_id does not match active library header.",
        )

    labels = semantic_service.label_themes(
        db=context.db,
        user_id=context.user.id,
        library_id=context.library_id,
        clusters=[cluster.model_dump() for cluster in payload.clusters],
    )
    return ThemeLabelsResponse(
        labels=[
            ThemeLabelResponse(
                cluster_id=payload.clusters[index].cluster_id,
                label=result["label"],
                explanation=result["explanation"],
                representative_ids=[
                    representative.id for representative in payload.clusters[index].representatives
                ],
            )
            for index, result in enumerate(labels)
        ]
    )
