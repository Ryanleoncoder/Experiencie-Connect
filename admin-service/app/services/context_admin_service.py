"""CRUD dos contextos de IA (challenge_contexts) usados pelo logun na correcao dos
desafios de texto. O campo 'context' e' um blob jsonb (scenario, metadata, etc.)."""

import logging
from typing import Any, Dict, List, Optional

from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)


class ContextAdminService:
    TABLE = "challenge_contexts"

    async def list_contexts(self) -> List[Dict[str, Any]]:
        res = supabase_client.table(self.TABLE).select("challenge_id,context").order("challenge_id").execute()
        return res.data or []

    async def get_context(self, challenge_id: str) -> Optional[Dict[str, Any]]:
        res = supabase_client.table(self.TABLE).select("*").eq("challenge_id", challenge_id).limit(1).execute()
        return (res.data or [None])[0]

    async def upsert_context(self, challenge_id: str, context: Dict[str, Any]) -> Dict[str, Any]:
        challenge_id = (challenge_id or "").strip()
        if not challenge_id:
            raise ValueError("challenge_id obrigatorio")
        res = supabase_client.table(self.TABLE).upsert({"challenge_id": challenge_id, "context": context}).execute()
        return (res.data or [None])[0]

    async def delete_context(self, challenge_id: str) -> None:
        supabase_client.table(self.TABLE).delete().eq("challenge_id", challenge_id).execute()


context_admin_service = ContextAdminService()
