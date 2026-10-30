"""Print the OpenAPI schema; the frontend API client is generated from it."""

import json

from app.config import Settings
from app.main import create_app


def main() -> None:
    schema = create_app(Settings()).openapi()
    print(json.dumps(schema, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
