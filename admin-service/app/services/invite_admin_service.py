"""Convites (criacao de usuarios) pro painel: usa a RPC gerar_invite existente.
Single + lote (lista de nicknames). Listagem via tabela invite_token."""

import logging
from typing import Any, Dict, List

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)


def _err_message(exc: Exception) -> str:
    msg = str(exc)
    # A APIError da supabase-py costuma trazer a mensagem do RAISE EXCEPTION do Postgres.
    for key in ("'message': '", '"message": "'):
        if key in msg:
            rest = msg.split(key, 1)[1]
            end = rest.find("'") if key.endswith("'") else rest.find('"')
            if end > 0:
                return rest[:end]
    return msg


class InviteAdminService:
    async def create_invite(self, nickname: str) -> Dict[str, Any]:
        nickname = (nickname or "").strip()
        if not nickname:
            return {"ok": False, "nickname": nickname, "error": "nickname vazio"}
        try:
            data = await supabase_client.call_rpc("gerar_invite", {"p_nickname": nickname})
            return {"ok": True, "invite": data}
        except Exception as e:
            logger.warning("gerar_invite falhou p/ %s: %s", nickname, e)
            return {"ok": False, "nickname": nickname, "error": _err_message(e)}

    async def create_bulk(self, nicknames: List[str]) -> Dict[str, Any]:
        results = []
        for nick in nicknames:
            nick = (nick or "").strip()
            if not nick:
                continue
            results.append(await self.create_invite(nick))
        ok = [r for r in results if r.get("ok")]
        fail = [r for r in results if not r.get("ok")]
        return {"total": len(results), "created": len(ok), "failed": len(fail), "results": results}

    async def clear_used_invites(self) -> Dict[str, Any]:
        res = supabase_client.table("invite_token").delete().eq("invite_used", True).execute()
        return {"deleted": len(res.data or [])}

    async def list_invites(self, limit: int = 200) -> List[Dict[str, Any]]:
        res = (
            supabase_client.table("invite_token")
            .select("nickname,invite_code,invite_url,invite_used,invite_expires,created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []


invite_admin_service = InviteAdminService()
