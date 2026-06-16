import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.intermission_service import IntermissionService


class IntermissionServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = IntermissionService(secret="test-secret")

    def test_create_session_id_is_deterministic_and_opaque(self):
        payload = {
            "v": 2,
            "user_id": "00000000-0000-0000-0000-000000000123",
            "season_id": "S-2025-01",
            "manifest_id": "im_test",
            "level": 1,
            "setor": "CX",
            "slot_index": 1,
            "order_index": 2,
            "game_id": "termo-cx",
            "flow_challenge_id": "ig-L1-slot1",
            "synthetic_challenge_id": "game:L1:slot1:termo-cx",
            "completed_minigame_id": "intermission:termo-cx:L1:slot1",
            "base_xp": 40,
            "next_node_type": "challenge",
            "next_challenge_id": "sel-109",
            "seed": 123456789,
        }

        first = self.service.create_session_id(payload)
        second = self.service.create_session_id(payload)

        self.assertEqual(first, second)
        self.assertTrue(first.startswith("igv2_"))
        self.assertNotIn("00000000-0000-0000-0000-000000000123", first)
        self.assertNotIn(".", first)

    def test_build_termo_feedback_tracks_letter_states(self):
        feedback = self.service.build_termo_feedback("FORMA", "FARDO")

        self.assertEqual(feedback, ["correct", "present", "correct", "absent", "present"])

    def test_phase_generation_changes_manifest_and_game_sessions(self):
        challenge_ids = [f"sel-10{i}" for i in range(1, 8)]

        first = self.service.build_manifest(
            user_id="00000000-0000-0000-0000-000000000123",
            season_id="S-2025-01",
            level=1,
            challenge_ids=challenge_ids,
            phase_generation="gen-a",
        )
        same = self.service.build_manifest(
            user_id="00000000-0000-0000-0000-000000000123",
            season_id="S-2025-01",
            level=1,
            challenge_ids=challenge_ids,
            phase_generation="gen-a",
        )
        next_generation = self.service.build_manifest(
            user_id="00000000-0000-0000-0000-000000000123",
            season_id="S-2025-01",
            level=1,
            challenge_ids=challenge_ids,
            phase_generation="gen-b",
        )

        def game_session_ids(manifest):
            return [
                node["session_id"]
                for node in manifest["nodes"]
                if node.get("type") == "game"
            ]

        self.assertEqual(first["manifest_id"], same["manifest_id"])
        self.assertEqual(first["phase_generation"], "gen-a")
        self.assertNotEqual(first["manifest_id"], next_generation["manifest_id"])
        self.assertNotEqual(game_session_ids(first), game_session_ids(next_generation))


if __name__ == "__main__":
    unittest.main()
