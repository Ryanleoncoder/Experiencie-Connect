"""Logun Router configuration — fallback order, timeouts, concurrency limits."""

from typing import List, Dict, Any
from dataclasses import dataclass
from .env import settings


@dataclass
class ProviderConfig:
    name: str
    enabled: bool
    timeout_ms: int
    cost_per_request: float
    priority: int  # Menor = maior prioridade


class LogunConfig:
    PROVIDERS: List[ProviderConfig] = [
        ProviderConfig(
            name="mistral",
            enabled=True,
            timeout_ms=settings.OLLAMA_TIMEOUT_MS,
            cost_per_request=0.0,
            priority=1,
        ),
        ProviderConfig(
            name="openrouter",
            enabled=bool(settings.OPENROUTER_API_KEY),
            timeout_ms=settings.OPENROUTER_TIMEOUT_MS,
            cost_per_request=0.0,
            priority=2,
        ),
        ProviderConfig(
            name="gemini",
            enabled=bool(settings.GEMINI_API_KEY),
            timeout_ms=settings.GEMINI_TIMEOUT_MS,
            cost_per_request=0.0,
            priority=3,
        ),
        ProviderConfig(
            name="rule_engine",
            enabled=True,
            timeout_ms=1000,
            cost_per_request=0.0,
            priority=4,
        ),
    ]

    CIRCUIT_BREAKER_THRESHOLD = settings.LOGUN_CIRCUIT_BREAKER_THRESHOLD
    CIRCUIT_BREAKER_TIMEOUT_SEC = settings.LOGUN_CIRCUIT_BREAKER_TIMEOUT_SEC

    MAX_CONCURRENT_REQUESTS = 2  # Ollama supports 2 concurrent requests
    MAX_QUEUE_SIZE = settings.LOGUN_MAX_QUEUE_SIZE

    CACHE_ENABLED = True
    CACHE_TTL_SEC = settings.LOGUN_CACHE_TTL_SEC
    CACHE_KEY_PREFIX = "logun:validation"

    LEVEL_STRATEGY = {
        1: {  # Básico - tenta rule engine primeiro
            "try_rule_engine_first": True,
            "rule_engine_confidence_threshold": 0.7,
        },
        2: {  # Intermediário - usa IA
            "try_rule_engine_first": False,
            "fallback_to_rule_engine": True,
        },
        3: {  # Avançado - usa IA com fallbacks completos
            "try_rule_engine_first": False,
            "fallback_to_rule_engine": True,
        },
    }
    
    EVALUATION_CRITERIA = [
        "empatia",
        "clareza",
        "tom_profissional",
        "proximo_passo",
    ]
    
    MAX_TEXT_LENGTH = 500
    MIN_TEXT_LENGTH = 10

    INJECTION_PATTERNS = [
        r"ignore\s+(previous|all|above)\s+instructions?",
        r"disregard\s+(previous|all|above)",
        r"forget\s+(everything|all|previous)",
        r"new\s+instructions?:",
        r"system\s+prompt",
        r"you\s+are\s+now",
        r"act\s+as\s+if",
        r"pretend\s+(you|to)\s+are",
    ]
    
    @classmethod
    def get_provider_by_name(cls, name: str) -> ProviderConfig:
        for provider in cls.PROVIDERS:
            if provider.name == name:
                return provider
        raise ValueError(f"Provider {name} not found")
    
    @classmethod
    def get_enabled_providers(cls) -> List[ProviderConfig]:
        enabled = [p for p in cls.PROVIDERS if p.enabled]
        return sorted(enabled, key=lambda p: p.priority)
    
    @classmethod
    def get_fallback_chain(cls, challenge_level: int) -> List[str]:
        strategy = cls.LEVEL_STRATEGY.get(challenge_level, cls.LEVEL_STRATEGY[2])
        enabled = cls.get_enabled_providers()
        
        if challenge_level == 1 and strategy["try_rule_engine_first"]:
            chain = []
            rule_engine = next((p for p in enabled if p.name == "rule_engine"), None)
            if rule_engine:
                chain.append(rule_engine.name)
            
            for provider in enabled:
                if provider.name != "rule_engine":
                    chain.append(provider.name)
            
            return chain

        return [p.name for p in enabled]
    
    @classmethod
    def to_dict(cls) -> Dict[str, Any]:
        return {
            "providers": [
                {
                    "name": p.name,
                    "enabled": p.enabled,
                    "timeout_ms": p.timeout_ms,
                    "priority": p.priority,
                }
                for p in cls.PROVIDERS
            ],
            "circuit_breaker": {
                "threshold": cls.CIRCUIT_BREAKER_THRESHOLD,
                "timeout_sec": cls.CIRCUIT_BREAKER_TIMEOUT_SEC,
            },
            "concurrency": {
                "max_concurrent": cls.MAX_CONCURRENT_REQUESTS,
                "max_queue_size": cls.MAX_QUEUE_SIZE,
            },
            "cache": {
                "enabled": cls.CACHE_ENABLED,
                "ttl_sec": cls.CACHE_TTL_SEC,
            },
        }


logun_config = LogunConfig()
