"""ClaudeService against the real SDK, with HTTP faked by httpx2 (the SDK's transport)."""

import json
from typing import Any

import anthropic
import httpx2
import pytest

from app.services.claude import ClaudeService
from app.services.llm import (
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMUnavailableError,
    Turn,
)

HI = [Turn("user", "Hi")]


def make_service(handler: Any) -> tuple[ClaudeService, list[dict[str, Any]]]:
    requests: list[dict[str, Any]] = []

    def recording_handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(json.loads(request.content))
        response: httpx2.Response = handler(request)
        return response

    client = anthropic.AsyncAnthropic(
        api_key="test-key",
        max_retries=0,
        http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(recording_handler)),
    )
    service = ClaudeService(client, effort="low", max_tokens=1000, system_prompt="Be brief.")
    return service, requests


def message_body(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "content": [
            {"type": "thinking", "thinking": "", "signature": "sig"},
            {"type": "text", "text": "Hello "},
            {"type": "text", "text": "there"},
        ],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 12, "output_tokens": 3},
    }
    body.update(overrides)
    return body


async def test_ask_sends_configured_request_and_joins_text_blocks() -> None:
    service, requests = make_service(lambda _: httpx2.Response(200, json=message_body()))

    reply = await service.ask(HI, model="claude-opus-5-5")

    assert reply.text == "Hello there"
    assert (reply.model, reply.stop_reason) == ("claude-opus-5-5", "end_turn")
    assert (reply.input_tokens, reply.output_tokens) == (12, 3)
    [sent] = requests
    assert sent["model"] == "claude-opus-5-5"
    assert sent["system"] == "Be brief."
    assert sent["output_config"] == {"effort": "low"}
    assert sent["fallbacks"] == "default"
    assert sent["messages"] == [{"role": "user", "content": "Hi"}]


async def test_ask_raises_on_refusal() -> None:
    body = message_body(
        content=[],
        stop_reason="refusal",
        stop_details={"type": "refusal", "category": None, "explanation": None},
    )
    service, _ = make_service(lambda _: httpx2.Response(200, json=body))

    with pytest.raises(LLMRefusalError):
        await service.ask(HI, model="claude-opus-5-5")


@pytest.mark.parametrize(
    ("status_code", "expected_error"),
    [(429, LLMRateLimitError), (529, LLMUnavailableError), (500, LLMUnavailableError)],
)
async def test_ask_maps_api_errors(status_code: int, expected_error: type[Exception]) -> None:
    error = {"type": "error", "error": {"type": "api_error", "message": "boom"}}
    service, _ = make_service(lambda _: httpx2.Response(status_code, json=error))

    with pytest.raises(expected_error):
        await service.ask(HI, model="claude-opus-5-5")


async def test_ask_maps_connection_errors() -> None:
    def fail(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    service, _ = make_service(fail)

    with pytest.raises(LLMUnavailableError):
        await service.ask(HI, model="claude-opus-5-5")


def sse_body(*events: dict[str, Any]) -> bytes:
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


def stream_events(stop_reason: str = "end_turn", texts: tuple[str, ...] = ("Hel", "lo")) -> bytes:
    start = message_body(
        content=[], stop_reason=None, usage={"input_tokens": 12, "output_tokens": 0}
    )
    return sse_body(
        {"type": "message_start", "message": start},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        *(
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": t}}
            for t in texts
        ),
        {"type": "content_block_stop", "index": 0},
        {
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None},
            "usage": {"output_tokens": 2},
        },
        {"type": "message_stop"},
    )


def sse_response(body: bytes) -> httpx2.Response:
    return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)


async def test_stream_yields_text_then_reply() -> None:
    service, requests = make_service(lambda _: sse_response(stream_events()))

    items = [item async for item in service.stream(HI, model="claude-opus-5-5")]

    assert items[:-1] == ["Hel", "lo"]
    reply = items[-1]
    assert isinstance(reply, LLMReply)
    assert (reply.text, reply.stop_reason) == ("Hello", "end_turn")
    assert (reply.input_tokens, reply.output_tokens) == (12, 2)
    [sent] = requests
    assert sent["stream"] is True
    assert sent["fallbacks"] == "default"


async def test_stream_raises_on_refusal_after_text() -> None:
    service, _ = make_service(lambda _: sse_response(stream_events(stop_reason="refusal")))

    received: list[object] = []
    with pytest.raises(LLMRefusalError):
        async for item in service.stream(HI, model="claude-opus-5-5"):
            received.append(item)
    assert received == ["Hel", "lo"]


async def test_stream_maps_api_errors() -> None:
    error = {"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}
    service, _ = make_service(lambda _: httpx2.Response(529, json=error))

    with pytest.raises(LLMUnavailableError):
        async for _ in service.stream(HI, model="claude-opus-5-5"):
            pass


async def test_ask_sends_the_conversation_and_overrides() -> None:
    service, requests = make_service(lambda _: httpx2.Response(200, json=message_body()))
    turns = [Turn("user", "Hi"), Turn("assistant", "Hello"), Turn("user", "More")]

    await service.ask(turns, model="claude-sonnet-5-5", system="Title only.", max_tokens=50)

    [sent] = requests
    assert sent["model"] == "claude-sonnet-5-5"
    assert (sent["system"], sent["max_tokens"]) == ("Title only.", 50)
    assert sent["messages"] == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello"},
        {"role": "user", "content": "More"},
    ]
