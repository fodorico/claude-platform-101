import json
from typing import Any

import pytest
from httpx import AsyncClient

from app.services.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMUnavailableError,
    Turn,
)
from tests.conftest import FakeLLMService


async def read_events(client: AsyncClient, **body: Any) -> list[tuple[str, Any]]:
    """POST to the stream endpoint and parse its server-sent events."""
    async with client.stream("POST", "/api/messages/stream", json=body) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        text = "".join([chunk async for chunk in response.aiter_text()])

    events = []
    for block in text.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((fields["event"], json.loads(fields["data"])))
    return events


async def test_stream_sends_deltas_then_the_stored_exchange_then_the_title(
    client: AsyncClient,
) -> None:
    events = await read_events(client, content="Hola")

    deltas = [data["text"] for name, data in events if name == "delta"]
    assert deltas == ["Reply ", "to: ", "Hola"]
    (done, exchange), (title_event, title) = events[-2:]
    assert done == "done"
    assert exchange["prompt"] == "Hola"
    assert exchange["reply"] == "Reply to: Hola"
    assert 0 <= exchange["first_token_ms"] <= exchange["duration_ms"]
    assert title_event == "title"
    assert title == {"conversation_id": exchange["conversation_id"], "title": "Fake title"}

    messages = await client.get(f"/api/conversations/{exchange['conversation_id']}/messages")
    assert [item["id"] for item in messages.json()] == [exchange["id"]]


async def test_stream_in_a_conversation_sends_context_and_no_title(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await read_events(client, content="Hola"))[-2][1]

    events = await read_events(client, content="Y?", conversation_id=first["conversation_id"])

    assert events[-1][0] == "done"
    assert events[-1][1]["conversation_id"] == first["conversation_id"]
    turns, model = fake_llm.requests[-1]
    assert turns[0] == Turn("user", "Hola")
    assert model == "claude-test"


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (LLMRefusalError("declined"), 422),
        (LLMRateLimitError("rate limited"), 429),
        (LLMUnavailableError("down"), 503),
    ],
)
async def test_stream_failure_sends_error_event_and_stores_nothing(
    client: AsyncClient, fake_llm: FakeLLMService, error: LLMError, expected_status: int
) -> None:
    fake_llm.error = error

    events = await read_events(client, content="Hola")

    assert events[0] == ("delta", {"text": "Reply "})
    assert events[-1] == ("error", {"detail": str(error), "status": expected_status})
    assert (await client.get("/api/conversations")).json() == []


@pytest.mark.parametrize(
    ("body", "expected_status"),
    [
        ({"content": ""}, 422),
        ({"content": "Hola", "provider": "gemini"}, 422),
        ({"content": "Hola", "conversation_id": 99}, 404),
    ],
)
async def test_stream_rejects_bad_requests_before_calling_the_model(
    client: AsyncClient, fake_llm: FakeLLMService, body: dict[str, Any], expected_status: int
) -> None:
    response = await client.post("/api/messages/stream", json=body)

    assert response.status_code == expected_status
    assert fake_llm.requests == []
