"""Passwordless WebAuthn authentication for Experience Connect.

Only public WebAuthn credential material is persisted. Link/code validation,
activation and ceremony state are opaque, short lived, one-time Redis records.
The link by itself is never a login token.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from jose import jwt
from pydantic import BaseModel, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import settings
from app.core.session_auth import require_session_user
from app.db.redis_client import redis_client
from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)
router = APIRouter()

ACTIVATION_COOKIE = "cx_activation"
REAUTH_COOKIE = "cx_passkey_reauth"
SESSION_COOKIE = "cx_session"
AUTH_FLAG_COOKIE = "cx_auth"

TAKE_STATE_SCRIPT = """
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
"""

AVATARS = {
    "m3345.webp", "m4245.webp", "m4523.webp", "m5353.webp", "m5354.webp",
    "m5367.webp", "m5444.webp", "m6345.webp", "m6735.webp", "h3535.webp",
    "h4234.webp", "h4244.webp", "h45234.webp", "h5234.webp", "h52344.webp",
    "h5345.webp", "h53534.webp", "h5354.webp", "h5355.webp", "h5635.webp",
    "h7545.webp", "h8724.webp",
}
CODE_RE = re.compile(r"^EC-[A-F0-9]{4}-[A-F0-9]{5}-[A-F0-9]{5}$")
CREDENTIAL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,1024}$")


class ActivationRequest(BaseModel):
    token: str = Field(min_length=64, max_length=128)
    code: str = Field(min_length=10, max_length=32)


class RegistrationOptionsRequest(BaseModel):
    avatar_file_name: str | None = Field(default=None, max_length=100)


class RegistrationVerifyRequest(BaseModel):
    credential: dict[str, Any]
    friendly_name: str | None = Field(default=None, max_length=80)


class AuthenticationVerifyRequest(BaseModel):
    credential: dict[str, Any]


def _redis():
    if not redis_client.is_available() or redis_client.redis is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Authentication temporarily unavailable")
    return redis_client.redis


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return (forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else "unknown"))[:100]


async def _rate_limit(request: Request, action: str, maximum: int, seconds: int) -> None:
    """Fixed-window limit. Redis is required for WebAuthn ceremonies anyway."""
    r = _redis()
    key = f"passkey:rate:{action}:{_hash(_client_ip(request))}"
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, seconds)
    if count > maximum:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Try again later")


async def _put_state(prefix: str, payload: dict[str, Any], ttl: int) -> str:
    state_id = secrets.token_urlsafe(32)
    await _redis().setex(f"passkey:{prefix}:{state_id}", ttl, json.dumps(payload))
    return state_id


async def _take_state(prefix: str, state_id: str | None) -> dict[str, Any]:
    if not state_id or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", state_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Activation expired")
    key = f"passkey:{prefix}:{state_id}"
    value = await _redis().eval(TAKE_STATE_SCRIPT, 1, key)
    if not value:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This step expired. Start again.")
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:  # corruption must fail closed
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This step expired. Start again.") from exc


async def _read_state(prefix: str, state_id: str | None) -> dict[str, Any]:
    if not state_id or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", state_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Activation expired")
    value = await _redis().get(f"passkey:{prefix}:{state_id}")
    if not value:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This step expired. Start again.")
    try:
        return json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This step expired. Start again.") from exc


def _set_cookie(response: Response, name: str, value: str, *, max_age: int, http_only: bool = True) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        secure=True,
        httponly=http_only,
        samesite="lax",
        domain=settings.CXGAME_COOKIE_DOMAIN or None,
        path="/",
    )


def _clear_cookie(response: Response, name: str, *, http_only: bool = True) -> None:
    response.delete_cookie(
        name,
        domain=settings.CXGAME_COOKIE_DOMAIN or None,
        path="/",
        secure=True,
        httponly=http_only,
        samesite="lax",
    )


def _session_token(user: dict[str, Any], session_id: str) -> tuple[str, datetime]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=settings.WEBAUTHN_SESSION_SECONDS)
    token = jwt.encode(
        {
            "sub": str(user["id"]),
            "nickname": user.get("nickname"),
            "typ": "cx_session",
            "jti": session_id,
            "sv": int(user.get("auth_version") or 1),
            "iat": int(now.timestamp()),
            "exp": int(expires.timestamp()),
            "iss": "cx-game",
            "aud": "cxgame-vps",
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, expires


async def _issue_session(response: Response, user: dict[str, Any], credential_uuid: str) -> None:
    session_id = str(uuid.uuid4())
    token, expires = _session_token(user, session_id)
    supabase_client.table("auth_sessions").insert({
        "id": session_id,
        "user_id": user["id"],
        "credential_id": credential_uuid,
        "auth_version": int(user.get("auth_version") or 1),
        "expires_at": expires.isoformat(),
    }).execute()
    _set_cookie(response, SESSION_COOKIE, token, max_age=settings.WEBAUTHN_SESSION_SECONDS)
    _set_cookie(response, AUTH_FLAG_COOKIE, "1", max_age=settings.WEBAUTHN_SESSION_SECONDS, http_only=False)


async def _user(user_id: str) -> dict[str, Any]:
    result = supabase_client.table("usuarios").select(
        "id,nickname,avatar_file_name,banned,auth_version"
    ).eq("id", user_id).limit(1).execute()
    rows = result.data or []
    if not rows or rows[0].get("banned"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account unavailable")
    return rows[0]


async def _active_credentials(user_id: str) -> list[dict[str, Any]]:
    result = supabase_client.table("passkey_credentials").select("id,credential_id").eq(
        "user_id", user_id
    ).is_("revoked_at", "null").execute()
    return result.data or []


def _credential_descriptors(credentials: list[dict[str, Any]]) -> list[PublicKeyCredentialDescriptor]:
    descriptors: list[PublicKeyCredentialDescriptor] = []
    for credential in credentials:
        try:
            descriptors.append(PublicKeyCredentialDescriptor(id=base64url_to_bytes(credential["credential_id"])))
        except Exception:
            logger.warning("Ignoring malformed stored WebAuthn credential %s", credential.get("id"))
    return descriptors


def _public_options(options: Any) -> dict[str, Any]:
    return json.loads(options_to_json(options))


async def _registration_options(subject: dict[str, Any], *, avatar: str | None = None) -> dict[str, Any]:
    user_id = subject["user_id"]
    credentials = await _active_credentials(user_id)
    challenge = secrets.token_bytes(32)
    options = generate_registration_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=uuid.UUID(user_id).bytes,
        user_name=subject["nickname"],
        user_display_name=subject["nickname"],
        challenge=challenge,
        timeout=settings.WEBAUTHN_CHALLENGE_SECONDS * 1000,
        exclude_credentials=_credential_descriptors(credentials),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    challenge_id = await _put_state("registration", {
        **subject,
        "avatar_file_name": avatar,
        "challenge": bytes_to_base64url(challenge),
    }, settings.WEBAUTHN_CHALLENGE_SECONDS)
    return {"challenge_id": challenge_id, "public_key": _public_options(options)}


def _safe_transports(credential: dict[str, Any]) -> list[str]:
    transports = credential.get("response", {}).get("transports") or []
    allowed = {"ble", "hybrid", "internal", "nfc", "usb"}
    return [value for value in transports if isinstance(value, str) and value in allowed][:5]


async def _verify_registration(state: dict[str, Any], credential: dict[str, Any], friendly_name: str | None) -> tuple[dict[str, Any], str]:
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(state["challenge"]),
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=settings.webauthn_origins_list,
            require_user_verification=True,
        )
    except (InvalidRegistrationResponse, ValueError, KeyError, TypeError) as exc:
        logger.info("Rejected WebAuthn registration: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passkey verification failed") from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    payload = {
        "user_id": state["user_id"],
        "credential_id": credential_id,
        "public_key": bytes_to_base64url(verified.credential_public_key),
        "sign_count": max(verified.sign_count, 0),
        "transports": _safe_transports(credential),
        "aaguid": verified.aaguid,
        "backup_eligible": verified.credential_device_type.value == "multi_device",
        "backup_state": bool(verified.credential_backed_up),
        "friendly_name": (friendly_name or "Passkey").strip()[:80] or "Passkey",
    }
    return payload, credential_id


@router.post("/activation/verify")
async def verify_activation(request: Request, body: ActivationRequest, response: Response):
    """Validate the two independent pieces sent in the invite email."""
    await _rate_limit(request, "activation", 10, 10 * 60)
    token = body.token.strip().lower()
    code = body.code.strip().upper()
    if not re.fullmatch(r"[a-f0-9]{64}", token) or not CODE_RE.fullmatch(code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid activation data")
    try:
        result = await supabase_client.call_rpc("verify_passkey_grant", {
            "p_token_hash": _hash(token), "p_code_hash": _hash(code),
        })
    except Exception as exc:
        logger.info("Rejected activation grant: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Activation link or code is invalid") from exc

    grant = result[0] if isinstance(result, list) else result
    if not grant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Activation link or code is invalid")
    user_id = str(grant.get("target_user_id") or grant.get("pending_user_id"))
    activation_id = await _put_state("activation", {
        "grant_id": str(grant["grant_id"]),
        "grant_type": grant["grant_type"],
        "user_id": user_id,
        "nickname": grant["nickname"],
    }, settings.WEBAUTHN_ACTIVATION_SECONDS)
    _set_cookie(response, ACTIVATION_COOKIE, activation_id, max_age=settings.WEBAUTHN_ACTIVATION_SECONDS)
    return {
        "ok": True,
        "account_exists": grant["grant_type"] in {"MIGRATION", "RECOVERY"},
        "nickname": grant["nickname"],
        "activation_expires_in": settings.WEBAUTHN_ACTIVATION_SECONDS,
    }


@router.post("/passkeys/register/options")
async def register_options(
    body: RegistrationOptionsRequest,
    request: Request,
    cx_activation: str | None = Cookie(default=None),
    cx_passkey_reauth: str | None = Cookie(default=None),
):
    """Begin registration from activation/recovery or from fresh re-authentication."""
    await _rate_limit(request, "registration-options", 20, 10 * 60)
    if cx_activation:
        activation = await _read_state("activation", cx_activation)
        avatar = body.avatar_file_name.strip() if body.avatar_file_name else None
        if activation["grant_type"] == "INVITE":
            if avatar not in AVATARS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a valid character")
        else:
            avatar = None  # Existing accounts must never be asked to choose again.
        return await _registration_options({
            "mode": "activation", "activation_id": cx_activation,
            "grant_id": activation["grant_id"], "grant_type": activation["grant_type"],
            "user_id": activation["user_id"], "nickname": activation["nickname"],
        }, avatar=avatar)

    reauth = await _read_state("reauth", cx_passkey_reauth)
    return await _registration_options({
        "mode": "add", "reauth_id": cx_passkey_reauth,
        "user_id": reauth["user_id"], "nickname": reauth["nickname"],
    })


@router.post("/passkeys/register/verify")
async def register_verify(
    request: Request,
    body: RegistrationVerifyRequest,
    response: Response,
    cx_activation: str | None = Cookie(default=None),
    cx_passkey_reauth: str | None = Cookie(default=None),
):
    # The server gives the state id as a header-like field in the client request;
    # it is not an authenticator value and is removed before WebAuthn validation.
    await _rate_limit(request, "registration-verify", 20, 10 * 60)
    state_id = body.credential.pop("_challenge_id", None)
    state = await _take_state("registration", state_id)
    if state.get("mode") == "activation":
        if not cx_activation or state.get("activation_id") != cx_activation:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Activation expired")
        await _read_state("activation", cx_activation)
    elif state.get("mode") == "add":
        if not cx_passkey_reauth or state.get("reauth_id") != cx_passkey_reauth:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Fresh passkey confirmation required")
        await _read_state("reauth", cx_passkey_reauth)
    else:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Registration expired")

    stored, _ = await _verify_registration(state, body.credential, body.friendly_name)
    try:
        if state["mode"] == "activation":
            result = await supabase_client.call_rpc("complete_passkey_onboarding", {
                "p_grant_id": state["grant_id"],
                "p_credential_id": stored["credential_id"],
                "p_public_key": stored["public_key"],
                "p_sign_count": stored["sign_count"],
                "p_transports": stored["transports"],
                "p_aaguid": stored["aaguid"],
                "p_backup_eligible": stored["backup_eligible"],
                "p_backup_state": stored["backup_state"],
                "p_friendly_name": stored["friendly_name"],
                "p_avatar_file_name": state.get("avatar_file_name"),
            })
            complete = result[0] if isinstance(result, list) else result
            credential_uuid = str(complete["credential_id"])
            await redis_client.delete(f"passkey:activation:{cx_activation}")
            _clear_cookie(response, ACTIVATION_COOKIE)
        else:
            inserted = supabase_client.table("passkey_credentials").insert(stored).execute().data
            credential_uuid = str(inserted[0]["id"])
            supabase_client.table("passkey_security_events").insert({
                "user_id": state["user_id"], "credential_id": credential_uuid,
                "event_type": "PASSKEY_REGISTERED",
                "metadata": {"source": "fresh_reauthentication"},
            }).execute()
            await redis_client.delete(f"passkey:reauth:{cx_passkey_reauth}")
            _clear_cookie(response, REAUTH_COOKIE)
    except Exception as exc:
        logger.exception("Could not persist verified WebAuthn registration")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This passkey could not be added") from exc

    user = await _user(state["user_id"])
    if state["mode"] == "activation":
        await _issue_session(response, user, credential_uuid)
    return {"ok": True, "user": {"id": user["id"], "nickname": user["nickname"], "avatar_file_name": user.get("avatar_file_name")}}


@router.post("/passkeys/login/options")
async def login_options(request: Request):
    await _rate_limit(request, "login-options", 30, 10 * 60)
    challenge = secrets.token_bytes(32)
    options = generate_authentication_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        challenge=challenge,
        timeout=settings.WEBAUTHN_CHALLENGE_SECONDS * 1000,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge_id = await _put_state("authentication", {
        "purpose": "login", "challenge": bytes_to_base64url(challenge),
    }, settings.WEBAUTHN_CHALLENGE_SECONDS)
    return {"challenge_id": challenge_id, "public_key": _public_options(options)}


async def _credential_for_assertion(credential: dict[str, Any]) -> dict[str, Any]:
    credential_id = str(credential.get("id") or "")
    if not CREDENTIAL_ID_RE.fullmatch(credential_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid passkey")
    result = supabase_client.table("passkey_credentials").select(
        "id,user_id,credential_id,public_key,sign_count"
    ).eq("credential_id", credential_id).is_("revoked_at", "null").limit(1).execute()
    rows = result.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey not recognized")
    return rows[0]


async def _verify_assertion(state: dict[str, Any], credential: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    stored = await _credential_for_assertion(credential)
    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(state["challenge"]),
            expected_rp_id=settings.WEBAUTHN_RP_ID,
            expected_origin=settings.webauthn_origins_list,
            credential_public_key=base64url_to_bytes(stored["public_key"]),
            credential_current_sign_count=int(stored.get("sign_count") or 0),
            require_user_verification=True,
        )
    except (InvalidAuthenticationResponse, ValueError, KeyError, TypeError) as exc:
        logger.info("Rejected WebAuthn assertion: %s", exc)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Passkey verification failed") from exc
    supabase_client.table("passkey_credentials").update({
        "sign_count": max(int(stored.get("sign_count") or 0), verified.new_sign_count),
        "last_used_at": datetime.now(timezone.utc).isoformat(),
        "backup_state": bool(verified.credential_backed_up),
    }).eq("id", stored["id"]).execute()
    return stored, await _user(stored["user_id"])


@router.post("/passkeys/login/verify")
async def login_verify(request: Request, body: AuthenticationVerifyRequest, response: Response):
    await _rate_limit(request, "login-verify", 30, 10 * 60)
    state_id = body.credential.pop("_challenge_id", None)
    state = await _take_state("authentication", state_id)
    if state.get("purpose") != "login":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid authentication ceremony")
    stored, user = await _verify_assertion(state, body.credential)
    await _issue_session(response, user, str(stored["id"]))
    supabase_client.table("passkey_security_events").insert({
        "user_id": user["id"], "credential_id": stored["id"], "event_type": "PASSKEY_AUTHENTICATED",
    }).execute()
    return {"ok": True, "user": {"id": user["id"], "nickname": user["nickname"], "avatar_file_name": user.get("avatar_file_name")}}


@router.post("/passkeys/add/options")
async def add_passkey_options(request: Request, session_user: dict = Depends(require_session_user)):
    """Require an assertion from an already registered passkey before adding one."""
    await _rate_limit(request, "add-options", 20, 10 * 60)
    user = await _user(session_user["sub"])
    credentials = await _active_credentials(user["id"])
    if not credentials:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No active passkey")
    challenge = secrets.token_bytes(32)
    options = generate_authentication_options(
        rp_id=settings.WEBAUTHN_RP_ID,
        challenge=challenge,
        timeout=settings.WEBAUTHN_CHALLENGE_SECONDS * 1000,
        allow_credentials=_credential_descriptors(credentials),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge_id = await _put_state("authentication", {
        "purpose": "add", "user_id": user["id"], "challenge": bytes_to_base64url(challenge),
    }, settings.WEBAUTHN_CHALLENGE_SECONDS)
    return {"challenge_id": challenge_id, "public_key": _public_options(options)}


@router.post("/passkeys/add/verify")
async def add_passkey_verify(
    request: Request,
    body: AuthenticationVerifyRequest,
    response: Response,
    session_user: dict = Depends(require_session_user),
):
    await _rate_limit(request, "add-verify", 20, 10 * 60)
    state_id = body.credential.pop("_challenge_id", None)
    state = await _take_state("authentication", state_id)
    if state.get("purpose") != "add" or state.get("user_id") != session_user.get("sub"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Fresh passkey confirmation required")
    stored, user = await _verify_assertion(state, body.credential)
    if str(user["id"]) != str(session_user["sub"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Passkey belongs to another account")
    reauth_id = await _put_state("reauth", {"user_id": user["id"], "nickname": user["nickname"], "credential_id": stored["id"]}, settings.WEBAUTHN_CHALLENGE_SECONDS)
    _set_cookie(response, REAUTH_COOKIE, reauth_id, max_age=settings.WEBAUTHN_CHALLENGE_SECONDS)
    return {"ok": True, "expires_in": settings.WEBAUTHN_CHALLENGE_SECONDS}
