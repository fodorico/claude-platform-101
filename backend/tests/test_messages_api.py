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


async def test_regenerate_adds_a_version_of_the_last_exchange_with_its_earlier_context(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    conversation_id = first["conversation_id"]
    last = (
        await client.post(
            "/api/messages", json={"content": "Y?", "conversation_id": conversation_id}
        )
    ).json()

    response = await client.post(
        "/api/messages",
        json={
            "content": "Y entonces?",
            "conversation_id": conversation_id,
            "replaces_id": last["id"],
        },
    )

    assert response.status_code == 201
    turns, _ = fake_llm.requests[-1]
    assert turns == [
        Turn("user", "Hola"),
        Turn("assistant", "Reply to: Hola"),
        Turn("user", "Y entonces?"),
    ]
    messages = (await client.get(f"/api/conversations/{conversation_id}/messages")).json()
    # The replaced exchange stays as an inactive version of the same message.
    assert [(m["prompt"], m["version_group"], m["is_active"]) for m in messages] == [
        ("Hola", first["id"], True),
        ("Y?", last["id"], False),
        ("Y entonces?", last["id"], True),
    ]

    # The next message only gets the active versions as context.
    await client.post("/api/messages", json={"content": "Ok", "conversation_id": conversation_id})
    turns, _ = fake_llm.requests[-1]
    assert [turn.text for turn in turns] == [
        "Hola",
        "Reply to: Hola",
        "Y entonces?",
        "Reply to: Y entonces?",
        "Ok",
    ]


async def test_only_the_last_exchange_can_be_replaced(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    conversation_id = first["conversation_id"]
    await client.post("/api/messages", json={"content": "Y?", "conversation_id": conversation_id})
    requests_before = len(fake_llm.requests)

    response = await client.post(
        "/api/messages",
        json={"content": "x", "conversation_id": conversation_id, "replaces_id": first["id"]},
    )

    assert response.status_code == 422
    assert len(fake_llm.requests) == requests_before


async def test_failed_replacement_keeps_the_original_exchange(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    fake_llm.error = LLMUnavailableError("down")

    response = await client.post(
        "/api/messages",
        json={
            "content": "Hola",
            "conversation_id": first["conversation_id"],
            "replaces_id": first["id"],
        },
    )

    assert response.status_code == 503
    messages = (await client.get(f"/api/conversations/{first['conversation_id']}/messages")).json()
    assert [item["id"] for item in messages] == [first["id"]]


async def test_switch_between_versions_of_the_last_message(client: AsyncClient) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    conversation_id = first["conversation_id"]
    second = (
        await client.post(
            "/api/messages",
            json={
                "content": "Hola!",
                "conversation_id": conversation_id,
                "replaces_id": first["id"],
            },
        )
    ).json()
    # Regenerating a version adds to the same group.
    third = (
        await client.post(
            "/api/messages",
            json={"content": "Hi", "conversation_id": conversation_id, "replaces_id": second["id"]},
        )
    ).json()
    assert third["version_group"] == first["id"]

    response = await client.patch(f"/api/exchanges/{second['id']}", json={"active": True})

    assert response.status_code == 200
    messages = (await client.get(f"/api/conversations/{conversation_id}/messages")).json()
    assert [(m["id"], m["is_active"]) for m in messages] == [
        (first["id"], False),
        (second["id"], True),
        (third["id"], False),
    ]


async def test_only_the_last_message_versions_can_be_switched(client: AsyncClient) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    conversation_id = first["conversation_id"]
    second = (
        await client.post(
            "/api/messages",
            json={
                "content": "Hola!",
                "conversation_id": conversation_id,
                "replaces_id": first["id"],
            },
        )
    ).json()
    await client.post("/api/messages", json={"content": "Más", "conversation_id": conversation_id})

    response = await client.patch(f"/api/exchanges/{first['id']}", json={"active": True})

    assert response.status_code == 422
    assert second["is_active"]


async def test_rate_an_answer_and_clear_the_rating(client: AsyncClient) -> None:
    exchange = (await client.post("/api/messages", json={"content": "Hola"})).json()
    assert exchange["rating"] is None

    rated = await client.patch(f"/api/exchanges/{exchange['id']}", json={"rating": -1})
    cleared = await client.patch(f"/api/exchanges/{exchange['id']}", json={"rating": 0})

    assert rated.json()["rating"] == -1
    assert cleared.json()["rating"] is None
    missing = await client.patch("/api/exchanges/999", json={"rating": 1})
    assert missing.status_code == 404


async def test_new_chat_settings_are_kept_and_used_for_every_message(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    settings = {
        "system_prompt": "  Talk like a pirate.  ",
        "temperature": 0.4,
        "max_tokens": 300,
        "show_thinking": True,
    }
    first = (
        await client.post("/api/messages", json={"content": "Hola", "settings": settings})
    ).json()
    conversation_id = first["conversation_id"]
    await client.post("/api/messages", json={"content": "Y?", "conversation_id": conversation_id})

    for options in fake_llm.options:
        assert (options.system, options.temperature, options.max_tokens, options.show_thinking) == (
            "Talk like a pirate.",
            0.4,
            300,
            True,
        )
    assert first["thinking"] == "Thinking about it"
    conversation = (await client.get(f"/api/conversations/{conversation_id}")).json()
    assert conversation["system_prompt"] == "Talk like a pirate."

    # Blank system prompt and no values go back to the defaults.
    await client.patch(
        f"/api/conversations/{conversation_id}", json={"settings": {"system_prompt": " "}}
    )
    await client.post("/api/messages", json={"content": "Z", "conversation_id": conversation_id})
    options = fake_llm.options[-1]
    assert (options.system, options.temperature, options.show_thinking) == (None, None, False)


@pytest.mark.parametrize(
    "settings", [{"temperature": 3}, {"max_tokens": 0}, {"system_prompt": "x" * 10_001}]
)
async def test_invalid_settings_are_rejected(
    client: AsyncClient, settings: dict[str, object]
) -> None:
    response = await client.post("/api/messages", json={"content": "Hola", "settings": settings})

    assert response.status_code == 422


async def test_exchange_records_cache_usage_and_the_api_call(client: AsyncClient) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola"})).json()
    second = (
        await client.post(
            "/api/messages", json={"content": "Y?", "conversation_id": first["conversation_id"]}
        )
    ).json()

    assert (second["cache_read_tokens"], second["cache_write_tokens"]) == (4, 2)
    response = await client.get(f"/api/exchanges/{second['id']}/api-call")
    assert response.status_code == 200
    assert response.json() == {
        "provider": "claude",
        "request": {
            "model": "claude-test",
            "system": "Default system",
            "messages": [
                {"role": "user", "content": "Hola"},
                {"role": "assistant", "content": "Reply to: Hola"},
                {"role": "user", "content": "Y?"},
            ],
        },
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


PNG = "iVBORw0KGgo="  # the PNG signature, base64


async def test_images_are_sent_stored_served_and_kept_when_regenerating(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    images = [{"media_type": "image/png", "data": PNG}]
    first = (
        await client.post("/api/messages", json={"content": "What is this?", "images": images})
    ).json()

    [attachment] = first["attachments"]
    assert attachment["media_type"] == "image/png"
    turns, _ = fake_llm.requests[-1]
    assert [image.media_type for image in turns[-1].images] == ["image/png"]
    served = await client.get(f"/api/attachments/{attachment['id']}")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert served.content == b"\x89PNG\r\n\x1a\n"

    regenerated = (
        await client.post(
            "/api/messages",
            json={
                "content": "What is this?",
                "conversation_id": first["conversation_id"],
                "replaces_id": first["id"],
            },
        )
    ).json()
    assert len(regenerated["attachments"]) == 1
    turns, _ = fake_llm.requests[-1]
    assert len(turns[-1].images) == 1
    api_call = (await client.get(f"/api/exchanges/{regenerated['id']}/api-call")).json()
    image_block = api_call["request"]["messages"][-1]["content"][0]
    assert image_block["source"]["data"] == "<8 bytes>"


@pytest.mark.parametrize(
    "image",
    [
        {"media_type": "image/png", "data": "not base64!"},
        {"media_type": "image/tiff", "data": PNG},
        {"media_type": "image/png", "data": ""},
    ],
)
async def test_invalid_images_are_rejected(client: AsyncClient, image: dict[str, str]) -> None:
    response = await client.post("/api/messages", json={"content": "Hola", "images": [image]})

    assert response.status_code == 422


async def test_too_many_images_are_rejected(client: AsyncClient) -> None:
    images = [{"media_type": "image/png", "data": PNG}] * 5

    response = await client.post("/api/messages", json={"content": "Hola", "images": images})

    assert response.status_code == 422


async def test_count_tokens_uses_the_conversation_context(
    client: AsyncClient, fake_llm: FakeLLMService
) -> None:
    first = (await client.post("/api/messages", json={"content": "Hola amigo"})).json()

    response = await client.post(
        "/api/messages/count-tokens",
        json={"content": "Y vos?", "conversation_id": first["conversation_id"]},
    )

    assert response.status_code == 200
    # "Hola amigo" + "Reply to: Hola amigo" + "Y vos?", one token per word.
    assert response.json() == {"input_tokens": 2 + 4 + 2}
    fake_llm.error = LLMUnavailableError("down")
    failed = await client.post("/api/messages/count-tokens", json={"content": "Hola"})
    assert failed.status_code == 503


async def test_model_settings_include_prices(client: AsyncClient) -> None:
    body = (await client.get("/api/model-settings")).json()

    opus = next(price for price in body["prices"] if price["model"] == "claude-opus-5-5")
    assert opus == {
        "model": "claude-opus-5-5",
        "input": 4.0,
        "output": 20.0,
        "cache_read": 0.2,
        "cache_write": 5.0,
    }
