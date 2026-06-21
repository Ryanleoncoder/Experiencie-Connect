"""Session-token validation for frontend-to-VPS requests."""

from fastapi import Cookie, Header, HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings

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
        if payload is not None:
            return payload

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido")
