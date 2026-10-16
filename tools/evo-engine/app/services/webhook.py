import logging
import time

import requests

from app.core.config import settings
from app.domain.models import IngestTask

logger = logging.getLogger("evo.webhook")

RETRY_DELAYS = (0, 2, 6, 15)


class WebhookNotifier:
    """Tells the app a quality finished caching so it can register the CDN file as a source."""

    def notify_completed(self, task: IngestTask) -> bool:
        if not settings.EVO_WEBHOOK_URL:
            logger.info("EVO_WEBHOOK_URL not set; skipping completion webhook")
            return False

        payload = {
            "tmdbId": task.tmdb_id,
            "mediaType": task.media_type.value,
            "season": task.season,
            "episode": task.episode,
            "quality": task.resolved_quality or task.requested_quality,
            "resultUrl": task.result_url,
            "subtitles": task.cdn_subtitles,
        }
        headers = {"X-Evo-Secret": settings.EVO_SECRET_TOKEN} if settings.EVO_SECRET_TOKEN else {}
        for delay in RETRY_DELAYS:
            if delay:
                time.sleep(delay)
            try:
                r = requests.post(settings.EVO_WEBHOOK_URL, json=payload, headers=headers, timeout=15)
                if r.status_code == 200:
                    return True
                # 4xx means the payload itself is wrong; retrying cannot fix it. The app's status poll is the backstop.
                logger.warning(f"[{task.task_id}] webhook rejected: HTTP {r.status_code} {r.text[:200]}")
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    return False
            except Exception as e:
                logger.warning(f"[{task.task_id}] webhook attempt failed: {e}")
        return False
