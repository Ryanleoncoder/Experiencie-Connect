"""Rate limiting middleware - IP-based rate limiting per Requirement 13.

Limits: 100 req/min for /admin/*, 1000 req/min for public endpoints.
/health is excluded. Returns 429 with Retry-After when exceeded.
In-memory store; not shared across processes/replicas.
"""

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from datetime import datetime, timedelta
import logging
from collections import defaultdict
from typing import Dict, Tuple
import asyncio

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    EXCLUDED_PATHS = ["/health"]
    ADMIN_LIMIT = 100
    PUBLIC_LIMIT = 1000

    def __init__(self, app):
        super().__init__(app)
        self._store: Dict[str, Dict[str, Tuple[int, datetime]]] = defaultdict(dict)
        self._lock = asyncio.Lock()
        self._cleanup_task = None

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path in self.EXCLUDED_PATHS:
            return await call_next(request)

        client_ip = self._get_client_ip(request)

        if path.startswith("/admin/"):
            endpoint_type = "admin"
            limit = self.ADMIN_LIMIT
        else:
            endpoint_type = "public"
            limit = self.PUBLIC_LIMIT
        
        is_allowed, retry_after = await self._check_rate_limit(client_ip, endpoint_type, limit)
        
        if not is_allowed:
            logger.warning(f"Rate limit exceeded for IP {client_ip} on {endpoint_type} endpoint: {path}")
            return JSONResponse(
                status_code=429,
                content={
                    "error": "rate_limit_exceeded",
                    "message": f"Rate limit of {limit} requests per minute exceeded"
                },
                headers={"Retry-After": str(retry_after)}
            )

        return await call_next(request)

    def _get_client_ip(self, request: Request) -> str:
        """Checks X-Forwarded-For first (proxies/load balancers), then direct client IP."""
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()

        if request.client:
            return request.client.host

        return "unknown"

    async def _check_rate_limit(self, ip: str, endpoint_type: str, limit: int) -> Tuple[bool, int]:
        async with self._lock:
            now = datetime.utcnow()
            window_start = now - timedelta(seconds=60)
            
            if endpoint_type in self._store[ip]:
                count, tracked_window_start = self._store[ip][endpoint_type]

                if tracked_window_start > window_start:
                    if count >= limit:
                        retry_after = int((tracked_window_start + timedelta(seconds=60) - now).total_seconds())
                        return False, max(retry_after, 1)

                    self._store[ip][endpoint_type] = (count + 1, tracked_window_start)
                    return True, 0
                else:
                    self._store[ip][endpoint_type] = (1, now)
                    return True, 0
            else:
                self._store[ip][endpoint_type] = (1, now)
                return True, 0

    async def cleanup_old_entries(self):
        """Removes entries older than 2 minutes to prevent memory leaks."""
        async with self._lock:
            now = datetime.utcnow()
            cutoff = now - timedelta(seconds=120)

            ips_to_remove = []
            for ip, endpoint_data in self._store.items():
                all_old = True
                for endpoint_type, (count, window_start) in endpoint_data.items():
                    if window_start > cutoff:
                        all_old = False
                        break
                
                if all_old:
                    ips_to_remove.append(ip)
            
            for ip in ips_to_remove:
                del self._store[ip]
            
            if ips_to_remove:
                logger.debug(f"Cleaned up {len(ips_to_remove)} old rate limit entries")
