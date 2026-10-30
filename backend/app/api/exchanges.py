from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Attachment, Exchange
from app.schemas import ApiCallRead, ExchangeRead, ExchangeUpdate

router = APIRouter(tags=["exchanges"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _get_or_404(session: AsyncSession, exchange_id: int) -> Exchange:
    exchange = await session.get(Exchange, exchange_id)
    if exchange is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return exchange


@router.patch("/api/exchanges/{exchange_id}")
async def update_exchange(
    exchange_id: int, body: ExchangeUpdate, session: SessionDep
) -> ExchangeRead:
    """Rate an answer, or make this version of the conversation's last message the active one
    (earlier messages keep their version, so later context stays consistent)."""
    exchange = await _get_or_404(session, exchange_id)
    if body.rating is not None:
        exchange.rating = body.rating or None
    if body.active and not exchange.is_active:
        last = await session.scalar(
            select(Exchange)
            .where(Exchange.conversation_id == exchange.conversation_id, Exchange.is_active)
            .order_by(Exchange.id.desc())
            .limit(1)
        )
        if last is None or last.version_group != exchange.version_group:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Only the last message's versions can be switched",
            )
        group = exchange.version_group
        await session.execute(
            update(Exchange)
            .where(or_(Exchange.id == group, Exchange.version_of == group))
            .values(is_active=Exchange.id == exchange.id)
        )
    await session.commit()
    await session.refresh(exchange)
    return ExchangeRead.model_validate(exchange)


def _content(provider: str, text: str, images: list[Attachment]) -> Any:
    """A user message's content in the provider's shape, images shown by size only."""
    if provider == "gemini":
        return [
            *(
                {"inline_data": {"mime_type": item.media_type, "data": f"<{len(item.data)} bytes>"}}
                for item in images
            ),
            {"text": text},
        ]
    if not images:
        return text
    return [
        *(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": item.media_type,
                    "data": f"<{len(item.data)} bytes>",
                },
            }
            for item in images
        ),
        {"type": "text", "text": text},
    ]


@router.get("/api/exchanges/{exchange_id}/api-call")
async def get_api_call(exchange_id: int, session: SessionDep) -> ApiCallRead:
    """What was sent to the provider for this answer and the usage it returned. The messages
    are rebuilt from the stored exchanges (earlier messages deleted since are left out)."""
    exchange = await _get_or_404(session, exchange_id)
    api_call = exchange.api_call
    if not api_call:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No API call was recorded for this message")
    context_ids: list[int] = api_call.get("context_ids", [])
    earlier = {
        item.id: item
        for item in await session.scalars(select(Exchange).where(Exchange.id.in_(context_ids)))
    }
    turns: list[tuple[str, Any]] = []
    for item in (earlier[i] for i in context_ids if i in earlier):
        turns += [
            ("user", _content(exchange.provider, item.prompt, item.attachments)),
            ("assistant", item.reply),
        ]
    turns.append(("user", _content(exchange.provider, exchange.prompt, exchange.attachments)))

    request = dict(api_call.get("request", {}))
    if exchange.provider == "gemini":
        request["contents"] = [
            {
                "role": "model" if role == "assistant" else "user",
                "parts": content if isinstance(content, list) else [{"text": content}],
            }
            for role, content in turns
        ]
    else:
        request["messages"] = [{"role": role, "content": content} for role, content in turns]
    return ApiCallRead(provider=exchange.provider, request=request, usage=api_call.get("usage", {}))


@router.get(
    "/api/attachments/{attachment_id}",
    response_class=Response,
    responses={200: {"content": {"image/*": {}}, "description": "The image"}},
)
async def get_attachment(attachment_id: int, session: SessionDep) -> Response:
    """Return an image sent with a message."""
    attachment = await session.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    # Attachments never change, so the browser can keep them.
    return Response(
        content=attachment.data,
        media_type=attachment.media_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
