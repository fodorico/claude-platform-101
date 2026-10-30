from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]
Provider = Literal["claude", "gemini"]


class ModelPrice(BaseModel):
    """USD per million tokens, for cost estimates. `model` matches by prefix the model id the
    provider reports (the longest match wins)."""

    model: str
    input: float
    output: float
    cache_read: float
    cache_write: float


# Standard paid-tier list prices (Claude: platform docs; Gemini: ai.google.dev/pricing), checked
# 2026-10-30. Cache writes are 1.25x input on Claude (5-minute cache); Gemini's implicit cache has
# no write charge.
DEFAULT_MODEL_PRICES = [
    ModelPrice(model="claude-opus-5-5", input=4, output=20, cache_read=0.2, cache_write=5),
    ModelPrice(model="claude-sonnet-5-5", input=2, output=10, cache_read=0.2, cache_write=2.5),
    ModelPrice(
        model="gemini-3.5-flash-lite", input=0.3, output=2.5, cache_read=0.03, cache_write=0
    ),
    # Introductory price until 2026-12-31 ($1.50 / $7.50 from 2027).
    ModelPrice(model="gemini-3.6-flash", input=0.75, output=3.75, cache_read=0.075, cache_write=0),
]


class Settings(BaseSettings):
    """Application settings, read from environment variables or a local `.env` file."""

    # Empty variables (as copied from .env.example) mean "use the default".
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/app"

    # The provider used when a request doesn't pick one.
    llm_provider: Provider = "claude"
    max_tokens: int = Field(default=16000, gt=0)
    timeout_seconds: float = Field(default=60.0, gt=0)
    system_prompt: str = (
        "You are a helpful assistant. Answer briefly and simply, in the language of the question."
    )

    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-opus-5-5"
    # Short, simple answers: low effort keeps latency and cost down.
    anthropic_effort: Effort = "low"
    # Models offered in the model picker, besides ANTHROPIC_MODEL (JSON list in the environment).
    anthropic_models: list[str] = ["claude-opus-5-5", "claude-sonnet-5-5"]

    gemini_api_key: SecretStr | None = None
    # Lite: fastest and cheapest, enough for short answers (flash-latest was timing out).
    gemini_model: str = "gemini-flash-lite-latest"
    gemini_models: list[str] = ["gemini-flash-lite-latest", "gemini-flash-latest"]

    # JSON list in the environment to override the prices used for cost estimates.
    model_prices: list[ModelPrice] = DEFAULT_MODEL_PRICES

    cors_origins: list[str] = ["http://localhost:5173"]

    def models_for(self, provider: Provider) -> list[str]:
        """The models offered for a provider, its configured default first."""
        if provider == "gemini":
            default, offered = self.gemini_model, self.gemini_models
        else:
            default, offered = self.anthropic_model, self.anthropic_models
        return [default, *(model for model in offered if model != default)]


@lru_cache
def get_settings() -> Settings:
    return Settings()
