import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

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

from app.services.phase_service import PhaseSessionService


def make_level(level, n_sel, logun_ids):
    qs = [{"id": f"sel-{level}{str(i).zfill(2)}"} for i in range(1, n_sel + 1)]
    qs += [{"id": cid} for cid in logun_ids]
    qs += [
        {"id": f"ig-L{level}-slot1", "tipo": "intermission"},
        {"id": f"ig-L{level}-slot2", "tipo": "intermission"},
    ]
    return {"questions": qs}


LEVELS = {
    1: make_level(1, 20, ["lg-101"]),
    2: make_level(2, 20, ["lg-201"]),
    3: make_level(3, 19, ["lg-301", "lg-302"]),
}


def positions(phase_session):
    sentury, intermission, total = [], [], 0
    for node in sorted(phase_session["nodes"], key=lambda n: n["order_index"]):
        total += 1
        pos = node["order_index"] + 1
        if node["type"] == "game":
            intermission.append(pos)
        else:
            cid = str(node.get("content_id") or node.get("challenge_id") or node.get("logical_id"))
            if cid.startswith(("lg-", "txt-")):
                sentury.append(pos)
    return sentury, intermission, total


class PhaseAnchorTest(unittest.TestCase):
    def setUp(self):
        self.svc = PhaseSessionService(secret="unit-test-secret")

    def _build(self, level, phase_generation=None):
        return self.svc.build_phase_session(
            user_id="00000000-0000-0000-0000-000000000123",
            season_id="S-2025-01",
            level=level,
            setor="CX",
            level_document=LEVELS[level],
            phase_generation=phase_generation,
        )

    def test_l1_l2_anchors(self):
        for level in (1, 2):
            ps = self._build(level)
            sentury, intermission, total = positions(ps)
            self.assertEqual(total, 22, f"L{level} total")
            self.assertEqual(sentury, [4], f"L{level} sentury")
            self.assertEqual(intermission, [9, 16], f"L{level} intermission")

    def test_l3_anchors(self):
        ps = self._build(3)
        sentury, intermission, total = positions(ps)
        self.assertEqual(total, 22)
        self.assertEqual(sentury, [4, 13])
        self.assertEqual(intermission, [8, 18])

    def test_sentury_and_intermission_never_missing(self):
        for level in (1, 2, 3):
            ps = self._build(level)
            ids = [
                str(n.get("content_id") or n.get("challenge_id") or n.get("flow_challenge_id"))
                for n in ps["nodes"]
            ]
            self.assertTrue(any(i.startswith("lg-") for i in ids), f"L{level} sem Sentury")
            self.assertEqual(sum(1 for i in ids if i.startswith("ig-")), 2, f"L{level} intermissions")

    def test_anchors_never_adjacent(self):
        for level in (1, 2, 3):
            ps = self._build(level)
            sentury, intermission, _ = positions(ps)
            anchors = sorted(sentury + intermission)
            for a, b in zip(anchors, anchors[1:]):
                self.assertGreater(b - a, 1, f"L{level} ancoras adjacentes {a},{b}")

    def test_manifest_has_version_and_anchors(self):
        ps = self._build(2)
        self.assertIn("manifest_version", ps)
        self.assertIn("seed", ps)
        self.assertEqual(ps["anchors"]["sentury"], [4])
        self.assertEqual(ps["anchors"]["intermission"], [9, 16])
        self.assertEqual(ps["created_from_challenge_count"], len(LEVELS[2]["questions"]))

    def test_phase_generation_changes_phase_seed_without_changing_anchors(self):
        first = self._build(1, phase_generation="gen-a")
        same = self._build(1, phase_generation="gen-a")
        next_generation = self._build(1, phase_generation="gen-b")

        self.assertEqual(first["phase_session_id"], same["phase_session_id"])
        self.assertEqual(first["phase_generation"], "gen-a")
        self.assertNotEqual(first["phase_session_id"], next_generation["phase_session_id"])
        self.assertNotEqual(first["source_manifest_id"], next_generation["source_manifest_id"])
        self.assertEqual(positions(first), positions(next_generation))


