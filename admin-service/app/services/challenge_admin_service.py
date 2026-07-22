"""CRUD de desafios (tabela challenges) + gabarito (answer_keys) pro painel admin.

O gabarito fica separado (answer_keys, so service_role) por seguranca — a resposta
correta nunca vai pro conteudo publico. Este service edita os dois lados.
"""

import logging
from typing import Any, Dict, List, Optional

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)

CHALLENGE_FIELDS = {
    "season_id", "setor", "level", "tipo", "titulo", "descricao",
    "categoria", "alternativas", "xp", "tempo_limite", "ordem", "ativo", "tags",
}
ANSWER_FIELDS = {"correct_answers", "resposta_correta", "is_text_question", "points"}


class ChallengeAdminService:
    async def list_challenges(self, season_id: Optional[str] = None, setor: Optional[str] = None,
                              level: Optional[int] = None) -> List[Dict[str, Any]]:
        q = supabase_client.table("challenges").select(
            "challenge_id,season_id,setor,level,tipo,titulo,categoria,xp,tempo_limite,ordem,ativo"
        )
        if season_id:
            q = q.eq("season_id", season_id)
        if setor:
            q = q.eq("setor", setor)
        if level is not None:
            q = q.eq("level", level)
        res = q.order("level").order("ordem").execute()
        return res.data or []

    async def get_challenge(self, challenge_id: str) -> Optional[Dict[str, Any]]:
        cres = supabase_client.table("challenges").select("*").eq("challenge_id", challenge_id).limit(1).execute()
        rows = cres.data or []
        if not rows:
            return None
        challenge = rows[0]
        ares = supabase_client.table("answer_keys").select("*").eq("challenge_id", challenge_id).limit(1).execute()
        challenge["answer_key"] = (ares.data or [None])[0]
        return challenge

    async def create_challenge(self, data: Dict[str, Any]) -> Dict[str, Any]:
        challenge_id = (data.get("challenge_id") or "").strip()
        if not challenge_id:
            raise ValueError("challenge_id obrigatorio")
        payload = {"challenge_id": challenge_id}
        for k in CHALLENGE_FIELDS:
            if k in data and data[k] is not None:
                payload[k] = data[k]
        res = supabase_client.table("challenges").insert(payload).execute()

        answer = {k: data[k] for k in ANSWER_FIELDS if k in data and data[k] is not None}
        if answer:
            answer["challenge_id"] = challenge_id
            supabase_client.table("answer_keys").upsert(answer).execute()
        return (res.data or [None])[0]

    async def update_challenge(self, challenge_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        fields = {k: data[k] for k in CHALLENGE_FIELDS if k in data}
        if not fields:
            raise ValueError("nada para atualizar")
        res = supabase_client.table("challenges").update(fields).eq("challenge_id", challenge_id).execute()
        if not res.data:
            raise LookupError("desafio nao encontrado")
        return res.data[0]

    async def update_answer(self, challenge_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        answer = {k: data[k] for k in ANSWER_FIELDS if k in data}
        answer["challenge_id"] = challenge_id
        # Coerencia: texto nao tem resposta_correta; selecao guarda a letra tambem em correct_answers.
        if answer.get("is_text_question"):
            answer["resposta_correta"] = None
            answer.setdefault("correct_answers", ["*"])
        elif answer.get("resposta_correta") and "correct_answers" not in answer:
            answer["correct_answers"] = [answer["resposta_correta"]]
        res = supabase_client.table("answer_keys").upsert(answer).execute()
        return (res.data or [None])[0]

    async def delete_challenge(self, challenge_id: str) -> None:
        supabase_client.table("answer_keys").delete().eq("challenge_id", challenge_id).execute()
        supabase_client.table("challenges").delete().eq("challenge_id", challenge_id).execute()


challenge_admin_service = ChallengeAdminService()
