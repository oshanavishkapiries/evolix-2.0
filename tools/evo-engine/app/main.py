import logging
import shutil
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as media_router, _repository, load_runtime_config
from app.core.config import settings

logger = logging.getLogger("evo.main")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

@asynccontextmanager
async def lifespan(_: FastAPI):
    if not settings.EVO_SECRET_TOKEN:
        logger.warning("EVO_SECRET_TOKEN is empty: the engine accepts unauthenticated requests")
    load_runtime_config()
    # Background jobs die with the process; without this they would look in-flight forever.
    recovered = _repository.recover_interrupted()
    if recovered:
        logger.warning(f"Recovered {recovered} task(s) interrupted by the last shutdown")
    leftovers = [p for p in settings.DOWNLOAD_DIR.iterdir() if p.is_file()]
    if leftovers and settings.CLEAN_ORPHANS_ON_START:
        for p in leftovers:
            p.unlink(missing_ok=True)
        logger.warning(f"Removed {len(leftovers)} orphaned download file(s)")
    elif leftovers:
        logger.warning(f"{len(leftovers)} leftover file(s) in {settings.DOWNLOAD_DIR} (set CLEAN_ORPHANS_ON_START=true to remove)")
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.APP_NAME,
    description="Encapsulated clean architecture media ingestion and CDN sync microservice.",
    version="1.0.0",
)

# Enable CORS for Next.js web application
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(media_router)


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": settings.APP_NAME,
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
        "ffprobe_available": shutil.which("ffprobe") is not None,
        "free_disk_gb": round(shutil.disk_usage(settings.DOWNLOAD_DIR).free / 1024**3, 1),
        "webhook_configured": bool(settings.EVO_WEBHOOK_URL),
    }
