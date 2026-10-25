"""Dual Subtitles and on-demand Sinhala subtitles (Playwright, mocked network).

Needs a running production server (`pnpm build && pnpm start`) and the engine venv's Python:

    BASE_URL=http://localhost:3000 tests/e2e/run.sh

Every /api/evo/* call and the CDN are mocked, so nothing is translated, uploaded or paid for. The watch page itself
is real (it creates a source-less catalog row for TMDB 680 the first time; run.sh removes it again).
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:3000")
TOKEN = os.environ["E2E_ACCESS_TOKEN"]
TMDB = 680
TID = "11111111-2222-3333-4444-555555555555"
VIDEO_URL = "https://pixeldrain.com/api/file/e2eVideo1"
SI_URL = "https://pixeldrain.com/api/file/e2eSinhala"

EN_VTT = "WEBVTT\n\n1\n00:00:00.500 --> 00:00:30.000\nEnglish line\n"
SI_VTT = "WEBVTT\n\n1\n00:00:00.500 --> 00:00:30.000\nSinhala line\n"

work = Path(tempfile.mkdtemp(prefix="e2e-sinhala-"))
MP4 = work / "clip.mp4"
subprocess.run(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=40:size=320x180:rate=15", "-f", "lavfi", "-i", "sine=duration=40",
     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-shortest", str(MP4)],
    check=True,
)

EN_TRACK = {"id": "sub_1_en_1", "label": "English", "language": "en", "format": "vtt", "url": "/api/v1/media/subtitles/sub_1_en_1.vtt"}
SI_TRACK = {"id": "sub_1_si_9", "label": "Sinhala (AI)", "language": "si", "format": "vtt", "url": "/api/v1/media/subtitles/sub_1_si_9.vtt"}


def json_body(route, body, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(body))


class Mocks:
    """Routes for one scenario; records every translate call."""

    def __init__(self, page, ingest_subs, translate_start, translate_poll=None):
        self.start_calls, self.poll_calls = [], 0
        self.start, self.poll = translate_start, translate_poll or []
        page.route("**/api/evo/ingest", lambda r: json_body(r, {"task_id": TID, "status": "COMPLETED", "result_url": VIDEO_URL, "subtitles": ingest_subs}))
        page.route("**/api/evo/subtitles/*", lambda r: r.fulfill(status=200, content_type="text/vtt", body=SI_VTT if "si_9" in r.request.url else EN_VTT))
        page.route("**/pixeldrain.com/api/file/e2eVideo1*", lambda r: r.fulfill(status=200, content_type="video/mp4", body=MP4.read_bytes()))
        page.route("**/pixeldrain.com/api/file/e2eVideo1/info", lambda r: json_body(r, {"name": "clip.mp4", "mime_type": "video/mp4", "size": MP4.stat().st_size}))
        page.route("**/pixeldrain.com/api/file/e2eSinhala*", lambda r: r.fulfill(status=200, content_type="text/vtt", body=SI_VTT, headers={"Access-Control-Allow-Origin": "*"}))
        page.route("**/api/evo/translate**", self.translate)

    def translate(self, route):
        req = route.request
        if req.method == "POST":
            self.start_calls.append(req.post_data_json)
            body = self.start.pop(0) if len(self.start) > 1 else self.start[0]
            return json_body(route, body)
        self.poll_calls += 1
        body = self.poll.pop(0) if len(self.poll) > 1 else self.poll[0]
        json_body(route, body)


def active_track(page):
    """Label of the first rendered track (the old track stays on during generation)."""
    track = page.locator('.v-dual-track[data-slot="0"]')
    return track.get_attribute("aria-label") if track.count() else None


def open_player(page):
    page.goto(f"{BASE}/watch/movie/tmdb-{TMDB}")
    page.locator("video").wait_for(timeout=60_000)
    page.wait_for_function("document.querySelector('video').currentTime > 0.5", timeout=30_000)


def open_subtitle_panel(page):
    page.get_by_role("button", name="Dual Subtitles settings").click()


def picker(page, which="First"):
    """The track picker button (a custom listbox, not a native <select>)."""
    return page.get_by_role("button", name=re.compile(f"^{which} subtitle"))


def open_list(page, which="First"):
    btn = picker(page, which)
    if btn.get_attribute("aria-expanded") != "true":
        btn.click()
    return page.get_by_role("listbox")


def chip(page, label, which="First"):
    return open_list(page, which).get_by_role("option", name=label)


def pick_track(page, label, which="First"):
    chip(page, label, which).click()


def run():
    results = []

    def check(ok, msg):
        results.append(ok)
        print("PASS" if ok else "FAIL", msg)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        ctx.add_cookies([{"name": "access_token", "value": TOKEN, "url": BASE}])

        # 1. No Sinhala track yet: the option is listed; picking it starts the job, playback is not blocked.
        page = ctx.new_page()
        m = Mocks(
            page, [EN_TRACK],
            translate_start=[{"state": "running", "progress": None}],
            translate_poll=[{"state": "running", "progress": {"done": 2, "total": 8}}, {"state": "running", "progress": {"done": 2, "total": 8}}, {"state": "done", "subtitle": {"id": "si-row", "label": "Sinhala (AI)", "language": "si", "format": "vtt", "url": SI_URL}}],
        )
        open_player(page)
        open_subtitle_panel(page)
        check(chip(page, "Sinhala (AI)").count() == 1, "no track yet: 'Sinhala (AI)' is offered next to English")
        check(active_track(page) == "English", "English is the active subtitle before the pick")
        check(len(m.start_calls) == 0, "nothing is requested until the viewer picks Sinhala")
        before = page.evaluate("document.querySelector('video').currentTime")
        pick_track(page, "Sinhala (AI)")
        expect(page.get_by_text("Preparing Sinhala subtitles")).to_be_visible(timeout=5000)
        check(len(m.start_calls) == 1 and m.start_calls[0] == {"tmdbId": TMDB, "mediaType": "movie"}, f"picking Sinhala starts exactly one job: {m.start_calls}")
        check(active_track(page) == "English", "English stays on while the translation runs")
        page.wait_for_timeout(1500)
        check(page.evaluate("document.querySelector('video').currentTime") > before and not page.evaluate("document.querySelector('video').paused"), "video keeps playing while the banner is up")
        expect(page.get_by_text("Part 2 of 8")).to_be_visible(timeout=10_000)
        check(True, "banner shows chunk progress from the engine")
        expect(page.get_by_text("Sinhala subtitles are ready")).to_be_visible(timeout=20_000)
        expect(picker(page)).to_contain_text("Sinhala (AI)", timeout=10_000)
        check(active_track(page) == "Sinhala (AI)", "when ready the Sinhala track is loaded and selected automatically")
        polls_done = m.poll_calls
        page.wait_for_timeout(7000)
        check(m.poll_calls == polls_done, "polling stops once the job is done")
        check(chip(page, "Sinhala (AI)").count() == 1, "the placeholder is replaced by the real track (one Sinhala entry)")
        page.screenshot(path=str(work / "ready.png"))
        page.close()

        # 2. Failure shows an error with Retry; Retry starts again; dismiss hides the banner.
        page = ctx.new_page()
        m = Mocks(page, [EN_TRACK], translate_start=[{"state": "failed", "message": "model down"}, {"state": "running", "progress": None}], translate_poll=[{"state": "running", "progress": None}])
        open_player(page)
        open_subtitle_panel(page)
        pick_track(page, "Sinhala (AI)")
        expect(page.get_by_text("Couldn’t prepare Sinhala subtitles")).to_be_visible(timeout=5000)
        check(page.get_by_text("model down").is_visible(), "failure banner explains why")
        check(active_track(page) == "English", "English subtitles still active after a failure")
        page.get_by_role("button", name="Retry").click()
        expect(page.get_by_text("Preparing Sinhala subtitles")).to_be_visible(timeout=5000)
        check(len(m.start_calls) == 2, "Retry starts the job again")
        page.locator(".v-banner .v-banner-x").click()
        expect(page.get_by_text("Preparing Sinhala subtitles")).to_be_hidden(timeout=3000)
        check(True, "banner can be dismissed")
        page.close()

        # 3. Daily cap reached: a clear 'unavailable right now' state.
        page = ctx.new_page()
        Mocks(page, [EN_TRACK], translate_start=[{"state": "unavailable", "message": "Sinhala subtitles are unavailable right now, try again tomorrow"}])
        open_player(page)
        open_subtitle_panel(page)
        pick_track(page, "Sinhala (AI)")
        expect(page.get_by_text("Sinhala subtitles are unavailable right now").first).to_be_visible(timeout=5000)
        check(True, "budget cap shows the 'unavailable right now' banner")
        page.close()

        # 4. A Sinhala track already exists: behaves as before, no API call at all.
        page = ctx.new_page()
        m = Mocks(page, [EN_TRACK, SI_TRACK], translate_start=[{"state": "running"}])
        open_player(page)
        open_subtitle_panel(page)
        expect(picker(page)).to_contain_text("Sinhala (AI)", timeout=10_000)
        check(active_track(page) == "Sinhala (AI)", "existing Sinhala track is selected by default")
        check(chip(page, "Sinhala (AI)").count() == 1, "no duplicate placeholder next to the real track")
        pick_track(page, "English")
        pick_track(page, "Sinhala (AI)")
        page.wait_for_timeout(1200)
        check(active_track(page) == "Sinhala (AI)", "re-selecting the existing track switches to it")
        check(len(m.start_calls) == 0 and m.poll_calls == 0, "selecting an existing track makes no translate API call")
        page.close()

        # 5. No English subtitle: no Sinhala option, with a short explanation.
        page = ctx.new_page()
        m = Mocks(page, [{**EN_TRACK, "id": "sub_1_fr_1", "label": "French", "language": "fr"}, {**EN_TRACK, "id": "sub_1_de_1", "label": "German", "language": "de"}], translate_start=[{"state": "running"}])
        open_player(page)
        open_subtitle_panel(page)
        check(chip(page, "Sinhala").count() == 0, "no English subtitle: Sinhala is not offered")
        check(page.get_by_text("needs an English subtitle").is_visible(), "an explanation is shown instead")
        check(len(m.start_calls) == 0, "and nothing is requested")
        page.close()

        # 6. Two tracks render together; replacing/removing a slot never creates a third track.
        page = ctx.new_page()
        french = {**EN_TRACK, "id": "sub-fr", "label": "French", "language": "fr"}
        german = {**EN_TRACK, "id": "sub-de", "label": "German", "language": "de"}
        Mocks(page, [EN_TRACK, french, german], translate_start=[{"state": "running"}])
        open_player(page)
        open_subtitle_panel(page)
        pick_track(page, "French", "Second")
        expect(page.locator(".v-dual-track")).to_have_count(2)
        expect(page.locator('.v-dual-track[data-slot="0"] span')).to_be_visible()
        expect(page.locator('.v-dual-track[data-slot="1"] span')).to_be_visible()
        check(active_track(page) == "English", "adding a second track keeps the first one")
        check(chip(page, "English", "Second").get_attribute("aria-disabled") == "true", "the same track cannot occupy both slots")
        check(page.locator(".vds-caption-button").count() == 0, "the separate CC button is removed")
        pick_track(page, "German")
        expect(page.locator(".v-dual-track")).to_have_count(2)
        check(active_track(page) == "German", "a third language replaces a slot instead of adding a third track")
        page.get_by_role("button", name="Remove second subtitle").click()
        expect(page.locator(".v-dual-track")).to_have_count(1)
        check(active_track(page) == "German", "removing the second subtitle leaves the first one on")
        page.close()

        # 7. Generating Sinhala for the second slot preserves the first language.
        page = ctx.new_page()
        Mocks(page, [EN_TRACK], translate_start=[{"state": "done", "subtitle": {**SI_TRACK, "url": SI_URL}}])
        open_player(page)
        open_subtitle_panel(page)
        pick_track(page, "Sinhala (AI)", "Second")
        expect(page.locator('.v-dual-track[data-slot="1"]')).to_have_attribute("aria-label", "Sinhala (AI)")
        expect(page.locator(".v-dual-track")).to_have_count(2)
        check(active_track(page) == "English", "generated Sinhala uses the requested second slot and keeps English")
        page.close()

        # 8. A removed pending track stays off when its translation finishes.
        page = ctx.new_page()
        Mocks(page, [EN_TRACK], translate_start=[{"state": "running"}], translate_poll=[{"state": "done", "subtitle": {**SI_TRACK, "url": SI_URL}}])
        open_player(page)
        open_subtitle_panel(page)
        pick_track(page, "Sinhala (AI)", "Second")
        page.get_by_role("button", name="Remove second subtitle").click()
        expect(page.get_by_text("Sinhala subtitles are ready", exact=True)).to_be_visible(timeout=10_000)
        expect(picker(page, "Second")).to_have_text("Off")
        check(active_track(page) == "English", "removing a pending translation prevents it from switching subtitles later")
        page.close()

        browser.close()
    print(f"\n{sum(results)}/{len(results)} checks passed (screenshots in {work})")
    sys.exit(0 if all(results) else 1)


run()
