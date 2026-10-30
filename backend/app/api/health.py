from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.schemas import HealthRead

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health(session: Annotated[AsyncSession, Depends(get_session)]) -> HealthRead:
    """Liveness and database connectivity check."""
    await session.execute(text("SELECT 1"))
    return HealthRead(status="ok")
