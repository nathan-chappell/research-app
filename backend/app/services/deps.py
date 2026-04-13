from __future__ import annotations

from fastapi import Request

from app.services.openai_service import OpenAIService
from app.services.semantic_service import SemanticSearchService


def get_openai_service(request: Request) -> OpenAIService:
    return request.app.state.openai_service


def get_semantic_service(request: Request) -> SemanticSearchService:
    return request.app.state.semantic_service
