"""Provider-neutral contract for the language models behind the API (Claude and Gemini)."""

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from fastapi import Request


@dataclass(frozen=True)
class Turn:
    """One message of a conversation, oldest first; the last one is the user's new message."""

    role: Literal["user", "assistant"]
    text: str


@dataclass(frozen=True)
class LLMReply:
    text: str
    model: str
    stop_reason: str
    input_tokens: int
    output_tokens: int


# A stream yields text deltas (str) as they arrive and ends with the complete LLMReply.
StreamItem = str | LLMReply


class LLMError(Exception):
    """Base class for errors talking to the model provider."""


class LLMRefusalError(LLMError):
    """The model declined to answer the request."""


class LLMUnavailableError(LLMError):
    """The provider could not be reached or returned an error; retrying later may work."""


class LLMRateLimitError(LLMError):
    """The provider's rate limit was hit."""


class LLMSelectionError(LLMError):
    """The requested provider or model can't be used."""


class LLMService(Protocol):
    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMReply:
        """Answer in one go; `system` and `max_tokens` override the configured ones."""
        ...

    def stream(self, messages: Sequence[Turn], *, model: str) -> AsyncIterator[StreamItem]:
        """Yield the answer's text as it is generated, then the final LLMReply.

        Raises LLMError subclasses, possibly after some text was already yielded.
        """
        ...


@dataclass(frozen=True)
class ProviderModels:
    provider: str
    models: list[str]
    available: bool


class LLMRegistry:
    """The configured providers, the models offered for each, and the default choice."""

    def __init__(
        self,
        services: Mapping[str, LLMService],
        models: Mapping[str, list[str]],
        *,
        default_provider: str,
    ) -> None:
        self._services = dict(services)
        self._models = {provider: list(names) for provider, names in models.items()}
        self.default_provider = default_provider

    @property
    def providers(self) -> list[ProviderModels]:
        return [
            ProviderModels(provider, models, provider in self._services)
            for provider, models in self._models.items()
        ]

    def default_model(self, provider: str) -> str:
        return self._models[provider][0]

    def resolve(self, provider: str | None, model: str | None) -> tuple[str, str, LLMService]:
        """Pick the service and model for a request; None means the default."""
        provider = provider or self.default_provider
        service = self._services.get(provider)
        if service is None:
            raise LLMSelectionError(f"The {provider} provider is not configured")
        model = model or self.default_model(provider)
        if model not in self._models[provider]:
            raise LLMSelectionError(f"The model {model} is not offered for {provider}")
        return provider, model, service


def get_llm_registry(request: Request) -> LLMRegistry:
    registry: LLMRegistry = request.app.state.llm_registry
    return registry
