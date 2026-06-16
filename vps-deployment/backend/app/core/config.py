"""Application configuration using Pydantic Settings."""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "CX Game Backend"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "production"

    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 4

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ADMIN_SECRET: str
    CRON_SECRET: str
    INTERNAL_API_SECRET: str = ""

    ALLOWED_ORIGINS: str = ""

    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    FIREBASE_CREDENTIALS_BASE64: str

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str
    REDIS_DB: int = 0
    REDIS_MAX_CONNECTIONS: int = 20

    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW: int = 60

    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    LOG_FILE: str = "/var/log/cxgame/backend.log"

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Env vars nao declaradas (ex.: chaves extras do Supabase no ambiente)
        # nao devem derrubar o boot do app nem a suite de testes.
        extra = "ignore"

    @property
    def allowed_origins_list(self) -> List[str]:
        if isinstance(self.ALLOWED_ORIGINS, list):
            return self.ALLOWED_ORIGINS
        if isinstance(self.ALLOWED_ORIGINS, str):
            return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]
        return []

    @property
    def redis_url(self) -> str:
        return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"


settings = Settings()
