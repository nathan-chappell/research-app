from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import chatkit, embeddings, health, ingestion, libraries, semantic, threads
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import engine
from app.chatkit.server import ResearchChatKitServer
from app.chatkit.store import SQLAlchemyAttachmentStore, SQLAlchemyChatKitStore
from app.services.openai_service import OpenAIService
from app.services.semantic_service import SemanticSearchService


def _resolve_frontend_dist(settings: Settings) -> Path:
    frontend_dist = Path(settings.frontend_dist_path).expanduser().resolve()
    index_path = frontend_dist / "index.html"
    if not frontend_dist.is_dir() or not index_path.is_file():
        raise RuntimeError(
            "Built frontend assets are required before backend startup. "
            f"Expected {index_path}."
        )
    return frontend_dist


def _frontend_response(frontend_dist: Path, requested_path: str | None = None) -> FileResponse:
    if requested_path:
        candidate = (frontend_dist / requested_path.lstrip("/")).resolve()
        if candidate.is_file() and candidate.is_relative_to(frontend_dist):
            return FileResponse(candidate)
    return FileResponse(frontend_dist / "index.html")


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or get_settings()
    frontend_dist = Path(resolved_settings.frontend_dist_path).expanduser().resolve()
    api_prefix = resolved_settings.api_prefix.strip("/")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        resolved_frontend_dist = _resolve_frontend_dist(resolved_settings)
        Base.metadata.create_all(bind=engine)
        openai_service = OpenAIService(resolved_settings)
        semantic_service = SemanticSearchService(resolved_settings, engine, openai_service)
        semantic_service.initialize()
        app.state.openai_service = openai_service
        app.state.semantic_service = semantic_service
        app.state.frontend_dist = resolved_frontend_dist
        app.state.chatkit_server = ResearchChatKitServer(
            store=SQLAlchemyChatKitStore(),
            attachment_store=SQLAlchemyAttachmentStore(),
            openai_service=openai_service,
        )
        yield

    app = FastAPI(title=resolved_settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(libraries.router, prefix=resolved_settings.api_prefix)
    app.include_router(ingestion.router, prefix=resolved_settings.api_prefix)
    app.include_router(embeddings.router, prefix=resolved_settings.api_prefix)
    app.include_router(semantic.router, prefix=resolved_settings.api_prefix)
    app.include_router(threads.router, prefix=resolved_settings.api_prefix)
    app.include_router(chatkit.router, prefix=resolved_settings.api_prefix)

    @app.get("/", include_in_schema=False)
    async def frontend_root():
        return _frontend_response(frontend_dist)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def frontend_app(full_path: str):
        if full_path == api_prefix or full_path.startswith(f"{api_prefix}/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
        return _frontend_response(frontend_dist, full_path)

    return app


app = create_app()
