"""Phase session API.

The frontend requests a phase session from the VPS, then Vercel validates
access/attempts against that opaque session.
"""

from __future__ import annotations

import copy
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.session_auth import require_session_user
from app.db.firebase_client import firebase_client
from app.db.redis_client import redis_client
from app.db.supabase_client import supabase_client
from app.services.phase_service import (
    PHASE_SESSION_TTL_SECONDS,
    PhaseSessionService,
    phase_session_cache_key,
)

logger = logging.getLogger(__name__)

router = APIRouter()
IN_MEMORY_PHASE_CACHE: Dict[str, Dict[str, Any]] = {}


class PhaseSessionRequest(BaseModel):
    season_id: str
    level: int = Field(ge=1, le=3)
    setor: str = "CX"


def get_phase_service() -> PhaseSessionService:
    return PhaseSessionService(secret=settings.JWT_SECRET)


async def cache_json(key: str, value: Dict[str, Any], ttl: int = PHASE_SESSION_TTL_SECONDS) -> None:
    IN_MEMORY_PHASE_CACHE[key] = value
    if not redis_client.is_available():
        return

    try:
        await redis_client.set_json(key, value, ttl=ttl)
    except Exception as exc:
        logger.warning("Failed to cache phase session payload: %s", exc)


async def get_cached_json(key: str) -> Optional[Dict[str, Any]]:
    if key in IN_MEMORY_PHASE_CACHE:
        return IN_MEMORY_PHASE_CACHE[key]
    if not redis_client.is_available():
        return None

    try:
        return await redis_client.get_json(key)
    except Exception as exc:
        logger.warning("Failed to read phase session payload: %s", exc)
        return None


async def cache_intermission_payloads(phase_session: Dict[str, Any]) -> None:
    for node in phase_session.get("nodes", []):
        if node.get("type") != "game":
            continue

        session_id = node.get("session_id")
        session_payload = node.get("_session_payload")
        if session_id and isinstance(session_payload, dict):
            await cache_json(
                f"intermission:session:{session_id}:payload",
                session_payload,
                ttl=PHASE_SESSION_TTL_SECONDS,
            )


async def cache_phase_session(phase_session: Dict[str, Any], service: PhaseSessionService) -> None:
    phase_session_id = phase_session["phase_session_id"]
    await cache_json(
        phase_session_cache_key(phase_session_id),
        phase_session,
        ttl=PHASE_SESSION_TTL_SECONDS,
    )
    await cache_json(
        f"phase:user:{phase_session['user_id']}:{phase_session['season_id']}:{phase_session['setor']}:{phase_session['level']}",
        {"phase_session_id": phase_session_id},
        ttl=PHASE_SESSION_TTL_SECONDS,
    )
    await cache_json(
        f"intermission:manifest:{phase_session_id}",
        service.sanitize_phase_session(phase_session),
        ttl=PHASE_SESSION_TTL_SECONDS,
    )
    await cache_intermission_payloads(phase_session)


async def get_persisted_active_phase(user_id: str, season_id: str, level: int) -> Optional[Dict[str, Any]]:
    """Phase active persistida no Supabase (FONTE DE VERDADE da ordem). Retorna o manifest completo ou None."""
    try:
        row = await supabase_client.call_rpc("get_active_phase_session", {
            "p_user_id": user_id,
            "p_season_id": season_id or "default",
            "p_level": level,
        })
    except Exception as exc:
        logger.warning("get_active_phase_session failed: %s", exc)
        return None
    if not isinstance(row, dict):
        return None
    manifest = row.get("manifest_json")
    return manifest if isinstance(manifest, dict) and manifest.get("nodes") else None


