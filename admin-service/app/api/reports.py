from fastapi import APIRouter, Query
import logging

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/user-retention")
async def get_user_retention(days: int = Query(30, ge=1, le=365)):
    """Taxa de retencao: usuarios com >=1 tentativa no periodo vs total cadastrado. Agregado."""
    return await supabase_client.call_rpc("admin_user_retention", {"p_days": days})


@router.get("/daily-activity")
async def get_daily_activity(days: int = Query(7, ge=1, le=90)):
    """Tentativas e usuarios unicos por dia. Agregado."""
    return {
        "period_days": days,
        "daily_activity": await supabase_client.call_rpc("admin_daily_activity", {"p_days": days}),
    }


@router.get("/xp-distribution")
async def get_xp_distribution():
    """Distribuicao de XP (min/max/media/percentis). Agregado."""
    return await supabase_client.call_rpc("admin_xp_distribution", {})


@router.get("/challenge-difficulty")
async def get_challenge_difficulty():
    """Taxa de acerto por desafio (>=10 tentativas), do mais dificil ao mais facil. Agregado."""
    return {
        "challenges": await supabase_client.call_rpc("admin_challenge_difficulty", {}),
    }
