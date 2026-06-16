import os
import time
from functools import lru_cache
from typing import Dict, Optional

import requests
from fastapi import Depends, FastAPI, Header, HTTPException, status
from jose import jwt
from jose.utils import base64url_decode

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")

if not SUPABASE_URL:
    raise RuntimeError("SUPABASE_URL não definido. Configure SUPABASE_URL no .env.")

JWKS_URL = f"{SUPABASE_URL}/auth/v1/keys"

app = FastAPI(title="Experience Connect API", version="0.1.0")


@lru_cache(maxsize=1)
def _load_jwks() -> Dict:
    resp = requests.get(JWKS_URL, timeout=5)
    resp.raise_for_status()
    return resp.json()


def _get_signing_key(kid: str) -> Optional[Dict]:
    jwks = _load_jwks()
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def verify_supabase_jwt(token: str) -> Dict:
    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cabeçalho JWT inválido.",
        )

    kid = unverified_header.get("kid")
    alg = unverified_header.get("alg")
    key = _get_signing_key(kid) if kid else None

    if not key:
        # fallback para segredo simples se fornecido
        if SUPABASE_JWT_SECRET:
            key = SUPABASE_JWT_SECRET
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Chave de assinatura não encontrada.",
            )

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[alg] if isinstance(key, dict) else [alg or "HS256"],
            audience=None,
            options={"verify_aud": False},
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado.",
        )

    return payload


def get_current_user(authorization: str = Header(None)) -> Dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token não fornecido.",
        )
    token = authorization.split(" ", 1)[1]
    return verify_supabase_jwt(token)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "time": int(time.time()),
    }


@app.get("/api/me")
def me(user: Dict = Depends(get_current_user)):
    return {
        "sub": user.get("sub"),
        "email": user.get("email"),
        "role": user.get("role"),
        "app_metadata": user.get("app_metadata", {}),
        "user_metadata": user.get("user_metadata", {}),
    }


@app.get("/api/secure-data")
def secure_data(user: Dict = Depends(get_current_user)):
    return {"message": "Conteúdo protegido", "user": user.get("email")}
