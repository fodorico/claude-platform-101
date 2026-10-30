from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Attachment, Conversation, Exchange
from app.schemas import (
    ConversationBulkAction,
    ConversationBulkResult,
    ConversationFork,
    ConversationRead,
    ConversationUpdate,
    ExchangeRead,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def list_conversations(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    archived: bool = False,
    q: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> list[ConversationRead]:
    """Return the active (or, with `archived=true`, the archived) conversations: pinned ones
    first, then most recent activity first. `q` keeps those whose title or messages contain it
    (any case)."""
    query = select(Conversation).where(
        Conversation.archived_at.is_not(None) if archived else Conversation.archived_at.is_(None)
    )
    if q:
        # % and _ are wildcards in LIKE; search for them literally.
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        in_messages = exists().where(
            Exchange.conversation_id == Conversation.id,
            or_(
                Exchange.prompt.ilike(pattern, escape="\\"),
                Exchange.reply.ilike(pattern, escape="\\"),
            ),
        )
        query = query.where(or_(Conversation.title.ilike(pattern, escape="\\"), in_messages))
    result = await session.scalars(
        query.order_by(
            Conversation.pinned_at.desc().nulls_last(),
            Conversation.updated_at.desc(),
            Conversation.id.desc(),
        ).limit(limit)
    )
    return [ConversationRead.model_validate(conversation) for conversation in result]


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: int, session: SessionDep) -> ConversationRead:
    """Return one conversation, active or archived."""
    return ConversationRead.model_validate(await _get_or_404(session, conversation_id))


@router.get("/{conversation_id}/messages")
async def list_conversation_messages(
    conversation_id: int, session: SessionDep
) -> list[ExchangeRead]:
    """Return a conversation's exchanges, oldest first, including every version of a message
    (`version_group`); the context sent to the model is made of the active ones."""
    if await session.get(Conversation, conversation_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    result = await session.scalars(
        select(Exchange).where(Exchange.conversation_id == conversation_id).order_by(Exchange.id)
    )
    return [ExchangeRead.model_validate(exchange) for exchange in result]


async def _get_or_404(session: AsyncSession, conversation_id: int) -> Conversation:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conversation


@router.patch("/{conversation_id}")
async def update_conversation(
    conversation_id: int, body: ConversationUpdate, session: SessionDep
) -> ConversationRead:
    """Rename a conversation, archive or pin it (or undo that), or change its settings."""
    conversation = await _get_or_404(session, conversation_id)
    if body.title is not None:
        conversation.title = body.title
    if body.archived is not None:
        conversation.archived_at = func.now() if body.archived else None
    if body.pinned is not None:
        conversation.pinned_at = func.now() if body.pinned else None
    if body.settings is not None:
        conversation.system_prompt = body.settings.system_prompt
        conversation.temperature = body.settings.temperature
        conversation.max_tokens = body.settings.max_tokens
        conversation.show_thinking = body.settings.show_thinking
    await session.commit()
    await session.refresh(conversation)
    return ConversationRead.model_validate(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: int, session: SessionDep) -> Response:
    """Delete a conversation and its messages. This can't be undone."""
    await session.delete(await _get_or_404(session, conversation_id))
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bulk")
async def bulk_update_conversations(
    body: ConversationBulkAction, session: SessionDep
) -> ConversationBulkResult:
    """Archive, bring back or delete several conversations at once; unknown ids are skipped."""
    selected = Conversation.id.in_(body.ids)
    statement = (
        delete(Conversation).where(selected)
        if body.action == "delete"
        else update(Conversation)
        .where(selected)
        .values(archived_at=func.now() if body.action == "archive" else None)
    )
    # UPDATE/DELETE return a cursor result, which carries the row count.
    result = cast(CursorResult[Any], await session.execute(statement))
    await session.commit()
    return ConversationBulkResult(affected=result.rowcount)


@router.post("/{conversation_id}/fork", status_code=status.HTTP_201_CREATED)
async def fork_conversation(
    conversation_id: int, body: ConversationFork, session: SessionDep
) -> ConversationRead:
    """Start a new chat with this one's settings and its messages up to and including
    `exchange_id` (the active versions only), to take the conversation another way."""
    source = await _get_or_404(session, conversation_id)
    exchanges = (
        await session.scalars(
            select(Exchange)
            .where(
                Exchange.conversation_id == conversation_id,
                Exchange.is_active,
                Exchange.id <= body.exchange_id,
            )
            .order_by(Exchange.id)
        )
    ).all()
    if not exchanges or exchanges[-1].id != body.exchange_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The message is not in this conversation"
        )
    fork = Conversation(
        title=f"{source.title[:191]} (fork)",
        system_prompt=source.system_prompt,
        temperature=source.temperature,
        max_tokens=source.max_tokens,
        show_thinking=source.show_thinking,
    )
    session.add(fork)
    await session.flush()
    for exchange in exchanges:
        session.add(
            Exchange(
                conversation_id=fork.id,
                prompt=exchange.prompt,
                reply=exchange.reply,
                provider=exchange.provider,
                model=exchange.model,
                stop_reason=exchange.stop_reason,
                input_tokens=exchange.input_tokens,
                output_tokens=exchange.output_tokens,
                duration_ms=exchange.duration_ms,
                first_token_ms=exchange.first_token_ms,
                thinking=exchange.thinking,
                cache_read_tokens=exchange.cache_read_tokens,
                cache_write_tokens=exchange.cache_write_tokens,
                rating=exchange.rating,
                api_call=exchange.api_call,
                attachments=[
                    Attachment(media_type=item.media_type, data=item.data)
                    for item in exchange.attachments
                ],
            )
        )
    await session.commit()
    await session.refresh(fork)
    return ConversationRead.model_validate(fork)
