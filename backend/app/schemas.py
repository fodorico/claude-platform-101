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
