"""
Shared configuration for every package in this monorepo.
Why centralized: rag-engine, agent-mesh, observability, and governance all read
the same environment variables (DB URL, Redis URL, log level). One source of
truth here means one place to change it, not four separate .env parsers
drifting out of sync with each other.
"""
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Absolute path to the repo-root .env file, resolved from this file's own
# location rather than the process's current working directory. Without
# this, pydantic-settings looks for ".env" relative to wherever the command
# was launched from (e.g. packages/rag-engine/), silently finds nothing
# there, and falls back to the hardcoded default below with no warning.
_ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development")
    log_level: str = Field(default="INFO")
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/fazle"
    )
    redis_url: str = Field(default="redis://localhost:6379/0")
    app_database_url: str = Field(
        default="postgresql+asyncpg://app_user:change_me@localhost:5432/fazle"
    )
    app_db_password: str = Field(default="change_me_locally")


settings = Settings()