async def get_persisted_phase_by_id(phase_session_id: str) -> Optional[Dict[str, Any]]:
    """Fallback por phase_session_id (reidratacao quando o Redis expira/limpa)."""
    try:
        res = (
            supabase_client.table("phase_sessions")
            .select("manifest_json")
            .eq("phase_session_id", phase_session_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        logger.warning("get_persisted_phase_by_id failed: %s", exc)
        return None
    if not rows:
        return None
    manifest = rows[0].get("manifest_json")
    return manifest if isinstance(manifest, dict) and manifest.get("nodes") else None


async def get_phase_generation(user_id: str, season_id: str, level: int) -> str:
    """Read the user's current reset generation used for deterministic phase seeds."""
    try:
        res = (
            supabase_client.table("user_progress")
            .select("phase_generation")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        logger.warning("get_phase_generation failed user_id=%s season_id=%s level=%s: %s", user_id, season_id, level, exc)
        return "legacy"

    if not rows:
        return "legacy"
    generation = rows[0].get("phase_generation")
    return str(generation or "legacy")


async def persist_phase(phase_session: Dict[str, Any], expires_at: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Persiste o manifest autoritativo no Supabase (idempotente/race-safe via RPC).
    Degrada com log (Redis-only) se a RPC ainda nao existir (ex.: migration 36 nao rodada),
    para que a ordem de deploy migration->VPS seja segura mesmo se invertida."""
    try:
        row = await supabase_client.call_rpc("upsert_phase_session", {
            "p_user_id": phase_session["user_id"],
            "p_season_id": phase_session.get("season_id") or "default",
            "p_level": phase_session["level"],
            "p_phase_session_id": phase_session["phase_session_id"],
            "p_phase_seed": (
                phase_session.get("seed")
                or phase_session.get("source_manifest_id")
                or phase_session["phase_session_id"]
            ),
            "p_manifest_json": phase_session,
            "p_expires_at": expires_at,  # NULL em dev: phase nao auto-expira
        })
        if isinstance(row, list) and row:
            row = row[0]
        manifest = row.get("manifest_json") if isinstance(row, dict) else None
        return manifest if isinstance(manifest, dict) and manifest.get("nodes") else phase_session
    except Exception as exc:
        logger.error(
            "[PhaseSession] FALHA ao persistir no Supabase (degradando p/ Redis-only) "
            "phase_session_id=%s: %s", phase_session.get("phase_session_id"), exc,
        )
        return None


def assert_session_owner(phase_session: Dict[str, Any], user_id: str) -> None:
    if phase_session.get("user_id") != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessao de outro usuario")


@router.post("/sessions")
async def create_phase_session(
    payload: PhaseSessionRequest,
    session_user: dict = Depends(require_session_user),
    service: PhaseSessionService = Depends(get_phase_service),
) -> Dict[str, Any]:
    user_id = session_user["sub"]

    # 1. Supabase e a FONTE DE VERDADE: ja existe phase active? reusa (reidrata Redis), mesma ordem.
    persisted = await get_persisted_active_phase(user_id, payload.season_id, payload.level)
    if persisted:
        await cache_phase_session(persisted, service)
        logger.info(
            "[PhaseSession] reused persisted phase_session_id=%s user_id=%s level=%s total_nodes=%s",
            persisted.get("phase_session_id"), user_id, payload.level, persisted.get("total_nodes"),
        )
        return service.sanitize_phase_session(persisted)

    # 2. Nao existe: gera 1x (ancoras fixas) -> persiste no Supabase -> cacheia no Redis.
    level_document = await firebase_client.load_level(
        season_id=payload.season_id,
        setor=payload.setor,
        level=payload.level,
    )
    phase_generation = await get_phase_generation(user_id, payload.season_id, payload.level)
    phase_session = service.build_phase_session(
        user_id=user_id,
        season_id=payload.season_id,
        level=payload.level,
        setor=payload.setor,
        level_document=level_document,
        phase_generation=phase_generation,
    )

    persisted_phase = await persist_phase(phase_session, expires_at=None)  # dev: NULL (phase nao auto-expira)
    active_phase = persisted_phase if isinstance(persisted_phase, dict) and persisted_phase.get("nodes") else phase_session
    await cache_phase_session(active_phase, service)

    logger.info(
        "[PhaseSession] created+persisted phase_session_id=%s user_id=%s season_id=%s setor=%s level=%s generation=%s total_nodes=%s",
        active_phase["phase_session_id"],
        user_id,
        payload.season_id,
        payload.setor,
        payload.level,
        active_phase.get("phase_generation"),
        active_phase.get("total_nodes"),
    )

    return service.sanitize_phase_session(active_phase)


@router.get("/sessions/active")
async def get_active_phase_session_endpoint(
    season_id: str,
    level: int = Query(ge=1, le=3),
    setor: str = "CX",
    session_user: dict = Depends(require_session_user),
    service: PhaseSessionService = Depends(get_phase_service),
):
    """Read-only: retorna a phase ACTIVE persistida (reidrata Redis) SEM criar.
    O app usa isto para exibir a ordem/contagem REAIS sem gerar phase prematura
    (evita o timeout dos POSTs no load). 204 quando o nivel ainda nao foi iniciado."""
    user_id = session_user["sub"]
    persisted = await get_persisted_active_phase(user_id, season_id, level)
    if persisted:
        await cache_phase_session(persisted, service)
        return service.sanitize_phase_session(persisted)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions/{phase_session_id}")
async def get_phase_session(
    phase_session_id: str,
    session_user: dict = Depends(require_session_user),
    service: PhaseSessionService = Depends(get_phase_service),
) -> Dict[str, Any]:
    phase_session = await get_cached_json(phase_session_cache_key(phase_session_id))
    if not phase_session:
        # Redis expirou/limpou/restart: reidrata do Supabase (fonte de verdade) — mesma ordem.
        phase_session = await get_persisted_phase_by_id(phase_session_id)
        if phase_session:
            await cache_phase_session(phase_session, service)

    if not phase_session:
        return {
            "state": "blocked",
            "phase_session_id": phase_session_id,
            "message": "Sessao de fase expirada. Volte ao app para gerar uma nova fase.",
            "navigation": {"next_target": "app.html"},
        }

    assert_session_owner(phase_session, session_user["sub"])
    return service.sanitize_phase_session(phase_session)


@router.post("/sessions/{phase_session_id}/intermission/{flow_challenge_id}/resolve")
async def resolve_intermission_session(
    phase_session_id: str,
    flow_challenge_id: str,
    session_user: dict = Depends(require_session_user),
    service: PhaseSessionService = Depends(get_phase_service),
) -> Dict[str, Any]:
    phase_session = await get_cached_json(phase_session_cache_key(phase_session_id))
    if not phase_session:
        # Reidrata do Supabase (fonte de verdade) antes de desistir.
        phase_session = await get_persisted_phase_by_id(phase_session_id)
        if phase_session:
            await cache_phase_session(phase_session, service)
    if not phase_session:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Sessao de fase expirada")

    assert_session_owner(phase_session, session_user["sub"])
    game_node = service.find_game_node(phase_session, flow_challenge_id)
    if not game_node or not game_node.get("session_id"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Intermission indisponivel")

    await cache_intermission_payloads({"nodes": [game_node]})
    sanitized_node = copy.deepcopy(game_node)
    sanitized_node.pop("_session_payload", None)

    return {
        "state": "active",
        "phase_session_id": phase_session_id,
        "flow_challenge_id": flow_challenge_id,
        "game_session_id": game_node["session_id"],
        "node": sanitized_node,
        "next_target": f"challenge.html?game_session_id={game_node['session_id']}",
    }
