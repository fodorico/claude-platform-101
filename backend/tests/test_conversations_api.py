from httpx import AsyncClient


async def test_conversations_list_latest_activity_first(client: AsyncClient) -> None:
    first = (await client.post("/api/messages", json={"content": "first"})).json()
    await client.post("/api/messages", json={"content": "second"})
    # A new message moves the older conversation back to the top.
    await client.post(
        "/api/messages", json={"content": "again", "conversation_id": first["conversation_id"]}
    )

    response = await client.get("/api/conversations")

    assert response.status_code == 200
    ids = [conversation["id"] for conversation in response.json()]
    assert ids[0] == first["conversation_id"]
    assert len(ids) == 2


async def test_conversation_messages_are_oldest_first(client: AsyncClient) -> None:
    first = (await client.post("/api/messages", json={"content": "one"})).json()
    conversation_id = first["conversation_id"]
    await client.post("/api/messages", json={"content": "two", "conversation_id": conversation_id})

    response = await client.get(f"/api/conversations/{conversation_id}/messages")

    assert response.status_code == 200
    assert [item["prompt"] for item in response.json()] == ["one", "two"]


async def test_messages_of_a_missing_conversation_are_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/conversations/99/messages")

    assert response.status_code == 404


async def start_chat(client: AsyncClient, content: str) -> int:
    response = await client.post("/api/messages", json={"content": content})
    conversation_id: int = response.json()["conversation_id"]
    return conversation_id


async def titles(client: AsyncClient, *, archived: bool = False) -> list[str]:
    response = await client.get("/api/conversations", params={"archived": archived})
    return [conversation["title"] for conversation in response.json()]


async def test_rename_conversation(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")

    response = await client.patch(
        f"/api/conversations/{conversation_id}", json={"title": "  My chat  "}
    )

    assert response.status_code == 200
    assert response.json()["title"] == "My chat"
    assert await titles(client) == ["My chat"]


async def test_rename_rejects_a_blank_title(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")

    response = await client.patch(f"/api/conversations/{conversation_id}", json={"title": "  "})

    assert response.status_code == 422


async def test_archive_moves_a_chat_to_the_archived_list_and_back(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")
    url = f"/api/conversations/{conversation_id}"

    archived = await client.patch(url, json={"archived": True})
    assert archived.json()["archived_at"] is not None
    assert await titles(client) == []
    assert await titles(client, archived=True) == ["Fake title"]

    restored = await client.patch(url, json={"archived": False})
    assert restored.json()["archived_at"] is None
    assert await titles(client) == ["Fake title"]


async def test_writing_in_an_archived_chat_brings_it_back(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")
    await client.patch(f"/api/conversations/{conversation_id}", json={"archived": True})

    await client.post("/api/messages", json={"content": "Y?", "conversation_id": conversation_id})

    assert await titles(client) == ["Fake title"]


async def test_delete_conversation_removes_its_messages(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")

    response = await client.delete(f"/api/conversations/{conversation_id}")

    assert response.status_code == 204
    assert await titles(client) == []
    missing = await client.get(f"/api/conversations/{conversation_id}/messages")
    assert missing.status_code == 404


async def test_update_or_delete_a_missing_conversation_is_not_found(client: AsyncClient) -> None:
    assert (await client.patch("/api/conversations/99", json={"title": "x"})).status_code == 404
    assert (await client.delete("/api/conversations/99")).status_code == 404


async def test_bulk_archive_unarchive_and_delete(client: AsyncClient) -> None:
    first = await start_chat(client, "one")
    second = await start_chat(client, "two")
    third = await start_chat(client, "three")

    archived = await client.post(
        "/api/conversations/bulk", json={"ids": [first, second, 99], "action": "archive"}
    )
    assert archived.json() == {"affected": 2}
    assert len(await titles(client)) == 1
    assert len(await titles(client, archived=True)) == 2

    await client.post("/api/conversations/bulk", json={"ids": [first], "action": "unarchive"})
    assert len(await titles(client)) == 2

    deleted = await client.post(
        "/api/conversations/bulk", json={"ids": [first, second, third], "action": "delete"}
    )
    assert deleted.json() == {"affected": 3}
    assert await titles(client) == []
    assert await titles(client, archived=True) == []


async def test_bulk_needs_at_least_one_id(client: AsyncClient) -> None:
    response = await client.post("/api/conversations/bulk", json={"ids": [], "action": "delete"})

    assert response.status_code == 422


async def test_get_one_conversation(client: AsyncClient) -> None:
    conversation_id = await start_chat(client, "Hola")

    response = await client.get(f"/api/conversations/{conversation_id}")

    assert response.status_code == 200
    assert response.json()["title"] == "Fake title"
    assert (await client.get("/api/conversations/99")).status_code == 404


async def test_search_matches_titles_and_messages_in_any_case(client: AsyncClient) -> None:
    about_apis = await start_chat(client, "What is an API?")
    await client.patch(f"/api/conversations/{about_apis}", json={"title": "APIs 101"})
    await start_chat(client, "Tips for 100% better PROMPTS")
    await start_chat(client, "Unrelated")

    async def search(q: str) -> list[str]:
        response = await client.get("/api/conversations", params={"q": q})
        return [conversation["title"] for conversation in response.json()]

    assert await search("apis") == ["APIs 101"]
    assert await search("prompts") == ["Fake title"]  # found in the message, not the title
    assert await search("100%") == ["Fake title"]
    assert await search("%") == ["Fake title"]  # literal, not a wildcard
    assert await search("nothing here") == []
