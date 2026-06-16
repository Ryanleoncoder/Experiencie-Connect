from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from datetime import datetime
from typing import Dict, Any

from app.core.config import settings
from app.db.connections import connection_manager

router = APIRouter()


@router.get("/health")
async def health_check() -> Dict[str, str]:
    """Used by Render and VPS monitoring for uptime checks."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


@router.get("/health/detailed")
async def detailed_health_check() -> JSONResponse:
    """
    Returns 200 if all critical services are healthy, 503 if any critical
    service is down, or 200 with "degraded" status if only Redis is down.
    """
    health_status = await connection_manager.health_check_all()
    
    response_data = {
        "status": "healthy" if health_status["healthy"] else "unhealthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "services": health_status["services"]
    }
    
    if health_status["healthy"]:
        redis_status = health_status["services"].get("redis", {}).get("status")
        if redis_status in ["degraded", "disabled"]:
            response_data["status"] = "degraded"
            response_data["message"] = "Running with degraded performance (Redis unavailable)"
    
    if not health_status["healthy"]:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=response_data
        )
    
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content=response_data
    )


@router.get("/health/stats")
async def connection_stats() -> Dict[str, Any]:
    stats = await connection_manager.get_connection_stats()
    
    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "connections": stats
    }
