"""Stealth layer for Evo Engine.

Everything anti-bot related lives here: stealth patches, header/UA rotation
and human-like behavior. Proxy support is intentionally not included yet.
"""

import random
import time

from playwright.sync_api import sync_playwright
from playwright_stealth import Stealth
from fingerprint_profiles import get_random_profile, generate_fingerprint_injection_script

ACCEPT_LANGUAGES = ["en-US,en;q=0.9", "en-GB,en;q=0.8", "en-US,en;q=0.8"]


class StealthBrowser:
    def __init__(self, headless=True, timeout=60000, request_filter=None, profile=None, locale="en-US", timezone="America/New_York"):
        self.headless = headless
        self.timeout = timeout
        self.request_filter = request_filter
        self.profile = profile or get_random_profile()
        self.locale = locale
        self.timezone = timezone
        self._pw = None
        self.browser = None
        self.context = None
        self.page = None

    def start(self):
        self._pw = sync_playwright().start()
        chrome_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-infobars",
            "--disable-features=IsolateOrigins,site-per-process",
            f"--window-size={self.profile['viewport']['width']},{self.profile['viewport']['height']}",
        ]
        self.browser = self._pw.chromium.launch(
            headless=self.headless,
            args=chrome_args,
        )

        headers = {
            "Accept-Language": random.choice(ACCEPT_LANGUAGES),
            "Sec-Ch-Ua": self.profile.get("sec_ch_ua", ""),
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": self.profile.get("sec_ch_ua_platform", '"Windows"'),
        }

        self.context = self.browser.new_context(
            user_agent=self.profile["user_agent"],
            viewport=self.profile["viewport"],
            locale=self.locale,
            timezone_id=self.timezone,
            extra_http_headers=headers,
        )
        self.context.set_default_timeout(self.timeout)

        # 1. Standard stealth patches
        Stealth().apply_stealth_sync(self.context)

        # 2. Advanced fingerprint spoofing (WebGL, Canvas, Audio, Client Hints, Hardware)
        injection_js = generate_fingerprint_injection_script(self.profile)
        self.context.add_init_script(injection_js)

        # 3. Optional request blocker/stub filter
        if self.request_filter:
            self.request_filter.apply(self.context)

        self.page = self.context.new_page()
        return self

    def goto(self, url, wait_for_challenge=True):
        self.page.goto(url, wait_until="domcontentloaded")
        if wait_for_challenge:
            self.wait_for_challenge()
        self.human_behavior()
        return self.page

    def wait_for_challenge(self, max_wait=30):
        """Wait while a Cloudflare 'Just a moment...' check is showing."""
        end = time.time() + max_wait
        while time.time() < end:
            if "just a moment" not in self.page.title().lower():
                return True
            self.pause(1, 2)
        return False

    def human_behavior(self):
        for _ in range(random.randint(3, 5)):
            self.page.mouse.move(
                random.randint(100, 800),
                random.randint(100, 600),
                steps=random.randint(5, 25),
            )
            self.pause(0.2, 0.6)
        for _ in range(2):
            self.page.mouse.wheel(0, random.randint(200, 500))
            self.pause(0.5, 1.2)
        self.page.mouse.wheel(0, -random.randint(100, 300))
        self.pause(0.3, 0.8)

    @staticmethod
    def pause(low, high):
        time.sleep(random.uniform(low, high))

    def screenshot(self, path):
        self.page.screenshot(path=str(path))

    def close(self):
        if self.browser:
            self.browser.close()
        if self._pw:
            self._pw.stop()

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.close()
