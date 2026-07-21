"""Redis client for caching and rate limiting — VPS local Redis instance."""

import redis.asyncio as aioredis
from typing import Optional, Any
import logging
import json
import secrets

from app.core.config import settings

logger = logging.getLogger(__name__)


class RedisClient:
    
    def __init__(self):
        self.redis: Optional[aioredis.Redis] = None
        self._available = False
    
    async def connect(self) -> None:
        try:
            self.redis = await aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True,
                max_connections=settings.REDIS_MAX_CONNECTIONS
            )

            await self.redis.ping()
            self._available = True
            
            logger.info(f"Redis connected: {settings.REDIS_HOST}:{settings.REDIS_PORT}")
        
        except Exception as e:
            logger.error(f"Redis connection failed: {e}")
            self._available = False
            self.redis = None
            raise
    
    async def disconnect(self) -> None:
        if self.redis:
            try:
                await self.redis.close()
                self.redis = None
                self._available = False
                logger.info("Redis connection closed")
            except Exception as e:
                logger.error(f"Error closing Redis connection: {e}")
    
    def is_available(self) -> bool:
        return self._available and self.redis is not None
    
    async def get(self, key: str) -> Optional[str]:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        
        try:
            return await self.redis.get(key)
        except Exception as e:
            logger.error(f"Redis GET failed for key '{key}': {e}")
            raise
    
    async def set(
        self,
        key: str,
        value: str,
        ttl: Optional[int] = None
    ) -> bool:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        
        try:
            if ttl:
                await self.redis.setex(key, ttl, value)
            else:
                await self.redis.set(key, value)
            return True
        
        except Exception as e:
            logger.error(f"Redis SET failed for key '{key}': {e}")
            raise
    
    async def delete(self, key: str) -> bool:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis DELETE failed for key '{key}': {e}")
            raise
    
    async def incr(self, key: str, amount: int = 1) -> int:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        
        try:
            return await self.redis.incrby(key, amount)
        except Exception as e:
            logger.error(f"Redis INCR failed for key '{key}': {e}")
            raise
    
    async def expire(self, key: str, ttl: int) -> bool:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        
        try:
            await self.redis.expire(key, ttl)
            return True
        except Exception as e:
            logger.error(f"Redis EXPIRE failed for key '{key}': {e}")
            raise
    
    async def get_json(self, key: str) -> Optional[Any]:
        value = await self.get(key)
        if value is None:
            return None
        
        try:
            return json.loads(value)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to decode JSON for key '{key}': {e}")
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
            logger.error(f"Failed to serialize JSON for key '{key}': {e}")
            raise
    
    async def health_check(self) -> dict:
        if not self.is_available():
            return {"status": "unhealthy", "error": "Redis not connected"}
        
        try:
            start_time = __import__('time').time()
            await self.redis.ping()
            latency_ms = (__import__('time').time() - start_time) * 1000
            
            return {
                "status": "healthy",
                "latency_ms": round(latency_ms, 2)
            }
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            self._available = False
            return {"status": "unhealthy", "error": str(e)}
    
    async def exists(self, key: str) -> bool:
        if not self.is_available():
            raise RuntimeError("Redis not available")

        try:
            return await self.redis.exists(key) > 0
        except Exception as e:
            logger.error(f"Redis EXISTS failed for key '{key}': {e}")
            raise

    async def acquire_lock(self, key: str, ttl_seconds: int = 5) -> Optional[str]:
        if not self.is_available():
            raise RuntimeError("Redis not available")
        token = secrets.token_hex(16)
        acquired = await self.redis.set(key, token, nx=True, px=ttl_seconds * 1000)
        return token if acquired else None

    async def release_lock(self, key: str, token: str) -> bool:
        # Compare-and-del atomico: so libera se o token bater (nao apaga lock de outro dono).
        if not self.is_available():
            return False
        script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
        try:
            return bool(await self.redis.eval(script, 1, key, token))
        except Exception as e:
            logger.error(f"Redis release_lock failed for key '{key}': {e}")
            return False


redis_client = RedisClient()
