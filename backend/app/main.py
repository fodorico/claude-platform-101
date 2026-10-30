import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute

from app.api import health, messages
from app.config import Settings, get_settings
from app.db import create_engine, create_session_factory
from app.services.claude import ClaudeService


def _operation_id(route: APIRoute) -> str:
    return route.name


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings.database_url)
        api_key = settings.anthropic_api_key
        client = anthropic.AsyncAnthropic(
            api_key=api_key.get_secret_value() if api_key else None,
            timeout=settings.anthropic_timeout_seconds,
        )
        app.state.session_factory = create_session_factory(engine)
        app.state.claude_service = ClaudeService(
            client,
            model=settings.anthropic_model,
            effort=settings.anthropic_effort,
            max_tokens=settings.anthropic_max_tokens,
            system_prompt=settings.system_prompt,
        )
        yield
        await client.close()
        await engine.dispose()

    app = FastAPI(
        title="Claude Platform 101 API",
        version="0.1.0",
        lifespan=lifespan,
        # Operation IDs become the generated frontend function names (e.g. sendMessage).
        generate_unique_id_function=_operation_id,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(messages.router)
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
