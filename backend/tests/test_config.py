import pytest

from app.config import Settings


def test_empty_variables_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in [
        "DATABASE_URL",
        "LLM_PROVIDER",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_EFFORT",
        "GEMINI_API_KEY",
        "GEMINI_MODEL",
    ]:
        monkeypatch.setenv(name, "")

    settings = Settings(_env_file=None)

    assert settings.database_url == Settings.model_fields["database_url"].default
    assert settings.llm_provider == "claude"
    assert settings.anthropic_api_key is None
    assert settings.gemini_api_key is None
    assert settings.gemini_model == "gemini-flash-lite-latest"
    assert settings.anthropic_model == "claude-opus-5-5"
    assert settings.anthropic_effort == "low"
