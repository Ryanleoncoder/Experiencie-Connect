"""Supabase client using supabase-py."""

from supabase import create_client, Client
from typing import Optional, Dict, Any
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
            self.client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY
            )
            logger.info("Supabase client initialized")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")
            raise
    
    async def disconnect(self) -> None:
        if self.client is None:
            logger.warning("Supabase client not initialized")
            return
        
        try:
            # supabase-py doesn't need explicit disconnect
            self.client = None
            logger.info("Supabase client closed")
        except Exception as e:
            logger.error(f"Error closing Supabase client: {e}")
            raise
    
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
    
    async def health_check(self) -> dict:
        try:
            start_time = __import__('time').time()
            result = self.table("usuarios").select("id").limit(1).execute()
            latency_ms = (__import__('time').time() - start_time) * 1000
            
            return {
                "status": "healthy",
                "latency_ms": round(latency_ms, 2)
            }
        except Exception as e:
            logger.error(f"Database health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}


supabase_client = SupabaseClient()
