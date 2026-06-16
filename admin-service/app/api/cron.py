from fastapi import APIRouter, HTTPException
import logging

from app.services.admin_service import admin_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/generate-daily-ranking")
async def generate_daily_ranking():
    """Triggered by: Daily cron job (e.g., 00:00 UTC)"""
    try:
        result = await admin_service.generate_daily_ranking()
        logger.info(f"Daily ranking generated: {result['users_count']} users")
        return result
    except Exception as e:
        logger.error(f"Failed to generate daily ranking: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/close-season")
async def close_season():
    """Triggered by: Manual or scheduled cron job"""
    try:
        season = await admin_service.get_current_season()

        if not season:
            raise HTTPException(status_code=404, detail="No active season to close")

        result = await admin_service.close_season(season['id'])
        logger.info(f"Season closed: {season['id']}")
        return result
    except Exception as e:
        logger.error(f"Failed to close season: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cleanup-old-data")
async def cleanup_old_data(retention_days: int = 90):
    """Triggered by: Weekly cron job"""
    try:
        result = await admin_service.cleanup_old_data(retention_days)
        logger.info(
            f"Cleanup completed: {result['attempts_deleted']} attempts, "
            f"{result['login_attempts_deleted']} login attempts"
        )
        return result
    except Exception as e:
        logger.error(f"Failed to cleanup old data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def cron_health():
    return {
        "status": "healthy",
        "service": "cron-jobs",
        "endpoints": [
            "/internal/cron/generate-daily-ranking",
            "/internal/cron/close-season",
            "/internal/cron/cleanup-old-data"
        ]
    }
