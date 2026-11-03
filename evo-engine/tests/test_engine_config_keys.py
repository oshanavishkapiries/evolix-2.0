import unittest
from tests.generate_engine_config_keys import FIXTURE, rendered


class EngineConfigKeysTest(unittest.TestCase):
    def test_fixture_is_current(self):
        self.assertEqual(FIXTURE.read_text(), rendered(), "Run tests/generate_engine_config_keys.py")
