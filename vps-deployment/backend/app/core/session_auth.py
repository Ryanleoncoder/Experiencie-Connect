"""Session-token validation for frontend-to-VPS requests."""

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token ausente")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token invalido")

    return token


async def require_session_user(authorization: str | None = Header(default=None)) -> dict:
    token = _extract_bearer_token(authorization)

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
