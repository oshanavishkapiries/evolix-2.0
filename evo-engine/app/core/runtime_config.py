"""Settings an admin may change while the engine runs (stored in SQLite, applied onto `settings` in place)."""
import re
from dataclasses import dataclass
from typing import Any, Optional

from app.core.config import settings


@dataclass(frozen=True)
class Spec:
    key: str
    label: str
    description: str
    kind: str  # "int" | "float" | "choice" | "text"
    min: float
    max: float
    live: bool = True
    choices: tuple = ()  # for "choice": (value, label) pairs


# Every order the providers can be tried in. The keys name the providers in app.api.routes.
EXTRACTOR_ORDERS = (
    ("cinesrc,ythd", "CineSrc first, then YtHD"),
    ("ythd,cinesrc", "YtHD first, then CineSrc"),
)

SPECS = [
    Spec("MAX_CONCURRENT_EXTRACTIONS", "Parallel extractions", "Headless-browser extractions running at once.", "int", 1, 8),
    Spec("MAX_CONCURRENT_DOWNLOADS", "Parallel CDN caches", "Downloads/uploads to the CDN running at once.", "int", 1, 8),
    Spec("MAX_QUEUED_TASKS", "Queue limit", "Jobs waiting for extraction beyond this are refused with 503.", "int", 1, 5000),
    Spec("MIN_FREE_DISK_GB", "Minimum free disk (GB)", "CDN caching is skipped below this much free disk.", "float", 0, 10000),
    Spec("BROWSER_POOL_SIZE", "Browser pool size", "Long-lived headless browsers shared by extractions. 0 = launch a fresh browser each time.", "int", 0, 8),
    Spec("BROWSER_MAX_USES", "Browser max uses", "A pooled browser is replaced after this many extractions.", "int", 1, 1000),
    Spec("BROWSER_RECYCLE_RSS_MB", "Browser memory limit (MB)", "A pooled browser using more memory than this is replaced. 0 = no limit.", "int", 0, 16000),
    Spec("BLOCK_ASSETS", "Block images, fonts and trackers", "1 = provider pages skip images, fonts, media and ad/tracker hosts during extraction.", "int", 0, 1),
    Spec("EXTRACTION_REUSE_TTL_S", "Reuse extraction for (s)", "Stream URLs from an extraction are reused for other qualities of the same title for this long. 0 = off.", "int", 0, 3600),
    Spec("PROVIDER_FAIL_THRESHOLD", "Provider failures before cool-down", "Consecutive failures within the window that put a provider on cool-down. 0 = never skip providers.", "int", 0, 50),
    Spec("PROVIDER_FAIL_WINDOW_S", "Provider failure window (s)", "Failures older than this no longer count towards a cool-down.", "int", 10, 86400),
    Spec("PROVIDER_COOLDOWN_S", "Provider cool-down (s)", "How long a failing provider is skipped before one trial request.", "int", 10, 86400),
    Spec("PROVIDER_MISS_THRESHOLD", "\"Not found\" answers before cool-down", "A provider that says \"title not found\" this many times in a row, without finding any title in between, is treated as broken. 0 = never.", "int", 0, 500),
    Spec("EXTRACTOR_ORDER", "Provider order", "Which stream provider is tried first. The other one is the fallback when it fails or is cooling down.", "choice", 0, 0, choices=EXTRACTOR_ORDERS),
    Spec("YTHD_DECRYPTOR_CACHE", "Cache YtHD decryptor", "1 = keep the decryptor script on disk by version instead of downloading it every attempt.", "int", 0, 1),
    Spec("TRANSLATE_MODEL", "Translation model", "OpenRouter model that translates subtitles to Sinhala (e.g. google/gemini-3.1-flash-lite). Takes effect on the next job.", "text", 0, 0),
    Spec("TRANSLATE_DAILY_BUDGET_USD", "Daily translation budget (USD)", "0 = unlimited. Spend is always ledgered.", "float", 0, 100000),
]
BY_KEY = {s.key: s for s in SPECS}
DEFAULTS = {s.key: getattr(settings, s.key) for s in SPECS}


# OpenRouter model ids look like "vendor/name" with optional ":variant" (":free", ":nitro").
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:~-]*$")


def coerce(key: str, value: Any):
    spec = BY_KEY.get(key)
    if spec is None:
        raise ValueError(f"Unknown setting {key}")
    if spec.kind == "text":
        text = value.strip() if isinstance(value, str) else ""
        if len(text) > 120 or not MODEL_ID.match(text):
            raise ValueError(f"{key} must be an OpenRouter model id such as vendor/model-name")
        return text
    if spec.kind == "choice":
        if value not in [c[0] for c in spec.choices]:
            raise ValueError(f"{key} must be one of: " + ", ".join(c[0] for c in spec.choices))
        return value
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
            "choices": [{"value": v, "label": l} for v, l in s.choices],
            "value": getattr(settings, s.key), "default": DEFAULTS[s.key], "overridden": s.key in overrides,
        }
        for s in SPECS
    ]
