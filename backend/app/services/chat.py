"""Conversations in the database: the context sent with each message, storing exchanges, titles."""

import logging

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, Exchange
from app.schemas import ExchangeRead
from app.services.llm import LLMError, LLMReply, LLMService, Turn

logger = logging.getLogger(__name__)

# Earlier exchanges sent as context; older ones are left out to bound the request size.
MAX_CONTEXT_EXCHANGES = 20
FALLBACK_TITLE_LENGTH = 60

TITLE_SYSTEM_PROMPT = (
    "Write a short title, at most six words, for a chat that starts with the user's message. "
    "Use the language of the message. Reply with the title only: no quotes, no final period."
)
TITLE_MAX_TOKENS = 200


class ConversationNotFoundError(Exception):
    pass


class NotLastExchangeError(Exception):
    """Only a conversation's last exchange can be regenerated or edited."""


async def context_for(
    session: AsyncSession,
    conversation_id: int | None,
    content: str,
    replaces_id: int | None = None,
) -> list[Turn]:
    """The turns to send: the conversation's latest exchanges (those before `replaces_id`, when
    replacing the last one), then the new message."""
    turns: list[Turn] = []
    if replaces_id is not None and conversation_id is None:
        raise NotLastExchangeError
    if conversation_id is not None:
        if await session.get(Conversation, conversation_id) is None:
            raise ConversationNotFoundError
        in_conversation = select(Exchange).where(Exchange.conversation_id == conversation_id)
        if replaces_id is not None:
            last_id = await session.scalar(
                select(func.max(Exchange.id)).where(Exchange.conversation_id == conversation_id)
            )
            if last_id != replaces_id:
                raise NotLastExchangeError
            in_conversation = in_conversation.where(Exchange.id < replaces_id)
        latest = await session.scalars(
            in_conversation.order_by(Exchange.id.desc()).limit(MAX_CONTEXT_EXCHANGES)
        )
        for exchange in reversed(latest.all()):
            turns += [Turn("user", exchange.prompt), Turn("assistant", exchange.reply)]
    return [*turns, Turn("user", content)]


def fallback_title(prompt: str) -> str:
    """The first message, cut at a word boundary: the title until the model writes one."""
    text = " ".join(prompt.split())
    if len(text) <= FALLBACK_TITLE_LENGTH:
        return text
    return text[:FALLBACK_TITLE_LENGTH].rsplit(" ", 1)[0] + "…"


async def store_exchange(
    session: AsyncSession,
    conversation_id: int | None,
    prompt: str,
    provider: str,
    reply: LLMReply,
    *,
    duration_ms: int,
    first_token_ms: int | None = None,
    replaces_id: int | None = None,
) -> ExchangeRead:
    """Store the exchange, creating its conversation when it is the first message, and
    dropping the exchange it replaces."""
    if conversation_id is None:
        conversation = Conversation(title=fallback_title(prompt))
        session.add(conversation)
        await session.flush()
    else:
        conversation = await session.get_one(Conversation, conversation_id)
        conversation.updated_at = func.now()
        # Writing in an archived chat brings it back to the main list.
        conversation.archived_at = None

    if replaces_id is not None:
        await session.execute(delete(Exchange).where(Exchange.id == replaces_id))

    exchange = Exchange(
        conversation_id=conversation.id,
        prompt=prompt,
        reply=reply.text,
        provider=provider,
        model=reply.model,
        stop_reason=reply.stop_reason,
        input_tokens=reply.input_tokens,
        output_tokens=reply.output_tokens,
        duration_ms=duration_ms,
        first_token_ms=first_token_ms,
    )
    session.add(exchange)
    await session.commit()
    await session.refresh(exchange)
    return ExchangeRead.model_validate(exchange)


async def write_title(
    session: AsyncSession, conversation_id: int, prompt: str, llm: LLMService, model: str
) -> str | None:
    """Ask the model for a title and store it; None (keeping the fallback) if that fails."""
    try:
        reply = await llm.ask(
            [Turn("user", prompt)],
            model=model,
            system=TITLE_SYSTEM_PROMPT,
            max_tokens=TITLE_MAX_TOKENS,
        )
    except LLMError as exc:
        logger.warning("Could not write a title for conversation %s: %s", conversation_id, exc)
        return None

    lines = reply.text.strip().splitlines()
    title = lines[0].strip().strip("\"'“”*#").strip().rstrip(".") if lines else ""
    if not title:
        return None
    title = title[:200]
    conversation = await session.get_one(Conversation, conversation_id)
    conversation.title = title
    await session.commit()
    return title
