from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.config import Settings
from app.schemas import ModelSettingsRead, ProviderRead
from app.services.llm import LLMRegistry, get_llm_registry

router = APIRouter(prefix="/api/model-settings", tags=["model settings"])


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


@router.get("")
async def get_model_settings(
    settings: Annotated[Settings, Depends(get_app_settings)],
    registry: Annotated[LLMRegistry, Depends(get_llm_registry)],
) -> ModelSettingsRead:
    """Return the providers and models a message can be sent to, and the shared settings."""
    return ModelSettingsRead(
        default_provider=registry.default_provider,
        providers=[
            ProviderRead(name=item.provider, available=item.available, models=item.models)
            for item in registry.providers
        ],
        max_tokens=settings.max_tokens,
        system_prompt=settings.system_prompt,
    )
