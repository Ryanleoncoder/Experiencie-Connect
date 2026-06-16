import asyncio
import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("JWT_SECRET", "unit-test-secret")
os.environ.setdefault("ADMIN_SECRET", "admin")
os.environ.setdefault("CRON_SECRET", "cron")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("FIREBASE_CREDENTIALS_BASE64", "e30=")
os.environ.setdefault("REDIS_PASSWORD", "redis")

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_ROOT)

from fastapi import HTTPException

from app.api.intermission import (
    CompleteRequest,
    IN_MEMORY_INTERMISSION_CACHE,
    ManifestRequest,
    build_completion_response,
    complete_session,
    create_manifest,
    get_session,
)
from app.services.intermission_service import IntermissionService


class FakeExecuteResult:
    def __init__(self, data):
        self.data = data
        self.error = None


class FakeTableQuery:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return FakeExecuteResult(self.rows)


class FakeSupabaseClient:
    def __init__(self, table_rows=None):
        self.calls = []
        self.table_rows = table_rows or {}

    def table(self, table_name: str):
        return FakeTableQuery(self.table_rows.get(table_name, []))

    async def call_rpc(self, function_name, params):
        self.calls.append((function_name, params))
        return {
            "success": True,
            "xp": params["p_xp_earned"],
            "level": params["p_level"],
            "completed_challenges": [params["p_challenge_id"]],
            "completed_minigames": [params["p_minigame_id"]],
        }


