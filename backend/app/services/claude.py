import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

import anthropic
from anthropic.types.beta import BetaMessage

from app.config import Effort
from app.services.llm import (
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
    StreamItem,
    Turn,
)

logger = logging.getLogger(__name__)

# "default" fallbacks: if the model declines for policy reasons, the API retries on
# Anthropic's recommended substitute model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class ClaudeService:
    def __init__(
        self,
        client: anthropic.AsyncAnthropic,
        *,
        effort: Effort,
        max_tokens: int,
        system_prompt: str,
    ) -> None:
        self._client = client
        self._effort: Effort = effort
        self._max_tokens = max_tokens
        self._system_prompt = system_prompt

    def _request(
        self,
        messages: Sequence[Turn],
        model: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        return {
            "model": model,
            "max_tokens": max_tokens or self._max_tokens,
            "system": system or self._system_prompt,
            "output_config": {"effort": self._effort},
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
            "messages": [{"role": turn.role, "content": turn.text} for turn in messages],
        }

    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMReply:
        request = self._request(messages, model, system, max_tokens)
        try:
            response = await self._client.beta.messages.create(**request)
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc
        return _to_reply(response)

    async def stream(self, messages: Sequence[Turn], *, model: str) -> AsyncIterator[StreamItem]:
        try:
            async with self._client.beta.messages.stream(
                **self._request(messages, model)
            ) as stream:
                async for text in stream.text_stream:
                    yield text
                response = await stream.get_final_message()
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc
        yield _to_reply(response)


def _map_error(exc: anthropic.APIError) -> Exception:
    if isinstance(exc, anthropic.RateLimitError):
        return LLMRateLimitError("Rate limit reached")
    if isinstance(exc, anthropic.APIStatusError):
        logger.error(
            "Claude API error status=%s request_id=%s message=%s",
            exc.status_code,
            exc.request_id,
            exc.message,
        )
        return LLMUnavailableError("The Claude API returned an error")
    return LLMUnavailableError("Could not reach the Claude API")


def _to_reply(response: BetaMessage) -> LLMReply:
    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        # Streamed messages carry no request id.
        request_id = getattr(response, "_request_id", None)
        logger.info("Claude declined request_id=%s category=%s", request_id, category)
        raise LLMRefusalError("Claude declined to answer this message")

    text = "".join(block.text for block in response.content if block.type == "text")
    return LLMReply(
        text=text,
        model=response.model,
        stop_reason=response.stop_reason or "unknown",
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )
