"""Strips annotations from subtitle text before it is sent to the translation model.

Sound effects, speaker notes and lyrics markers carry no dialogue, and models translate them badly (or invent more of
them). Pure text in, text out: no I/O, no settings. Cues are handled one at a time; a span that opens in one cue and
closes in the next is left alone.
"""

import re
from dataclasses import dataclass
from typing import Callable, Optional, Tuple


@dataclass(frozen=True)
class Rule:
    name: str
    open: str
    close: str
    # Symmetric rules (same open and close character) only: which characters may open or close a span.
    opens: Optional[Callable[[str, int], bool]] = None
    closes: Optional[Callable[[str, int], bool]] = None


# Everything between the pair is removed, nesting included: `[a (b) c]` goes whole.
PAIRED: Tuple[Rule, ...] = (
    Rule("braces", "{", "}"),
    Rule("parentheses", "(", ")"),
    Rule("square brackets", "[", "]"),
)

# The same character opens and closes. The guards keep ordinary text safe: `5 * 3 * 2` and `I'm #1, you're #2` stay.
SYMMETRIC: Tuple[Rule, ...] = (
    Rule("asterisks", "*", "*", opens=lambda t, i: t[i + 1 : i + 2].strip() != "", closes=lambda t, i: i > 0 and not t[i - 1].isspace()),
    Rule("hashtags", "#", "#", opens=lambda t, i: not t[i + 1 : i + 2].isdigit()),
)

_EMPTY_TAGS = re.compile(r"<(i|b|u)>\s*</\1>", re.I)
_SPACE = re.compile(r"[ \t]+")
_BEFORE_PUNCT = re.compile(r"\s+([,.!?;:])")
_NO_TEXT = re.compile(r"^[\s\-–—.,;:!?]*$")


def _remove_paired(text: str, rule: Rule) -> str:
    out, i = [], 0
    while i < len(text):
        if text[i] != rule.open:
            out.append(text[i])
            i += 1
            continue
        depth, j = 0, i
        while j < len(text):
            if text[j] == rule.open:
                depth += 1
            elif text[j] == rule.close:
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth == 0 and j < len(text):
            i = j + 1  # the whole span, brackets included
        else:
            out.append(text[i])  # an opener that never closes is plain text
            i += 1
    return "".join(out)


def _remove_symmetric(text: str, rule: Rule) -> str:
    out, i, ch = [], 0, rule.open
    while i < len(text):
        if text[i] != ch or (rule.opens and not rule.opens(text, i)):
            out.append(text[i])
            i += 1
            continue
        j = next((k for k in range(i + 1, len(text)) if text[k] == ch and (not rule.closes or rule.closes(text, k))), None)
        if j is None:
            out.append(text[i])
            i += 1
        else:
            i = j + 1
    return "".join(out)


def _tidy(text: str) -> str:
    """Closes the gaps removal leaves: empty tags, double spaces, a speaker dash with nothing after it."""
    while True:
        shorter = _EMPTY_TAGS.sub("", text)
        if shorter == text:
            break
        text = shorter
    lines = []
    for line in text.split("\n"):
        line = _BEFORE_PUNCT.sub(r"\1", _SPACE.sub(" ", line)).strip()
        if line and not _NO_TEXT.match(re.sub(r"</?[a-z][^>]*>", "", line, flags=re.I)):
            lines.append(line)
    return "\n".join(lines)


def clean_text(text: str) -> str:
    """The cue text without its annotations. Text that has none comes back untouched (not even re-spaced).

    A cue that cleaning leaves with no words at all comes back as "".
    """
    cleaned = text
    for rule in PAIRED:
        cleaned = _remove_paired(cleaned, rule)
    for rule in SYMMETRIC:
        cleaned = _remove_symmetric(cleaned, rule)
    if cleaned == text:
        return text
    cleaned = _tidy(cleaned)
    return cleaned if re.search(r"\w", cleaned) else ""
