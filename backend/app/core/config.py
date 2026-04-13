from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RESEARCH_APP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Research App API"
    api_prefix: str = "/api"
    debug: bool = False

    database_url: str = "sqlite:///./research_app.db"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    auth_disabled: bool = True
    oidc_issuer: str | None = None
    oidc_audience: str | None = None
    oidc_jwks_url: str | None = None
    dev_user_subject: str = "dev-user"
    dev_user_email: str = "dev@example.com"
    dev_user_name: str = "Local Developer"

    openai_api_key: str | None = None
    openai_base_url: str | None = None
    transcription_model: str = "gpt-4o-transcribe-diarize"
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 256
    semantic_working_set_size: int = 200
    answer_model: str = "gpt-5.4"
    answer_reasoning_effort: str = "low"
    answer_text_verbosity: str = "medium"

    chatkit_domain_key: str = "dev-domain-key"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
