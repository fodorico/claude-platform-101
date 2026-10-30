import base64
import binascii
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import ModelPrice, Provider

MAX_PROMPT_LENGTH = 10_000
MAX_SYSTEM_PROMPT_LENGTH = 10_000
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 3_000_000
# The highest max_tokens a chat can ask for; current models allow up to 128K output tokens.
MAX_OUTPUT_TOKENS = 128_000

ImageMediaType = Literal["image/png", "image/jpeg", "image/gif", "image/webp"]


class ImageCreate(BaseModel):
    media_type: ImageMediaType
    # Base64-encoded bytes, at most 3 MB once decoded.
    data: str

    @field_validator("data")
    @classmethod
    def valid_image_data(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except binascii.Error as exc:
            raise ValueError("The image is not valid base64") from exc
        if not decoded:
            raise ValueError("The image is empty")
        if len(decoded) > MAX_IMAGE_BYTES:
            raise ValueError("Images can be at most 3 MB")
        return value


class ChatSettings(BaseModel):
    """How the model answers in a chat; None means the API's default."""

    system_prompt: str | None = Field(default=None, max_length=MAX_SYSTEM_PROMPT_LENGTH)
    # Gemini only: current Claude models don't accept sampling parameters.
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=MAX_OUTPUT_TOKENS)
    # Return the model's reasoning (a summary of it) with each answer.
    show_thinking: bool = False

    @field_validator("system_prompt")
    @classmethod
    def blank_is_default(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=MAX_PROMPT_LENGTH)
    # None starts a new conversation.
    conversation_id: int | None = None
    # None means the API's default provider / that provider's default model.
    provider: Provider | None = None
    model: str | None = Field(default=None, max_length=100)
    # Regenerate or edit: the conversation's last exchange. The new answer becomes another
    # version of it (the active one) once it succeeds; its context is everything before it.
    replaces_id: int | None = None
    # Images sent with the message. Regenerating without images keeps those of the replaced one.
    images: list[ImageCreate] = Field(default_factory=list, max_length=MAX_IMAGES)
    # Settings for a new conversation; ignored when sending to an existing one.
    settings: ChatSettings | None = None


class TokenCount(BaseModel):
    """Input tokens a message would use, with its conversation's context and settings."""

    input_tokens: int


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    media_type: str


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
    thinking: str | None
    cache_read_tokens: int
    cache_write_tokens: int
    rating: int | None
    # Versions of one message share a group (the first version's id); one is active.
    version_group: int
    is_active: bool
    attachments: list[AttachmentRead]


class ExchangeUpdate(BaseModel):
    """Rate an answer and/or make this version of the last message the active one."""

    # 1 = good, -1 = bad, 0 = clear the rating.
    rating: Literal[-1, 0, 1] | None = None
    active: Literal[True] | None = None


class ApiCallRead(BaseModel):
    """What the API sent to the provider for one answer, and the usage it returned."""

    provider: str
    # The request as sent, with `messages` rebuilt from the stored exchanges.
    request: dict[str, object]
    usage: dict[str, object]


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    archived_at: datetime | None
    pinned_at: datetime | None
    created_at: datetime
    updated_at: datetime
    system_prompt: str | None
    temperature: float | None
    max_tokens: int | None
    show_thinking: bool


class ConversationUpdate(BaseModel):
    """Rename, archive, pin or change the settings of a conversation; fields left out stay as
    they are."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None
    pinned: bool | None = None
    settings: ChatSettings | None = None

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


class ConversationFork(BaseModel):
    """Start a new chat with this one's messages up to and including `exchange_id`."""

    exchange_id: int


class PromptCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=MAX_PROMPT_LENGTH)

    @field_validator("title", "content")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Can't be empty")
        return value.strip()


class PromptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    created_at: datetime


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
    # For cost estimates; models without a price show no cost.
    prices: list[ModelPrice]


class HealthRead(BaseModel):
    status: str


# Server-sent events of POST /api/messages/stream. The frontend mirrors these shapes in
# frontend/src/api/stream.ts.
class StreamDelta(BaseModel):
    """`event: delta` — a piece of the answer, in order."""

    text: str


class StreamThinking(BaseModel):
    """`event: thinking` — a piece of the model's reasoning, when the chat shows it."""

    text: str


class StreamTitle(BaseModel):
    """`event: title` — after `done`, only for a new conversation: the title the model wrote."""

    conversation_id: int
    title: str


class StreamError(BaseModel):
    """`event: error` — the answer failed; `status` is the HTTP status the error maps to."""

    detail: str
    status: int
