from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.config import Settings
from app.schemas import ModelSettingsRead

router = APIRouter(prefix="/api/model-settings", tags=["model settings"])


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


@router.get("")
async def get_model_settings(
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> ModelSettingsRead:
    """Return the provider, model and request settings used to answer messages."""
    return ModelSettingsRead(
        provider=settings.llm_provider,
        model=settings.llm_model,
        max_tokens=settings.max_tokens,
        system_prompt=settings.system_prompt,
    )
