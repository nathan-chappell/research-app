from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import chatkit, embeddings, health, ingestion, libraries, threads
from app.core.config import Settings, get_settings
from app.db.base import Base
from app.db.session import engine
from app.chatkit.server import ResearchChatKitServer
from app.chatkit.store import SQLAlchemyAttachmentStore, SQLAlchemyChatKitStore
from app.services.openai_service import OpenAIService


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings = get_settings()
    openai_service = OpenAIService(settings)
    app.state.openai_service = openai_service
    app.state.chatkit_server = ResearchChatKitServer(
        store=SQLAlchemyChatKitStore(),
        attachment_store=SQLAlchemyAttachmentStore(),
        openai_service=openai_service,
    )
    yield


app = FastAPI(title=get_settings().app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(health.router)
app.include_router(libraries.router, prefix=get_settings().api_prefix)
app.include_router(ingestion.router, prefix=get_settings().api_prefix)
app.include_router(embeddings.router, prefix=get_settings().api_prefix)
app.include_router(threads.router, prefix=get_settings().api_prefix)
app.include_router(chatkit.router, prefix=get_settings().api_prefix)
