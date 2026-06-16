"""
Configuração de variáveis de ambiente
Fonte única de verdade para todas as configs de infraestrutura
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """
    Configurações centralizadas do Logun-IA.
    Todas as variáveis de ambiente devem ser definidas aqui.
    """
    
    # ── Aplicação ──────────────────────────────────────────────────────────
    APP_NAME: str = "Logun-IA"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = Field(default="production", env="ENVIRONMENT")
    DEBUG: bool = Field(default=False, env="DEBUG")
    
    # ── Redis ──────────────────────────────────────────────────────────────
    REDIS_HOST: str = Field(default="localhost", env="REDIS_HOST")
    REDIS_PORT: int = Field(default=6379, env="REDIS_PORT")
    REDIS_PASSWORD: Optional[str] = Field(default=None, env="REDIS_PASSWORD")
    REDIS_DB: int = Field(default=0, env="REDIS_DB")
    REDIS_MAX_CONNECTIONS: int = Field(default=20, env="REDIS_MAX_CONNECTIONS")
    
    # ── Supabase ───────────────────────────────────────────────────────────
    SUPABASE_URL: str = Field(..., env="SUPABASE_URL")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(..., env="SUPABASE_SERVICE_ROLE_KEY")
    
    # ── Firebase ───────────────────────────────────────────────────────────
    FIREBASE_SERVICE_ACCOUNT_BASE64: Optional[str] = Field(
        default=None, env="FIREBASE_SERVICE_ACCOUNT_BASE64"
    )
    
    # ── Ollama (Mistral) ───────────────────────────────────────────────────
    OLLAMA_BASE_URL: str = Field(default="http://localhost:11434", env="OLLAMA_BASE_URL")
    OLLAMA_MODEL: str = Field(default="mistral:7b-instruct", env="OLLAMA_MODEL")
    OLLAMA_TIMEOUT_MS: int = Field(default=8000, env="OLLAMA_TIMEOUT_MS")
    
    # ── OpenRouter ─────────────────────────────────────────────────────────
    OPENROUTER_API_KEY: Optional[str] = Field(default=None, env="OPENROUTER_API_KEY")
    OPENROUTER_API_KEY_FALLBACK: Optional[str] = Field(default=None, env="OPENROUTER_API_KEY_FALLBACK")
    OPENROUTER_BASE_URL: str = Field(
        default="https://openrouter.ai/api/v1", env="OPENROUTER_BASE_URL"
    )
    OPENROUTER_TIMEOUT_MS: int = Field(default=10000, env="OPENROUTER_TIMEOUT_MS")
    OPENROUTER_MODEL_FAST: str = Field(default="google/gemma-2-2b-it", env="OPENROUTER_MODEL_FAST")
    OPENROUTER_MODEL_PRIMARY: str = Field(default="google/gemma-2-4b-it", env="OPENROUTER_MODEL_PRIMARY")
    OPENROUTER_MODEL_PRECISE: str = Field(default="google/gemma-2-12b-it", env="OPENROUTER_MODEL_PRECISE")
    OPENROUTER_MODEL_CRITICAL: str = Field(default="meta-llama/llama-3.3-70b-instruct", env="OPENROUTER_MODEL_CRITICAL")
    
    # ── Gemini ─────────────────────────────────────────────────────────────
    GEMINI_API_KEY: Optional[str] = Field(default=None, env="GEMINI_API_KEY")
    GEMINI_BASE_URL: str = Field(
        default="https://generativelanguage.googleapis.com/v1beta",
        env="GEMINI_BASE_URL"
    )
    GEMINI_MODEL: str = Field(default="gemini-2.0-flash-exp", env="GEMINI_MODEL")
    GEMINI_TIMEOUT_MS: int = Field(default=10000, env="GEMINI_TIMEOUT_MS")
    
    # ── Groq ───────────────────────────────────────────────────────────────
    GROQ_API_KEY: Optional[str] = Field(default=None, env="GROQ_API_KEY")
    GROQ_BASE_URL: str = Field(
        default="https://api.groq.com/openai/v1",
        env="GROQ_BASE_URL"
    )
    GROQ_TIMEOUT_MS: int = Field(default=10000, env="GROQ_TIMEOUT_MS")
    
    # ── NVIDIA NIM ─────────────────────────────────────────────────────────
    NVIDIA_API_KEY: Optional[str] = Field(default=None, env="NVIDIA_API_KEY")
    NVIDIA_BASE_URL: str = Field(
        default="https://integrate.api.nvidia.com/v1",
        env="NVIDIA_BASE_URL"
    )
    NVIDIA_TIMEOUT_MS: int = Field(default=20000, env="NVIDIA_TIMEOUT_MS")
    
    # ── Sentury Router ───────────────────────────────────────────────────────
    LOGUN_CIRCUIT_BREAKER_THRESHOLD: int = Field(default=3, env="LOGUN_CIRCUIT_BREAKER_THRESHOLD")
    LOGUN_CIRCUIT_BREAKER_TIMEOUT_SEC: int = Field(default=300, env="LOGUN_CIRCUIT_BREAKER_TIMEOUT_SEC")
    LOGUN_MAX_QUEUE_SIZE: int = Field(default=100, env="LOGUN_MAX_QUEUE_SIZE")
    LOGUN_CACHE_TTL_SEC: int = Field(default=86400, env="LOGUN_CACHE_TTL_SEC")  # 24h
    
    # ── Rate Limiting ──────────────────────────────────────────────────────
    RATE_LIMIT_LOGUN_PER_MIN: int = Field(default=10, env="RATE_LIMIT_LOGUN_PER_MIN")
    RATE_LIMIT_LOGUN_BURST: int = Field(default=5, env="RATE_LIMIT_LOGUN_BURST")
    
    # ── Security ───────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str = Field(..., env="JWT_SECRET_KEY")
    JWT_ALGORITHM: str = Field(default="HS256", env="JWT_ALGORITHM")
    ADMIN_SECRET: Optional[str] = Field(default=None, env="ADMIN_SECRET")
    LOGUN_API_TOKEN: Optional[str] = Field(default=None, env="LOGUN_API_TOKEN")
    
    # ── Logging ────────────────────────────────────────────────────────────
    LOG_LEVEL: str = Field(default="INFO", env="LOG_LEVEL")
    LOG_FORMAT: str = Field(default="json", env="LOG_FORMAT")  # json ou text
    
    # ── CORS ───────────────────────────────────────────────────────────────
    CORS_ORIGINS: str = Field(
        default="https://cxgame.vercel.app,https://astreqapiv1.duckdns.org",
        env="CORS_ORIGINS"
    )
    
    @property
    def cors_origins_list(self) -> list[str]:
        """Retorna lista de origens CORS"""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]
    
    @property
    def redis_url(self) -> str:
        """Constrói URL do Redis"""
        if self.REDIS_PASSWORD:
            return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Instância global de settings
settings = Settings()
