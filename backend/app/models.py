from datetime import datetime

from sqlalchemy import DateTime, Identity, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Exchange(Base):
    """One question sent to Claude and the answer it returned."""

    __tablename__ = "exchanges"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    prompt: Mapped[str] = mapped_column(Text)
    reply: Mapped[str] = mapped_column(Text)
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
