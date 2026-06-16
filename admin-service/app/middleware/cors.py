"""Custom CORS middleware with origin validation."""

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import logging

logger = logging.getLogger(__name__)


class CORSMiddleware(BaseHTTPMiddleware):
    """
    Custom CORS middleware with strict origin validation.
    
    Validates Origin header against allowed domains and returns 403 for unauthorized origins.
    Handles preflight OPTIONS requests correctly.
    """
    
    def __init__(self, app):
        super().__init__(app)
        self.allow_credentials = True
        self.allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
        self.allow_headers = ["*"]
        self.max_age = 600  # 10 minutes
    
    def _get_allowed_origins(self):
        """Get allowed origins from settings (allows for dynamic configuration)."""
        from app.core.config import settings
        return settings.allowed_origins_list
    
    def _is_origin_allowed(self, origin: str) -> bool:
        """Check if origin is in the allowed list."""
        if not origin:
            return False
        
        allowed_origins = self._get_allowed_origins()
        
        if origin in allowed_origins:
            return True
        
        for allowed in allowed_origins:
            if allowed == "*":
                return True
            if allowed.startswith("*."):
                domain_suffix = allowed[1:]
                if origin.endswith(domain_suffix):
                    return True
        
        return False
    
    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("Origin")

        if request.method == "OPTIONS":
            if not origin:
                logger.warning(
                    f"CORS preflight rejected - Missing Origin header | "
                    f"Path: {request.url.path} | IP: {request.client.host if request.client else 'unknown'}"
                )
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Missing Origin header"}
                )

            if not self._is_origin_allowed(origin):
                logger.warning(
                    f"CORS preflight rejected - Unauthorized origin | "
                    f"Origin: {origin} | Path: {request.url.path} | "
                    f"IP: {request.client.host if request.client else 'unknown'}"
                )
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Origin not allowed"}
                )

            return Response(
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": origin,
                    "Access-Control-Allow-Methods": ", ".join(self.allow_methods),
                    "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers", "*"),
                    "Access-Control-Allow-Credentials": "true" if self.allow_credentials else "false",
                    "Access-Control-Max-Age": str(self.max_age),
                }
            )

        if origin:
            if not self._is_origin_allowed(origin):
                logger.warning(
                    f"CORS request rejected - Unauthorized origin | "
                    f"Origin: {origin} | Method: {request.method} | Path: {request.url.path} | "
                    f"IP: {request.client.host if request.client else 'unknown'}"
                )
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Origin not allowed"}
                )

        response = await call_next(request)

        if origin and self._is_origin_allowed(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true" if self.allow_credentials else "false"
            response.headers["Access-Control-Expose-Headers"] = "*"
        
        return response

