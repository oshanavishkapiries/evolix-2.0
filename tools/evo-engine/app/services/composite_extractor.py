import logging
from typing import Callable, List, Optional
from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource

logger = logging.getLogger("evo.composite_extractor")


class CompositeStreamExtractor(IStreamExtractor):
    """Multi-provider fallback: tries the extractors in priority order.

    A provider is skipped when it raises, returns nothing, or (when a validator is given) returns streams that
    do not actually play. If every provider fails validation but at least one extracted something, that
    unvalidated result is used rather than failing outright, since a validator false-negative must not take the
    whole pipeline down.
    """

    def __init__(self, extractors: List[IStreamExtractor], validator: Optional[Callable[[List[StreamSource]], None]] = None):
        if not extractors:
            raise ValueError("CompositeStreamExtractor requires at least one extractor")
        self.extractors = extractors
        self.validator = validator

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        errors: List[str] = []
        unvalidated: Optional[List[StreamSource]] = None

        for extractor in self.extractors:
            name = extractor.__class__.__name__
            try:
                logger.info(f"Attempting stream extraction with {name}...")
                streams = extractor.extract_streams(tmdb_id=tmdb_id, media_type=media_type, season=season, episode=episode)
            except Exception as e:
                logger.warning(f"{name} extraction failed: {e}")
                errors.append(f"{name}: {e}")
                continue
            if not streams:
                logger.warning(f"{name} returned empty stream list")
                errors.append(f"{name}: returned no streams")
                continue

            if self.validator:
                try:
                    self.validator(streams)
                except Exception as e:
                    logger.warning(f"{name} streams failed validation: {e}")
                    errors.append(f"{name}: streams not playable ({e})")
                    unvalidated = unvalidated or streams
                    continue
            logger.info(f"{name} successfully extracted {len(streams)} stream(s)")
            return streams

        if unvalidated:
            logger.warning("No provider passed validation; using the first extracted result anyway")
            return unvalidated
        raise RuntimeError(f"All stream extractors failed for TMDB {tmdb_id}: {'; '.join(errors)}")
