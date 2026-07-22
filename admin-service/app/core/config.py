from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    APP_NAME: str = "Experience Connect BFF API"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    HOST: str = "0.0.0.0"
    PORT: int = 8000

    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_DAYS: int = 7
    ADMIN_SECRET: str
    CRON_SECRET: str

    ALLOWED_ORIGINS: str = ""

    SUPABASE_URL: str
    SUPABASE_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    DB_POOL_MIN_SIZE: int = 5
    DB_POOL_MAX_SIZE: int = 20
    DB_POOL_TIMEOUT: int = 30


    REDIS_URL: str = "redis://localhost:6379"
    REDIS_ENABLED: bool = False
    REDIS_TTL_SECONDS: int = 300

    EVENT_WINDOW_START_HOUR: int = 7
    EVENT_WINDOW_END_HOUR: int = 19
    EVENT_WINDOW_TIMEZONE: str = "America/Sao_Paulo"

    RATE_LIMIT_REQUESTS_PER_MINUTE: int = 100
    RATE_LIMIT_ENABLED: bool = True

    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "json"
    LOG_FILE: str = "logs/app.log"

    SUPABASE_STORAGE_BUCKET: str = "rankings"
    RANKING_FILE_PREFIX: str = "ranking"

    MAX_ATTEMPTS_PER_CHALLENGE: int = 3
    XP_PER_LEVEL: int = 500
    XP_MULTIPLIERS: str = "1.0,0.6,0.3"

    RANKING_GENERATION_HOUR: int = 19
    RANKING_GENERATION_MINUTE: int = 5
    CLEANUP_RETENTION_DAYS: int = 90
    WARMUP_HOUR: int = 6
    WARMUP_MINUTE: int = 55

    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "development"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1
    
    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"
    
    @property
    def xp_multipliers_list(self) -> List[float]:
        return [float(x.strip()) for x in self.XP_MULTIPLIERS.split(",")]

    @property
    def allowed_origins_list(self) -> List[str]:
        if isinstance(self.ALLOWED_ORIGINS, list):
            return self.ALLOWED_ORIGINS
        if isinstance(self.ALLOWED_ORIGINS, str):
            return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]
        return []


settings = Settings()
