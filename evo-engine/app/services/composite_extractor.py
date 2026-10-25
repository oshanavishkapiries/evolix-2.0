import logging
import time
from typing import Callable, List, Optional
from app.core import metrics
from app.core.notes import note
from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource
from app.services.provider_health import ProviderHealth

logger = logging.getLogger("evo.composite_extractor")


class CompositeStreamExtractor(IStreamExtractor):
    """Multi-provider fallback: tries the extractors in priority order.

    A provider is skipped when it raises, returns nothing, or (when a validator is given) returns streams that
    do not actually play. If every provider fails validation but at least one extracted something, that
    unvalidated result is used rather than failing outright, since a validator false-negative must not take the
    whole pipeline down. Providers that keep failing are put on cool-down (see ProviderHealth) and every attempt
    is measured (see app.core.metrics).
    """

    def __init__(
        self,
        extractors: List[IStreamExtractor],
        validator: Optional[Callable[[List[StreamSource]], None]] = None,
        health: Optional[ProviderHealth] = None,
    ):
        if not extractors:
            raise ValueError("CompositeStreamExtractor requires at least one extractor")
        self.extractors = extractors
        self.validator = validator
        self.health = health or ProviderHealth()

    @property
    def provider_names(self) -> List[str]:
        return [e.__class__.__name__ for e in self.extractors]

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        errors: List[str] = []
        skipped: List[str] = []
        unvalidated: Optional[List[StreamSource]] = None

        for extractor in self.extractors:
            name = extractor.__class__.__name__
            decision = self.health.before(name)
            if decision == "skip":
                until = self.health.until(name)
                when = time.strftime("%H:%M:%S", time.localtime(until)) if until else "a trial finishes"
                msg = f"{name} skipped: cooling down until {when}"
                logger.warning(msg)
                note(msg)
                skipped.append(msg)
                continue
            if decision == "trial":
                note(f"{name}: cool-down over, trying it once")

            streams: Optional[List[StreamSource]] = None
            failure: Optional[str] = None
            attempt = None
            try:
                with metrics.measure(name) as attempt:
                    logger.info(f"Attempting stream extraction with {name}...")
                    streams = extractor.extract_streams(tmdb_id=tmdb_id, media_type=media_type, season=season, episode=episode)
                    if not streams:
                        attempt.outcome, failure = "failed", "returned no streams"
                    elif self.validator:
                        try:
                            self.validator(streams)
                        except Exception as e:
                            attempt.outcome, failure = "invalid", f"streams not playable ({e})"
                            unvalidated = unvalidated or streams
            except Exception as e:
                failure = str(e)
            if attempt:
                note(attempt.summary())

            if failure is not None:
                logger.warning(f"{name} failed: {failure}")
                errors.append(f"{name}: {failure}")
                self.health.failure(name)
                continue
            self.health.success(name)
            logger.info(f"{name} successfully extracted {len(streams)} stream(s)")
            return streams

        if unvalidated:
            logger.warning("No provider passed validation; using the first extracted result anyway")
            return unvalidated
        if skipped and not errors:
            raise RuntimeError("No provider is available right now: " + "; ".join(skipped))
        raise RuntimeError(f"All stream extractors failed for TMDB {tmdb_id}: {'; '.join(errors + skipped)}")
