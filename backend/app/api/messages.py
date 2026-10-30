import logging
import time
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db import get_session, get_session_factory
from app.schemas import ExchangeRead, MessageCreate, StreamDelta, StreamError, StreamTitle
from app.services.chat import (
    ConversationNotFoundError,
    context_for,
    store_exchange,
    write_title,
)
from app.services.llm import (
    LLMError,
    LLMRateLimitError,
    LLMRefusalError,
    LLMRegistry,
    LLMReply,
    LLMSelectionError,
    LLMService,
    Turn,
    get_llm_registry,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messages"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]
RegistryDep = Annotated[LLMRegistry, Depends(get_llm_registry)]


def _http_status(error: LLMError) -> int:
    if isinstance(error, LLMRefusalError | LLMSelectionError):
        return status.HTTP_422_UNPROCESSABLE_CONTENT
    if isinstance(error, LLMRateLimitError):
        return status.HTTP_429_TOO_MANY_REQUESTS
    return status.HTTP_503_SERVICE_UNAVAILABLE


def _elapsed_ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


async def _prepare(
    body: MessageCreate, session: AsyncSession, registry: LLMRegistry
) -> tuple[str, str, LLMService, list[Turn]]:
    """Validate the request before calling the model: provider, model and conversation."""
    try:
        provider, model, llm = registry.resolve(body.provider, body.model)
        turns = await context_for(session, body.conversation_id, body.content)
    except LLMSelectionError as exc:
        raise HTTPException(_http_status(exc), str(exc)) from exc
    except ConversationNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found") from exc
    return provider, model, llm, turns


@router.post("", status_code=status.HTTP_201_CREATED)
async def send_message(
    body: MessageCreate, session: SessionDep, registry: RegistryDep
) -> ExchangeRead:
    """Send a message to the chosen model, store the exchange and return it. A message
    without a conversation starts one, and the model then writes its title."""
    provider, model, llm, turns = await _prepare(body, session, registry)
    start = time.perf_counter()
    try:
        reply = await llm.ask(turns, model=model)
    except LLMError as exc:
        raise HTTPException(_http_status(exc), str(exc)) from exc
    exchange = await store_exchange(
        session, body.conversation_id, body.content, provider, reply, duration_ms=_elapsed_ms(start)
    )
    if body.conversation_id is None:
        await write_title(session, exchange.conversation_id, body.content, llm, model)
    return exchange


def _sse(event: str, payload: BaseModel) -> str:
    return f"event: {event}\ndata: {payload.model_dump_json()}\n\n"


@router.post(
    "/stream",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": (
                "Server-sent events: `delta` (StreamDelta) for each piece of the answer, then "
                "`done` (ExchangeRead) once it is stored, then — for a new conversation — "
                "`title` (StreamTitle); or `error` (StreamError)."
            ),
            "content": {"text/event-stream": {}},
        }
    },
)
async def stream_message(
    body: MessageCreate,
    session: SessionDep,
    session_factory: SessionFactoryDep,
    registry: RegistryDep,
) -> StreamingResponse:
    """Send a message and stream the answer as it is generated; the exchange is stored at the
    end. Nothing is stored if the answer fails, even after part of it was streamed."""
    provider, model, llm, turns = await _prepare(body, session, registry)

    async def events() -> AsyncIterator[str]:
        start = time.perf_counter()
        first_token_ms: int | None = None
        try:
            async for item in llm.stream(turns, model=model):
                if not isinstance(item, LLMReply):
                    if first_token_ms is None:
                        first_token_ms = _elapsed_ms(start)
                    yield _sse("delta", StreamDelta(text=item))
                    continue

                duration_ms = _elapsed_ms(start)
                async with session_factory() as session:
                    exchange = await store_exchange(
                        session,
                        body.conversation_id,
                        body.content,
                        provider,
                        item,
                        duration_ms=duration_ms,
                        first_token_ms=first_token_ms,
                    )
                    yield _sse("done", exchange)
                    if body.conversation_id is None:
                        conversation_id = exchange.conversation_id
                        title = await write_title(
                            session, conversation_id, body.content, llm, model
                        )
                        if title:
                            yield _sse(
                                "title", StreamTitle(conversation_id=conversation_id, title=title)
                            )
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
