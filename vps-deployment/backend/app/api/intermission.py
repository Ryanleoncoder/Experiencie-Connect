"""Intermission game API."""

from __future__ import annotations

import copy
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.session_auth import require_session_user
from app.db.redis_client import redis_client
from app.db.supabase_client import supabase_client
from app.services.intermission_service import IntermissionService

logger = logging.getLogger(__name__)

router = APIRouter()
IN_MEMORY_INTERMISSION_CACHE: Dict[str, Dict[str, Any]] = {}

MANIFEST_TTL_SECONDS = 21600
SESSION_PAYLOAD_TTL_SECONDS = 86400
TERMO_STATE_TTL_SECONDS = 86400


class ManifestRequest(BaseModel):
    user_id: str
    season_id: str
    level: int = Field(ge=1, le=3)
    setor: str = "CX"
    challenge_ids: List[str] = Field(min_length=1)


class CompleteRequest(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)
    idempotency_key: Optional[str] = None


class GuessRequest(BaseModel):
    guess: str = Field(min_length=1, max_length=32)


class HintRequest(BaseModel):
    pass


def get_intermission_service() -> IntermissionService:
    return IntermissionService(secret=settings.JWT_SECRET)


async def cache_json(key: str, value: Dict[str, Any], ttl: int = MANIFEST_TTL_SECONDS) -> None:
    IN_MEMORY_INTERMISSION_CACHE[key] = value
    if not redis_client.is_available():
        return
    try:
        await redis_client.set_json(key, value, ttl=ttl)
    except Exception as exc:
        logger.warning("Failed to cache intermission payload: %s", exc)


async def get_cached_json(key: str) -> Optional[Dict[str, Any]]:
    if key in IN_MEMORY_INTERMISSION_CACHE:
        return IN_MEMORY_INTERMISSION_CACHE[key]
    if not redis_client.is_available():
        return None
    try:
        return await redis_client.get_json(key)
    except Exception as exc:
        logger.warning("Failed to read cached intermission payload: %s", exc)
        return None


async def delete_cached_json(key: str) -> None:
    IN_MEMORY_INTERMISSION_CACHE.pop(key, None)
    if not redis_client.is_available():
        return
    try:
        await redis_client.delete(key)
    except Exception as exc:
        logger.warning("Failed to delete cached intermission payload: %s", exc)


async def get_phase_generation(user_id: str) -> str:
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
        logger.warning("get_phase_generation failed for intermission manifest user_id=%s: %s", user_id, exc)
        return "legacy"

    if not rows:
        return "legacy"
    return str(rows[0].get("phase_generation") or "legacy")


def strip_private_manifest_data(manifest: Dict[str, Any]) -> Dict[str, Any]:
    sanitized = copy.deepcopy(manifest)
    for node in sanitized.get("nodes", []):
        node.pop("_session_payload", None)
    return sanitized


async def cache_manifest_session_payloads(manifest: Dict[str, Any]) -> None:
    for node in manifest.get("nodes", []):
        if node.get("type") != "game":
            continue
        session_id = node.get("session_id")
        session_payload = node.get("_session_payload")
        if session_id and isinstance(session_payload, dict):
            await cache_json(
                f"intermission:session:{session_id}:payload",
                session_payload,
                ttl=SESSION_PAYLOAD_TTL_SECONDS,
            )


