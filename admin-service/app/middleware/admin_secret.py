"""Admin secret authentication middleware."""

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class AdminSecretMiddleware(BaseHTTPMiddleware):
    """Middleware for validating admin secret on /admin/* endpoints."""
    
    def __init__(self, app):
        super().__init__(app)
        self.admin_secret = settings.ADMIN_SECRET
    
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/admin"):
            return await call_next(request)
        
        admin_secret = request.headers.get("X-Admin-Secret")
        
        if not admin_secret:
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(
                f"Unauthorized admin access attempt - Missing X-Admin-Secret header | "
                f"Path: {request.url.path} | IP: {client_ip}"
            )
            raise HTTPException(
                status_code=401,
                detail="Missing X-Admin-Secret header"
            )
        
        if admin_secret != self.admin_secret:
            client_ip = request.client.host if request.client else "unknown"
            logger.warning(
                f"Unauthorized admin access attempt - Invalid X-Admin-Secret | "
                f"Path: {request.url.path} | IP: {client_ip}"
            )
            raise HTTPException(
                status_code=401,
                detail="Invalid admin secret"
            )

        return await call_next(request)
