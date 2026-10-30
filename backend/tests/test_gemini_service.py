"""GeminiService with a stub in place of the google-genai client."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from google.genai import errors, types

from app.services.gemini import GeminiService
from app.services.llm import LLMRateLimitError, LLMRefusalError, LLMReply, LLMUnavailableError


class StubModels:
    def __init__(self, result: types.GenerateContentResponse | Exception) -> None:
        self.result = result
        self.chunks: list[types.GenerateContentResponse] = []
        self.calls: list[dict[str, Any]] = []

    async def generate_content(self, **kwargs: Any) -> types.GenerateContentResponse:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    async def generate_content_stream(
        self, **kwargs: Any
    ) -> AsyncIterator[types.GenerateContentResponse]:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        chunks = self.chunks

        async def iterate() -> AsyncIterator[types.GenerateContentResponse]:
            for chunk in chunks:
                yield chunk

        return iterate()


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


def chunk(
    text: str, finish_reason: str | None = None, **overrides: Any
) -> types.GenerateContentResponse:
    candidate: dict[str, Any] = {"content": {"role": "model", "parts": [{"text": text}]}}
    if finish_reason:
        candidate["finish_reason"] = finish_reason
    return response(candidates=[candidate], **overrides)


async def test_stream_yields_text_then_reply() -> None:
    service, models = make_service(response())
    models.chunks = [chunk("Hel"), chunk("lo", finish_reason="STOP")]

    items = [item async for item in service.stream("Hi")]

    assert items[:-1] == ["Hel", "lo"]
    reply = items[-1]
    assert isinstance(reply, LLMReply)
    assert (reply.text, reply.stop_reason, reply.model) == ("Hello", "STOP", "gemini-3.8-flash")
    assert (reply.input_tokens, reply.output_tokens) == (12, 3)
    assert models.calls[0]["contents"] == "Hi"


async def test_stream_raises_on_refusal_after_text() -> None:
    service, models = make_service(response())
    models.chunks = [chunk("Hel"), chunk("", finish_reason="SAFETY")]

    received: list[object] = []
    with pytest.raises(LLMRefusalError):
        async for item in service.stream("Hi"):
            received.append(item)
    assert received == ["Hel"]


async def test_stream_maps_errors() -> None:
    service, _ = make_service(errors.ServerError(503, {"error": {"message": "overloaded"}}))

    with pytest.raises(LLMUnavailableError):
        async for _ in service.stream("Hi"):
            pass