class IntermissionApiTest(unittest.TestCase):
    def setUp(self):
        self.user_id = "00000000-0000-0000-0000-000000000123"
        self.service = IntermissionService(secret="unit-test-secret")
        self.challenge_ids = [f"sel-{100 + i}" for i in range(1, 21)]
        IN_MEMORY_INTERMISSION_CACHE.clear()

    def run_async(self, coro):
        return asyncio.run(coro)

    def test_manifest_rejects_different_user(self):
        payload = ManifestRequest(
            user_id="00000000-0000-0000-0000-000000000999",
            season_id="S-2025-01",
            level=1,
            setor="CX",
            challenge_ids=self.challenge_ids,
        )

        with self.assertRaises(HTTPException) as context:
            self.run_async(create_manifest(payload, session_user={"sub": self.user_id}, service=self.service))

        self.assertEqual(context.exception.status_code, 403)

    def test_manifest_and_session_routes_return_signed_game_nodes(self):
        manifest = self.run_async(create_manifest(
            ManifestRequest(
                user_id=self.user_id,
                season_id="S-2025-01",
                level=1,
                setor="CX",
                challenge_ids=self.challenge_ids,
            ),
            session_user={"sub": self.user_id},
            service=self.service,
        ))
        self.assertEqual(manifest["schema_version"], 3)
        game_node = next(node for node in manifest["nodes"] if node["type"] == "game")
        next_node = manifest["nodes"][game_node["order_index"] + 1]

        with patch("app.api.intermission.supabase_client", FakeSupabaseClient({
            "intermission_game_sessions": [],
        })):
            response = self.run_async(get_session(
                game_node["session_id"],
                session_user={"sub": self.user_id},
                service=self.service,
            ))

        self.assertEqual(response["session_id"], game_node["session_id"])
        self.assertEqual(response["manifest"]["manifest_id"], manifest["manifest_id"])
        self.assertEqual(response["progress"]["flow_challenge_id"], game_node["flow_challenge_id"])
        self.assertEqual(response["progress"]["synthetic_challenge_id"], game_node["synthetic_challenge_id"])
        self.assertEqual(response["progress"]["manifest_id"], manifest["manifest_id"])
        self.assertEqual(response["progress"]["order_index"], game_node["order_index"])
        self.assertEqual(response["navigation"]["next_node"]["challenge_id"], next_node["challenge_id"])
        self.assertEqual(response["navigation"]["next_target"], f"challenge.html?id={next_node['challenge_id']}")

    def test_complete_route_recalculates_score_before_rpc(self):
        session_payload = {
            "v": 2,
            "user_id": self.user_id,
            "season_id": "S-2025-01",
            "manifest_id": "im_test_manifest",
            "level": 1,
            "setor": "CX",
            "slot_index": 1,
            "order_index": 8,
            "game_id": "quem-disse-cx",
            "flow_challenge_id": "ig-L1-slot1",
            "synthetic_challenge_id": "game:L1:slot1:quem-disse-cx",
            "completed_minigame_id": "intermission:quem-disse-cx:L1:slot1",
            "base_xp": 40,
            "next_node_type": "challenge",
            "next_challenge_id": "sel-110",
            "seed": 123,
        }
        session_id = self.service.create_session_id(session_payload)
        IN_MEMORY_INTERMISSION_CACHE[f"intermission:session:{session_id}:payload"] = session_payload
        answers = [question["correct"] for question in self.service.get_game_config("quem-disse-cx")["questions"]]
        fake_supabase = FakeSupabaseClient()

        with patch("app.api.intermission.supabase_client", fake_supabase):
            response = self.run_async(complete_session(
                session_id,
                CompleteRequest(result={"answers": answers}, idempotency_key="idem-1"),
                session_user={"sub": self.user_id},
                idempotency_header="idem-1",
                service=self.service,
            ))

        self.assertEqual(fake_supabase.calls[0][0], "complete_intermission_game")
        rpc_payload = fake_supabase.calls[0][1]
        self.assertEqual(rpc_payload["p_percent"], 100)
        self.assertEqual(rpc_payload["p_xp_earned"], 40)
        self.assertEqual(rpc_payload["p_challenge_id"], "ig-L1-slot1")
        self.assertEqual(response["progress"]["completed_challenges"], ["ig-L1-slot1"])
        self.assertEqual(response["result_summary"]["outcome"], "hit")
        self.assertEqual(response["navigation"]["next_node"]["challenge_id"], "sel-110")
        self.assertEqual(response["navigation"]["next_target"], "challenge.html?id=sel-110")

    def test_cached_completion_is_ignored_when_supabase_record_was_reset(self):
        session_id = "igv2_stale_complete"
        session_payload = {
            "user_id": self.user_id,
            "manifest_id": "ph_reset",
            "phase_session_id": "ph_reset",
            "game_id": "quem-disse-cx",
            "flow_challenge_id": "ig-L1-slot1",
            "order_index": 1,
        }
        IN_MEMORY_INTERMISSION_CACHE[f"intermission:session:{session_id}:complete"] = {
            "score": {"score": 0, "max_score": 1200, "percent": 0},
            "navigation": {"next_target": "challenge.html?id=sel-110&phase_session_id=ph_reset"},
            "progress": {
                "completed_challenges": ["ig-L1-slot1"],
                "completed_minigames": ["intermission:quem-disse-cx:L1:slot1"],
            },
        }

        fake_supabase = FakeSupabaseClient({
            "intermission_game_sessions": [],
        })

        with patch("app.api.intermission.supabase_client", fake_supabase):
            response = self.run_async(build_completion_response(
                session_id,
                session_payload,
                self.service,
            ))

        self.assertIsNone(response)

    def test_session_blocks_when_phase_prerequisites_were_reset_in_supabase(self):
        session_id = "igv2_stale_phase"
        session_payload = {
            "v": 2,
            "user_id": self.user_id,
            "season_id": "S-2025-01",
            "manifest_id": "ph_reset",
            "phase_session_id": "ph_reset",
            "level": 1,
            "setor": "CX",
            "slot_index": 1,
            "order_index": 1,
            "game_id": "quem-disse-cx",
            "flow_challenge_id": "ig-L1-slot1",
            "synthetic_challenge_id": "game:L1:slot1:quem-disse-cx",
            "completed_minigame_id": "intermission:quem-disse-cx:L1:slot1",
            "base_xp": 40,
            "next_node_type": "challenge",
            "next_challenge_id": "sel-110",
            "seed": 123,
        }
        IN_MEMORY_INTERMISSION_CACHE[f"intermission:session:{session_id}:payload"] = session_payload
        IN_MEMORY_INTERMISSION_CACHE["intermission:manifest:ph_reset"] = {
            "phase_session_id": "ph_reset",
            "nodes": [
                {"type": "challenge", "challenge_id": "sel-109", "logical_id": "sel-109", "order_index": 0},
                {"type": "game", "flow_challenge_id": "ig-L1-slot1", "order_index": 1},
                {"type": "challenge", "challenge_id": "sel-110", "logical_id": "sel-110", "order_index": 2},
            ],
        }
        fake_supabase = FakeSupabaseClient({
            "challenge_status": [],
            "intermission_game_sessions": [],
        })

        with patch("app.api.intermission.supabase_client", fake_supabase):
            response = self.run_async(get_session(
                session_id,
                session_user={"sub": self.user_id},
                service=self.service,
            ))

        self.assertEqual(response["state"], "blocked")
        self.assertEqual(response["reason"], "phase_prerequisite_not_processed")
        self.assertEqual(response["navigation"]["next_target"], "challenge.html?id=sel-109&phase_session_id=ph_reset")

    def test_complete_blocks_when_phase_prerequisites_were_reset_in_supabase(self):
        session_id = "igv2_stale_complete_phase"
        session_payload = {
            "v": 2,
            "user_id": self.user_id,
            "season_id": "S-2025-01",
            "manifest_id": "ph_reset",
            "phase_session_id": "ph_reset",
            "level": 1,
            "setor": "CX",
            "slot_index": 1,
            "order_index": 1,
            "game_id": "quem-disse-cx",
            "flow_challenge_id": "ig-L1-slot1",
            "synthetic_challenge_id": "game:L1:slot1:quem-disse-cx",
            "completed_minigame_id": "intermission:quem-disse-cx:L1:slot1",
            "base_xp": 40,
            "next_node_type": "challenge",
            "next_challenge_id": "sel-110",
            "seed": 123,
        }
        IN_MEMORY_INTERMISSION_CACHE[f"intermission:session:{session_id}:payload"] = session_payload
        IN_MEMORY_INTERMISSION_CACHE["intermission:manifest:ph_reset"] = {
            "phase_session_id": "ph_reset",
            "nodes": [
                {"type": "challenge", "challenge_id": "sel-109", "logical_id": "sel-109", "order_index": 0},
                {"type": "game", "flow_challenge_id": "ig-L1-slot1", "order_index": 1},
                {"type": "challenge", "challenge_id": "sel-110", "logical_id": "sel-110", "order_index": 2},
            ],
        }
        fake_supabase = FakeSupabaseClient({
            "challenge_status": [],
            "intermission_game_sessions": [],
        })

        with patch("app.api.intermission.supabase_client", fake_supabase):
            response = self.run_async(complete_session(
                session_id,
                CompleteRequest(result={"answers": []}, idempotency_key="idem-reset"),
                session_user={"sub": self.user_id},
                idempotency_header="idem-reset",
                service=self.service,
            ))

        self.assertEqual(response["state"], "blocked")
        self.assertEqual(response["reason"], "phase_prerequisite_not_processed")
        self.assertEqual(fake_supabase.calls, [])


