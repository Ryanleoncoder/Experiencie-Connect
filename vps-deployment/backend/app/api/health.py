"""Health check endpoint — monitors services (Redis, Supabase, Firebase) and system metrics."""
from fastapi import APIRouter, status, Response
from typing import Dict, Any
import logging
import psutil
import os

from app.db.redis_client import redis_client
from app.db.supabase_client import supabase_client
from app.db.firebase_client import firebase_client

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check(response: Response) -> Dict[str, Any]:
    """Retorna status de Redis, Supabase, Firebase e métricas do servidor (CPU, RAM, disco). Responde 503 se Redis ou Supabase estiverem indisponíveis."""
    health_status = {
        "status": "healthy",
        "services": {},
        "system": {}
    }
    
    redis_health = await redis_client.health_check()
    health_status["services"]["redis"] = redis_health
    
    supabase_health = await supabase_client.health_check()
    health_status["services"]["supabase"] = supabase_health
    
    firebase_health = await firebase_client.health_check()
    health_status["services"]["firebase"] = firebase_health
    
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        
        health_status["system"] = {
            "cpu_percent": round(cpu_percent, 2),
            "memory_percent": round(memory.percent, 2),
            "memory_used_gb": round(memory.used / (1024**3), 2),
            "memory_total_gb": round(memory.total / (1024**3), 2),
            "disk_percent": round(disk.percent, 2),
            "disk_used_gb": round(disk.used / (1024**3), 2),
            "disk_total_gb": round(disk.total / (1024**3), 2)
        }
        
        if cpu_percent > 80:
            logger.warning(f"High CPU usage: {cpu_percent}%")
        if memory.percent > 85:
            logger.warning(f"High memory usage: {memory.percent}%")
        if disk.percent > 90:
            logger.warning(f"High disk usage: {disk.percent}%")
            
    except Exception as e:
        logger.error(f"Failed to get system metrics: {e}")
        health_status["system"]["error"] = str(e)
    
    critical_services = ["redis", "supabase"]
    for service in critical_services:
        if health_status["services"][service]["status"] != "healthy":
            health_status["status"] = "unhealthy"
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            logger.error(f"Critical service {service} is unhealthy")
            break
    
    return health_status
