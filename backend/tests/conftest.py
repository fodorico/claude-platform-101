from collections.abc import AsyncIterator, Iterator, Sequence
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from testcontainers.community.postgres import PostgresContainer

from app.config import Settings
from app.db import create_engine
from app.main import create_app
from app.services.chat import TITLE_SYSTEM_PROMPT
from app.services.llm import (
    LLMError,
    LLMRegistry,
    LLMReply,
    StreamItem,
    Turn,
    get_llm_registry,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent


class FakeLLMService:
    """Stands in for a provider so tests never call a real one."""

    def __init__(self) -> None:
        # Every chat request: the turns sent and the model asked.
        self.requests: list[tuple[list[Turn], str]] = []
        self.error: LLMError | None = None
        self.title = "Fake title"
        self.title_error: LLMError | None = None

    @property
    def prompts(self) -> list[str]:
        return [turns[-1].text for turns, _ in self.requests]

    def _reply(self, prompt: str, model: str) -> LLMReply:
        return LLMReply(
            text=f"Reply to: {prompt}",
            model=model,
            stop_reason="end_turn",
            input_tokens=10,
            output_tokens=5,
        )

    async def ask(
        self,
        messages: Sequence[Turn],
        *,
        model: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMReply:
        if system == TITLE_SYSTEM_PROMPT:
            if self.title_error:
                raise self.title_error
            return LLMReply(self.title, model, "end_turn", 5, 3)
        self.requests.append((list(messages), model))
        if self.error:
            raise self.error
        return self._reply(messages[-1].text, model)

    async def stream(self, messages: Sequence[Turn], *, model: str) -> AsyncIterator[StreamItem]:
        self.requests.append((list(messages), model))
        prompt = messages[-1].text
        for chunk in ["Reply ", "to: ", prompt]:
            yield chunk
            # A configured error fails the stream after the first chunk, like a mid-answer failure.
            if self.error:
                raise self.error
        yield self._reply(prompt, model)


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:18", driver="asyncpg") as postgres:
        url = postgres.get_connection_url()
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        config.set_main_option("sqlalchemy.url", url)
        command.upgrade(config, "head")
        yield url


@pytest.fixture(scope="session")
async def engine(database_url: str) -> AsyncIterator[AsyncEngine]:
    engine = create_engine(database_url)
    yield engine
    await engine.dispose()


# Only tests that use the database (through `client`) pay for PostgreSQL: the container starts
# once per run, on first use, and tables are emptied before each of those tests. Unit tests of
# the services don't touch it, so running them alone takes well under a second.
@pytest.fixture
async def clean_tables(engine: AsyncEngine) -> None:
    async with engine.begin() as connection:
        await connection.execute(text("TRUNCATE conversations, exchanges RESTART IDENTITY"))


@pytest.fixture
def fake_llm() -> FakeLLMService:
    return FakeLLMService()


@pytest.fixture
def registry(fake_llm: FakeLLMService) -> LLMRegistry:
    """Claude is configured (backed by the fake); Gemini is listed but has no key."""
    return LLMRegistry(
        {"claude": fake_llm},
        {"claude": ["claude-test", "claude-other"], "gemini": ["gemini-test"]},
        default_provider="claude",
    )


@pytest.fixture
async def client(
    database_url: str, registry: LLMRegistry, clean_tables: None
) -> AsyncIterator[AsyncClient]:
    app = create_app(Settings(database_url=database_url))
    app.dependency_overrides[get_llm_registry] = lambda: registry
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http_client,
    ):
        yield http_client
