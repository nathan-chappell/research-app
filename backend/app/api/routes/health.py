from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import get_settings


router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict[str, object]:
    settings = get_settings()
    semantic_capabilities = request.app.state.semantic_service.capabilities()
    return {
        "status": "ok",
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "semantic_search": {
            "enabled": semantic_capabilities.enabled,
            "retrieval_backend": semantic_capabilities.retrieval_backend,
            "fallback_backend": semantic_capabilities.fallback_backend,
            "working_set_size": semantic_capabilities.working_set_size,
        },
    }
