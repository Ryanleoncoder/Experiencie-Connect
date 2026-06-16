import redis.asyncio as aioredis
from typing import Optional, Any
import logging
import json

from app.core.config import settings

logger = logging.getLogger(__name__)


class RedisClient:
    """Gracefully degrades if Redis is unavailable."""

    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self._enabled = settings.REDIS_ENABLED
        self._available = False
    
    async def connect(self) -> None:
        """Initialize Redis connection."""
        if not self._enabled:
            logger.info("Redis is disabled in configuration")
            return
        
        try:
            self.redis = await aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )

            await self.redis.ping()
            self._available = True
            
            logger.info(f"Redis connected: {settings.REDIS_URL}")
        
        except Exception as e:
            logger.warning(f"Redis connection failed (will degrade gracefully): {e}")
            self._available = False
            self.redis = None
    
    async def disconnect(self) -> None:
        """Close Redis connection."""
        if self.redis:
            try:
                await self.redis.close()
                self.redis = None
                self._available = False
                logger.info("Redis connection closed")
            except Exception as e:
                logger.error(f"Error closing Redis connection: {e}")
    
    def is_available(self) -> bool:
        """Check if Redis is available."""
        return self._available and self.redis is not None
    
    async def get(self, key: str) -> Optional[str]:
        if not self.is_available():
            return None
        
        try:
            return await self.redis.get(key)
        except Exception as e:
            logger.warning(f"Redis GET failed for key '{key}': {e}")
            return None
    
    async def set(
        self,
        key: str,
        value: str,
        ttl: Optional[int] = None
    ) -> bool:
        if not self.is_available():
            return False
        
        try:
            if ttl is None:
                ttl = settings.REDIS_TTL_SECONDS
            
            await self.redis.setex(key, ttl, value)
            return True
        
        except Exception as e:
            logger.warning(f"Redis SET failed for key '{key}': {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        if not self.is_available():
            return False
        
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Redis DELETE failed for key '{key}': {e}")
            return False
    
    async def incr(self, key: str, amount: int = 1) -> Optional[int]:
        if not self.is_available():
            return None
        
        try:
            return await self.redis.incrby(key, amount)
        except Exception as e:
            logger.warning(f"Redis INCR failed for key '{key}': {e}")
            return None
    
    async def expire(self, key: str, ttl: int) -> bool:
        if not self.is_available():
            return False
        
        try:
            await self.redis.expire(key, ttl)
            return True
        except Exception as e:
            logger.warning(f"Redis EXPIRE failed for key '{key}': {e}")
            return False
    
    async def get_json(self, key: str) -> Optional[Any]:
        value = await self.get(key)
        if value is None:
            return None
        
        try:
            return json.loads(value)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to decode JSON for key '{key}': {e}")
            return None
    
    async def set_json(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None
    ) -> bool:
        try:
            json_value = json.dumps(value)
            return await self.set(key, json_value, ttl)
        except (TypeError, ValueError) as e:
            logger.warning(f"Failed to serialize JSON for key '{key}': {e}")
            return False
    
    async def health_check(self) -> bool:
        if not self.is_available():
            return False
        
        try:
            await self.redis.ping()
            return True
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            self._available = False
            return False
    
    async def get_ttl(self, key: str) -> Optional[int]:
        if not self.is_available():
            return None
        
        try:
            ttl = await self.redis.ttl(key)
            return ttl if ttl > 0 else None
        except Exception as e:
            logger.warning(f"Redis TTL failed for key '{key}': {e}")
            return None
    
    async def exists(self, key: str) -> bool:
        if not self.is_available():
            return False
        
        try:
            return await self.redis.exists(key) > 0
        except Exception as e:
            logger.warning(f"Redis EXISTS failed for key '{key}': {e}")
            return False


redis_client = RedisClient()
