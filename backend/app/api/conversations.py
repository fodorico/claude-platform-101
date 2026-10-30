from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Conversation, Exchange
from app.schemas import (
    ConversationBulkAction,
    ConversationBulkResult,
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
    """Return the active (or, with `archived=true`, the archived) conversations, most recent
    activity first. `q` keeps those whose title or messages contain it (any case)."""
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
        query.order_by(Conversation.updated_at.desc(), Conversation.id.desc()).limit(limit)
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
    """Return a conversation's exchanges, oldest first."""
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
    """Rename a conversation, archive it or bring it back."""
    conversation = await _get_or_404(session, conversation_id)
    if body.title is not None:
        conversation.title = body.title
    if body.archived is not None:
        conversation.archived_at = func.now() if body.archived else None
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
