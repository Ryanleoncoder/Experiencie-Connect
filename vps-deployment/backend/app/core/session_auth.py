"""Session-token validation for frontend-to-VPS requests."""

from fastapi import Cookie, Header, HTTPException, status
from jose import JWTError, jwt
from datetime import datetime, timezone

from app.core.config import settings
from app.db.supabase_client import supabase_client

SESSION_COOKIE = "cx_session"


def _candidate_tokens(authorization: str | None, cx_session: str | None) -> list[str]:
    # Cookie primeiro (fonte canonica da sessao). O Bearer entra como fallback
    # para nao quebrar clientes legados, mas um Bearer velho/invalido NAO deve
    # bloquear um cookie valido.
    candidates: list[str] = []
    if cx_session:
        candidates.append(cx_session)
    if authorization:
        scheme, _, bearer = authorization.partition(" ")
        if scheme.lower() == "bearer" and bearer:
            candidates.append(bearer)
    return candidates


def _decode_session(token: str) -> dict | None:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer="cx-game",
            audience="cxgame-vps",
        )
    except JWTError:
        return None

    if payload.get("typ") != "cx_session" or not payload.get("sub"):
        return None

    return payload


async def require_session_user(
    authorization: str | None = Header(default=None),
    cx_session: str | None = Cookie(default=None),
) -> dict:
    candidates = _candidate_tokens(authorization, cx_session)
    if not candidates:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token ausente")

    for token in candidates:
        payload = _decode_session(token)
        if payload is not None and await _session_is_active(payload):
            return payload

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido")


async def _session_is_active(payload: dict) -> bool:
    """Make the signed cookie revocable and bind it to the current auth version.

    A passkey credential may be revoked by an administrator while a JWT is
    still within its four-day event lifetime, so cryptographic verification by
    itself is intentionally insufficient.
    """
    session_id = payload.get("jti")
    auth_version = payload.get("sv")
    if not session_id or not payload.get("sub") or not isinstance(auth_version, int):
        return False
    try:
        session_result = supabase_client.table("auth_sessions").select(
            "id,user_id,auth_version,expires_at,revoked_at"
        ).eq("id", session_id).eq("user_id", payload["sub"]).is_("revoked_at", "null").gt(
            "expires_at", datetime.now(timezone.utc).isoformat()
        ).limit(1).execute()
        sessions = session_result.data or []
        if not sessions or int(sessions[0].get("auth_version") or 0) != auth_version:
            return False
        user_result = supabase_client.table("usuarios").select("id,banned,auth_version").eq(
            "id", payload["sub"]
        ).limit(1).execute()
        users = user_result.data or []
        return bool(users and not users[0].get("banned") and int(users[0].get("auth_version") or 0) == auth_version)
    except Exception:
        # Fail closed: accepting a session while the revocation store is down
        # would turn an operational failure into an authorization bypass.
        return False
