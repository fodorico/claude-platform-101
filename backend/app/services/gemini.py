import logging
from collections.abc import AsyncIterator, Sequence

from google import genai
from google.genai import errors, types

from app.services.llm import (
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
    StreamItem,
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

    def _config(
        self, system: str | None = None, max_tokens: int | None = None
    ) -> types.GenerateContentConfig:
        return types.GenerateContentConfig(
            system_instruction=system or self._system_prompt,
            max_output_tokens=max_tokens or self._max_tokens,
        )

    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMReply:
        try:
            response = await self._client.aio.models.generate_content(
                model=model, contents=_contents(messages), config=self._config(system, max_tokens)
            )
        except (errors.APIError, OSError) as exc:
            raise _map_error(exc) from exc
        _raise_if_refused(response)
        return _to_reply(response.text or "", response, model)

    async def stream(self, messages: Sequence[Turn], *, model: str) -> AsyncIterator[StreamItem]:
        parts: list[str] = []
        last: types.GenerateContentResponse | None = None
        try:
            chunks = await self._client.aio.models.generate_content_stream(
                model=model, contents=_contents(messages), config=self._config()
            )
            async for chunk in chunks:
                _raise_if_refused(chunk)
                last = chunk
                if chunk.text:
                    parts.append(chunk.text)
                    yield chunk.text
        except (errors.APIError, OSError) as exc:
            raise _map_error(exc) from exc
        yield _to_reply("".join(parts), last, model)


def _contents(messages: Sequence[Turn]) -> list[types.Content]:
    # Gemini calls the assistant's role "model".
    return [
        types.Content(
            role="model" if turn.role == "assistant" else "user",
            parts=[types.Part(text=turn.text)],
        )
        for turn in messages
    ]


def _to_reply(text: str, response: types.GenerateContentResponse | None, model: str) -> LLMReply:
    candidate = response.candidates[0] if response and response.candidates else None
    finish_reason = candidate.finish_reason if candidate else None
    usage = response.usage_metadata if response else None
    return LLMReply(
        text=text,
        model=(response.model_version if response else None) or model,
        stop_reason=finish_reason.value if finish_reason else "unknown",
        input_tokens=(usage.prompt_token_count or 0) if usage else 0,
        output_tokens=(usage.candidates_token_count or 0) if usage else 0,
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
