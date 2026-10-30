import json
from typing import Any

import pytest
from httpx import AsyncClient

from app.services.llm import LLMError, LLMRateLimitError, LLMRefusalError, LLMUnavailableError
from tests.conftest import FakeClaudeService


async def read_events(client: AsyncClient, content: str) -> list[tuple[str, Any]]:
    """POST to the stream endpoint and parse its server-sent events."""
    async with client.stream("POST", "/api/messages/stream", json={"content": content}) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        body = "".join([chunk async for chunk in response.aiter_text()])

    events = []
    for block in body.strip().split("\n\n"):
        fields = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((fields["event"], json.loads(fields["data"])))
    return events


async def test_stream_sends_deltas_then_the_stored_exchange(client: AsyncClient) -> None:
    events = await read_events(client, "Hola")

    deltas = [data["text"] for name, data in events if name == "delta"]
    assert deltas == ["Reply ", "to: ", "Hola"]
    name, exchange = events[-1]
    assert name == "done"
    assert exchange["prompt"] == "Hola"
    assert exchange["reply"] == "Reply to: Hola"

    history = (await client.get("/api/messages")).json()
    assert [item["id"] for item in history] == [exchange["id"]]


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (LLMRefusalError("declined"), 422),
        (LLMRateLimitError("rate limited"), 429),
        (LLMUnavailableError("down"), 503),
    ],
)
async def test_stream_failure_sends_error_event_and_stores_nothing(
    client: AsyncClient, fake_claude: FakeClaudeService, error: LLMError, expected_status: int
) -> None:
    fake_claude.error = error

    events = await read_events(client, "Hola")

    assert events[0] == ("delta", {"text": "Reply "})
    assert events[-1] == ("error", {"detail": str(error), "status": expected_status})
    assert (await client.get("/api/messages")).json() == []


async def test_stream_rejects_invalid_content(
    client: AsyncClient, fake_claude: FakeClaudeService
) -> None:
    response = await client.post("/api/messages/stream", json={"content": ""})

    assert response.status_code == 422
    assert fake_claude.prompts == []
