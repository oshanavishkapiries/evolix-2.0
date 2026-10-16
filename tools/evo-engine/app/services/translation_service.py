import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

import requests

from app.core.config import settings
from app.interfaces.repository import ITaskRepository

logger = logging.getLogger("evo.translate")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MAX_LINE_CHARS = 46


class TranslationError(Exception):
    pass


class BudgetExceeded(TranslationError):
    pass


@dataclass
class Cue:
    id: int
    timing: str
    text: str


@dataclass
class TranslationResult:
    vtt: str
    cues: int = 0
    translated: int = 0
    kept_english: int = 0
    dropped_ads: int = 0
    cost_usd: float = 0.0
    tokens: int = 0
    seconds: float = 0.0
    warnings: List[str] = field(default_factory=list)


# Subtitle-site advertising that sneaks into the first/last cue; never worth translating or showing.
_AD = re.compile(
    r"opensubtitles|osdb\.|advertise your|contact www|subtitles? (?:by|downloaded|from)|sync(?:ed)? (?:and|&) corrected"
    r"|support us and become|watch online movies|download(?:ed)? from|(?:https?://|www\.)\S+|\b[a-z0-9-]+\.(?:com|org|net|link|to|io|cc)\b/?\S*",
    re.I,
)


def is_ad(text: str) -> bool:
    return bool(_AD.search(text))


def parse_vtt(vtt: str) -> List[Cue]:
    cues: List[Cue] = []
    for block in re.split(r"\n\s*\n", vtt.replace("\r\n", "\n").strip()):
        lines = block.split("\n")
        # A cue is "[id]\n<timing> --> <timing>\ntext..." (the id line is optional in WebVTT).
        t = next((i for i, l in enumerate(lines[:2]) if "-->" in l), None)
        if t is None or t + 1 >= len(lines):
            continue
        cues.append(Cue(id=len(cues) + 1, timing=lines[t].strip(), text="\n".join(lines[t + 1 :]).strip()))
    return cues


def wrap_lines(text: str, limit: int = MAX_LINE_CHARS) -> str:
    """At most two lines; a long single line is split at the space nearest its middle."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if len(lines) == 1 and len(lines[0]) > limit and " " in lines[0]:
        line = lines[0]
        mid = len(line) // 2
        cut = min((m.start() for m in re.finditer(" ", line)), key=lambda i: abs(i - mid))
        lines = [line[:cut].strip(), line[cut:].strip()]
    return "\n".join(lines)


BREAK = "⏎"
_LINE = re.compile(r"^\s*\[(\d+)\]\s*(.+?)\s*$")


def encode_cues(cues: List[Cue]) -> str:
    return "\n".join(f"[{c.id}] {c.text.replace(chr(10), f' {BREAK} ')}" for c in cues)


def decode_cues(content: str, wanted: set) -> Dict[int, str]:
    """Parses `[id] text` lines; tolerant of fences, blank lines and chatter around them."""
    out: Dict[int, str] = {}
    for line in content.replace("\r", "").split("\n"):
        m = _LINE.match(line)
        if not m:
            continue
        cid = int(m.group(1))
        text = re.sub(r"\s*" + BREAK + r"\s*", "\n", m.group(2)).strip()
        if cid in wanted and text:
            out[cid] = text
    return out


def restore_tags(source: str, translated: str) -> str:
    """Models sometimes drop the italic wrapper that marks off-screen speech; put it back."""
    if source.startswith("<i>") and source.endswith("</i>") and "<i>" not in translated:
        return f"<i>{translated}</i>"
    return translated


def build_vtt(cues: List[Cue], texts: Dict[int, str]) -> str:
    out = ["WEBVTT", ""]
    for n, c in enumerate(cues, 1):
        text = restore_tags(c.text, texts[c.id]) if c.id in texts else c.text
        out += [str(n), c.timing, wrap_lines(text), ""]
    return "\n".join(out)


SYSTEM_PROMPT = """You are a professional subtitle translator. Translate English movie/TV subtitles into CASUAL, SPOKEN Sinhala (කතා කරන සිංහල), the way people actually talk, not formal written/literary Sinhala.

