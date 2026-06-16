"""
Main FastAPI application entry point for BFF API Central
"""
from fastapi import FastAPI
from contextlib import asynccontextmanager
import asyncio

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.db.connections import connection_manager

logger = get_logger(__name__)

# Global reference to rate limit middleware for cleanup task
_rate_limit_middleware = None


async def cleanup_rate_limits_task():
    """Background task to cleanup old rate limit entries every 5 minutes."""
    while True:
        try:
            await asyncio.sleep(300)  # 5 minutes
            if _rate_limit_middleware:
                await _rate_limit_middleware.cleanup_old_entries()
        except asyncio.CancelledError:
            logger.info("Rate limit cleanup task cancelled")
            break
        except Exception as e:
            logger.error(f"Error in rate limit cleanup task: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager
    Handles startup and shutdown events
    """
    # Startup
    setup_logging(
        log_level=settings.LOG_LEVEL,
        log_format=settings.LOG_FORMAT,
        log_file=settings.LOG_FILE
    )
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    
    await connection_manager.initialize_all()
    
    # Start rate limit cleanup background task
    cleanup_task = asyncio.create_task(cleanup_rate_limits_task())
    logger.info("Started rate limit cleanup background task")
    
    yield
    
    # Shutdown
    logger.info("Shutting down application")
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    await connection_manager.close_all()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend For Frontend API for Experience Connect",
    lifespan=lifespan
)

# CORS Middleware - Custom implementation with origin validation
from app.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware)

# Admin Secret Middleware - protects /admin/* endpoints
from app.middleware.admin_secret import AdminSecretMiddleware
app.add_middleware(AdminSecretMiddleware)

# Cron Secret Middleware - protects /internal/cron/* endpoints
from app.middleware.cron_secret import CronSecretMiddleware
app.add_middleware(CronSecretMiddleware)

# Rate Limit Middleware - IP-based rate limiting
from app.middleware.rate_limit import RateLimitMiddleware
_rate_limit_middleware = RateLimitMiddleware(app)
app.add_middleware(RateLimitMiddleware)

# Health check router (already implemented)
from app.api import health
app.include_router(health.router, tags=["Health"])

# Cron router - protected by CronSecretMiddleware
from app.api import cron
app.include_router(cron.router, prefix="/internal/cron", tags=["Cron"])

# Ranking router - public endpoints
from app.api import ranking
app.include_router(ranking.router, prefix="/ranking", tags=["Ranking"])

# Admin router - protected by AdminSecretMiddleware
from app.api import admin
app.include_router(admin.router, prefix="/admin", tags=["Admin"])

# Reports router - protected by AdminSecretMiddleware
from app.api import reports
app.include_router(reports.router, prefix="/reports", tags=["Reports"])


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "environment": settings.ENVIRONMENT
    }

