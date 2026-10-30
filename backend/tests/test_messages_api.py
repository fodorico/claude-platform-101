import pytest
from httpx import AsyncClient

from app.services.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMUnavailableError,
)
from tests.conftest import FakeClaudeService


async def test_send_message_returns_and_stores_reply(
    client: AsyncClient, fake_claude: FakeClaudeService
) -> None:
    response = await client.post("/api/messages", json={"content": "Hola"})

    assert response.status_code == 201
    body = response.json()
    assert body["prompt"] == "Hola"
    assert body["reply"] == "Reply to: Hola"
    assert body["model"] == "claude-test"
    assert fake_claude.prompts == ["Hola"]

    history = await client.get("/api/messages")
    assert [item["id"] for item in history.json()] == [body["id"]]


async def test_list_messages_is_newest_first_and_limited(client: AsyncClient) -> None:
    for prompt in ["first", "second", "third"]:
        await client.post("/api/messages", json={"content": prompt})

    response = await client.get("/api/messages", params={"limit": 2})

    assert response.status_code == 200
    assert [item["prompt"] for item in response.json()] == ["third", "second"]


@pytest.mark.parametrize("content", ["", "x" * 10_001])
async def test_send_message_rejects_invalid_content(
    client: AsyncClient, fake_claude: FakeClaudeService, content: str
) -> None:
    response = await client.post("/api/messages", json={"content": content})

    assert response.status_code == 422
    assert fake_claude.prompts == []


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (LLMRefusalError("declined"), 422),
        (LLMRateLimitError("rate limited"), 429),
        (LLMUnavailableError("down"), 503),
    ],
)
async def test_claude_errors_map_to_http_status_and_store_nothing(
    client: AsyncClient,
    fake_claude: FakeClaudeService,
    error: LLMError,
    expected_status: int,
) -> None:
    fake_claude.error = error

    response = await client.post("/api/messages", json={"content": "Hola"})

    assert response.status_code == expected_status
    assert (await client.get("/api/messages")).json() == []


async def test_health_checks_database(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
