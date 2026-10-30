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


async def test_first_message_starts_a_conversation_titled_by_the_model(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    response = await client.post("/api/messages", json={"content": "Hola"})

    assert response.status_code == 201
    body = response.json()
    assert body["prompt"] == "Hola"
    assert body["reply"] == "Reply to: Hola"
    assert (body["provider"], body["model"]) == ("claude", "claude-test")
    assert body["stop_reason"] == "end_turn"
    assert (body["input_tokens"], body["output_tokens"]) == (10, 5)
    assert body["duration_ms"] >= 0
    assert body["first_token_ms"] is None
    assert fake_llm.requests == [([Turn("user", "Hola")], "claude-test")]

    [conversation] = (await client.get("/api/conversations")).json()
    assert conversation["id"] == body["conversation_id"]
    assert conversation["title"] == "Fake title"


async def test_message_in_a_conversation_sends_earlier_exchanges_as_context(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()

    second = await client.post(
        "/api/messages", json={"content": "Y?", "conversation_id": first["conversation_id"]}
    )

    assert second.status_code == 201
    assert second.json()["conversation_id"] == first["conversation_id"]
    turns, _ = fake_llm.requests[-1]
    assert turns == [
        Turn("user", "Hola"),
        Turn("assistant", "Reply to: Hola"),
        Turn("user", "Y?"),
    ]
    assert len((await client.get("/api/conversations")).json()) == 1


async def test_message_uses_the_chosen_model(client: AsyncClient, fake_llm: FakeLLMService) -> None:
    response = await client.post(
        "/api/messages", json={"content": "Hola", "provider": "claude", "model": "claude-other"}
    )

    assert response.status_code == 201
    assert response.json()["model"] == "claude-other"
    assert fake_llm.requests[-1][1] == "claude-other"


@pytest.mark.parametrize(
    ("choice", "detail"),
    [
        ({"provider": "gemini"}, "The gemini provider is not configured"),
        ({"provider": "claude", "model": "gpt"}, "The model gpt is not offered for claude"),
    ],
)
async def test_message_rejects_unusable_models(
    client: AsyncClient, fake_llm: FakeLLMService, choice: dict[str, str], detail: str
) -> None:
    response = await client.post("/api/messages", json={"content": "Hola", **choice})

    assert response.status_code == 422
    assert response.json()["detail"] == detail
    assert fake_llm.requests == []


async def test_message_to_a_missing_conversation_is_not_found(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    response = await client.post("/api/messages", json={"content": "Hola", "conversation_id": 99})

    assert response.status_code == 404
    assert fake_llm.requests == []


async def test_failed_title_keeps_the_shortened_first_message(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    fake_llm.title_error = LLMUnavailableError("down")
    content = "Explain in detail how server-sent events work and when to prefer them over sockets"

    response = await client.post("/api/messages", json={"content": content})

    assert response.status_code == 201
    [conversation] = (await client.get("/api/conversations")).json()
    assert conversation["title"] == "Explain in detail how server-sent events work and when to…"


@pytest.mark.parametrize("content", ["", "x" * 10_001])
async def test_send_message_rejects_invalid_content(
    client: AsyncClient, fake_llm: FakeLLMService, content: str
) -> None:
    response = await client.post("/api/messages", json={"content": content})

    assert response.status_code == 422
    assert fake_llm.requests == []


@pytest.mark.parametrize(
    ("error", "expected_status"),
    [
        (LLMRefusalError("declined"), 422),
        (LLMRateLimitError("rate limited"), 429),
        (LLMUnavailableError("down"), 503),
    ],
)
async def test_model_errors_map_to_http_status_and_store_nothing(
    client: AsyncClient,
    fake_llm: FakeLLMService,
    error: LLMError,
    expected_status: int,
) -> None:
    fake_llm.error = error

    response = await client.post("/api/messages", json={"content": "Hola"})

    assert response.status_code == expected_status
    assert (await client.get("/api/conversations")).json() == []


async def test_model_settings_list_providers_and_their_models(client: AsyncClient) -> None:
    response = await client.get("/api/model-settings")

    assert response.status_code == 200
    body = response.json()
    assert body["default_provider"] == "claude"
    assert body["providers"] == [
        {"name": "claude", "available": True, "models": ["claude-test", "claude-other"]},
        {"name": "gemini", "available": False, "models": ["gemini-test"]},
    ]
    assert body["max_tokens"] > 0
    assert body["system_prompt"]


async def test_health_checks_database(client: AsyncClient) -> None:
    response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
