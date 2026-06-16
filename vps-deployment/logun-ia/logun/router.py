"""
Logun Router — gateway de avaliação com roteamento por saúde.

O roteamento tem três camadas:

1. Gate determinístico: o rule engine resolve casos simples em menos de 100ms,
   sem custo. Sem match, segue para o scoring.
2. Regras de exclusão: descarta provedores indisponíveis (fila alta, circuit
   breaker aberto ou health check negativo).
3. Scoring dinâmico: ordena os provedores restantes por latência real, taxa de
   erro e taxa de sucesso, com ajustes por contexto (tamanho do texto e carga).
   Escolhe o de menor score. Não há ordem fixa.
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


@dataclass
class Provider:
    name: str
    timeout_ms: int
    cost_per_request: float = 0.0
    latency_ms: float = 9999.0
    healthy: bool = True
    request_count: int = 0
    error_count: int = 0
    success_count: int = 0
    avg_latency_ms: float = 9999.0
    last_check: Optional[datetime] = None
    circuit_open: bool = False
    circuit_opened_at: Optional[datetime] = None
    consecutive_failures: int = 0
    
    @property
    def error_rate(self) -> float:
        if self.request_count == 0:
            return 0.0
        return self.error_count / self.request_count
    
    @property
    def success_rate(self) -> float:
        if self.request_count == 0:
            return 0.0
        return self.success_count / self.request_count
    
    def score(self) -> float:
        """Lower score = better provider (health-based scoring)"""
        if not self.healthy or self.circuit_open:
            return float("inf")

        latency_score = self.avg_latency_ms / 1000.0
        cost_score = self.cost_per_request * 100
        error_penalty = self.error_rate * 500
        success_bonus = (1.0 - self.success_rate) * 100

        return latency_score + cost_score + error_penalty + success_bonus
    
    def health_score(self, current_load: float, text_length: int, ollama_queue: int) -> float:
        """Dynamic score: base (latency + error + success) plus context adjustments. Lower = better."""
        if not self.healthy or self.circuit_open:
            return float("inf")

        base_score = self.score()
        context_adjustment = 0.0

        # REGRA 1: Texto curto → bônus velocidade (Groq ultra-rápido)
        if text_length < 120:
            if self.name == "groq":
                context_adjustment -= 2.0

        # REGRA 2: Alta carga → bônus fallback (OpenRouter = 13 modelos)
        if current_load > 10:
            if self.name == "openrouter":
                context_adjustment -= 5.0

        return base_score + context_adjustment


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 3, timeout_seconds: int = 300):
        self.failure_threshold = failure_threshold
        self.timeout_seconds = timeout_seconds

    def should_open(self, provider: Provider) -> bool:
        return provider.consecutive_failures >= self.failure_threshold
    
    def should_close(self, provider: Provider) -> bool:
        if not provider.circuit_open or not provider.circuit_opened_at:
            return False
        
        elapsed = (datetime.utcnow() - provider.circuit_opened_at).total_seconds()
        return elapsed > self.timeout_seconds
    
    def open_circuit(self, provider: Provider) -> None:
        provider.circuit_open = True
        provider.circuit_opened_at = datetime.utcnow()
        logger.warning(
            f"Circuit breaker OPEN for {provider.name} "
            f"(failures: {provider.consecutive_failures})"
        )
    
    def close_circuit(self, provider: Provider) -> None:
        provider.circuit_open = False
        provider.circuit_opened_at = None
        provider.consecutive_failures = 0
        logger.info(f"Circuit breaker CLOSED for {provider.name} (timeout expired)")
    
    def record_success(self, provider: Provider) -> None:
        provider.consecutive_failures = 0
        if provider.circuit_open:
            self.close_circuit(provider)
    
    def record_failure(self, provider: Provider) -> None:
        provider.consecutive_failures += 1
        if self.should_open(provider):
            self.open_circuit(provider)


class LogunRouter:
    """
    Orquestrador inteligente com roteamento adaptativo.
    
    Decisão baseada em:
    - Carga do sistema (req/min)
    - Tamanho do texto (complexidade)
    - Fila do Ollama (disponibilidade)
    - Rate limits das APIs
    """
    
    def __init__(self, redis_client=None):
        self.providers: List[Provider] = self._build_providers()
        self.circuit_breaker = CircuitBreaker(failure_threshold=5, timeout_seconds=300)
        self._initialized = False
        self.redis_client = redis_client

        self.request_window = 60
        self.ollama_max_queue = 3
        self.LOW_LOAD_THRESHOLD = 5
        self.HIGH_LOAD_THRESHOLD = 10
        self.SHORT_TEXT_THRESHOLD = 120
        self.LONG_TEXT_THRESHOLD = 400
    
    def _build_providers(self) -> List[Provider]:
        """
        Constrói lista de provedores para HEALTH SCORING DINÂMICO.
        
        ARQUITETURA SIMPLIFICADA (apenas APIs externas):
        
        FAST API (latência < 1s):
        - Groq: ultra-rápido (200-500ms), free tier generoso (14.400 req/dia)
        
        SMART API (latência 1-5s):
        - Gemini: inteligente, free tier (1.500 req/dia)
        
        GPU FALLBACK (variável 2-10s):
        - NVIDIA NIM: GPU externa, fallback confiável
        
        API EXTERNA DE FALLBACK (distribuição de carga):
        - OpenRouter: Agregador de modelos externos para redundância limitada (limite de 400 req/dia)
        
        GATE (tratado separadamente no código):
        - Rule Engine: <100ms, determinístico, primeira barreira
        
        REMOVIDOS (instáveis/problemáticos):
        - Ollama/Mistral: lento (6-26s), instável sob carga, single-threaded
        - TinyLlama: baixa qualidade, não confiável
        
        Decisão: MENOR health score = melhor provider AGORA
        """
        return [
            # FAST API (prioridade máxima)
            Provider(
                name="groq",
                timeout_ms=10000,
                cost_per_request=0.0,
            ),
            # SMART API (qualidade + velocidade)
            Provider(
                name="gemini",
                timeout_ms=20000,
                cost_per_request=0.0,
            ),
            # GPU FALLBACK (confiável)
            Provider(
                name="nvidia",
                timeout_ms=20000,
                cost_per_request=0.0,
            ),
            # fallback API (redundância limitada / fallback)
            Provider(
                name="openrouter",
                timeout_ms=20000,
                cost_per_request=0.0,
            ),
        ]
    
    async def initialize(self) -> None:
        logger.info("LogunRouter: inicializando provedores...")
        await asyncio.gather(
            *[self._health_check_provider(p) for p in self.providers],
            return_exceptions=True,
        )
        available = [p for p in self.providers if p.healthy]
        logger.info(
            f"LogunRouter ready. Available providers: "
            f"{[p.name for p in available]}"
        )
        self._initialized = True
    
    async def _health_check_provider(self, provider: Provider) -> None:
        # Implementação específica será feita nos providers
        provider.last_check = datetime.utcnow()
        provider.healthy = True  # Assume healthy por padrão
    
    async def _get_current_load(self) -> float:
        if not self.redis_client:
            return 0.0
        
        try:
            key = "logun:load:requests"
            now = time.time()
            
            await self.redis_client.zremrangebyscore(key, 0, now - self.request_window)
            count = await self.redis_client.zcard(key)
            await self.redis_client.zadd(key, {f"{now}": now})
            await self.redis_client.expire(key, self.request_window)
            return float(count)
        except Exception as e:
            logger.error(f"Error getting current load: {e}")
            return 0.0
    
    async def _get_ollama_queue_size(self) -> int:
        if not self.redis_client:
            return 0
        
        try:
            key = "logun:ollama:active"
            now = time.time()
            
            await self.redis_client.zremrangebyscore(key, 0, now - 30)
            count = await self.redis_client.zcard(key)
            return int(count)
        except Exception as e:
            logger.error(f"Error getting Ollama queue size: {e}")
            return 0
    
    async def _mark_ollama_active(self, request_id: str) -> None:
        if not self.redis_client:
            return
        
        try:
            key = "logun:ollama:active"
            now = time.time()
            await self.redis_client.zadd(key, {request_id: now})
            await self.redis_client.expire(key, 60)
        except Exception as e:
            logger.error(f"Error marking Ollama active: {e}")
    
    async def _unmark_ollama_active(self, request_id: str) -> None:
        if not self.redis_client:
            return
        
        try:
            key = "logun:ollama:active"
            await self.redis_client.zrem(key, request_id)
        except Exception as e:
            logger.error(f"Error unmarking Ollama active: {e}")
    
    async def _choose_provider_intelligent(
        self,
        text: str,
        challenge_level: int,
        exclude: Optional[List[str]] = None,
    ) -> Optional[Provider]:
        """
        Escolhe provedor usando HEALTH-BASED SCORING DINÂMICO.
        
        ARQUITETURA SIMPLIFICADA (apenas APIs):
        - Groq: ultra-rápido, primeira escolha
        - Gemini: qualidade, segunda escolha
        - NVIDIA: GPU fallback
        - OpenRouter: cluster de 13 modelos
        
        Estratégia:
        1. Calcula health score de todos disponíveis
        2. Escolhe MENOR score = melhor provider AGORA
        
        REMOVIDO: Regras de exclusão do Ollama (não existe mais)
        """
        exclude_set = set(exclude or [])
        
        # Verifica circuit breakers expirados
        for provider in self.providers:
            if self.circuit_breaker.should_close(provider):
                self.circuit_breaker.close_circuit(provider)
        
        # Métricas do sistema
        current_load = await self._get_current_load()
        text_length = len(text)
        
        logger.info(
            f"Routing decision: load={current_load:.1f} req/min, "
            f"text_len={text_length}"
        )
        
        # Filtra provedores disponíveis
        available = [
            p for p in self.providers
            if p.healthy and not p.circuit_open and p.name not in exclude_set
        ]
        
        if not available:
            return None
        
        provider_scores = []
        for provider in available:
            score = provider.health_score(
                current_load=current_load,
                text_length=text_length,
                ollama_queue=0  # Not used anymore, kept for compatibility
            )
            provider_scores.append((provider, score))
            logger.debug(
                f"Provider {provider.name}: score={score:.2f}, "
                f"latency={provider.avg_latency_ms:.0f}ms, "
                f"error_rate={provider.error_rate:.3f}"
            )
        
        provider_scores.sort(key=lambda x: x[1])
        best_provider, best_score = provider_scores[0]
        
        logger.info(
            f"HEALTH-BASED ROUTING: Selected {best_provider.name} "
            f"(score={best_score:.2f}, latency={best_provider.avg_latency_ms:.0f}ms, "
            f"success_rate={best_provider.success_rate:.2f})"
        )
        
        if len(provider_scores) >= 3:
            top3 = provider_scores[:3]
            logger.debug(
                f"Top 3 providers: "
                f"{[(p.name, f'{s:.1f}') for p, s in top3]}"
            )
        
        return best_provider
    
    def select_provider(self, challenge_level: int, exclude: Optional[List[str]] = None) -> Optional[Provider]:
        exclude_set = set(exclude or [])
        
        # Verifica circuit breakers expirados
        for provider in self.providers:
            if self.circuit_breaker.should_close(provider):
                self.circuit_breaker.close_circuit(provider)
        
        # Filtra provedores disponíveis
        available = [
            p for p in self.providers
            if p.healthy and not p.circuit_open and p.name not in exclude_set
        ]
        
        if not available:
            return None
        
        # Nível 1: Tenta rule engine primeiro
        if challenge_level == 1:
            rule_engine = next((p for p in available if p.name == "rule_engine"), None)
            if rule_engine:
                return rule_engine
        
        # Nível 2/3: Usa ordem de fallback (Mistral → Groq → OpenRouter → Gemini → TinyLlama → Rule Engine)
        return min(available, key=lambda p: p.score())
    
    async def route(
        self,
        text: str,
        challenge_level: int,
        challenge_criteria: Dict[str, Any],
        attempt: int = 0,
        exclude_providers: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        if not self._initialized:
            await self.initialize()
        
        # Usa lógica inteligente para escolher provedor
        provider = await self._choose_provider_intelligent(
            text=text,
            challenge_level=challenge_level,
            exclude=exclude_providers,
        )
        
        if not provider:
            raise RuntimeError(
                "LogunRouter: nenhum provedor disponível. "
                "Todos os provedores estão indisponíveis ou com circuit breaker aberto."
            )

        request_id = f"{int(time.time() * 1000)}_{attempt}"
        
        logger.info(
            f"LogunRouter: routed to {provider.name} "
            f"(level={challenge_level}, attempt={attempt}, text_len={len(text)})"
        )
        
        return {
            "provider": provider.name,
            "provider_object": provider,
            "timeout_ms": provider.timeout_ms,
            "request_id": request_id,
        }
    
    def record_result(
        self,
        provider_name: str,
        success: bool,
        duration_ms: float,
    ) -> None:
        provider = next(
            (p for p in self.providers if p.name == provider_name), None
        )
        if not provider:
            return
        
        provider.request_count += 1
        
        if success:
            provider.success_count += 1
            self._update_latency(provider, duration_ms)
            self.circuit_breaker.record_success(provider)
        else:
            provider.error_count += 1
            self.circuit_breaker.record_failure(provider)
    
    def _update_latency(self, provider: Provider, duration_ms: float) -> None:
        alpha = 0.3  # Peso para nova observação
        provider.avg_latency_ms = (
            alpha * duration_ms + (1 - alpha) * provider.avg_latency_ms
        )
    
    def get_status(self) -> Dict[str, Any]:
        providers_status = []
        for p in self.providers:
            status = "healthy"
            if p.circuit_open:
                status = "circuit_open"
            elif not p.healthy:
                status = "unhealthy"
            
            providers_status.append({
                "name": p.name,
                "status": status,
                "latency_avg_ms": round(p.avg_latency_ms, 1),
                "success_rate": round(p.success_rate, 3),
                "error_rate": round(p.error_rate, 3),
                "request_count": p.request_count,
                "last_check": p.last_check.isoformat() if p.last_check else None,
            })
        
        active_provider = next(
            (p.name for p in self.providers if p.healthy and not p.circuit_open),
            None
        )

        return {
            "providers": providers_status,
            "active_provider": active_provider,
            "queue_length": 0,
        }


logun_router = LogunRouter()
