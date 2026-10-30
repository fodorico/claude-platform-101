import logging
from dataclasses import dataclass

import anthropic
from fastapi import Request

from app.config import Effort

logger = logging.getLogger(__name__)

# "default" fallbacks: if the model declines for policy reasons, the API retries on
# Anthropic's recommended substitute model inside the same call.
FALLBACK_BETA = "server-side-fallback-2026-07-01"


@dataclass(frozen=True)
class ClaudeReply:
    text: str
    model: str
    stop_reason: str
    input_tokens: int
    output_tokens: int


class ClaudeError(Exception):
    """Base class for errors talking to Claude."""


class ClaudeRefusalError(ClaudeError):
    """Claude declined to answer the request."""


class ClaudeUnavailableError(ClaudeError):
    """Claude could not be reached or is temporarily overloaded; retrying later may work."""


class ClaudeRateLimitError(ClaudeError):
    """The API rate limit was hit."""


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

    async def ask(self, prompt: str) -> ClaudeReply:
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
            raise ClaudeRateLimitError("Rate limit reached") from exc
        except anthropic.APIConnectionError as exc:
            raise ClaudeUnavailableError("Could not reach the Claude API") from exc
        except anthropic.APIStatusError as exc:
            logger.error(
                "Claude API error status=%s request_id=%s", exc.status_code, exc.request_id
            )
            raise ClaudeUnavailableError("The Claude API returned an error") from exc

        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            logger.info("Claude declined request_id=%s category=%s", response._request_id, category)
            raise ClaudeRefusalError("Claude declined to answer this message")

        text = "".join(block.text for block in response.content if block.type == "text")
        return ClaudeReply(
            text=text,
            model=response.model,
            stop_reason=response.stop_reason or "unknown",
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )


def get_claude_service(request: Request) -> ClaudeService:
    service: ClaudeService = request.app.state.claude_service
    return service
