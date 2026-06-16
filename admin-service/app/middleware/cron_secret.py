"""Cron secret authentication middleware."""

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class CronSecretMiddleware(BaseHTTPMiddleware):
    """Middleware for validating cron secret on /internal/cron/* endpoints."""
    
    def __init__(self, app):
        super().__init__(app)
        self.cron_secret = settings.CRON_SECRET
    
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/internal/cron"):
            return await call_next(request)
        
        cron_secret = request.headers.get("X-Cron-Secret")
        
        client_ip = request.client.host if request.client else "unknown"
        
        if not cron_secret:
            logger.warning(
                f"Unauthorized cron access attempt - Missing X-Cron-Secret header | "
                f"Path: {request.url.path} | IP: {client_ip}"
            )
            raise HTTPException(
                status_code=401,
                detail="Missing X-Cron-Secret header"
            )
        
        if cron_secret != self.cron_secret:
            logger.warning(
                f"Unauthorized cron access attempt - Invalid X-Cron-Secret | "
                f"Path: {request.url.path} | IP: {client_ip}"
            )
            raise HTTPException(
                status_code=401,
                detail="Invalid cron secret"
            )

        return await call_next(request)
