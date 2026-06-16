"""Phase session orchestration for challenge flow.

The VPS owns the playable phase order and stores the private intermission
session data in Redis. Vercel still validates attempts and writes progress.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any, Dict, List, Optional

from app.services.intermission_service import IntermissionService


PHASE_SESSION_SCHEMA_VERSION = 2
PHASE_SESSION_TTL_SECONDS = 86400
NORMAL_CHALLENGE_COUNT = 20
PINNED_LOGUN_STAGE_BY_LEVEL = {1: 3}


def normalize_challenge_identity(challenge: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Return logical/content/variant IDs for a Firebase challenge."""
    content_id = (
        challenge.get("content_id")
        or challenge.get("contentId")
        or challenge.get("challenge_id")
        or challenge.get("challengeId")
        or challenge.get("id")
    )
    logical_id = (
        challenge.get("logical_id")
        or challenge.get("logicalId")
        or _normalize_logical_id(content_id)
    )
    variant_id = challenge.get("variant_id") or challenge.get("variantId")

    if not variant_id and content_id and logical_id and content_id != logical_id:
        suffix = content_id.replace(f"{logical_id}-", "", 1)
        variant_id = suffix if suffix != content_id else None

    return {
        "logical_id": logical_id,
        "content_id": content_id,
        "variant_id": variant_id,
    }


def _normalize_logical_id(challenge_id: Optional[str]) -> Optional[str]:
    if not isinstance(challenge_id, str) or not challenge_id:
        return challenge_id
    if challenge_id.startswith("ig-"):
        return challenge_id
    return re.sub(r"-v\d+$", "", challenge_id)


def _hash_string(value: str) -> int:
    hash_value = 0
    for char in value or "":
        hash_value = ((hash_value << 5) - hash_value) + ord(char)
        hash_value &= 0xFFFFFFFF
        if hash_value >= 0x80000000:
            hash_value -= 0x100000000
    return abs(hash_value)


def _seeded_shuffle(items: List[Dict[str, Any]], seed: int) -> List[Dict[str, Any]]:
    state = seed
    shuffled = [*items]
    modulus = 2 ** 32

    def rng() -> float:
        nonlocal state
        state = (1664525 * state + 1013904223) % modulus
        return state / modulus

    for index in range(len(shuffled) - 1, 0, -1):
        swap_index = int(rng() * (index + 1))
        shuffled[index], shuffled[swap_index] = shuffled[swap_index], shuffled[index]

    return shuffled


