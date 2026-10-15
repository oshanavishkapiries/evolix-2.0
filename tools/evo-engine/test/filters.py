"""
Request filter layer for Evo Engine.

All blocking/mocking of unwanted requests (anti-debug scripts, trackers,
heavy resources) lives here. Create a `RequestFilter` object, optionally
configure it, and pass it to `StealthBrowser`.
"""

import re
from collections import deque
from functools import lru_cache
from datetime import datetime

# ---------------------------------------------------------------
# Default block list: anti-debug + common trackers
# ---------------------------------------------------------------
DEFAULT_BLOCKED = [
    # --- anti-debugging / devtools detection ---
    "**/*disable-devtool*",
    "**/*devtool-detect*",
    "**/*debug-guard*",
    "**/*anti-debug*",
    "**/*console-ban*",
    "**/*devtools-detector*",

    # --- analytics / trackers ---
    "**/*google-analytics.com/**",
    "**/*googletagmanager.com/**",
    "**/analytics.js",
    "**/gtag/js",
    "**/*facebook.net/**",
    "**/*hotjar.com/**",
    "**/*clarity.ms/**",
    "**/*segment.com/**",
    "**/*sentry.io/**",
]

# Smart stubs: fake bodies for scripts whose globals the page
# expects — prevents ReferenceError after blocking.
SMART_STUBS = {
    "googletagmanager": (
        "window.dataLayer = window.dataLayer || [];\n"
        "function gtag(){dataLayer.push(arguments);}\n"
    ),
    "google-analytics": (
        "window.dataLayer = window.dataLayer || [];\n"
        "function gtag(){dataLayer.push(arguments);}\n"
    ),
    "sentry": (
        "window.Sentry = { init(){}, captureException(){}, "
        "captureMessage(){}, setUser(){} };"
    ),
    "disable-devtool": "/* blocked */",
}

MAX_LOG = 5000

# Presets
PRESETS = {
    "default":    list(DEFAULT_BLOCKED),          # the full DEFAULT_BLOCKED list
    "anti-debug": ["**/*disable-devtool*", "**/*devtool-detect*",
                    "**/*debug-guard*", "**/*anti-debug*"],
    "none":       [],                              # empty — add your own
}


class RequestFilter:
    """
    Central request-blocking engine.

    Usage:
        rf = RequestFilter(verbose=True)
        rf.block("**/unwanted.js")
        rf.apply(context)          # or pass to StealthBrowser(request_filter=rf)
    """

    def __init__(self, preset="default", extra_blocked=None,
                 whitelist=None, block_resources=None, verbose=False):
        """
        preset        : "default" | "anti-debug" | "none"
        extra_blocked : list of glob patterns to also block
        whitelist     : glob patterns that ALWAYS pass (win over blocking)
        block_resources: resource types to kill ("image", "font", "media", "stylesheet")
        verbose       : print every blocked request to console
        """
        self.verbose = verbose
        if preset not in PRESETS:
            raise ValueError(f"unknown preset {preset!r}, use one of {list(PRESETS)}")
        self._patterns = list(PRESETS[preset])
        self._whitelist = list(whitelist or [])
        self._blocked_types = set(block_resources or [])
        self._log = deque(maxlen=MAX_LOG)    # (time, url, reason), newest kept
        self._blocked_count = 0
        self._context = None

        if extra_blocked:
            self._patterns.extend(extra_blocked)

        self._rx_rules = [self._compile(p) for p in self._patterns]
        self._rx_allow = [self._compile(p) for p in self._whitelist]

    # ---------------------------------------------------------
    # Configuration (works BEFORE and AFTER apply — live changes)
    # ---------------------------------------------------------
    def block(self, *patterns):
        """Add glob pattern(s) to the block list at runtime."""
        for p in patterns:
            if p not in self._patterns:
                self._patterns.append(p)
                self._rx_rules.append(self._compile(p))
        return self

    def unblock(self, *patterns):
        """Remove pattern(s) from the block list."""
        for p in patterns:
            if p in self._patterns:
                i = self._patterns.index(p)
                self._patterns.pop(i)
                self._rx_rules.pop(i)
        return self

    def allow(self, *patterns):
        """Whitelist pattern(s) — they pass even if a block rule matches."""
        for p in patterns:
            if p not in self._whitelist:
                self._whitelist.append(p)
                self._rx_allow.append(self._compile(p))
        return self

    def block_resource(self, *types):
        """Block entire resource types: image, font, media, stylesheet..."""
        self._blocked_types.update(types)
        return self

    def unblock_resource(self, *types):
        self._blocked_types.difference_update(types)
        return self

    # ---------------------------------------------------------
    # Playwright glue
    # ---------------------------------------------------------
    def apply(self, context):
        """Attach to a Playwright BrowserContext (all pages/popups covered)."""
        self._context = context
        context.route("**/*", self._handler)
        return self

    def detach(self):
        """Remove the interceptor."""
        if self._context:
            self._context.unroute("**/*", self._handler)
            self._context = None

    def _handler(self, route):
        request = route.request
        url = request.url
        rtype = request.resource_type

        # 1) whitelist wins over everything
        if any(rx.match(url) for rx in self._rx_allow):
            route.continue_()
            return

        # 2) blocked resource types (images, fonts...)
        if rtype in self._blocked_types:
            self._record(url, f"resource:{rtype}")
            route.abort()
            return

        # 3) blocked URL patterns
        for rx in self._rx_rules:
            if rx.match(url):
                self._record(url, "pattern")
                if rtype == "script":
                    # fulfill → page thinks it loaded, no JS errors
                    route.fulfill(
                        status=200,
                        content_type="application/javascript",
                        body=self._stub_for(url),
                    )
                else:
                    route.abort()
                return

        route.continue_()

    # ---------------------------------------------------------
    # Internals
    # ---------------------------------------------------------
    @staticmethod
    @lru_cache(maxsize=256)
    def _compile(pattern):
        """Convert Playwright-style glob to regex (**, *, ?)."""
        i, n, out = 0, len(pattern), []
        while i < n:
            c = pattern[i]
            if c == "*":
                if i + 1 < n and pattern[i + 1] == "*":
                    out.append(".*")
                    i += 2
                else:
                    out.append("[^/]*")
                    i += 1
            elif c == "?":
                out.append(".")
                i += 1
            else:
                out.append(re.escape(c))
                i += 1
        return re.compile("".join(out), re.IGNORECASE)

    @staticmethod
    def _stub_for(url):
        low = url.lower()
        for key, body in SMART_STUBS.items():
            if key in low:
                return body
        return "/* blocked */"

    def _record(self, url, reason):
        self._blocked_count += 1
        self._log.append((datetime.now().strftime("%H:%M:%S"), url, reason))
        if self.verbose:
            print(f"🚫 [{reason}] {url}")

    # ---------------------------------------------------------
    # Reporting
    # ---------------------------------------------------------
    @property
    def stats(self):
        return {"blocked": self._blocked_count,
                "rules": len(self._patterns),
                "whitelisted": len(self._whitelist)}

    def report(self):
        """Print everything that was blocked so far."""
        print(f"\n════ RequestFilter Report — {self._blocked_count} blocked ════")
        for t, url, reason in self._log:
            print(f"  [{t}] ({reason}) {url}")
        print("═" * 50)

    @property
    def blocked_urls(self):
        return [url for _, url, _ in self._log]
