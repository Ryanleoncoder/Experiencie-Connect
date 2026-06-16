"""Internal service API.

Endpoints consumed by the Vercel serverless layer instead of connecting to
Redis directly. This lets the Redis port stay closed to the internet: Vercel
talks to this authenticated API, and the API talks to local Redis.

Auth: shared service secret in the ``X-Internal-Secret`` header
(``settings.INTERNAL_API_SECRET``). These endpoints run pre-authentication
(rate limiting, login throttling), so they cannot use a user session token.

The Redis key names and algorithms mirror the previous Vercel middlewares
(``redis-rate-limiter.js`` / ``redis-login-attempts.js``) exactly, so the
direct-Redis path and the API path are fully interchangeable during migration.
"""

from __future__ import annotations

import math
import secrets as _secrets
import time

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.db.redis_client import redis_client

router = APIRouter()

MAX_LOGIN_ATTEMPTS = 5
LOGIN_BLOCK_SECONDS = 600  # 10 minutes
LOGIN_ATTEMPT_WINDOW_SECONDS = 600  # 10 minutes


def require_internal_secret(x_internal_secret: str = Header(default="")) -> bool:
    """Constant-time check of the shared service secret. Fail closed."""
    expected = settings.INTERNAL_API_SECRET or ""
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Internal API not configured",
        )
    provided = x_internal_secret or ""
    if not _secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
    return True


def _redis():
    if not redis_client.is_available() or redis_client.redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis unavailable",
        )
    return redis_client.redis


def _now_ms() -> int:
    return int(time.time() * 1000)

class RateLimitRequest(BaseModel):
    key: str = Field(min_length=1, max_length=256)
    max_requests: int = Field(gt=0, le=100000)
    window_seconds: int = Field(gt=0, le=86400)


@router.post("/ratelimit/check", dependencies=[Depends(require_internal_secret)])
async def ratelimit_check(body: RateLimitRequest):
    r = _redis()
    now = _now_ms()
    window_ms = body.window_seconds * 1000
    window_start = now - window_ms
    rkey = f"ratelimit:{body.key}"

    await r.zremrangebyscore(rkey, 0, window_start)
    count = await r.zcard(rkey)

    if count >= body.max_requests:
        oldest = await r.zrange(rkey, 0, 0, withscores=True)
        if oldest:
            oldest_ts = float(oldest[0][1])
            retry_after = math.ceil((oldest_ts + window_ms - now) / 1000)
            return {"allowed": False, "retry_after": max(1, retry_after)}
        return {"allowed": False, "retry_after": body.window_seconds}

    await r.zadd(rkey, {f"{now}-{_secrets.token_hex(6)}": now})
    await r.expire(rkey, body.window_seconds)
    return {"allowed": True}


class IdentifierRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=256)


@router.post("/login-attempts/check", dependencies=[Depends(require_internal_secret)])
async def login_attempts_check(body: IdentifierRequest):
    r = _redis()
    block_key = f"login:block:{body.identifier}"
    attempts_key = f"login:attempts:{body.identifier}"

    blocked_until = await r.get(block_key)
    if blocked_until:
        now = _now_ms()
        blocked_until_ms = int(blocked_until)
        if blocked_until_ms > now:
            return {"blocked": True, "retry_after": math.ceil((blocked_until_ms - now) / 1000)}
        await r.delete(block_key)
        await r.delete(attempts_key)

    return {"blocked": False}


@router.post("/login-attempts/increment", dependencies=[Depends(require_internal_secret)])
async def login_attempts_increment(body: IdentifierRequest):
    r = _redis()
    attempts_key = f"login:attempts:{body.identifier}"
    block_key = f"login:block:{body.identifier}"

    attempts = await r.incr(attempts_key)
    if attempts == 1:
        await r.expire(attempts_key, LOGIN_ATTEMPT_WINDOW_SECONDS)

    if attempts >= MAX_LOGIN_ATTEMPTS:
        blocked_until = _now_ms() + LOGIN_BLOCK_SECONDS * 1000
        await r.set(block_key, str(blocked_until), ex=LOGIN_BLOCK_SECONDS)
        return {"blocked": True, "attempts_left": 0}

    return {"blocked": False, "attempts_left": MAX_LOGIN_ATTEMPTS - attempts}


@router.post("/login-attempts/clear", dependencies=[Depends(require_internal_secret)])
async def login_attempts_clear(body: IdentifierRequest):
    # Non-critical: tolerate Redis being unavailable.
    if not redis_client.is_available() or redis_client.redis is None:
        return {"cleared": False}
    r = redis_client.redis
    await r.delete(f"login:attempts:{body.identifier}")
    await r.delete(f"login:block:{body.identifier}")
    return {"cleared": True}
