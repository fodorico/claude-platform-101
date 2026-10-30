"""Conversations in the database: the context sent with each message, storing exchanges, titles."""

import base64
import logging
from dataclasses import dataclass, field

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Attachment, Conversation, Exchange
from app.schemas import ChatSettings, ExchangeRead, ImageCreate
from app.services.llm import GenerationOptions, Image, LLMError, LLMReply, LLMService, Turn

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


@dataclass
class Context:
    """What a new message is sent with: the earlier turns and the chat's settings."""

    turns: list[Turn]
    options: GenerationOptions
    # The exchanges the earlier turns came from, oldest first.
    exchange_ids: list[int] = field(default_factory=list)


def options_for(settings: Conversation | ChatSettings | None) -> GenerationOptions:
    if settings is None:
        return GenerationOptions()
    return GenerationOptions(
        system=settings.system_prompt,
        max_tokens=settings.max_tokens,
        temperature=settings.temperature,
        show_thinking=settings.show_thinking,
    )


def _images(attachments: list[Attachment]) -> tuple[Image, ...]:
    return tuple(Image(item.media_type, item.data) for item in attachments)


async def _last_active(session: AsyncSession, conversation_id: int) -> Exchange | None:
    return await session.scalar(
        select(Exchange)
        .where(Exchange.conversation_id == conversation_id, Exchange.is_active)
        .order_by(Exchange.id.desc())
        .limit(1)
    )


async def context_for(
    session: AsyncSession,
    conversation_id: int | None,
    content: str,
    *,
    replaces_id: int | None = None,
    images: list[ImageCreate] | None = None,
    settings: ChatSettings | None = None,
) -> Context:
    """The turns to send: the conversation's latest active exchanges (those before
    `replaces_id`, when replacing the last one), then the new message with its images (or, when
    replacing without new images, those of the replaced message). A new conversation uses
    `settings`; an existing one, its own."""
    new_images = tuple(Image(i.media_type, base64.b64decode(i.data)) for i in images or [])
    if conversation_id is None:
        if replaces_id is not None:
            raise NotLastExchangeError
        return Context([Turn("user", content, new_images)], options_for(settings))

    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise ConversationNotFoundError
    in_conversation = select(Exchange).where(
        Exchange.conversation_id == conversation_id, Exchange.is_active
    )
    if replaces_id is not None:
        last = await _last_active(session, conversation_id)
        if last is None or last.id != replaces_id:
            raise NotLastExchangeError
        in_conversation = in_conversation.where(Exchange.id < replaces_id)
        if not new_images:
            new_images = _images(last.attachments)
    latest = (
        await session.scalars(
            in_conversation.order_by(Exchange.id.desc()).limit(MAX_CONTEXT_EXCHANGES)
        )
    ).all()
    turns: list[Turn] = []
    for exchange in reversed(latest):
        turns += [
            Turn("user", exchange.prompt, _images(exchange.attachments)),
            Turn("assistant", exchange.reply),
        ]
    return Context(
        [*turns, Turn("user", content, new_images)],
        options_for(conversation),
        [exchange.id for exchange in reversed(latest)],
    )


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
    context: Context,
    duration_ms: int,
    first_token_ms: int | None = None,
    replaces_id: int | None = None,
    settings: ChatSettings | None = None,
) -> ExchangeRead:
    """Store the exchange, creating its conversation (with `settings`) when it is the first
    message. Replacing the last message adds the exchange as its new active version."""
    if conversation_id is None:
        conversation = Conversation(title=fallback_title(prompt))
        if settings is not None:
            conversation.system_prompt = settings.system_prompt
            conversation.temperature = settings.temperature
            conversation.max_tokens = settings.max_tokens
            conversation.show_thinking = settings.show_thinking
        session.add(conversation)
        await session.flush()
    else:
        conversation = await session.get_one(Conversation, conversation_id)
        conversation.updated_at = func.now()
        # Writing in an archived chat brings it back to the main list.
        conversation.archived_at = None

    version_of: int | None = None
    if replaces_id is not None:
        replaced = await session.get_one(Exchange, replaces_id)
        version_of = replaced.version_group
        await session.execute(
            update(Exchange).where(Exchange.id == version_of).values(is_active=False)
        )
        await session.execute(
            update(Exchange).where(Exchange.version_of == version_of).values(is_active=False)
        )

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
        thinking=reply.thinking or None,
        cache_read_tokens=reply.cache_read_tokens,
        cache_write_tokens=reply.cache_write_tokens,
        version_of=version_of,
        api_call={
            "request": reply.request,
            "context_ids": context.exchange_ids,
            "usage": reply.usage,
        },
        attachments=[
            Attachment(media_type=image.media_type, data=image.data)
            for image in context.turns[-1].images
        ],
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
            options=GenerationOptions(system=TITLE_SYSTEM_PROMPT, max_tokens=TITLE_MAX_TOKENS),
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
