"""Provider-neutral contract for the language models behind the API (Claude and Gemini)."""

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from fastapi import Request


@dataclass(frozen=True)
class Image:
    """An image attached to a user message."""

    media_type: str
    data: bytes


@dataclass(frozen=True)
class Turn:
    """One message of a conversation, oldest first; the last one is the user's new message."""

    role: Literal["user", "assistant"]
    text: str
    images: tuple[Image, ...] = ()


@dataclass(frozen=True)
class GenerationOptions:
    """Per-request settings; None means the configured default."""

    system: str | None = None
    max_tokens: int | None = None
    # Only Gemini accepts it: current Claude models reject sampling parameters.
    temperature: float | None = None
    # Return the model's reasoning (a summary of it) along with the answer.
    show_thinking: bool = False


@dataclass(frozen=True)
class LLMReply:
    text: str
    model: str
    stop_reason: str
    input_tokens: int
    output_tokens: int
    thinking: str = ""
    # Prompt caching: input tokens read from / written to the provider's cache.
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    # The request as sent (without the messages) and the usage as returned, for inspection.
    request: dict[str, Any] = field(default_factory=dict)
    usage: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ThinkingDelta:
    """A piece of the model's reasoning, streamed before (or between) pieces of the answer."""

    text: str


# A stream yields text deltas (str) and reasoning (ThinkingDelta) as they arrive, and ends with
# the complete LLMReply.
StreamItem = str | ThinkingDelta | LLMReply


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
        options: GenerationOptions | None = None,
    ) -> LLMReply:
        """Answer in one go."""
        ...

    def stream(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> AsyncIterator[StreamItem]:
        """Yield the answer's text (and reasoning) as it is generated, then the final LLMReply.

        Raises LLMError subclasses, possibly after some text was already yielded.
        """
        ...

    async def count_tokens(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> int:
        """How many input tokens the request would use, without generating an answer."""
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
