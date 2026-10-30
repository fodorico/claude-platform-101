import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

from google import genai
from google.genai import errors, types

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

# Finish reasons that mean Gemini withheld the answer for policy reasons.
REFUSAL_FINISH_REASONS = {
    types.FinishReason.SAFETY,
    types.FinishReason.RECITATION,
    types.FinishReason.BLOCKLIST,
    types.FinishReason.PROHIBITED_CONTENT,
    types.FinishReason.SPII,
}


class GeminiService:
    def __init__(
        self,
        client: genai.Client,
        *,
        max_tokens: int,
        system_prompt: str,
    ) -> None:
        self._client = client
        self._max_tokens = max_tokens
        self._system_prompt = system_prompt

    def _config(self, options: GenerationOptions) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            system_instruction=options.system or self._system_prompt,
            max_output_tokens=options.max_tokens or self._max_tokens,
            temperature=options.temperature,
            # Thought summaries come back as parts marked `thought`. Flash-Lite doesn't think
            # unless given a budget; -1 lets the model decide how much.
            thinking_config=types.ThinkingConfig(include_thoughts=True, thinking_budget=-1)
            if options.show_thinking
            else None,
        )

    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> LLMReply:
        config = self._config(options or GenerationOptions())
        try:
            response = await self._client.aio.models.generate_content(
                model=model, contents=_contents(messages), config=config
            )
        except (errors.APIError, OSError) as exc:
            raise _map_error(exc) from exc
        _raise_if_refused(response)
        text, thinking = _split_parts(response)
        return _to_reply(text, thinking, response, model, config)

    async def stream(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> AsyncIterator[StreamItem]:
        config = self._config(options or GenerationOptions())
        parts: list[str] = []
        thoughts: list[str] = []
        last: types.GenerateContentResponse | None = None
        try:
            chunks = await self._client.aio.models.generate_content_stream(
                model=model, contents=_contents(messages), config=config
            )
            async for chunk in chunks:
                _raise_if_refused(chunk)
                last = chunk
                text, thinking = _split_parts(chunk)
                if thinking:
                    thoughts.append(thinking)
                    yield ThinkingDelta(thinking)
                if text:
                    parts.append(text)
                    yield text
        except (errors.APIError, OSError) as exc:
            raise _map_error(exc) from exc
        yield _to_reply("".join(parts), "".join(thoughts), last, model, config)

    async def count_tokens(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        options: GenerationOptions | None = None,
    ) -> int:
        # The Gemini API counts the messages only, not the system instruction.
        try:
            result = await self._client.aio.models.count_tokens(
                model=model, contents=_contents(messages)
            )
        except (errors.APIError, OSError) as exc:
            raise _map_error(exc) from exc
        return result.total_tokens or 0


def _contents(messages: Sequence[Turn]) -> list[types.Content]:
    # Gemini calls the assistant's role "model".
    return [
        types.Content(
            role="model" if turn.role == "assistant" else "user",
            parts=[
                *(
                    types.Part.from_bytes(data=image.data, mime_type=image.media_type)
                    for image in turn.images
                ),
                types.Part(text=turn.text),
            ],
        )
        for turn in messages
    ]


def _split_parts(response: types.GenerateContentResponse) -> tuple[str, str]:
    """The answer's text and the thought summaries in a response (or chunk)."""
    candidate = response.candidates[0] if response.candidates else None
    content_parts = candidate.content.parts if candidate and candidate.content else None
    text: list[str] = []
    thinking: list[str] = []
    for part in content_parts or []:
        if part.text:
            (thinking if part.thought else text).append(part.text)
    return "".join(text), "".join(thinking)


def _to_reply(
    text: str,
    thinking: str,
    response: types.GenerateContentResponse | None,
    model: str,
    config: types.GenerateContentConfig,
) -> LLMReply:
    candidate = response.candidates[0] if response and response.candidates else None
    finish_reason = candidate.finish_reason if candidate else None
    usage = response.usage_metadata if response else None
    request: dict[str, Any] = {"model": model, **config.model_dump(mode="json", exclude_none=True)}
    return LLMReply(
        text=text,
        model=(response.model_version if response else None) or model,
        stop_reason=finish_reason.value if finish_reason else "unknown",
        input_tokens=(usage.prompt_token_count or 0) if usage else 0,
        # Thinking tokens are billed as output.
        output_tokens=((usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0))
        if usage
        else 0,
        thinking=thinking,
        # Gemini caches repeated prefixes implicitly; there is no separate write charge.
        cache_read_tokens=(usage.cached_content_token_count or 0) if usage else 0,
        request=request,
        usage=usage.model_dump(mode="json", exclude_none=True) if usage else {},
    )


def _map_error(exc: errors.APIError | OSError) -> Exception:
    if isinstance(exc, OSError):
        return LLMUnavailableError("Could not reach the Gemini API")
    if exc.code == 429:
        return LLMRateLimitError("Rate limit reached")
    logger.error("Gemini API error status=%s message=%s", exc.code, exc.message)
    return LLMUnavailableError("The Gemini API returned an error")


def _raise_if_refused(response: types.GenerateContentResponse) -> None:
    feedback = response.prompt_feedback
    candidate = response.candidates[0] if response.candidates else None
    finish_reason = candidate.finish_reason if candidate else None
    if (feedback and feedback.block_reason) or finish_reason in REFUSAL_FINISH_REASONS:
        reason = feedback.block_reason if feedback and feedback.block_reason else finish_reason
        logger.info("Gemini declined reason=%s", reason)
        raise LLMRefusalError("Gemini declined to answer this message")
