import logging

from google import genai
from google.genai import errors, types

from app.services.llm import (
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
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
        model: str,
        max_tokens: int,
        system_prompt: str,
    ) -> None:
        self._client = client
        self._model = model
        self._max_tokens = max_tokens
        self._system_prompt = system_prompt

    async def ask(self, prompt: str) -> LLMReply:
        try:
            response = await self._client.aio.models.generate_content(
                model=self._model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=self._system_prompt,
                    max_output_tokens=self._max_tokens,
                ),
            )
        except errors.APIError as exc:
            if exc.code == 429:
                raise LLMRateLimitError("Rate limit reached") from exc
            logger.error("Gemini API error status=%s message=%s", exc.code, exc.message)
            raise LLMUnavailableError("The Gemini API returned an error") from exc
        except OSError as exc:
            raise LLMUnavailableError("Could not reach the Gemini API") from exc

        feedback = response.prompt_feedback
        candidate = response.candidates[0] if response.candidates else None
        finish_reason = candidate.finish_reason if candidate else None
        if (feedback and feedback.block_reason) or finish_reason in REFUSAL_FINISH_REASONS:
            reason = feedback.block_reason if feedback and feedback.block_reason else finish_reason
            logger.info("Gemini declined reason=%s", reason)
            raise LLMRefusalError("Gemini declined to answer this message")

        usage = response.usage_metadata
        return LLMReply(
            text=response.text or "",
            model=response.model_version or self._model,
            stop_reason=finish_reason.value if finish_reason else "unknown",
            input_tokens=(usage.prompt_token_count or 0) if usage else 0,
            output_tokens=(usage.candidates_token_count or 0) if usage else 0,
        )
