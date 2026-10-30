from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Conversation(Base):
    """A chat: the exchanges sent together, each with the earlier ones as context."""

    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    # Starts as the first message, shortened; then replaced by a title the model writes.
    title: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Archived chats are hidden from the main list; set to None again to bring one back.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Bumped on every new exchange, so the history lists the latest chats first.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # Pinned chats are listed first.
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Generation settings for every message of the chat; None means the API's default.
    system_prompt: Mapped[str | None] = mapped_column(Text)
    temperature: Mapped[float | None] = mapped_column(Float)
    max_tokens: Mapped[int | None]
    show_thinking: Mapped[bool] = mapped_column(Boolean, server_default="false")


class Exchange(Base):
    """One message sent to the model and the answer it returned."""

    __tablename__ = "exchanges"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    prompt: Mapped[str] = mapped_column(Text)
    reply: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(100))
    stop_reason: Mapped[str] = mapped_column(String(50))
    input_tokens: Mapped[int]
    output_tokens: Mapped[int]
    # Wall-clock time measured by the API; first_token_ms only exists for streamed answers.
    duration_ms: Mapped[int | None]
    first_token_ms: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    # The model's reasoning (a summary), when the chat asked to show it.
    thinking: Mapped[str | None] = mapped_column(Text)
    cache_read_tokens: Mapped[int] = mapped_column(server_default="0")
    cache_write_tokens: Mapped[int] = mapped_column(server_default="0")
    # The user's feedback: 1 (good), -1 (bad) or None.
    rating: Mapped[int | None] = mapped_column(SmallInteger)
    # Regenerating or editing the last message adds a version of it instead of replacing it:
    # versions share the first one's id here (None on the first), and one of them is active.
    # The context sent to the model is made of the active exchanges.
    version_of: Mapped[int | None] = mapped_column(
        ForeignKey("exchanges.id", ondelete="CASCADE"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    # What was sent to the provider (without the messages) and the usage it returned.
    api_call: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    attachments: Mapped[list[Attachment]] = relationship(
        lazy="selectin", order_by="Attachment.id", cascade="all, delete-orphan"
    )

    @property
    def version_group(self) -> int:
        return self.version_of or self.id


class Attachment(Base):
    """An image sent with a message."""

    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    exchange_id: Mapped[int] = mapped_column(
        ForeignKey("exchanges.id", ondelete="CASCADE"), index=True
    )
    media_type: Mapped[str] = mapped_column(String(50))
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Prompt(Base):
    """A saved prompt, inserted into the message box from the prompt library."""

    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    title: Mapped[str] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
