from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

MAX_PROMPT_LENGTH = 10_000


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_PROMPT_LENGTH)


class ExchangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    prompt: str
    reply: str
    model: str
    created_at: datetime


class HealthRead(BaseModel):
    status: str


# Server-sent events of POST /api/messages/stream. The frontend mirrors these shapes in
# frontend/src/api/stream.ts.
class StreamDelta(BaseModel):
    """`event: delta` — a piece of the answer, in order."""

    text: str


class StreamError(BaseModel):
    """`event: error` — the answer failed; `status` is the HTTP status the error maps to."""

    detail: str
    status: int
