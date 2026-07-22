import logging
from typing import Dict, Any

from app.db.supabase_client import supabase_client
from app.db.redis_client import redis_client

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages all database connections and health checks."""
    
    def __init__(self):
        self.supabase = supabase_client
        self.redis = redis_client
    
    async def initialize_all(self) -> None:
        """Initialize all database connections."""
        logger.info("Initializing database connections...")
        
        try:
            await self.supabase.connect()
            logger.info("✓ Supabase connected")
        except Exception as e:
            logger.error(f"✗ Supabase connection failed: {e}")
            raise  # Supabase is critical, fail startup

        try:
            await self.redis.connect()
            if self.redis.is_available():
                logger.info("✓ Redis connected")
            else:
                logger.info("○ Redis not available (graceful degradation)")
        except Exception as e:
            logger.warning(f"○ Redis connection failed (graceful degradation): {e}")
        
        logger.info("Database connections initialized successfully")
    
    async def close_all(self) -> None:
        logger.info("Closing database connections...")

        try:
            await self.supabase.disconnect()
            logger.info("✓ Supabase disconnected")
        except Exception as e:
            logger.error(f"Error closing Supabase: {e}")

        try:
            await self.redis.disconnect()
            logger.info("✓ Redis disconnected")
        except Exception as e:
            logger.error(f"Error closing Redis: {e}")
        
        logger.info("Database connections closed")
    
    async def health_check_all(self) -> Dict[str, Any]:
        health_status = {
            "healthy": True,
            "services": {}
        }
        
        try:
            supabase_healthy = await self.supabase.health_check()
            health_status["services"]["supabase"] = {
                "status": "healthy" if supabase_healthy else "unhealthy",
                "critical": True
            }
            if not supabase_healthy:
                health_status["healthy"] = False
        except Exception as e:
            logger.error(f"Supabase health check error: {e}")
            health_status["services"]["supabase"] = {
                "status": "unhealthy",
                "critical": True,
                "error": str(e)
            }
            health_status["healthy"] = False

        try:
            if self.redis.is_available():
                redis_healthy = await self.redis.health_check()
                health_status["services"]["redis"] = {
                    "status": "healthy" if redis_healthy else "degraded",
                    "critical": False
                }
            else:
                health_status["services"]["redis"] = {
                    "status": "disabled",
                    "critical": False
                }
        except Exception as e:
            logger.warning(f"Redis health check error: {e}")
            health_status["services"]["redis"] = {
                "status": "degraded",
                "critical": False,
                "error": str(e)
            }
        
        return health_status
    
    async def get_connection_stats(self) -> Dict[str, Any]:
        stats = {}

        if self.supabase.pool:
            stats["supabase"] = {
                "pool_size": self.supabase.pool.get_size(),
                "pool_free": self.supabase.pool.get_idle_size(),
                "pool_used": self.supabase.pool.get_size() - self.supabase.pool.get_idle_size()
            }
        else:
            stats["supabase"] = {"status": "not_connected"}

        stats["redis"] = {
            "available": self.redis.is_available(),
            "enabled": self.redis._enabled
        }
        
        return stats


connection_manager = ConnectionManager()
