import logging
from typing import List, Optional
from app.interfaces.contracts import IStreamExtractor
from app.domain.models import StreamSource

logger = logging.getLogger("evo.composite_extractor")


class CompositeStreamExtractor(IStreamExtractor):
    """Orchestrates multi-provider fallback extraction across multiple stream extractors.

    Attempts extraction using extractors in sequential priority order.
    If the primary extractor fails or returns no valid streams, automatically
    falls back to the next extractor.
    """

    def __init__(self, extractors: List[IStreamExtractor]):
        if not extractors:
            raise ValueError("CompositeStreamExtractor requires at least one extractor")
        self.extractors = extractors

    def extract_streams(
        self,
        tmdb_id: int,
        media_type: str = "movie",
        season: Optional[int] = None,
        episode: Optional[int] = None,
    ) -> List[StreamSource]:
        errors: List[str] = []

        for extractor in self.extractors:
            name = extractor.__class__.__name__
            try:
                logger.info(f"Attempting stream extraction with {name}...")
                streams = extractor.extract_streams(
                    tmdb_id=tmdb_id,
                    media_type=media_type,
                    season=season,
                    episode=episode,
                )
                if streams:
                    logger.info(f"{name} successfully extracted {len(streams)} stream(s)")
                    return streams
                else:
                    logger.warning(f"{name} returned empty stream list")
                    errors.append(f"{name}: returned no streams")
            except Exception as e:
                logger.warning(f"{name} extraction failed: {e}")
                errors.append(f"{name}: {str(e)}")

        raise RuntimeError(f"All stream extractors failed for TMDB {tmdb_id}: {'; '.join(errors)}")
