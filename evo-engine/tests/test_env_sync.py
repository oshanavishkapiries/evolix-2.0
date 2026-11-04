"""`.env.example` lists only bootstrap variables, and each must be a real engine setting."""
import re
import unittest
from pathlib import Path

from app.core.config import Settings

EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"
# Everything else is pushed from the app's admin configuration.
BOOTSTRAP = {"EVO_SECRET_TOKEN", "EVO_WEBHOOK_URL"}


def example_keys() -> set[str]:
    return set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", EXAMPLE.read_text(), re.M))


class EnvSync(unittest.TestCase):
    def test_example_is_exactly_the_bootstrap_set(self):
        self.assertEqual(example_keys(), BOOTSTRAP)

    def test_bootstrap_variables_are_engine_settings(self):
        stale = BOOTSTRAP - set(Settings.model_fields)
        self.assertFalse(stale, f"not read by the engine: {sorted(stale)}")


if __name__ == "__main__":
    unittest.main()
