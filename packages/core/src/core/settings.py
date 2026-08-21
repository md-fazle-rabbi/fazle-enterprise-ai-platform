"""
Shared configuration for every package in this monorepo.
Why centralized: rag-engine, agent-mesh, observability, and governance all read
the same environment variables (DB URL, Redis URL, log level). One source of
truth here means one place to change it, not four separate .env parsers
drifting out of sync with each other.
"""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/fazle"
    )
    redis_url: str = Field(default="redis://localhost:6379/0")


settings = Settings()