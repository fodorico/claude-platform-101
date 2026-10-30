import base64
import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

import anthropic
from anthropic.types.beta import BetaMessage

from app.config import Effort
from app.services.llm import (
    GenerationOptions,
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
    StreamItem,
    ThinkingDelta,
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

    def _params(self, model: str, options: GenerationOptions) -> dict[str, Any]:
        """The request without its messages; options.temperature is left out on purpose."""
        params: dict[str, Any] = {
            "model": model,
            "max_tokens": options.max_tokens or self._max_tokens,
            "system": options.system or self._system_prompt,
            "output_config": {"effort": self._effort},
            # Automatic prompt caching: the conversation so far is read back from the cache on
            # the next message instead of being processed again.
            "cache_control": {"type": "ephemeral"},
            "betas": [FALLBACK_BETA],
            "fallbacks": "default",
        }
        if options.show_thinking:
            # Thinking is on by default; its text (a summary) is only returned when asked for.
            params["thinking"] = {"type": "adaptive", "display": "summarized"}
        return params

    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> LLMReply:
        params = self._params(model, options or GenerationOptions())
        try:
            response = await self._client.beta.messages.create(
                **params, messages=_messages(messages)
            )
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc
        return _to_reply(response, params)

    async def stream(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> AsyncIterator[StreamItem]:
        params = self._params(model, options or GenerationOptions())
        try:
            async with self._client.beta.messages.stream(
                **params, messages=_messages(messages)
            ) as stream:
                async for event in stream:
                    if event.type != "content_block_delta":
                        continue
                    if event.delta.type == "text_delta":
                        yield event.delta.text
                    elif event.delta.type == "thinking_delta":
                        yield ThinkingDelta(event.delta.thinking)
                response = await stream.get_final_message()
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc
        yield _to_reply(response, params)

    async def count_tokens(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> int:
        options = options or GenerationOptions()
        try:
            result = await self._client.beta.messages.count_tokens(
                model=model,
                system=options.system or self._system_prompt,
                messages=_messages(messages),
            )
        except anthropic.APIError as exc:
            raise _map_error(exc) from exc
        return result.input_tokens


def _messages(turns: Sequence[Turn]) -> list[Any]:
    """The turns as Messages API messages (plain dicts in the API's shape)."""
    messages: list[Any] = []
    for turn in turns:
        if not turn.images:
            messages.append({"role": turn.role, "content": turn.text})
            continue
        images = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": base64.b64encode(image.data).decode(),
                },
            }
            for image in turn.images
        ]
        messages.append(
            {"role": turn.role, "content": [*images, {"type": "text", "text": turn.text}]}
        )
    return messages


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


def _to_reply(response: BetaMessage, params: dict[str, Any]) -> LLMReply:
    if response.stop_reason == "refusal":
        category = response.stop_details.category if response.stop_details else None
        # Streamed messages carry no request id.
        request_id = getattr(response, "_request_id", None)
        logger.info("Claude declined request_id=%s category=%s", request_id, category)
        raise LLMRefusalError("Claude declined to answer this message")

    text = "".join(block.text for block in response.content if block.type == "text")
    thinking = "\n\n".join(
        block.thinking for block in response.content if block.type == "thinking" and block.thinking
    )
    usage = response.usage
    return LLMReply(
        text=text,
        model=response.model,
        stop_reason=response.stop_reason or "unknown",
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        thinking=thinking,
        cache_read_tokens=usage.cache_read_input_tokens or 0,
        cache_write_tokens=usage.cache_creation_input_tokens or 0,
        request=params,
        usage=usage.model_dump(mode="json", exclude_none=True),
    )
