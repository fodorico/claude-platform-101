from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Identity, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

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
