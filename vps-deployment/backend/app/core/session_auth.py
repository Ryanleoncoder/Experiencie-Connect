"""Session-token validation for frontend-to-VPS requests."""

from fastapi import Cookie, Header, HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings

SESSION_COOKIE = "cx_session"


def _resolve_token(authorization: str | None, cx_session: str | None) -> str:
    
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido")
        return token

    if cx_session:
        return cx_session

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token ausente")


async def require_session_user(
    authorization: str | None = Header(default=None),
    cx_session: str | None = Cookie(default=None),
) -> dict:
    token = _resolve_token(authorization, cx_session)

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
            issuer="cx-game",
            audience="cxgame-vps",
        )
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido") from exc

    if payload.get("typ") != "cx_session" or not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido")

    return payload