async def get_user_progress_snapshot(user_id: str) -> Dict[str, Any]:
    progress_rows = (
        supabase_client
        .table("user_progress")
        .select("user_id, xp, level, completed_challenges, completed_minigames, attempt_history, updated_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    profile_rows = (
        supabase_client
        .table("usuarios")
        .select("nickname, display_name, ranking_code, avatar_file_name")
        .eq("id", user_id)
        .limit(1)
        .execute()
        .data
        or []
    )

    progress = progress_rows[0] if progress_rows else {}
    profile = profile_rows[0] if profile_rows else {}

    return {
        "user_id": progress.get("user_id", user_id),
        "xp": progress.get("xp", 0),
        "level": progress.get("level", 1),
        "completed_challenges": progress.get("completed_challenges") or [],
        "completed_minigames": progress.get("completed_minigames") or [],
        "attempt_history": progress.get("attempt_history") or [],
        "updated_at": progress.get("updated_at"),
        "nickname": profile.get("nickname"),
        "display_name": profile.get("display_name"),
        "ranking_code": profile.get("ranking_code"),
        "avatar_file_name": profile.get("avatar_file_name"),
    }


def normalize_logical_challenge_id(challenge_id: Optional[str]) -> Optional[str]:
    if not isinstance(challenge_id, str) or not challenge_id:
        return challenge_id
    if challenge_id.startswith("ig-"):
        return challenge_id
    return re.sub(r"-v\d+$", "", challenge_id)


def get_phase_node_challenge_id(node: Dict[str, Any]) -> Optional[str]:
    if not isinstance(node, dict):
        return None
    if node.get("type") == "game":
        return (
            node.get("flow_challenge_id")
            or node.get("flowChallengeId")
            or node.get("challenge_id")
            or node.get("id")
        )
    return (
        node.get("challenge_id")
        or node.get("challengeId")
        or node.get("content_id")
        or node.get("contentId")
        or node.get("id")
    )


async def load_phase_processed_state(session_payload: Dict[str, Any]) -> Tuple[Dict[str, Dict[str, Any]], set]:
    challenge_rows = (
        supabase_client
        .table("challenge_status")
        .select("challenge_id, status, attempts_used, level")
        .eq("user_id", session_payload["user_id"])
        .eq("season_id", session_payload["season_id"])
        .eq("level", int(session_payload["level"]))
        .execute()
        .data
        or []
    )
    intermission_rows = (
        supabase_client
        .table("intermission_game_sessions")
        .select("challenge_id, completed_at, percent, level")
        .eq("user_id", session_payload["user_id"])
        .eq("season_id", session_payload["season_id"])
        .eq("level", int(session_payload["level"]))
        .execute()
        .data
        or []
    )

    challenge_status_map: Dict[str, Dict[str, Any]] = {}
    for row in challenge_rows:
        challenge_id = row.get("challenge_id")
        if not challenge_id:
            continue
        challenge_status_map[challenge_id] = row
        logical_id = normalize_logical_challenge_id(challenge_id)
        if logical_id:
            challenge_status_map.setdefault(logical_id, row)

    intermission_ids = {
        row.get("challenge_id")
        for row in intermission_rows
        if row.get("challenge_id")
    }
    return challenge_status_map, intermission_ids


def is_phase_node_processed(
    node: Dict[str, Any],
    challenge_status_map: Dict[str, Dict[str, Any]],
    intermission_ids: set,
) -> bool:
    challenge_id = get_phase_node_challenge_id(node)
    if not challenge_id:
        return False

    if node.get("type") == "game" or challenge_id.startswith("ig-"):
        return challenge_id in intermission_ids

    logical_id = node.get("logical_id") or node.get("logicalId") or normalize_logical_challenge_id(challenge_id)
    status_row = (
        challenge_status_map.get(challenge_id)
        or challenge_status_map.get(logical_id)
        or challenge_status_map.get(normalize_logical_challenge_id(challenge_id))
    )
    return bool(status_row and status_row.get("status") in {"completed", "failed"})


async def build_phase_prerequisite_block_response(
    session_id: str,
    session_payload: Dict[str, Any],
    service: IntermissionService,
) -> Optional[Dict[str, Any]]:
    phase_session_id = session_payload.get("phase_session_id")
    manifest_id = session_payload.get("manifest_id")
    order_index = session_payload.get("order_index")
    if not phase_session_id or manifest_id is None or order_index is None:
        return None

    manifest = await get_cached_json(f"intermission:manifest:{manifest_id}")
    nodes = manifest.get("nodes") if isinstance(manifest, dict) else []
    if not nodes:
        return None

    challenge_status_map, intermission_ids = await load_phase_processed_state(session_payload)
    previous_nodes = sorted(
        [node for node in nodes if int(node.get("order_index", -1)) < int(order_index)],
        key=lambda node: int(node.get("order_index", 0)),
    )
    first_unprocessed = next(
        (
            node
            for node in previous_nodes
            if not is_phase_node_processed(node, challenge_status_map, intermission_ids)
        ),
        None,
    )
    if not first_unprocessed:
        return None

    navigation = service._build_navigation(first_unprocessed, phase_session_id)
    logger.info(
        "[IntermissionPrerequisite] blocked session_id=%s phase_session_id=%s missing_node=%s order_index=%s",
        session_id,
        phase_session_id,
        get_phase_node_challenge_id(first_unprocessed),
        first_unprocessed.get("order_index"),
    )
    return {
        "state": "blocked",
        "session_id": session_id,
        "reason": "phase_prerequisite_not_processed",
        "message": "Seu progresso foi reiniciado. Volte para a etapa liberada.",
        "navigation": navigation,
    }


async def find_completion_record(session_payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = (
        supabase_client
        .table("intermission_game_sessions")
        .select("session_id, user_id, game_id, challenge_id, score, max_score, percent, xp_earned, result, completed_at")
        .eq("user_id", session_payload["user_id"])
        .eq("challenge_id", session_payload["flow_challenge_id"])
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


async def build_completion_response(
    session_id: str,
    session_payload: Dict[str, Any],
    service: IntermissionService,
    completion_row: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    cached = await get_cached_json(f"intermission:session:{session_id}:complete")
    if cached:
        completion_row = completion_row or await find_completion_record(session_payload)
        if not completion_row:
            await delete_cached_json(f"intermission:session:{session_id}:complete")
            logger.info(
                "[IntermissionCompleteCache] discarded stale completion cache session_id=%s flow_challenge_id=%s",
                session_id,
                session_payload.get("flow_challenge_id"),
            )
            return None

        cached.setdefault("game", service.get_game_config(session_payload["game_id"], session_payload))
        cached.setdefault("manifest", await get_cached_json(f"intermission:manifest:{session_payload.get('manifest_id')}"))
        cached["progress"] = await get_user_progress_snapshot(session_payload["user_id"])
        return {
            "state": "completed",
            "session_id": session_id,
            "success": True,
            **cached,
        }

    row = completion_row or await find_completion_record(session_payload)
    if not row:
        return None

    score = {
        "score": int(row.get("score") or 0),
        "max_score": int(row.get("max_score") or 0),
        "percent": int(row.get("percent") or 0),
    }
    result_payload = row.get("result") or {}
    result_summary = service.summarize_result(
        session_payload["game_id"],
        result_payload,
        score,
        session_payload,
    )
    progress = await get_user_progress_snapshot(session_payload["user_id"])
    manifest = await get_cached_json(f"intermission:manifest:{session_payload.get('manifest_id')}")
    navigation = (
        service.build_navigation_for_manifest(manifest, session_payload["order_index"], session_payload.get("phase_session_id"))
        if manifest else
        service.build_navigation_from_session_payload(session_payload)
    )

    payload = {
        "game": service.get_game_config(session_payload["game_id"], session_payload),
        "manifest": manifest,
        "score": score,
        "xp_earned": int(row.get("xp_earned") or 0),
        "result_summary": result_summary,
        "progress": progress,
        "navigation": navigation,
    }
    await cache_json(
        f"intermission:session:{session_id}:complete",
        payload,
        ttl=SESSION_PAYLOAD_TTL_SECONDS,
    )
    return {
        "state": "completed",
        "session_id": session_id,
        "success": True,
        **payload,
    }


async def resolve_session_payload(
    session_id: str,
    service: IntermissionService,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    cached_payload = await get_cached_json(f"intermission:session:{session_id}:payload")
    if cached_payload:
        return service.normalize_session_payload(cached_payload), None

    try:
        return service.verify_session_id(session_id), None
    except ValueError as exc:
        if session_id.startswith("igv2_"):
            return None, {
                "state": "blocked",
                "session_id": session_id,
                "message": "Sessao expirada. Volte ao fluxo para gerar uma nova fase especial.",
                "navigation": {
                    "next_node": None,
                    "next_target": "home.html",
                },
            }
        raise


async def get_or_create_termo_state(
    session_id: str,
    session_payload: Dict[str, Any],
    service: IntermissionService,
) -> Dict[str, Any]:
    cache_key = f"intermission:session:{session_id}:termo"
    state = await get_cached_json(cache_key)
    if not state:
        state = service.create_termo_state(session_payload)
    else:
        state.setdefault("target_word", service._termo_target(session_payload))
        state.setdefault("word_length", len(state["target_word"]))
        state.setdefault("max_attempts", 6)
        state.setdefault("max_hints", 3)
        state.setdefault("hints_used", 0)
        state.setdefault("revealed_positions", [])
        state.setdefault("guesses", [])
        state.setdefault("completed", False)
        state.setdefault("outcome", None)
        state.setdefault("final_answer", None)

    await cache_json(cache_key, state, ttl=TERMO_STATE_TTL_SECONDS)
    return state


async def save_termo_state(session_id: str, state: Dict[str, Any]) -> None:
    await cache_json(
        f"intermission:session:{session_id}:termo",
        state,
        ttl=TERMO_STATE_TTL_SECONDS,
    )


def build_progress_payload(session_payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "flow_challenge_id": session_payload["flow_challenge_id"],
        "synthetic_challenge_id": session_payload["synthetic_challenge_id"],
        "completed_minigame_id": session_payload["completed_minigame_id"],
        "manifest_id": session_payload.get("manifest_id"),
        "order_index": session_payload["order_index"],
        "level": session_payload["level"],
        "season_id": session_payload["season_id"],
        "setor": session_payload["setor"],
        "slot_index": session_payload["slot_index"],
        "base_xp": session_payload["base_xp"],
    }


@router.post("/manifest")
async def create_manifest(
    payload: ManifestRequest,
    session_user: dict = Depends(require_session_user),
    service: IntermissionService = Depends(get_intermission_service),
) -> Dict[str, Any]:
    token_user_id = session_user["sub"]
    if payload.user_id != token_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuario invalido")

    phase_generation = await get_phase_generation(token_user_id)
    raw_manifest = service.build_manifest(
        user_id=token_user_id,
        season_id=payload.season_id,
        level=payload.level,
        challenge_ids=payload.challenge_ids,
        setor=payload.setor,
        phase_generation=phase_generation,
    )
    await cache_manifest_session_payloads(raw_manifest)

    manifest = strip_private_manifest_data(raw_manifest)
    game_nodes = [node for node in manifest.get("nodes", []) if node.get("type") == "game"]
    logger.info(
        "[IntermissionManifest] manifest_id=%s level=%s challenge_ids=%s slot_positions=%s",
        manifest["manifest_id"],
        payload.level,
        payload.challenge_ids,
        [
            {
                "flow_challenge_id": node.get("flow_challenge_id"),
                "slot_index": node.get("slot_index"),
                "order_index": node.get("order_index"),
                "stage_position": int(node.get("order_index", 0)) + 1,
            }
            for node in game_nodes
        ],
    )

    await cache_json(f"intermission:manifest:{manifest['manifest_id']}", manifest, ttl=MANIFEST_TTL_SECONDS)
    return manifest


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    session_user: dict = Depends(require_session_user),
    service: IntermissionService = Depends(get_intermission_service),
) -> Dict[str, Any]:
    try:
        session_payload, blocked_response = await resolve_session_payload(session_id, service)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if blocked_response:
        return blocked_response
    if not session_payload:
        return {
            "state": "blocked",
            "session_id": session_id,
            "message": "Sessao indisponivel.",
            "navigation": {
                "next_node": None,
                "next_target": "home.html",
            },
        }

    if session_payload["user_id"] != session_user["sub"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessao de outro usuario")

    prerequisite_block = await build_phase_prerequisite_block_response(session_id, session_payload, service)
    if prerequisite_block:
        return prerequisite_block

    completed_response = await build_completion_response(session_id, session_payload, service)
    if completed_response:
        return completed_response

    config = service.get_game_config(session_payload["game_id"], session_payload)
    manifest = await get_cached_json(f"intermission:manifest:{session_payload.get('manifest_id')}")
    navigation = (
        service.build_navigation_for_manifest(manifest, session_payload["order_index"], session_payload.get("phase_session_id"))
        if manifest else
        service.build_navigation_from_session_payload(session_payload)
    )

    response = {
        "state": "active",
        "session_id": session_id,
        "game": config,
        "manifest": manifest,
        "progress": build_progress_payload(session_payload),
        "navigation": navigation,
    }

    if session_payload["game_id"] == "termo-cx":
        termo_state = await get_or_create_termo_state(session_id, session_payload, service)
        response["termo_state"] = service.public_termo_state(termo_state)
        if termo_state.get("completed"):
            response["message"] = "Sessao pronta para finalizar."

    return response


@router.post("/sessions/{session_id}/guess")
async def submit_guess(
    session_id: str,
    payload: GuessRequest,
    session_user: dict = Depends(require_session_user),
    service: IntermissionService = Depends(get_intermission_service),
) -> Dict[str, Any]:
    try:
        session_payload, blocked_response = await resolve_session_payload(session_id, service)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if blocked_response:
        return blocked_response
    if not session_payload:
        return {
            "state": "blocked",
            "session_id": session_id,
            "message": "Sessao indisponivel.",
            "navigation": {"next_node": None, "next_target": "home.html"},
        }

    if session_payload["user_id"] != session_user["sub"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessao de outro usuario")
    if session_payload["game_id"] != "termo-cx":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Guess disponivel apenas para Termo CX")

    completed_response = await build_completion_response(session_id, session_payload, service)
    if completed_response:
        return completed_response

    termo_state = await get_or_create_termo_state(session_id, session_payload, service)
    try:
        termo_state = service.apply_termo_guess(session_payload, termo_state, payload.guess)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await save_termo_state(session_id, termo_state)

    public_state = service.public_termo_state(termo_state)
    if termo_state.get("completed"):
        message = "Resposta registrada. Finalize para continuar."
    else:
        message = "Boa tentativa. Continue."

    return {
        "state": "active",
        "session_id": session_id,
        "message": message,
        "termo_state": public_state,
    }


@router.post("/sessions/{session_id}/hint")
async def request_hint(
    session_id: str,
    payload: HintRequest,
    session_user: dict = Depends(require_session_user),
    service: IntermissionService = Depends(get_intermission_service),
) -> Dict[str, Any]:
    try:
        session_payload, blocked_response = await resolve_session_payload(session_id, service)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if blocked_response:
        return blocked_response
    if not session_payload:
        return {
            "state": "blocked",
            "session_id": session_id,
            "message": "Sessao indisponivel.",
            "navigation": {"next_node": None, "next_target": "home.html"},
        }

    if session_payload["user_id"] != session_user["sub"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessao de outro usuario")
    if session_payload["game_id"] != "termo-cx":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dica disponivel apenas para Termo CX")

    completed_response = await build_completion_response(session_id, session_payload, service)
    if completed_response:
        return completed_response

    termo_state = await get_or_create_termo_state(session_id, session_payload, service)
    try:
        termo_state, hint = service.apply_termo_hint(session_payload, termo_state)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await save_termo_state(session_id, termo_state)
    return {
        "state": "active",
        "session_id": session_id,
        "message": hint["message"],
        "hint": hint,
        "termo_state": service.public_termo_state(termo_state),
    }


@router.post("/sessions/{session_id}/complete")
async def complete_session(
    session_id: str,
    payload: CompleteRequest,
    session_user: dict = Depends(require_session_user),
    idempotency_header: Optional[str] = Header(default=None, alias="X-Idempotency-Key"),
    service: IntermissionService = Depends(get_intermission_service),
) -> Dict[str, Any]:
    try:
        session_payload, blocked_response = await resolve_session_payload(session_id, service)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if blocked_response:
        return blocked_response
    if not session_payload:
        return {
            "state": "blocked",
            "session_id": session_id,
            "message": "Sessao indisponivel.",
            "navigation": {"next_node": None, "next_target": "home.html"},
        }

    if session_payload["user_id"] != session_user["sub"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sessao de outro usuario")

    prerequisite_block = await build_phase_prerequisite_block_response(session_id, session_payload, service)
    if prerequisite_block:
        return prerequisite_block

    result_payload = dict(payload.result or {})
    if session_payload["game_id"] == "termo-cx":
        termo_state = await get_or_create_termo_state(session_id, session_payload, service)
        if not termo_state.get("guesses"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Termo ainda nao iniciado")
        if not termo_state.get("completed"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Termo ainda em andamento")
        result_payload = {
            "guesses": [guess.get("word", "") for guess in termo_state.get("guesses", [])]
        }

    score = service.score_game(session_payload["game_id"], result_payload, session_payload)
    xp_earned = service.award_xp(session_payload["base_xp"], score["percent"])
    result_summary = service.summarize_result(session_payload["game_id"], result_payload, score, session_payload)
    idempotency_key = payload.idempotency_key or idempotency_header or session_id
    intermission_challenge_id = session_payload["flow_challenge_id"]

    rpc_payload = {
        "p_user_id": session_payload["user_id"],
        "p_session_id": session_id,
        "p_game_id": session_payload["game_id"],
        "p_challenge_id": intermission_challenge_id,
        "p_minigame_id": session_payload["completed_minigame_id"],
        "p_level": session_payload["level"],
        "p_setor": session_payload["setor"],
        "p_season_id": session_payload["season_id"],
        "p_score": score["score"],
        "p_max_score": score["max_score"],
        "p_percent": score["percent"],
        "p_xp_earned": xp_earned,
        "p_result": result_payload,
        "p_idempotency_key": idempotency_key,
    }

    try:
        progress = await supabase_client.call_rpc("complete_intermission_game", rpc_payload)
    except Exception as exc:
        logger.error("Failed to complete intermission game: %s", exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Falha ao salvar progresso") from exc

    manifest = await get_cached_json(f"intermission:manifest:{session_payload.get('manifest_id')}")
    navigation = (
        service.build_navigation_for_manifest(manifest, session_payload["order_index"], session_payload.get("phase_session_id"))
        if manifest else
        service.build_navigation_from_session_payload(session_payload)
    )

    cached_result = {
        "score": score,
        "xp_earned": xp_earned,
        "result_summary": result_summary,
        "progress": progress,
        "navigation": navigation,
    }
    await cache_json(
        f"intermission:session:{session_id}:complete",
        cached_result,
        ttl=SESSION_PAYLOAD_TTL_SECONDS,
    )

    if session_payload["game_id"] == "termo-cx":
        termo_state = await get_or_create_termo_state(session_id, session_payload, service)
        termo_state["completed"] = True
        termo_state["outcome"] = result_summary.get("outcome")
        termo_state["final_answer"] = result_summary.get("revealed_answer")
        await save_termo_state(session_id, termo_state)

    logger.info(
        "[IntermissionComplete] manifest_id=%s session_id=%s flow_challenge_id=%s order_index=%s percent=%s next_target=%s",
        session_payload.get("manifest_id"),
        session_id,
        intermission_challenge_id,
        session_payload.get("order_index"),
        score["percent"],
        navigation.get("next_target"),
    )

    return {
        "state": "completed",
        "success": True,
        "session_id": session_id,
        **cached_result,
    }
