from fastapi import APIRouter, Query
from datetime import datetime, timedelta
import logging

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/user-retention")
async def get_user_retention(days: int = Query(30, ge=1, le=365)):
    """Retorna taxa de retenção no período: usuários que fizeram ao menos uma tentativa vs total cadastrado. Não expõe dados individuais."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    total_users = await supabase_client.fetchval(
        "SELECT COUNT(*) FROM usuarios"
    )
    
    active_users = await supabase_client.fetchval(
        """
        SELECT COUNT(DISTINCT user_id)
        FROM attempts
        WHERE created_at > $1
        """,
        cutoff
    )
    
    retention_rate = (active_users / total_users * 100) if total_users > 0 else 0
    
    return {
        "period_days": days,
        "total_users": total_users,
        "active_users": active_users,
        "retention_rate": round(retention_rate, 2)
    }


@router.get("/daily-activity")
async def get_daily_activity(days: int = Query(7, ge=1, le=90)):
    """Retorna tentativas e usuários únicos ativos por dia no período. Dados agregados, sem identificação individual."""
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    activity = await supabase_client.fetch(
        """
        SELECT DATE(created_at) as date,
               COUNT(*) as attempts,
               COUNT(DISTINCT user_id) as unique_users
        FROM attempts
        WHERE created_at > $1
        GROUP BY DATE(created_at)
        ORDER BY date DESC
        """,
        cutoff
    )
    
    return {
        "period_days": days,
        "daily_activity": [
            {
                "date": row['date'].isoformat(),
                "attempts": row['attempts'],
                "unique_users": row['unique_users']
            }
            for row in activity
        ]
    }


@router.get("/xp-distribution")
async def get_xp_distribution():
    """Retorna distribuição de XP entre todos os jogadores (mín, máx, média, percentis p25–p99). Dados agregados."""
    stats = await supabase_client.fetchrow(
        """
        SELECT 
            MIN(xp) as min_xp,
            MAX(xp) as max_xp,
            AVG(xp)::int as avg_xp,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY xp)::int as p25,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY xp)::int as p50,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY xp)::int as p75,
            PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY xp)::int as p90,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY xp)::int as p95,
            PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY xp)::int as p99
        FROM user_progress
        """
    )
    
    return {
        "min_xp": stats['min_xp'],
        "max_xp": stats['max_xp'],
        "avg_xp": stats['avg_xp'],
        "percentiles": {
            "p25": stats['p25'],
            "p50": stats['p50'],
            "p75": stats['p75'],
            "p90": stats['p90'],
            "p95": stats['p95'],
            "p99": stats['p99']
        }
    }


@router.get("/challenge-difficulty")
async def get_challenge_difficulty():
    """Retorna taxa de acerto por desafio (apenas os com ≥10 tentativas), ordenado do mais difícil ao mais fácil. Dados agregados."""
    stats = await supabase_client.fetch(
        """
        SELECT challenge_id,
               COUNT(*) as total_attempts,
               SUM(CASE WHEN correct THEN 1 ELSE 0 END) as correct_attempts,
               (SUM(CASE WHEN correct THEN 1 ELSE 0 END)::float / COUNT(*) * 100) as success_rate
        FROM attempts
        GROUP BY challenge_id
        HAVING COUNT(*) >= 10
        ORDER BY success_rate ASC
        LIMIT 50
        """
    )
    
    return {
        "challenges": [
            {
                "challenge_id": row['challenge_id'],
                "total_attempts": row['total_attempts'],
                "correct_attempts": row['correct_attempts'],
                "success_rate": round(row['success_rate'], 2)
            }
            for row in stats
        ]
    }
