import logging
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import get_session, get_session_factory
from app.models import Exchange
from app.schemas import ExchangeRead, MessageCreate, StreamDelta, StreamError
from app.services.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMReply,
    LLMService,
    get_llm_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messages"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]
LLMDep = Annotated[LLMService, Depends(get_llm_service)]


def _http_status(error: LLMError) -> int:
    if isinstance(error, LLMRefusalError):
        return status.HTTP_422_UNPROCESSABLE_CONTENT
    if isinstance(error, LLMRateLimitError):
        return status.HTTP_429_TOO_MANY_REQUESTS
    return status.HTTP_503_SERVICE_UNAVAILABLE


async def _store(session: AsyncSession, prompt: str, reply: LLMReply) -> ExchangeRead:
    exchange = Exchange(
        prompt=prompt,
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


@router.post("", status_code=status.HTTP_201_CREATED)
async def send_message(body: MessageCreate, session: SessionDep, llm: LLMDep) -> ExchangeRead:
    """Send a message to the configured model, store the exchange and return it."""
    try:
        reply = await llm.ask(body.content)
    except LLMError as exc:
        raise HTTPException(_http_status(exc), str(exc)) from exc
    return await _store(session, body.content, reply)


def _sse(event: str, payload: BaseModel) -> str:
    return f"event: {event}\ndata: {payload.model_dump_json()}\n\n"


@router.post(
    "/stream",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": (
                "Server-sent events: `delta` (StreamDelta) for each piece of the answer, then "
                "`done` (ExchangeRead) once it is stored, or `error` (StreamError)."
            ),
            "content": {"text/event-stream": {}},
        }
    },
)
async def stream_message(
    body: MessageCreate, session_factory: SessionFactoryDep, llm: LLMDep
) -> StreamingResponse:
    """Send a message and stream the answer as it is generated; the exchange is stored at the
    end. Nothing is stored if the answer fails, even after part of it was streamed."""

    async def events() -> AsyncIterator[str]:
        try:
            async for item in llm.stream(body.content):
                if isinstance(item, LLMReply):
                    async with session_factory() as session:
                        exchange = await _store(session, body.content, item)
                    yield _sse("done", exchange)
                else:
                    yield _sse("delta", StreamDelta(text=item))
        except LLMError as exc:
            yield _sse("error", StreamError(detail=str(exc), status=_http_status(exc)))
        except Exception:
            logger.exception("Streaming the answer failed")
            yield _sse(
                "error",
                StreamError(
                    detail="Something went wrong", status=status.HTTP_500_INTERNAL_SERVER_ERROR
                ),
            )

    # X-Accel-Buffering: nginx must forward each event as soon as it is written.
    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("")
async def list_messages(
    session: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[ExchangeRead]:
    """Return the most recent exchanges, newest first."""
    result = await session.scalars(
        select(Exchange).order_by(Exchange.created_at.desc(), Exchange.id.desc()).limit(limit)
    )
    return [ExchangeRead.model_validate(exchange) for exchange in result]