class PhaseSessionService:
    """Build and sanitize phase sessions for one user/season/level."""

    def __init__(self, secret: str, intermission_service: Optional[IntermissionService] = None):
        self.intermission_service = intermission_service or IntermissionService(secret=secret)

    def build_phase_session(
        self,
        user_id: str,
        season_id: str,
        level: int,
        setor: str,
        level_document: Dict[str, Any],
        phase_generation: Optional[str] = None,
    ) -> Dict[str, Any]:
        generation = str(phase_generation or "legacy")
        questions = level_document.get("questions") or []
        selected_challenges = self._select_challenges(
            questions,
            user_id=user_id,
            season_id=season_id,
            level=level,
        )
        identities_by_content_id = {
            identity["content_id"]: {
                **identity,
                "source": challenge,
            }
            for challenge in selected_challenges
            for identity in [normalize_challenge_identity(challenge)]
            if identity.get("content_id")
        }
        selected_content_ids = list(identities_by_content_id.keys())
        intermission_manifest = self.intermission_service.build_manifest(
            user_id=user_id,
            season_id=season_id,
            level=level,
            setor=setor,
            challenge_ids=selected_content_ids,
            anchor_layout=self.intermission_service.anchor_layout_for_level(level),
            phase_generation=generation,
        )

        private_nodes = [
            self._phase_node_from_intermission_node(node, identities_by_content_id)
            for node in intermission_manifest.get("nodes", [])
        ]
        phase_session_payload = {
            "schema_version": PHASE_SESSION_SCHEMA_VERSION,
            "manifest_version": PHASE_SESSION_SCHEMA_VERSION,
            "user_id": user_id,
            "season_id": season_id,
            "setor": setor,
            "level": int(level),
            "phase_generation": generation,
            "source_manifest_id": intermission_manifest.get("manifest_id"),
            "seed": intermission_manifest.get("manifest_id"),
            "anchors": self.intermission_service.anchor_layout_for_level(level),
            "created_from_challenge_count": len(questions),
            "nodes": private_nodes,
            "total_nodes": len(private_nodes),
        }
        phase_session_id = self._phase_session_id(phase_session_payload)
        phase_session_payload["phase_session_id"] = phase_session_id

        for node in phase_session_payload["nodes"]:
            if node.get("type") != "game":
                continue
            session_payload = node.get("_session_payload") or {}
            session_payload["phase_session_id"] = phase_session_id
            session_payload["manifest_id"] = phase_session_id
            node["_session_payload"] = session_payload

        return phase_session_payload

    def sanitize_phase_session(self, phase_session: Dict[str, Any]) -> Dict[str, Any]:
        sanitized = copy.deepcopy(phase_session)
        sanitized["state"] = "active"
        for node in sanitized.get("nodes", []):
            if node.get("type") == "game":
                node.pop("game_id", None)
                node.pop("session_id", None)
                node.pop("_session_payload", None)
            else:
                node.pop("source", None)
        return sanitized

    def find_game_node(self, phase_session: Dict[str, Any], flow_challenge_id: str) -> Optional[Dict[str, Any]]:
        for node in phase_session.get("nodes", []):
            if node.get("type") == "game" and node.get("flow_challenge_id") == flow_challenge_id:
                return node
        return None

    def _phase_node_from_intermission_node(
        self,
        node: Dict[str, Any],
        identities_by_content_id: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        if node.get("type") == "game":
            return {
                "node_id": node.get("node_id"),
                "type": "game",
                "order_index": node.get("order_index"),
                "slot_index": node.get("slot_index"),
                "flow_challenge_id": node.get("flow_challenge_id"),
                "game_id": node.get("game_id"),
                "session_id": node.get("session_id"),
                "synthetic_challenge_id": node.get("synthetic_challenge_id"),
                "completed_minigame_id": node.get("completed_minigame_id"),
                "base_xp": node.get("base_xp"),
                "_session_payload": node.get("_session_payload"),
            }

        content_id = node.get("challenge_id")
        identity = identities_by_content_id.get(content_id) or {
            "logical_id": _normalize_logical_id(content_id),
            "content_id": content_id,
            "variant_id": None,
            "source": {},
        }
        source = identity.get("source") or {}

        return {
            "node_id": f"challenge:{identity.get('logical_id')}",
            "type": "challenge",
            "order_index": node.get("order_index"),
            "logical_id": identity.get("logical_id"),
            "content_id": identity.get("content_id"),
            "challenge_id": identity.get("content_id"),  # alias para compatibilidade com frontend
            "variant_id": identity.get("variant_id"),
            "title": source.get("titulo") or source.get("title"),
            "kind": source.get("tipo") or source.get("type") or source.get("kind"),
        }

    def _select_challenges(
        self,
        challenges: List[Dict[str, Any]],
        user_id: str,
        season_id: str,
        level: int,
        count: int = NORMAL_CHALLENGE_COUNT,
    ) -> List[Dict[str, Any]]:
        indexed = [
            {
                "challenge": challenge,
                "content_id": normalize_challenge_identity(challenge).get("content_id"),
                "logical_id": normalize_challenge_identity(challenge).get("logical_id"),
                "original_index": index,
                "order": self._order_value(challenge, index),
            }
            for index, challenge in enumerate(challenges or [])
        ]
        indexed = [item for item in indexed if item["content_id"]]
        normal_pool = [
            item for item in indexed
            if not self._is_intermission_challenge(item["challenge"])
        ]
        normal_pool = self._dedupe_normal_pool_by_logical(
            normal_pool,
            user_id=user_id,
            season_id=season_id,
            level=level,
        )

        # Separa Sentury (logun) dos desafios comuns (sel). Sentury SEMPRE entra (ancorado);
        # apenas os sel sao sorteados para preencher as vagas restantes. Assim o lg- nunca
        # compete por vaga nem some (raiz do challenge_not_found).
        layout = self.intermission_service.anchor_layout_for_level(level)
        sentury_count = len(layout.get("sentury", []))
        intermission_count = len(layout.get("intermission", []))
        total = int(layout.get("total", NORMAL_CHALLENGE_COUNT + 2))
        sel_needed = max(0, total - sentury_count - intermission_count)

        logun_items = [item for item in normal_pool if self._is_logun_challenge(item["challenge"])]
        sel_items = [item for item in normal_pool if not self._is_logun_challenge(item["challenge"])]

        logun_selected = sorted(
            logun_items, key=lambda i: (i["order"], i["original_index"])
        )[:sentury_count]

        if len(sel_items) > sel_needed:
            sampled_sel = _seeded_shuffle(
                sel_items,
                _hash_string(f"{user_id}_{season_id}_{level}"),
            )[:sel_needed]
        else:
            sampled_sel = [*sel_items]
        sampled_sel.sort(key=lambda i: (i["order"], i["original_index"]))

        # sel em ordem (preenchem os gaps) + logun (vao para as ancoras de Sentury no build_manifest)
        return [item["challenge"] for item in [*sampled_sel, *logun_selected]]

    def _dedupe_normal_pool_by_logical(
        self,
        normal_pool: List[Dict[str, Any]],
        user_id: str,
        season_id: str,
        level: int,
    ) -> List[Dict[str, Any]]:
        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for item in normal_pool:
            logical_id = item.get("logical_id") or item.get("content_id")
            if not logical_id:
                continue
            grouped.setdefault(logical_id, []).append(item)

        deduped: List[Dict[str, Any]] = []
        for logical_id, variants in grouped.items():
            ordered_variants = sorted(variants, key=lambda item: (item["order"], item["original_index"]))
            if len(ordered_variants) == 1:
                selected = dict(ordered_variants[0])
            else:
                selected = dict(
                    _seeded_shuffle(
                        ordered_variants,
                        _hash_string(f"{user_id}_{season_id}_{level}_{logical_id}"),
                    )[0]
                )
                selected["order"] = ordered_variants[0]["order"]
                selected["original_index"] = ordered_variants[0]["original_index"]
            deduped.append(selected)

        deduped.sort(key=lambda item: (item["order"], item["original_index"]))
        return deduped

    def _pinned_normal_challenges(self, normal_pool: List[Dict[str, Any]], level: int) -> List[Dict[str, Any]]:
        target_stage = PINNED_LOGUN_STAGE_BY_LEVEL.get(int(level))
        if not target_stage:
            return []

        ordered_pool = sorted(normal_pool, key=lambda item: (item["order"], item["original_index"]))
        first_logun = next(
            (item for item in ordered_pool if self._is_logun_challenge(item["challenge"])),
            None,
        )
        return [first_logun] if first_logun else []

    def _apply_pinned_normal_placements(
        self,
        selected: List[Dict[str, Any]],
        level: int,
    ) -> List[Dict[str, Any]]:
        reordered = [*selected]
        target_stage = PINNED_LOGUN_STAGE_BY_LEVEL.get(int(level))
        if not target_stage:
            return reordered

        logun_index = next(
            (
                index
                for index, item in enumerate(reordered)
                if self._is_logun_challenge(item["challenge"])
            ),
            -1,
        )
        if logun_index < 0:
            return reordered

        logun_item = reordered.pop(logun_index)
        target_index = max(0, min(len(reordered), target_stage - 1))
        reordered.insert(target_index, logun_item)
        return reordered

    def _is_intermission_challenge(self, challenge: Dict[str, Any]) -> bool:
        identity = normalize_challenge_identity(challenge)
        content_id = identity.get("content_id") or ""
        raw_type = challenge.get("tipo") or challenge.get("type") or challenge.get("kind") or challenge.get("node_type")
        return content_id.startswith("ig-") or raw_type in {"intermission", "game"}

    def _is_logun_challenge(self, challenge: Dict[str, Any]) -> bool:
        identity = normalize_challenge_identity(challenge)
        content_id = identity.get("content_id") or ""
        raw_type = challenge.get("tipo") or challenge.get("type") or challenge.get("kind") or challenge.get("node_type")
        return content_id.startswith(("txt-", "lg-")) or raw_type in {"texto", "text"}

    def _order_value(self, challenge: Dict[str, Any], fallback_index: int) -> int:
        raw = (
            challenge.get("ordem")
            or challenge.get("order")
            or challenge.get("order_index")
            or challenge.get("position")
        )
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback_index + 1

    def _phase_session_id(self, payload: Dict[str, Any]) -> str:
        ordered = [
            {
                "type": node.get("type"),
                "logical_id": node.get("logical_id"),
                "content_id": node.get("content_id"),
                "flow_challenge_id": node.get("flow_challenge_id"),
                "order_index": node.get("order_index"),
            }
            for node in payload.get("nodes", [])
        ]
        raw = json.dumps(
            [
                payload.get("schema_version"),
                payload.get("user_id"),
                payload.get("season_id"),
                payload.get("setor"),
                payload.get("level"),
                payload.get("phase_generation") or "legacy",
                ordered,
            ],
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]
        return f"ph_{digest}"


def phase_session_cache_key(phase_session_id: str) -> str:
    return f"phase:session:{phase_session_id}"

