"""Provider-neutral contract for the language model behind the API (Claude or Gemini)."""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol

from fastapi import Request


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


class LLMService(Protocol):
    async def ask(self, prompt: str) -> LLMReply: ...

    def stream(self, prompt: str) -> AsyncIterator[StreamItem]:
        """Yield the answer's text as it is generated, then the final LLMReply.

        Raises LLMError subclasses, possibly after some text was already yielded.
        """
        ...


def get_llm_service(request: Request) -> LLMService:
    service: LLMService = request.app.state.llm_service
    return service
