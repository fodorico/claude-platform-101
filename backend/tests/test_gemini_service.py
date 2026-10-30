"""GeminiService with a stub in place of the google-genai client."""

from typing import Any

import pytest
from google.genai import errors, types

from app.services.gemini import GeminiService
from app.services.llm import LLMRateLimitError, LLMRefusalError, LLMUnavailableError


class StubModels:
    def __init__(self, result: types.GenerateContentResponse | Exception) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> types.GenerateContentResponse:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class StubClient:
    def __init__(self, models: StubModels) -> None:
        self.aio = type("Aio", (), {"models": models})()


def make_service(
    result: types.GenerateContentResponse | Exception,
) -> tuple[GeminiService, StubModels]:
    models = StubModels(result)
    service = GeminiService(
        StubClient(models),  # type: ignore[arg-type]
        model="gemini-flash-latest",
        max_tokens=1000,
        system_prompt="Be brief.",
    )
    return service, models


def response(**overrides: Any) -> types.GenerateContentResponse:
    data: dict[str, Any] = {
        "candidates": [
            {
                "content": {"role": "model", "parts": [{"text": "Hello there"}]},
                "finish_reason": "STOP",
            }
        ],
        "usage_metadata": {"prompt_token_count": 12, "candidates_token_count": 3},
        "model_version": "gemini-3.8-flash",
    }
    data.update(overrides)
    return types.GenerateContentResponse.model_validate(data)


async def test_ask_sends_configured_request_and_returns_reply() -> None:
    service, models = make_service(response())

    reply = await service.ask("Hi")

    assert reply.text == "Hello there"
    assert (reply.model, reply.stop_reason) == ("gemini-3.8-flash", "STOP")
    assert (reply.input_tokens, reply.output_tokens) == (12, 3)
    [call] = models.calls
    assert call["model"] == "gemini-flash-latest"
    assert call["contents"] == "Hi"
    assert call["config"].system_instruction == "Be brief."
    assert call["config"].max_output_tokens == 1000


@pytest.mark.parametrize(
    "result",
    [
        response(candidates=[{"finish_reason": "SAFETY"}]),
        response(candidates=[], prompt_feedback={"block_reason": "PROHIBITED_CONTENT"}),
    ],
)
async def test_ask_raises_on_refusal(result: types.GenerateContentResponse) -> None:
    service, _ = make_service(result)

    with pytest.raises(LLMRefusalError):
        await service.ask("Hi")


@pytest.mark.parametrize(
    ("error", "expected_error"),
    [
        (errors.ClientError(429, {"error": {"message": "quota"}}), LLMRateLimitError),
        (errors.ClientError(400, {"error": {"message": "bad key"}}), LLMUnavailableError),
        (errors.ServerError(503, {"error": {"message": "overloaded"}}), LLMUnavailableError),
        (ConnectionError("unreachable"), LLMUnavailableError),
    ],
)
async def test_ask_maps_errors(error: Exception, expected_error: type[Exception]) -> None:
    service, _ = make_service(error)

    with pytest.raises(expected_error):
        await service.ask("Hi")
