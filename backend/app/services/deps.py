from __future__ import annotations

from fastapi import Request

from app.services.openai_service import OpenAIService


def get_openai_service(request: Request) -> OpenAIService:
    return request.app.state.openai_service
