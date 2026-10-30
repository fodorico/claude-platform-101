import logging
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

import anthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from google import genai
from google.genai import types as genai_types
from pydantic import SecretStr

from app.api import health, messages
from app.config import Settings, get_settings
from app.db import create_engine, create_session_factory
from app.services.claude import ClaudeService
from app.services.gemini import GeminiService
from app.services.llm import LLMService


def _operation_id(route: APIRoute) -> str:
    return route.name


def _secret(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value else None


def build_llm_service(settings: Settings, stack: AsyncExitStack) -> LLMService:
    """Create the configured provider's client; `stack` closes it on shutdown."""
    if settings.llm_provider == "gemini":
        gemini_client = genai.Client(
            api_key=_secret(settings.gemini_api_key),
            http_options=genai_types.HttpOptions(timeout=int(settings.timeout_seconds * 1000)),
        )
        stack.push_async_callback(gemini_client.aio.aclose)
        return GeminiService(
            gemini_client,
            model=settings.gemini_model,
            max_tokens=settings.max_tokens,
            system_prompt=settings.system_prompt,
        )

    claude_client = anthropic.AsyncAnthropic(
        api_key=_secret(settings.anthropic_api_key), timeout=settings.timeout_seconds
    )
    stack.push_async_callback(claude_client.close)
    return ClaudeService(
        claude_client,
        model=settings.anthropic_model,
        effort=settings.anthropic_effort,
        max_tokens=settings.max_tokens,
        system_prompt=settings.system_prompt,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            engine = create_engine(settings.database_url)
            stack.push_async_callback(engine.dispose)
            app.state.session_factory = create_session_factory(engine)
            app.state.llm_service = build_llm_service(settings, stack)
            yield

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
