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
