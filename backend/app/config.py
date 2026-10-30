from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class Settings(BaseSettings):
    """Application settings, read from environment variables or a local `.env` file."""

    # Empty variables (as copied from .env.example) mean "use the default".
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/app"

    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-opus-5-5"
    # Short, simple answers: low effort keeps latency and cost down.
    anthropic_effort: Effort = "low"
    anthropic_max_tokens: int = Field(default=16000, gt=0)
    anthropic_timeout_seconds: float = Field(default=60.0, gt=0)
    system_prompt: str = (
        "You are a helpful assistant. Answer briefly and simply, in the language of the question."
    )

    cors_origins: list[str] = ["http://localhost:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