class NavigationPhaseAwareTest(unittest.TestCase):
    """A VPS e dona do fluxo: o next_target deve carregar o phase token."""

    def setUp(self):
        self.service = IntermissionService(secret="unit-test-secret")

    def test_no_next_node_returns_home(self):
        nav = self.service._build_navigation(None)
        self.assertIsNone(nav["next_node"])
        self.assertEqual(nav["next_target"], "home.html")

    def test_challenge_target_without_phase_is_backward_compatible(self):
        nav = self.service._build_navigation({"type": "challenge", "challenge_id": "sel-110"})
        self.assertEqual(nav["next_target"], "challenge.html?id=sel-110")

    def test_challenge_target_carries_phase_token(self):
        nav = self.service._build_navigation(
            {"type": "challenge", "challenge_id": "sel-110"},
            phase_session_id="ph_abc",
        )
        self.assertEqual(nav["next_target"], "challenge.html?id=sel-110&phase_session_id=ph_abc")

    def test_game_target_uses_opaque_session_when_available(self):
        nav = self.service._build_navigation(
            {"type": "game", "session_id": "igv2_deadbeef", "flow_challenge_id": "ig-L1-slot2"},
            phase_session_id="ph_abc",
        )
        self.assertEqual(nav["next_target"], "challenge.html?game_session_id=igv2_deadbeef")

    def test_game_target_without_session_routes_via_flow_id_and_phase(self):
        # Regressao: manifest saneado remove session_id; antes gerava game_session_id=None.
        nav = self.service._build_navigation(
            {"type": "game", "session_id": None, "flow_challenge_id": "ig-L1-slot2", "order_index": 9},
            phase_session_id="ph_abc",
        )
        self.assertNotIn("None", nav["next_target"])
        self.assertEqual(nav["next_target"], "challenge.html?id=ig-L1-slot2&phase_session_id=ph_abc")

    def test_build_navigation_for_manifest_reads_phase_id_from_manifest(self):
        sanitized_manifest = {
            "phase_session_id": "ph_xyz",
            "nodes": [
                {"type": "game", "order_index": 0, "flow_challenge_id": "ig-L1-slot1"},
                {"type": "challenge", "order_index": 1, "challenge_id": "sel-200"},
            ],
        }
        nav = self.service.build_navigation_for_manifest(sanitized_manifest, order_index=0)
        self.assertEqual(nav["next_target"], "challenge.html?id=sel-200&phase_session_id=ph_xyz")

    def test_phase_flow_game_to_game_does_not_emit_none(self):
        # Manifest saneado com dois games adjacentes (session_id removido).
        sanitized_manifest = {
            "phase_session_id": "ph_xyz",
            "nodes": [
                {"type": "game", "order_index": 0, "flow_challenge_id": "ig-L1-slot1"},
                {"type": "game", "order_index": 1, "flow_challenge_id": "ig-L1-slot2"},
            ],
        }
        nav = self.service.build_navigation_for_manifest(sanitized_manifest, order_index=0)
        self.assertEqual(nav["next_target"], "challenge.html?id=ig-L1-slot2&phase_session_id=ph_xyz")
        self.assertNotIn("None", nav["next_target"])


if __name__ == "__main__":
    unittest.main()
