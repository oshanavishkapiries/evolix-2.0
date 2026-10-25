#!/usr/bin/env python3
"""Evo Engine - main extractor (scraper entry point)."""

import json
import os
import re
import urllib.parse
from pathlib import Path

from curl_cffi import requests
from dotenv import load_dotenv
from filters import RequestFilter
from stealth import StealthBrowser

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

TARGET_URL = os.getenv("TARGET_URL", "https://ythd.org/embed/1148365")
SCREENSHOT_PATH = BASE_DIR / "screenshot.png"


def extract_media(target_url: str):
    """Bypasses Cloudflare Turnstile & anti-bot gates by extracting stream metadata and playing the stream."""
    session = requests.Session(impersonate="chrome124")

    print(f"[*] Navigating to embed source: {target_url}")
    # 1. Fetch vs_src from embedding page
    parsed = urllib.parse.urlsplit(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    movie_id = parsed.path.rstrip("/").split("/")[-1]

    vs_src_url = f"{origin}/vs_src.php?type=movie&id={movie_id}"
    r_src = session.get(vs_src_url, headers={"Referer": target_url})
    if r_src.status_code != 200 or "src" not in r_src.json():
        raise RuntimeError(f"Failed to fetch vs_src: {r_src.status_code} {r_src.text}")

    movie_url = r_src.json()["src"]
    print(f"[*] Intermediate landing URL: {movie_url}")

    # 2. Extract player page URL
    r_landing = session.get(movie_url, headers={"Referer": origin})
    m_player = re.search(r'\"playerUrl\":\"([^\"]+)\"', r_landing.text)
    if not m_player:
        raise RuntimeError("Failed to locate playerUrl in landing HTML")
    player_rel = m_player.group(1).replace(r"\u0026", "&")
    player_origin = f"{urllib.parse.urlsplit(movie_url).scheme}://{urllib.parse.urlsplit(movie_url).netloc}"
    player_url = f"{player_origin}{player_rel}"
    print(f"[*] Gated Player URL: {player_url}")

    # 3. Pull player configuration & single-use API token
    r_player = session.get(player_url, headers={"Referer": f"{player_origin}/"})
    m_cfg = re.search(r'window\.CONFIG\s*=\s*(\{.*?\});', r_player.text)
    if not m_cfg:
        raise RuntimeError("Failed to extract window.CONFIG from player page")
    cfg = json.loads(m_cfg.group(1))

    stream_api_url = cfg["api"] + "&api_token=" + urllib.parse.quote(cfg["apiToken"])
    print(f"[*] Requesting encrypted stream data: {cfg['api']}")

    # 4. Fetch encrypted stream payload
    r_stream = session.get(
        stream_api_url,
        headers={
            "Referer": f"{player_origin}/",
            "Origin": player_origin,
            "Accept": "application/json",
        },
    )
    if r_stream.status_code != 200:
        raise RuntimeError(f"Stream API returned {r_stream.status_code}: {r_stream.text}")
    stream_json = r_stream.json()
    movie_title = stream_json.get("data", {}).get("title", "Player")

    # 5. Fetch vsdec decryptor WebAssembly script
    r_vsdec = session.get(f"{player_origin}/embed/iframe_player/assets/vsdec.js?v=1786492668")

    # 6. Execute decryption in StealthBrowser
    print("[*] Decrypting streams in StealthBrowser environment...")
    request_filter = RequestFilter(preset="default", verbose=False)
    with StealthBrowser(headless=True, request_filter=request_filter) as browser:
        browser.page.goto(player_origin)
        browser.page.evaluate(r_vsdec.text)
        decrypted_urls = browser.page.evaluate(
            """async (resp) => {
            const origFetch = window.fetch;
            window.fetch = async (url, opts) => {
                if (url === 'dummy') return { json: async () => resp };
                return await origFetch(url, opts);
            };
            const res = await window.vsFetchJSON('dummy');
            window.fetch = origFetch;
            return res.data.stream_urls;
        }""",
            stream_json,
        )

        if not decrypted_urls:
            raise RuntimeError("No stream URLs could be decrypted")

        print(f"[+] Successfully decrypted {len(decrypted_urls)} stream URLs:")
        for idx, u in enumerate(decrypted_urls):
            print(f"    [{idx+1}] {u}")

        # 7. Request authorization token from stream host
        target_stream = decrypted_urls[0]
        st_origin = f"{urllib.parse.urlsplit(target_stream).scheme}://{urllib.parse.urlsplit(target_stream).netloc}"
        r_tok = session.get(f"{st_origin}/generate.php", headers={"Referer": f"{player_origin}/"})
        stream_token = r_tok.text.strip()
        playable_m3u8 = target_stream + ("&" if "?" in target_stream else "?") + "token=" + urllib.parse.quote(stream_token)

        # 8. Load playback in HTML5 video player & capture screenshot
        print("[*] Rendering video stream into player...")
        player_page_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>{movie_title}</title>
          <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
          <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
              background: #000;
              color: #fff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              overflow: hidden;
            }}
            .title {{
              font-size: 24px;
              font-weight: 700;
              margin-bottom: 16px;
              letter-spacing: 0.5px;
            }}
            .video-container {{
              position: relative;
              width: 85%;
              max-width: 1200px;
              aspect-ratio: 16 / 9;
              background: #050505;
              border: 1px solid rgba(255, 255, 255, 0.15);
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            }}
            video {{
              width: 100%;
              height: 100%;
              display: block;
              object-fit: cover;
            }}
          </style>
        </head>
        <body>
          <div class="title">{movie_title}</div>
          <div class="video-container">
            <video id="video" controls autoplay muted></video>
          </div>
          <script>
            const video = document.getElementById('video');
            if (Hls.isSupported()) {{
              const hls = new Hls();
              hls.loadSource('{playable_m3u8}');
              hls.attachMedia(video);
              hls.on(Hls.Events.MANIFEST_PARSED, () => {{
                video.play();
              }});
            }} else if (video.canPlayType('application/vnd.apple.mpegurl')) {{
              video.src = '{playable_m3u8}';
              video.play();
            }}
          </script>
        </body>
        </html>
        """
        browser.page.set_content(player_page_html)
        browser.page.wait_for_timeout(4500)
        browser.screenshot(SCREENSHOT_PATH)
        print(f"[+] Screenshot captured successfully: {SCREENSHOT_PATH}")


def main():
    extract_media(TARGET_URL)


if __name__ == "__main__":
    main()
