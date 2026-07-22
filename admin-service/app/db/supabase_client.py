from supabase import create_client, Client
from typing import Optional, List, Dict, Any
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class SupabaseClient:
    def __init__(self):
        self.client: Optional[Client] = None

    async def connect(self) -> None:
        if self.client is not None:
            logger.warning("Supabase client already initialized")
            return
        try:
            self.client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            raise

    async def disconnect(self) -> None:
        self.client = None
        logger.info("Supabase client closed")

    def table(self, table_name: str):
        if self.client is None:
            raise RuntimeError("Supabase client not initialized. Call connect() first.")
        return self.client.table(table_name)

    def rpc(self, function_name: str, params: Dict[str, Any] = None):
        if self.client is None:
            raise RuntimeError("Supabase client not initialized. Call connect() first.")
        return self.client.rpc(function_name, params or {})

    async def call_rpc(self, function_name: str, params: Dict[str, Any] = None) -> Any:
        if self.client is None:
            raise RuntimeError("Supabase client not initialized. Call connect() first.")
        result = self.client.rpc(function_name, params or {}).execute()
        return result.data

    async def health_check(self) -> bool:
        try:
            self.table("usuarios").select("id").limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return False


supabase_client = SupabaseClient()
