"""GeminiService with a stub in place of the google-genai client."""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from google.genai import errors, types

from app.services.gemini import GeminiService
from app.services.llm import (
    GenerationOptions,
    Image,
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
    ThinkingDelta,
    Turn,
)

HI = [Turn("user", "Hi")]
USER_HI = [types.Content(role="user", parts=[types.Part(text="Hi")])]


class StubModels:
    def __init__(self, result: types.GenerateContentResponse | Exception) -> None:
        self.result = result
        self.chunks: list[types.GenerateContentResponse] = []
        self.calls: list[dict[str, Any]] = []
        self.token_count = 7

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

    async def count_tokens(self, **kwargs: Any) -> types.CountTokensResponse:
        self.calls.append(kwargs)
        if isinstance(self.result, Exception):
            raise self.result
        return types.CountTokensResponse(total_tokens=self.token_count)


class StubClient:
    def __init__(self, models: StubModels) -> None:
        self.aio = type("Aio", (), {"models": models})()


def make_service(
    result: types.GenerateContentResponse | Exception,
) -> tuple[GeminiService, StubModels]:
    models = StubModels(result)
    service = GeminiService(
        StubClient(models),  # type: ignore[arg-type]
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

    reply = await service.ask(HI, model="gemini-flash-latest")

    assert reply.text == "Hello there"
    assert (reply.model, reply.stop_reason) == ("gemini-3.8-flash", "STOP")
    assert (reply.input_tokens, reply.output_tokens) == (12, 3)
    [call] = models.calls
    assert call["model"] == "gemini-flash-latest"
    assert call["contents"] == USER_HI
    assert call["config"].system_instruction == "Be brief."
    assert call["config"].max_output_tokens == 1000
    assert call["config"].temperature is None
    assert call["config"].thinking_config is None
    assert reply.request["model"] == "gemini-flash-latest"
    assert reply.request["system_instruction"] == "Be brief."
    assert reply.usage == {"prompt_token_count": 12, "candidates_token_count": 3}


async def test_ask_applies_options_and_returns_thoughts_and_cache_usage() -> None:
    result = response(
        candidates=[
            {
                "content": {
                    "role": "model",
                    "parts": [{"text": "Let me see.", "thought": True}, {"text": "Done"}],
                },
                "finish_reason": "STOP",
            }
        ],
        usage_metadata={
            "prompt_token_count": 12,
            "candidates_token_count": 3,
            "thoughts_token_count": 4,
            "cached_content_token_count": 8,
        },
    )
    service, models = make_service(result)

    reply = await service.ask(
        HI,
        model="gemini-flash-latest",
        options=GenerationOptions(temperature=0.3, show_thinking=True, system="Custom."),
    )

    config = models.calls[0]["config"]
    assert (config.temperature, config.system_instruction) == (0.3, "Custom.")
    assert config.thinking_config.include_thoughts is True
    assert config.thinking_config.thinking_budget == -1
    assert (reply.text, reply.thinking) == ("Done", "Let me see.")
    # Thinking tokens are billed as output.
    assert (reply.output_tokens, reply.cache_read_tokens) == (7, 8)


async def test_ask_sends_images_before_the_text() -> None:
    service, models = make_service(response())

    await service.ask(
        [Turn("user", "What is this?", (Image("image/png", b"png"),))], model="gemini-flash-latest"
    )

    [content] = models.calls[0]["contents"]
    assert content.parts[0].inline_data == types.Blob(data=b"png", mime_type="image/png")
    assert content.parts[1].text == "What is this?"


async def test_count_tokens_counts_the_messages() -> None:
    service, models = make_service(response())

    assert await service.count_tokens(HI, model="gemini-flash-latest") == 7
    assert models.calls[0] == {"model": "gemini-flash-latest", "contents": USER_HI}


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
        await service.ask(HI, model="gemini-flash-latest")


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
        await service.ask(HI, model="gemini-flash-latest")


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

    items = [item async for item in service.stream(HI, model="gemini-flash-latest")]

    assert items[:-1] == ["Hel", "lo"]
    reply = items[-1]
    assert isinstance(reply, LLMReply)
    assert (reply.text, reply.stop_reason, reply.model) == ("Hello", "STOP", "gemini-3.8-flash")
    assert (reply.input_tokens, reply.output_tokens) == (12, 3)
    assert models.calls[0]["contents"] == USER_HI


async def test_stream_yields_thoughts_and_text() -> None:
    service, models = make_service(response())
    thought = {"content": {"role": "model", "parts": [{"text": "Hmm.", "thought": True}]}}
    models.chunks = [response(candidates=[thought]), chunk("Hi", finish_reason="STOP")]

    items = [
        item
        async for item in service.stream(
            HI, model="gemini-flash-latest", options=GenerationOptions(show_thinking=True)
        )
    ]

    assert items[:-1] == [ThinkingDelta("Hmm."), "Hi"]
    reply = items[-1]
    assert isinstance(reply, LLMReply)
    assert (reply.text, reply.thinking) == ("Hi", "Hmm.")


async def test_stream_raises_on_refusal_after_text() -> None:
    service, models = make_service(response())
    models.chunks = [chunk("Hel"), chunk("", finish_reason="SAFETY")]

    received: list[object] = []
    with pytest.raises(LLMRefusalError):
        async for item in service.stream(HI, model="gemini-flash-latest"):
            received.append(item)
    assert received == ["Hel"]


async def test_stream_maps_errors() -> None:
    service, _ = make_service(errors.ServerError(503, {"error": {"message": "overloaded"}}))

    with pytest.raises(LLMUnavailableError):
        async for _ in service.stream(HI, model="gemini-flash-latest"):
            pass


async def test_ask_sends_the_conversation_and_overrides() -> None:
    service, models = make_service(response())
    turns = [Turn("user", "Hi"), Turn("assistant", "Hello"), Turn("user", "More")]

    await service.ask(
        turns,
        model="gemini-flash-lite-latest",
        options=GenerationOptions(system="Title only.", max_tokens=50),
    )

    [call] = models.calls
    assert call["model"] == "gemini-flash-lite-latest"
    assert [(content.role, content.parts[0].text) for content in call["contents"]] == [
        ("user", "Hi"),
        ("model", "Hello"),
        ("user", "More"),
    ]
    assert call["config"].system_instruction == "Title only."
    assert call["config"].max_output_tokens == 50
