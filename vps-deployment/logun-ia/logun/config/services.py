"""Internal service URLs and endpoints."""

from typing import Dict, Any
from .env import settings


class ServiceConfig:
    BACKEND_HOST = "localhost"
    BACKEND_PORT = 8000
    BACKEND_BASE_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"

    LOGUN_HOST = "localhost"
    LOGUN_PORT = 8001
    LOGUN_BASE_URL = f"http://{LOGUN_HOST}:{LOGUN_PORT}"

    NGINX_DOMAIN = "api.expconnect.com.br"
    NGINX_BASE_URL = f"https://{NGINX_DOMAIN}"

    PUBLIC_API_BASE = f"{NGINX_BASE_URL}/api"
    PUBLIC_LOGUN_BASE = f"{NGINX_BASE_URL}/logun"
    PUBLIC_RANKING_URL = f"{NGINX_BASE_URL}/ranking/current"

    VERCEL_BASE_URL = "https://cxgame.vercel.app"
    VERCEL_LOGIN_URL = f"{VERCEL_BASE_URL}/api/login"
    VERCEL_VALIDATE_URL = f"{VERCEL_BASE_URL}/api/validate-answer"

    SUPABASE_URL = settings.SUPABASE_URL
    SUPABASE_API_URL = f"{SUPABASE_URL}/rest/v1"

    @classmethod
    def get_service_urls(cls) -> Dict[str, str]:
        return {
            "backend": cls.BACKEND_BASE_URL,
            "logun": cls.LOGUN_BASE_URL,
            "nginx": cls.NGINX_BASE_URL,
            "public_api": cls.PUBLIC_API_BASE,
            "public_logun": cls.PUBLIC_LOGUN_BASE,
            "vercel": cls.VERCEL_BASE_URL,
            "supabase": cls.SUPABASE_URL,
        }
    
    @classmethod
    def get_health_check_urls(cls) -> Dict[str, str]:
        return {
            "backend": f"{cls.BACKEND_BASE_URL}/health",
            "logun": f"{cls.LOGUN_BASE_URL}/health",
            "ollama": f"{settings.OLLAMA_BASE_URL}/api/tags",
            "redis": None,  # Health check via conexão direta
            "supabase": None,  # Health check via query
        }


service_config = ServiceConfig()
