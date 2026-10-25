"""Settings an admin may change while the engine runs (stored in SQLite, applied onto `settings` in place)."""
from dataclasses import dataclass
from typing import Any, Optional

from app.core.config import settings


@dataclass(frozen=True)
class Spec:
    key: str
    label: str
    description: str
    kind: str  # "int" | "float"
    min: float
    max: float
    live: bool = True


SPECS = [
    Spec("MAX_CONCURRENT_EXTRACTIONS", "Parallel extractions", "Headless-browser extractions running at once.", "int", 1, 8),
    Spec("MAX_CONCURRENT_DOWNLOADS", "Parallel CDN caches", "Downloads/uploads to the CDN running at once.", "int", 1, 8),
    Spec("MAX_QUEUED_TASKS", "Queue limit", "Jobs waiting for extraction beyond this are refused with 503.", "int", 1, 5000),
    Spec("MIN_FREE_DISK_GB", "Minimum free disk (GB)", "CDN caching is skipped below this much free disk.", "float", 0, 10000),
    Spec("TRANSLATE_DAILY_BUDGET_USD", "Daily translation budget (USD)", "0 = unlimited. Spend is always ledgered.", "float", 0, 100000),
]
BY_KEY = {s.key: s for s in SPECS}
DEFAULTS = {s.key: getattr(settings, s.key) for s in SPECS}


def coerce(key: str, value: Any):
    spec = BY_KEY.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting {key}")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{key} must be a number")
    v = int(value) if spec.kind == "int" else float(value)
    if spec.kind == "int" and v != value:
        raise ValueError(f"{key} must be a whole number")
    if not spec.min <= v <= spec.max:
        raise ValueError(f"{key} must be between {spec.min:g} and {spec.max:g}")
    return v


def apply(key: str, value: Optional[Any]) -> None:
    """Sets (or, with None, restores the .env default of) one setting on the live `settings` object."""
    setattr(settings, key, DEFAULTS[key] if value is None else value)


def snapshot(overrides: dict) -> list[dict]:
    return [
        {
            "key": s.key, "label": s.label, "description": s.description, "kind": s.kind, "min": s.min, "max": s.max,
            "value": getattr(settings, s.key), "default": DEFAULTS[s.key], "overridden": s.key in overrides,
        }
        for s in SPECS
    ]
