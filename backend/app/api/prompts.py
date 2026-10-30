from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Prompt
from app.schemas import PromptCreate, PromptRead

router = APIRouter(prefix="/api/prompts", tags=["prompts"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("")
async def list_prompts(session: SessionDep) -> list[PromptRead]:
    """Return the saved prompts, alphabetically."""
    result = await session.scalars(select(Prompt).order_by(Prompt.title, Prompt.id))
    return [PromptRead.model_validate(prompt) for prompt in result]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_prompt(body: PromptCreate, session: SessionDep) -> PromptRead:
    """Save a prompt to reuse later."""
    prompt = Prompt(title=body.title, content=body.content)
    session.add(prompt)
    await session.commit()
    await session.refresh(prompt)
    return PromptRead.model_validate(prompt)


@router.put("/{prompt_id}")
async def update_prompt(prompt_id: int, body: PromptCreate, session: SessionDep) -> PromptRead:
    """Change a saved prompt's title and text."""
    prompt = await session.get(Prompt, prompt_id)
    if prompt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt not found")
    prompt.title, prompt.content = body.title, body.content
    await session.commit()
    await session.refresh(prompt)
    return PromptRead.model_validate(prompt)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_prompt(prompt_id: int, session: SessionDep) -> Response:
    """Delete a saved prompt."""
    prompt = await session.get(Prompt, prompt_id)
    if prompt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt not found")
    await session.delete(prompt)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
