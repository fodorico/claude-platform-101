import pytest

from app.config import Settings


def test_empty_variables_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ["DATABASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_EFFORT"]:
        monkeypatch.setenv(name, "")

    settings = Settings(_env_file=None)

    assert settings.database_url == Settings.model_fields["database_url"].default
    assert settings.anthropic_api_key is None
    assert settings.anthropic_model == "claude-opus-5-5"
    assert settings.anthropic_effort == "low"
