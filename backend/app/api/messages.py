from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Exchange
from app.schemas import ExchangeRead, MessageCreate
from app.services.claude import (
    ClaudeRateLimitError,
    ClaudeRefusalError,
    ClaudeService,
    ClaudeUnavailableError,
    get_claude_service,
)

router = APIRouter(prefix="/api/messages", tags=["messages"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ClaudeDep = Annotated[ClaudeService, Depends(get_claude_service)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def send_message(body: MessageCreate, session: SessionDep, claude: ClaudeDep) -> ExchangeRead:
    """Send a message to Claude, store the exchange and return it."""
    try:
        reply = await claude.ask(body.content)
    except ClaudeRefusalError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ClaudeRateLimitError as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, str(exc)) from exc
    except ClaudeUnavailableError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    exchange = Exchange(
        prompt=body.content,
        reply=reply.text,
        model=reply.model,
        stop_reason=reply.stop_reason,
        input_tokens=reply.input_tokens,
        output_tokens=reply.output_tokens,
    )
    session.add(exchange)
    await session.commit()
    await session.refresh(exchange)
    return ExchangeRead.model_validate(exchange)


@router.get("")
async def list_messages(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[ExchangeRead]:
    """Return the most recent exchanges, newest first."""
    result = await session.scalars(
        select(Exchange).order_by(Exchange.created_at.desc(), Exchange.id.desc()).limit(limit)
    )
    return [ExchangeRead.model_validate(exchange) for exchange in result]
