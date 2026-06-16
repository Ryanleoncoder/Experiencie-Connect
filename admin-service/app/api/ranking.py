from fastapi import APIRouter, HTTPException, Query
from datetime import date
import logging

from app.services.admin_service import admin_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/current")
async def get_current_ranking():
    result = await admin_service.get_current_ranking()
    return result


@router.get("/historical")
async def get_historical_ranking(date_str: str = Query(..., alias="date")):
    try:
        ranking_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid date format. Use YYYY-MM-DD"
        )

    from app.core.config import settings
    filename = f"{settings.RANKING_FILE_PREFIX}_{date_str}.json"
    url = f"{settings.SUPABASE_URL}/storage/v1/object/public/{settings.SUPABASE_STORAGE_BUCKET}/{filename}"
    
    return {
        "url": url,
        "filename": filename,
        "date": date_str
    }