class PhasePersistenceTest(unittest.TestCase):
    """create_phase_session: reusa do Supabase ou gera+persiste."""

    def setUp(self):
        self.user_id = "00000000-0000-0000-0000-000000000123"
        self.service = PhaseSessionService(secret="unit-test-secret")

    def run_async(self, coro):
        return asyncio.run(coro)

    def _payload(self, level=2):
        from app.api.phase import PhaseSessionRequest
        return PhaseSessionRequest(season_id="S-2025-01", level=level, setor="CX")

    def test_reuses_persisted_phase(self):
        from app.api import phase as phase_api
        fake_manifest = self.run_async(self._fake_phase(2))

        with patch.object(phase_api, "get_persisted_active_phase", AsyncMock(return_value=fake_manifest)), \
             patch.object(phase_api, "cache_phase_session", AsyncMock()) as cache_mock, \
             patch.object(phase_api, "persist_phase", AsyncMock()) as persist_mock, \
             patch.object(phase_api.firebase_client, "load_level", AsyncMock()) as fb_mock:
            result = self.run_async(phase_api.create_phase_session(
                self._payload(2), session_user={"sub": self.user_id}, service=self.service,
            ))

        self.assertEqual(result["phase_session_id"], fake_manifest["phase_session_id"])
        persist_mock.assert_not_awaited()   # reuso nao persiste de novo
        fb_mock.assert_not_awaited()        # reuso nao toca Firebase
        cache_mock.assert_awaited()         # reidrata Redis

    def test_generates_and_persists_when_absent(self):
        from app.api import phase as phase_api

        with patch.object(phase_api, "get_persisted_active_phase", AsyncMock(return_value=None)), \
             patch.object(phase_api, "cache_phase_session", AsyncMock()), \
             patch.object(phase_api, "persist_phase", AsyncMock()) as persist_mock, \
             patch.object(phase_api.firebase_client, "load_level", AsyncMock(return_value=LEVELS[2])):
            result = self.run_async(phase_api.create_phase_session(
                self._payload(2), session_user={"sub": self.user_id}, service=self.service,
            ))

        self.assertEqual(result["total_nodes"], 22)
        persist_mock.assert_awaited()  # gerou -> persistiu no Supabase

    def test_uses_manifest_returned_by_persist_rpc(self):
        from app.api import phase as phase_api

        async def fake_persist(phase_session, expires_at=None):
            persisted = dict(phase_session)
            persisted["phase_session_id"] = "ph_from_rpc"
            persisted["seed"] = "rpc-seed"
            return persisted

        with patch.object(phase_api, "get_persisted_active_phase", AsyncMock(return_value=None)), \
             patch.object(phase_api, "get_phase_generation", AsyncMock(return_value="gen-rpc")), \
             patch.object(phase_api, "cache_phase_session", AsyncMock()) as cache_mock, \
             patch.object(phase_api, "persist_phase", AsyncMock(side_effect=fake_persist)), \
             patch.object(phase_api.firebase_client, "load_level", AsyncMock(return_value=LEVELS[2])):
            result = self.run_async(phase_api.create_phase_session(
                self._payload(2), session_user={"sub": self.user_id}, service=self.service,
            ))

        self.assertEqual(result["phase_session_id"], "ph_from_rpc")
        cached_phase = cache_mock.await_args.args[0]
        self.assertEqual(cached_phase["phase_session_id"], "ph_from_rpc")

    async def _fake_phase(self, level):
        return self.service.build_phase_session(
            user_id=self.user_id, season_id="S-2025-01", level=level, setor="CX",
            level_document=LEVELS[level],
        )


if __name__ == "__main__":
    unittest.main()
