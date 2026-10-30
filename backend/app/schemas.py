from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import Provider

MAX_PROMPT_LENGTH = 10_000


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_PROMPT_LENGTH)
    # None starts a new conversation.
    conversation_id: int | None = None
    # None means the API's default provider / that provider's default model.
    provider: Provider | None = None
    model: str | None = Field(default=None, max_length=100)


class ExchangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    prompt: str
    reply: str
    provider: str
    model: str
    stop_reason: str
    input_tokens: int
    output_tokens: int
    duration_ms: int | None
    first_token_ms: int | None
    created_at: datetime


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ConversationUpdate(BaseModel):
    """Rename and/or archive a conversation; fields left out stay as they are."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("The title can't be empty")
        return value


class ConversationBulkAction(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    action: Literal["archive", "unarchive", "delete"]


class ConversationBulkResult(BaseModel):
    """How many of the given conversations existed and were changed."""

    affected: int


class ProviderRead(BaseModel):
    name: str
    # False when the API has no key for it; its models are listed but can't be picked.
    available: bool
    models: list[str]


class ModelSettingsRead(BaseModel):
    """The models a message can be sent to and the settings shared by every request."""

    default_provider: str
    providers: list[ProviderRead]
    max_tokens: int
    system_prompt: str


class HealthRead(BaseModel):
    status: str


# Server-sent events of POST /api/messages/stream. The frontend mirrors these shapes in
# frontend/src/api/stream.ts.
class StreamDelta(BaseModel):
    """`event: delta` — a piece of the answer, in order."""

    text: str


class StreamTitle(BaseModel):
    """`event: title` — after `done`, only for a new conversation: the title the model wrote."""

    conversation_id: int
    title: str


class StreamError(BaseModel):
    """`event: error` — the answer failed; `status` is the HTTP status the error maps to."""

    detail: str
    status: int
