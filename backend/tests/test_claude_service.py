"""ClaudeService against the real SDK, with HTTP faked by httpx2 (the SDK's transport)."""

import json
from typing import Any

import anthropic
import httpx2
import pytest

from app.services.claude import (
    ClaudeRateLimitError,
    ClaudeRefusalError,
    ClaudeService,
    ClaudeUnavailableError,
)


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
    service = ClaudeService(
        client, model="claude-opus-5-5", effort="low", max_tokens=1000, system_prompt="Be brief."
    )
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

    reply = await service.ask("Hi")

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

    with pytest.raises(ClaudeRefusalError):
        await service.ask("Hi")


@pytest.mark.parametrize(
    ("status_code", "expected_error"),
    [(429, ClaudeRateLimitError), (529, ClaudeUnavailableError), (500, ClaudeUnavailableError)],
)
async def test_ask_maps_api_errors(status_code: int, expected_error: type[Exception]) -> None:
    error = {"type": "error", "error": {"type": "api_error", "message": "boom"}}
    service, _ = make_service(lambda _: httpx2.Response(status_code, json=error))

    with pytest.raises(expected_error):
        await service.ask("Hi")


async def test_ask_maps_connection_errors() -> None:
    def fail(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("unreachable", request=request)

    service, _ = make_service(fail)

    with pytest.raises(ClaudeUnavailableError):
        await service.ask("Hi")
