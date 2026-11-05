"""Keep the complete environment reference aligned with engine/admin settings."""
import re
import unittest
from pathlib import Path
from dotenv import dotenv_values
from app.core.config import Settings
from app.core.runtime_config import BY_KEY

EXAMPLE = Path(__file__).resolve().parent.parent / ".env.example"
# Read by compose.yaml rather than the Python settings model.
COMPOSE_KEYS = {"EVO_BIND_ADDRESS", "EVO_PORT"}

class EnvSync(unittest.TestCase):
    def test_example_covers_all_settings_without_unknown_keys(self):
        documented = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", EXAMPLE.read_text(), re.M))
        self.assertEqual(documented, set(Settings.model_fields) | COMPOSE_KEYS)
        self.assertTrue(set(BY_KEY) <= documented)

    def test_example_defaults_match_engine_defaults(self):
        values = dotenv_values(EXAMPLE)
        example = Settings(_env_file=EXAMPLE, **{
            k: v for k, v in values.items() if k in Settings.model_fields
        })
        for key, field in Settings.model_fields.items():
            if key in values:
                with self.subTest(key=key):
                    self.assertEqual(getattr(example, key), field.default)

if __name__ == "__main__":
    unittest.main()
