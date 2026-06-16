"""Ranking API endpoints."""
from fastapi import APIRouter, HTTPException, status
from typing import Dict, Any, List
import logging
import json
import os

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)

router = APIRouter()

RANKING_FILE_PATH = "/var/www/cxgame/static/ranking.json"
ALLOWED_RANKING_FIELDS = {
    "rank",
    "ranking_code",
    "display_name",
    "xp",
    "level",
    "avatar_file_name",
}


def sanitize_ranking_entry(entry: Dict[str, Any], index: int) -> Dict[str, Any]:
    safe_entry = {key: entry.get(key) for key in ALLOWED_RANKING_FIELDS if key in entry}
    safe_entry["rank"] = int(safe_entry.get("rank") or index + 1)
    safe_entry["ranking_code"] = safe_entry.get("ranking_code") or f"user{1000 + index + 1}"
    safe_entry["display_name"] = safe_entry.get("display_name") or f"Agente {1000 + index + 1}"
    safe_entry["xp"] = int(safe_entry.get("xp") or 0)
    safe_entry["level"] = int(safe_entry.get("level") or 1)
    safe_entry["avatar_file_name"] = safe_entry.get("avatar_file_name")
    return safe_entry


def sanitize_ranking_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    ranking = payload.get("ranking") if isinstance(payload, dict) else []
    safe_ranking = [
        sanitize_ranking_entry(entry, index)
        for index, entry in enumerate(ranking or [])
        if isinstance(entry, dict)
    ]

    return {
        **payload,
        "ranking": safe_ranking,
        "total_players": len(safe_ranking),
        "total_users": len(safe_ranking),
    }


@router.get("/current")
async def get_current_ranking() -> Dict[str, Any]:
    """Retorna o ranking público da temporada atual. Lê ranking.json pré-gerado em disco; faz fallback para Supabase RPC se o arquivo não existir. Campos expostos: rank, display_name, xp, level e avatar."""
    if os.path.exists(RANKING_FILE_PATH):
        try:
            with open(RANKING_FILE_PATH, 'r', encoding='utf-8') as f:
                ranking_data = json.load(f)
            logger.info("Ranking loaded from static file")
            return sanitize_ranking_payload(ranking_data)
        except Exception as e:
            logger.warning(f"Failed to read ranking file: {e}, falling back to database")

    try:
        result = await supabase_client.call_rpc("get_current_ranking_public", {})
        
        if not result:
            return {
                "ranking": [],
                "total_players": 0,
                "generated_at": None
            }
        
        safe_result = [
            sanitize_ranking_entry(entry, index)
            for index, entry in enumerate(result)
            if isinstance(entry, dict)
        ]

        return {
            "ranking": safe_result,
            "total_players": len(safe_result),
            "total_users": len(safe_result),
            "generated_at": None
        }
    
    except Exception as e:
        logger.error(f"Failed to fetch ranking: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch ranking data"
        )