Rules:
- Natural spoken register that fits each character and mood; jokes and sarcasm must still read as jokes.
- Work out who is speaking and who is addressed (gender, age, relationship) from the context and get gendered words right (e.g. a female "Sleeping Beauty" is නිදි කුමාරිය).
- Use the exact Sinhala spellings given for names. Other names: Sinhala script, spelled the same way every time.
- English loanwords people really say in Sinhala (OK, sorry, phone) may stay natural. Do not invent awkward Sinhala coinages; if a line is an idiom, translate the meaning, not the words.
- Commands to a person use a polite-casual imperative (…න්න / …පන්), not a bare stem.
- Keep it short: readable in 2-4 seconds, at most 2 lines per cue (use \\n for the break).
- Keep <i></i> tags and speaker dashes (- ) where the source has them. Translate sound effects in [brackets]; keep music symbols untouched.
- Never merge, split, drop or reorder cues. No notes or explanations.

Style examples (English -> Sinhala):
"Not now, Garfield." -> "දැන් නම් බෑ, ගාෆීල්ඩ්."
"Cut the sweet stuff." -> "ඔය ආදරේ පෙන්නන එක නවත්තන්න."
"Well, that just ain't gonna fly!" -> "ඒක නම් වෙන්නෙම නෑ!"
"Okay! I think you're clean enough now." -> "හරි! දැන් ඔයා හොඳටම පිරිසිදුයි."

