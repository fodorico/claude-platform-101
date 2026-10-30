import logging

import anthropic

from app.config import Effort
from app.services.llm import (
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
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
        model: str,
        effort: Effort,
        max_tokens: int,
        system_prompt: str,
    ) -> None:
        self._client = client
        self._model = model
        self._effort: Effort = effort
        self._max_tokens = max_tokens
        self._system_prompt = system_prompt

    async def ask(self, prompt: str) -> LLMReply:
        try:
            response = await self._client.beta.messages.create(
                model=self._model,
                max_tokens=self._max_tokens,
                system=self._system_prompt,
                output_config={"effort": self._effort},
                betas=[FALLBACK_BETA],
                fallbacks="default",
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.RateLimitError as exc:
            raise LLMRateLimitError("Rate limit reached") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMUnavailableError("Could not reach the Claude API") from exc
        except anthropic.APIStatusError as exc:
            logger.error(
                "Claude API error status=%s request_id=%s message=%s",
                exc.status_code,
                exc.request_id,
                exc.message,
            )
            raise LLMUnavailableError("The Claude API returned an error") from exc

        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            logger.info("Claude declined request_id=%s category=%s", response._request_id, category)
            raise LLMRefusalError("Claude declined to answer this message")

        text = "".join(block.text for block in response.content if block.type == "text")
        return LLMReply(
            text=text,
            model=response.model,
            stop_reason=response.stop_reason or "unknown",
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
