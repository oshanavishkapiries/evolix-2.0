import asyncio
import json
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 720}
        )
        page = await context.new_page()

        requests_log = []
        responses_log = []

        page.on("request", lambda req: requests_log.append({
            "url": req.url,
            "method": req.method,
            "headers": dict(req.headers),
            "post_data": req.post_data
        }))

        async def handle_response(resp):
            try:
                body = None
                content_type = resp.headers.get("content-type", "")
                if "json" in content_type or "text" in content_type or "mpegurl" in content_type:
                    body = await resp.text()
                responses_log.append({
                    "url": resp.url,
                    "status": resp.status,
                    "headers": dict(resp.headers),
                    "body_preview": (body[:500] if body else None)
                })
            except Exception:
                pass

        page.on("response", handle_response)

        target_url = "https://cinesrc.st/embed/movie/969681?color=%239b5cff&controls=true&continueprompt=true"
        print(f"Navigating to {target_url}...")
        try:
            await page.goto(target_url, wait_until="networkidle", timeout=25000)
        except Exception as e:
            print("Navigation finished/timed out:", e)

        # Wait a few more seconds for playback / stream resolution
        await page.wait_for_timeout(6000)

        # Check video element in DOM
        video_info = await page.evaluate("""() => {
            const video = document.querySelector('video');
            return video ? {
                src: video.src,
                currentSrc: video.currentSrc,
                paused: video.paused,
                readyState: video.readyState,
                videoWidth: video.videoWidth,
                videoHeight: video.videoHeight
            } : null;
        }""")

        title = await page.title()
        print(f"Page title: {title}")
        print(f"Video element info: {video_info}")

        # Take screenshot
        await page.screenshot(path="tools/evo-engine/test/cinesrc_screenshot.png")
        print("Screenshot saved to tools/evo-engine/test/cinesrc_screenshot.png")

        # Save network logs
        with open("tools/evo-engine/test/cinesrc_requests.json", "w") as f:
            json.dump(requests_log, f, indent=2)

        with open("tools/evo-engine/test/cinesrc_responses.json", "w") as f:
            json.dump(responses_log, f, indent=2)

        print(f"Total requests captured: {len(requests_log)}")
        print(f"Total responses captured: {len(responses_log)}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
