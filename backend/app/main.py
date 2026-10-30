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

from app.api import conversations, exchanges, health, messages, model_settings, prompts
from app.config import Settings, get_settings
from app.db import create_engine, create_session_factory
from app.services.claude import ClaudeService
from app.services.gemini import GeminiService
from app.services.llm import LLMRegistry, LLMService


def _operation_id(route: APIRoute) -> str:
    return route.name


def _secret(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value else None


def build_llm_registry(settings: Settings, stack: AsyncExitStack) -> LLMRegistry:
    """Create a client for each provider with an API key; `stack` closes them on shutdown."""
    services: dict[str, LLMService] = {}
    if settings.gemini_api_key:
        gemini_client = genai.Client(
            api_key=_secret(settings.gemini_api_key),
            http_options=genai_types.HttpOptions(timeout=int(settings.timeout_seconds * 1000)),
        )
        stack.push_async_callback(gemini_client.aio.aclose)
        services["gemini"] = GeminiService(
            gemini_client, max_tokens=settings.max_tokens, system_prompt=settings.system_prompt
        )
    if settings.anthropic_api_key:
        claude_client = anthropic.AsyncAnthropic(
            api_key=_secret(settings.anthropic_api_key), timeout=settings.timeout_seconds
        )
        stack.push_async_callback(claude_client.close)
        services["claude"] = ClaudeService(
            claude_client,
            effort=settings.anthropic_effort,
            max_tokens=settings.max_tokens,
            system_prompt=settings.system_prompt,
        )
    return LLMRegistry(
        services,
        {provider: settings.models_for(provider) for provider in ("claude", "gemini")},
        default_provider=settings.llm_provider,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with AsyncExitStack() as stack:
            engine = create_engine(settings.database_url)
            stack.push_async_callback(engine.dispose)
            app.state.settings = settings
            app.state.session_factory = create_session_factory(engine)
            app.state.llm_registry = build_llm_registry(settings, stack)
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
    app.include_router(conversations.router)
    app.include_router(messages.router)
    app.include_router(model_settings.router)
    app.include_router(exchanges.router)
    app.include_router(prompts.router)
    return app


logging.basicConfig(level=logging.INFO)
app = create_app()
