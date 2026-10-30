from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Conversation, Exchange
from app.schemas import ConversationRead, ExchangeRead

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def list_conversations(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 50
) -> list[ConversationRead]:
    """Return the conversations with the most recent activity first."""
    result = await session.scalars(
        select(Conversation)
        .order_by(Conversation.updated_at.desc(), Conversation.id.desc())
        .limit(limit)
    )
    return [ConversationRead.model_validate(conversation) for conversation in result]


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