Input and output are plain text, one cue per line, in the form `[id] text`. A line break inside a cue is written as ⏎ (keep it as ⏎ in your output).
Output exactly one `[id] translation` line per input cue, same ids, nothing else: no JSON, no code fences, no comments."""


class SinhalaTranslator:
    """English WebVTT -> casual Sinhala WebVTT through OpenRouter.

    Timestamps never reach the model: it sees cue ids and text only, and the output is rebuilt around the
    original timing, so synchronisation cannot drift. Failed or blocked cues fall back to the English line.
    """

    def __init__(self, repository: Optional[ITaskRepository] = None, api_key: Optional[str] = None, model: Optional[str] = None):
        self.repository = repository
        self.api_key = api_key if api_key is not None else settings.OPENROUTER_API_KEY
        self.model = model or settings.TRANSLATE_MODEL
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    # ---- OpenRouter

    def _check_budget(self) -> None:
        if self.repository and self.repository.usage_today() >= settings.TRANSLATE_DAILY_BUDGET_USD:
            raise BudgetExceeded(f"Daily translation budget (${settings.TRANSLATE_DAILY_BUDGET_USD:.2f}) reached")

    def _chat(self, messages: list, task_id: Optional[str], temperature: float = 0.3, as_json: bool = False) -> str:
        self._check_budget()
        last: Optional[Exception] = None
        for attempt in range(3):
            try:
                r = requests.post(
                    OPENROUTER_URL,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self.model,
                        "temperature": temperature,
                        "usage": {"include": True},
                        **({"response_format": {"type": "json_object"}} if as_json else {}),
                        "messages": messages,
                    },
                    timeout=180,
                )
                if r.status_code in (429, 500, 502, 503, 504):
                    raise TranslationError(f"OpenRouter HTTP {r.status_code}")
                body = r.json()
                if r.status_code != 200:
                    raise TranslationError(f"OpenRouter HTTP {r.status_code}: {str(body)[:200]}")
                usage = body.get("usage") or {}
                if self.repository:
                    self.repository.add_usage(task_id, self.model, float(usage.get("cost") or 0), int(usage.get("total_tokens") or 0))
                choice = (body.get("choices") or [{}])[0]
                content = (choice.get("message") or {}).get("content")
                if not content:
                    raise TranslationError(f"Empty response (finish_reason={choice.get('finish_reason')})")
                return content
            except BudgetExceeded:
                raise
            except Exception as e:  # network errors, bad JSON bodies, 5xx
                last = e
                time.sleep(2 * (attempt + 1))
        raise TranslationError(str(last))

    @staticmethod
    def _json(content: str) -> dict:
        text = re.sub(r"^```(?:json)?|```$", "", content.strip()).strip()
        return json.loads(text)

    # ---- steps

    def build_glossary(self, title: str, synopsis: str, characters: List[str], task_id: Optional[str]) -> Dict[str, str]:
        """One tiny call that fixes the Sinhala spelling of names, so parallel chunks stay consistent."""
        names = [title] + [c for c in characters if c]
        if not names:
            return {}
        prompt = (
            f"Title: {title}\nSynopsis: {synopsis[:500]}\n"
            "Give the natural Sinhala-script spelling of each of these names/titles (as a Sinhala speaker would write them). "
            'Return ONLY JSON: {"names":{"<English>":"<Sinhala>"}}\nNames: ' + json.dumps(names[:20], ensure_ascii=False)
        )
        try:
            data = self._json(self._chat([{"role": "user", "content": prompt}], task_id, temperature=0.1, as_json=True))
            return {k: v for k, v in (data.get("names") or {}).items() if isinstance(k, str) and isinstance(v, str) and v.strip()}
        except BudgetExceeded:
            raise
        except Exception as e:
            logger.warning(f"glossary failed: {e}")
            return {}

    def _translate_chunk(self, chunk: List[Cue], before: List[Cue], context: str, task_id: Optional[str], depth: int = 0) -> Dict[int, str]:
        wanted = {c.id for c in chunk}
        got: Dict[int, str] = {}
        for attempt in range(2):
            todo = [c for c in chunk if c.id not in got]
            if not todo:
                return got
            user = (
                context
                + ("Previous lines for context only (English, do not translate):\n" + "\n".join(c.text.replace("\n", " ") for c in before) + "\n\n" if before else "")
                + "Cues to translate:\n"
                + encode_cues(todo)
            )
            try:
                content = self._chat([{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}], task_id, 0.3 if attempt == 0 else 0.1)
                got.update(decode_cues(content, wanted))
            except BudgetExceeded:
                raise
            except Exception as e:
                logger.warning(f"chunk attempt {attempt + 1} failed: {e}")
        # Still missing: a smaller request is likelier to come back whole (long outputs are what get cut off).
        rest = [c for c in chunk if c.id not in got]
        if rest and depth < 2 and len(rest) > 1:
            mid = len(rest) // 2
            for part in (rest[:mid], rest[mid:]):
                got.update(self._translate_chunk(part, before, context, task_id, depth + 1))
        return got

    def translate_vtt(self, vtt: str, title: str, synopsis: str = "", characters: Optional[List[str]] = None, task_id: Optional[str] = None, progress: Optional[Callable[[int, int], None]] = None) -> TranslationResult:
        started = time.time()
        cost0 = self.repository.usage_today() if self.repository else 0.0
        all_cues = parse_vtt(vtt)
        cues = [c for c in all_cues if c.text and not is_ad(c.text)]
        if not cues:
            raise TranslationError("No translatable cues")
        result = TranslationResult(vtt="", cues=len(cues), dropped_ads=len(all_cues) - len(cues))

        glossary = self.build_glossary(title, synopsis, characters or [], task_id)
        context = f"Title: {title}\nSynopsis: {synopsis[:600]}\n"
        if glossary:
            context += "Name spellings (use exactly): " + json.dumps(glossary, ensure_ascii=False) + "\n"
        context += "\n"

        size, ctx_n = settings.TRANSLATE_CHUNK_CUES, settings.TRANSLATE_CONTEXT_CUES
        chunks = [(cues[i : i + size], cues[max(0, i - ctx_n) : i]) for i in range(0, len(cues), size)]
        done = 0
        texts: Dict[int, str] = {}

        def work(item):
            chunk, before = item
            return self._translate_chunk(chunk, before, context, task_id)

        errors: List[str] = []
        with ThreadPoolExecutor(max_workers=settings.TRANSLATE_CONCURRENCY) as pool:
            futures = [pool.submit(work, c) for c in chunks]
            for f in futures:
                try:
                    texts.update(f.result())
                except BudgetExceeded:
                    for g in futures:
                        g.cancel()
                    raise
                except Exception as e:
                    errors.append(str(e))
                done += 1
                if progress:
                    progress(done, len(chunks))

        result.translated = sum(1 for c in cues if c.id in texts)
        result.kept_english = len(cues) - result.translated
        if result.translated == 0:
            raise TranslationError(errors[0] if errors else "The model returned no usable translations")
        if result.kept_english:
            result.warnings.append(f"{result.kept_english} cue(s) kept in English")
        result.vtt = build_vtt(cues, texts)
        result.cost_usd = (self.repository.usage_today() - cost0) if self.repository else 0.0
        result.seconds = time.time() - started
        return result
