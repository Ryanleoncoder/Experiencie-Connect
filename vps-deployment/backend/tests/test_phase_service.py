from app.services.phase_service import PhaseSessionService


class FakeIntermissionService:
    def anchor_layout_for_level(self, level):
        return {"sentury": [3], "intermission": [], "total": 3}

    def build_manifest(self, user_id, season_id, level, setor, challenge_ids, phase_generation=None, anchor_layout=None):
        return {
            "manifest_id": "im_fake",
            "phase_generation": phase_generation or "legacy",
            "nodes": [
                {
                    "node_id": f"challenge:{challenge_id}",
                    "type": "challenge",
                    "challenge_id": challenge_id,
                    "order_index": index,
                }
                for index, challenge_id in enumerate(challenge_ids)
            ],
        }


def test_phase_session_selects_only_one_content_variant_per_logical_challenge():
    service = PhaseSessionService(secret="test-secret", intermission_service=FakeIntermissionService())

    phase_session = service.build_phase_session(
        user_id="user-1",
        season_id="S-2025-01",
        level=1,
        setor="CX",
        level_document={
            "questions": [
                {"id": "sel-101", "ordem": 1, "tipo": "selecao"},
                {"id": "sel-101-v1", "ordem": 2, "tipo": "selecao"},
                {"id": "sel-101-v2", "ordem": 3, "tipo": "selecao"},
                {"id": "sel-102", "ordem": 4, "tipo": "selecao"},
                {"id": "sel-102-v1", "ordem": 5, "tipo": "selecao"},
                {"id": "txt-101", "ordem": 6, "tipo": "texto"},
                {"id": "txt-101-v1", "ordem": 7, "tipo": "texto"},
            ]
        },
    )

    challenge_nodes = [node for node in phase_session["nodes"] if node["type"] == "challenge"]
    logical_ids = [node["logical_id"] for node in challenge_nodes]

    assert logical_ids == ["sel-101", "sel-102", "txt-101"]
    assert len(logical_ids) == len(set(logical_ids))
