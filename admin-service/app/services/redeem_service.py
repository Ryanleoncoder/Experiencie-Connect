"""CRUD de codigos de resgate (tabela redeem_codes). Backend do painel admin.

A validacao de payload aqui espelha a da RPC resgatar_codigo (migration 40): um codigo
mal formado nunca deveria ser criado. A garantia de concorrencia continua no Postgres.
"""

import logging
from typing import Any, Dict, List, Optional

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)

TIPOS = {"xp", "brinde"}
ESCOPOS = {"global_unico", "por_usuario"}


def _validate_payload(tipo_reward: str, reward_payload: Dict[str, Any]) -> Optional[str]:
    if tipo_reward not in TIPOS:
        return f"tipo_reward invalido (use {sorted(TIPOS)})"
    if not isinstance(reward_payload, dict):
        return "reward_payload deve ser um objeto"
    if tipo_reward == "xp":
        xp = reward_payload.get("xp")
        if not isinstance(xp, int) or isinstance(xp, bool) or xp <= 0 or xp > 100000:
            return "reward_payload.xp deve ser inteiro entre 1 e 100000"
    else:
        nome = reward_payload.get("nome")
        if not isinstance(nome, str) or not nome.strip():
            return "reward_payload.nome (brinde) nao pode ser vazio"
    return None


class RedeemService:
    TABLE = "redeem_codes"

    async def list_codes(self) -> List[Dict[str, Any]]:
        # Embedding do PostgREST: conta os pedidos de cada codigo via a FK code_id.
        res = (
            supabase_client.table(self.TABLE)
            .select("*, resgatados:redeem_orders(count)")
            .order("created_at", desc=True)
            .execute()
        )
        rows = res.data or []
        for r in rows:
            agg = r.pop("resgatados", None)
            r["resgatados"] = (agg[0]["count"] if isinstance(agg, list) and agg else 0)
        return rows

    async def create_code(self, data: Dict[str, Any]) -> Dict[str, Any]:
        err = _validate_payload(data["tipo_reward"], data.get("reward_payload") or {})
        if err:
            raise ValueError(err)
        if data["escopo"] not in ESCOPOS:
            raise ValueError(f"escopo invalido (use {sorted(ESCOPOS)})")
        if not (data.get("codigo") or "").strip():
            raise ValueError("codigo obrigatorio")

        payload = {
            "codigo": data["codigo"].strip(),
            "tipo_reward": data["tipo_reward"],
            "reward_payload": data["reward_payload"],
            "escopo": data["escopo"],
            "ativo": data.get("ativo", True),
            "inicio": data.get("inicio"),
            "fim": data.get("fim"),
        }
        res = supabase_client.table(self.TABLE).insert(payload).execute()
        return (res.data or [None])[0]

    async def update_code(self, code_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        fields: Dict[str, Any] = {}
        for key in ("ativo", "inicio", "fim", "reward_payload", "tipo_reward", "escopo"):
            if key in data and data[key] is not None:
                fields[key] = data[key]
        if not fields:
            raise ValueError("nada para atualizar")
        if "tipo_reward" in fields or "reward_payload" in fields:
            current = supabase_client.table(self.TABLE).select("tipo_reward,reward_payload").eq("id", code_id).single().execute().data
            tipo = fields.get("tipo_reward", current["tipo_reward"])
            payload = fields.get("reward_payload", current["reward_payload"])
            err = _validate_payload(tipo, payload or {})
            if err:
                raise ValueError(err)
        if "escopo" in fields and fields["escopo"] not in ESCOPOS:
            raise ValueError(f"escopo invalido (use {sorted(ESCOPOS)})")

        res = supabase_client.table(self.TABLE).update(fields).eq("id", code_id).execute()
        if not res.data:
            raise LookupError("codigo nao encontrado")
        return res.data[0]

    async def delete_code(self, code_id: str) -> None:
        # Nao apaga codigo ja resgatado (mantem auditoria/integridade da FK) — desative em vez disso.
        orders = supabase_client.table("redeem_orders").select("id", count="exact").eq("code_id", code_id).limit(1).execute()
        if (orders.count or 0) > 0:
            raise PermissionError("codigo ja possui resgates; desative (ativo=false) em vez de apagar")
        supabase_client.table(self.TABLE).delete().eq("id", code_id).execute()


redeem_service = RedeemService()
