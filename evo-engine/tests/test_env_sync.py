"""`.env.example` and `Settings` must list the same variables."""
import re
import unittest
from pathlib import Path

from app.core.config import Settings

EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"
# Read by docker compose, not by the engine.
COMPOSE_ONLY = {"EVO_BIND_ADDRESS", "EVO_PORT"}


def example_keys() -> set[str]:
    return set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", EXAMPLE.read_text(), re.M))


class EnvSync(unittest.TestCase):
    def test_every_setting_is_documented(self):
        missing = set(Settings.model_fields) - example_keys()
        self.assertFalse(missing, f"add to evo-engine/.env.example: {sorted(missing)}")

    def test_example_has_no_unused_variable(self):
        stale = example_keys() - set(Settings.model_fields) - COMPOSE_ONLY
        self.assertFalse(stale, f"not read by the engine, remove from evo-engine/.env.example: {sorted(stale)}")


if __name__ == "__main__":
    unittest.main()
