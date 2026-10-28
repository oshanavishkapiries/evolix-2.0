"""Run engine subtitle tests with throwaway paths and credentials; never use engine .env services."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
import warnings

engine = Path(__file__).resolve().parents[2] / 'evo-engine'
with tempfile.TemporaryDirectory(prefix='evolix-subtitle-tests-') as folder:
    root = Path(folder)
    os.environ.update({
        'EVO_SECRET_TOKEN': 's3cret', 'EVO_WEBHOOK_URL': '', 'ERROR_REPORT_URL': '',
        'OPENROUTER_API_KEY': '', 'PIXELDRAIN_API_KEY': '',
        'SQLITE_DB_PATH': str(root / 'engine.sqlite3'),
        'TEMP_DIR': str(root / 'temp'), 'DOWNLOAD_DIR': str(root / 'downloads'),
    })
    sys.path.insert(0, str(engine))
    warnings.filterwarnings('ignore', category=DeprecationWarning)
    suite = unittest.defaultTestLoader.loadTestsFromNames([
        'tests.test_subtitle_fallback', 'tests.test_subtitle_library', 'tests.test_busy_refusal',
        'tests.test_sinhala_on_demand', 'tests.test_ingest_events', 'tests.test_ffmpeg_args',
    ])
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
