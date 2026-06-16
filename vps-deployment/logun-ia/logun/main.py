"""Logun-IA FastAPI Application — validação de respostas textuais usando LLM."""

import asyncio
import hashlib
import json
import logging
import secrets
import time
from datetime import datetime
from typing import Dict, Any, Optional

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException, Depends, Header
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from fastapi.responses import JSONResponse
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
# pyrefly: ignore [missing-import]
import redis.asyncio as aioredis

from .config.env import settings
from .config.services import service_config
from .config.logun import logun_config
from .config.constants import ValidationStatus, HTTPStatus, ErrorMessages
from .router import logun_router
from .model_selector import get_provider_from_choice, get_short_name, validate_model_choice, get_available_models, parse_model_choice
from .providers.mistral import MistralProvider
from .providers.groq import GroqProvider
from .providers.openrouter import OpenRouterProvider
from .providers.gemini import GeminiProvider
from .providers.tinyllama import TinyLlamaProvider
from .providers.rule_engine import RuleEngineProvider
from .providers.nvidia import NvidiaProvider
from .validators.anti_injection import AntiInjectionValidator
from .validators.pre_validation import PreValidator
from .validators.json_schema import JSONSchemaValidator
from .context_loader import init_context_loader, load_challenge_context, ChallengeContext

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Sistema de validação de respostas textuais usando LLM",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

redis_client: Optional[aioredis.Redis] = None
providers: Dict[str, Any] = {}
validators: Dict[str, Any] = {}


class ValidationRequest(BaseModel):
    text: str = Field(..., description="Texto da resposta do usuário")
    challenge_id: str = Field(..., description="ID do desafio")
    user_id: str = Field(..., description="ID do usuário")
    challenge_level: int = Field(default=2, ge=1, le=3, description="Nível do desafio (1-3)")
    model_choice: Optional[str] = Field(
        default="auto",
        description="Escolha de modelo: auto, rule, gemma2b, tiny, groq, gemini, openrt"
    )


class ValidationResponse(BaseModel):
    status: str = Field(..., description="aprovado ou revisar")
    confianca: float = Field(..., ge=0.0, le=1.0, description="Confiança da validação")
    feedback: Dict[str, Any] = Field(..., description="Feedback detalhado por critério")
    sugestoes: list[str] = Field(default_factory=list, description="Sugestões de melhoria")
    provider_used: str = Field(..., description="Provedor de IA utilizado")
    cached: bool = Field(default=False, description="Se resultado veio do cache")


@app.on_event("startup")
async def startup_event():
    global redis_client, providers, validators
    
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    
    try:
        redis_client = await aioredis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=settings.REDIS_MAX_CONNECTIONS,
        )
        await redis_client.ping()
        logger.info("Redis connected successfully")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        redis_client = None
    
    providers = {
        "mistral": MistralProvider(base_url=settings.OLLAMA_BASE_URL),
        "groq": GroqProvider(api_key=settings.GROQ_API_KEY) if settings.GROQ_API_KEY else None,
        "openrouter": OpenRouterProvider(),
        "gemini": GeminiProvider(),
        "tinyllama": TinyLlamaProvider(base_url=settings.OLLAMA_BASE_URL),
        "rule_engine": RuleEngineProvider(),
        "nvidia": NvidiaProvider(),
    }
    providers = {k: v for k, v in providers.items() if v is not None}
    logger.info(f"Initialized {len(providers)} providers")
    
    validators = {
        "anti_injection": AntiInjectionValidator(),
        "pre_validation": PreValidator(),
        "json_schema": JSONSchemaValidator(),
    }
    logger.info(f"Initialized {len(validators)} validators")
    
    await logun_router.initialize()
    logun_router.redis_client = redis_client  # Passar Redis client para métricas
    logger.info("Logun Router initialized")
    
    init_context_loader(
        source="local",  # Usar arquivos locais
        local_path="/opt/logun-ia/challenge-contexts",  # Caminho na VM
        redis_client=redis_client,
        firebase_client=None,  # Opcional: adicionar depois
        supabase_client=None,  # Opcional: adicionar depois
    )
    logger.info("Challenge Context Loader initialized")
    
    try:
        logger.info("Pre-loading Gemma 2B model into Ollama memory...")
        mistral_provider = providers.get("mistral")
        if mistral_provider:
            await mistral_provider.validate(
                text="warmup",
                challenge_criteria={"criteria": {}},
                timeout_ms=30000,  # 30s para primeira carga
            )
            logger.info("Gemma 2B model pre-loaded successfully")
    except Exception as e:
        logger.warning(f"Failed to pre-load model (will load on first request): {e}")


@app.on_event("shutdown")
async def shutdown_event():
    global redis_client
    
    logger.info("Shutting down...")
    
    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed")


async def verify_jwt_token(authorization: Optional[str] = Header(None)) -> str:
    """Verify the shared Bearer token used by the Vercel API."""
    expected_token = settings.LOGUN_API_TOKEN
    if not expected_token:
        logger.error("LOGUN_API_TOKEN is not configured")
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail=ErrorMessages.SERVICE_UNAVAILABLE
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail=ErrorMessages.UNAUTHORIZED
        )

    token = authorization[len("Bearer "):].strip()
    if not secrets.compare_digest(token, expected_token):
        logger.warning("Invalid Logun API token received")
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail=ErrorMessages.UNAUTHORIZED
        )

    return "vercel_validate_answer"


async def check_rate_limit(user_id: str) -> None:
    if not redis_client:
        return  # Skip se Redis indisponível
    
    key = f"rate_limit:logun:{user_id}"
    window = 60  # 1 minuto
    limit = settings.RATE_LIMIT_LOGUN_PER_MIN
    
    try:
        now = time.time()
        pipe = redis_client.pipeline()

        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zcard(key)
        pipe.zadd(key, {f"{now}": now})
        pipe.expire(key, window)
        
        results = await pipe.execute()
        count = results[1]
        
        if count >= limit:
            raise HTTPException(
                status_code=HTTPStatus.TOO_MANY_REQUESTS,
                detail=ErrorMessages.RATE_LIMIT_EXCEEDED
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Rate limit check error: {e}")
        # Não bloqueia se erro no Redis


async def get_cached_validation(challenge_id: str, text: str) -> Optional[Dict[str, Any]]:
    if not redis_client or not logun_config.CACHE_ENABLED:
        return None
    
    try:
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        cache_key = f"{logun_config.CACHE_KEY_PREFIX}:{challenge_id}:{text_hash}"
        
        cached = await redis_client.get(cache_key)
        if cached:
            logger.info(f"Cache hit for challenge {challenge_id}")
            try:
                return json.loads(cached)
            except (json.JSONDecodeError, TypeError) as e:
                logger.error(f"Cache parse error for {cache_key}: {e}")
                await redis_client.delete(cache_key)
                return None
    
    except Exception as e:
        logger.error(f"Cache get error: {e}")
    
    return None


async def cache_validation(challenge_id: str, text: str, result: Dict[str, Any]) -> None:
    if not redis_client or not logun_config.CACHE_ENABLED:
        return
    
    try:
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        cache_key = f"{logun_config.CACHE_KEY_PREFIX}:{challenge_id}:{text_hash}"
        
        await redis_client.setex(
            cache_key,
            logun_config.CACHE_TTL_SEC,
            json.dumps(result)
        )
        logger.debug(f"Cached validation for challenge {challenge_id}")
    
    except Exception as e:
        logger.error(f"Cache set error: {e}")


async def save_validation_to_supabase(
    user_id: str,
    challenge_id: str,
    text: str,
    result: Dict[str, Any],
    provider_used: str,
    duration_ms: float,
) -> None:
    logger.info(
        f"Validation saved: user={user_id}, challenge={challenge_id}, "
        f"provider={provider_used}, duration={duration_ms:.0f}ms"
    )


def build_prompt_from_context(text: str, context: ChallengeContext) -> str:
    criteria_lines = []
    for criterion_name, criterion_data in context.evaluation_criteria.items():
        weight = criterion_data.get("weight", 0.0)
        description = criterion_data.get("description", "")
        keywords = criterion_data.get("keywords", [])
        
        criteria_lines.append(
            f"- {criterion_name} (peso {weight:.0%}): {description}\n"
            f"  Keywords: {', '.join(keywords[:5])}"
        )
    
    criteria_text = "\n".join(criteria_lines)

    prompt = f"""You are Sentury AI, an expert customer experience (CX) evaluator.
Your task is to evaluate a customer service response written in Portuguese.

CHALLENGE CONTEXT:
Title: {context.challenge_title}
Level: {context.challenge_level}
Type: {context.challenge_type}

SPECIFIC INSTRUCTIONS:
{context.custom_instructions}

EVALUATION CRITERIA:
{criteria_text}

USER'S RESPONSE TO EVALUATE (IN PORTUGUESE):
"{text}"

TASK:
Evaluate the user's response using the criteria above. For each criterion, assign a score from 0 to 10.
Ensure your feedback comments and suggestions are written in PORTUGUESE (as they will be shown to the user).

RESPONSE FORMAT (MUST BE EXCLUSIVELY VALID JSON):
{{
  "status": "aprovado" or "revisar",
  "confianca": 0.0 to 1.0,
  "feedback": {{
    "{list(context.evaluation_criteria.keys())[0]}": {{
      "score": 0-10,
      "comentario": "specific commentary in Portuguese"
    }},
    ...
  }},
  "sugestoes": ["suggestion 1 in Portuguese", "suggestion 2 in Portuguese", ...]
}}

IMPORTANT RULES:
- Use the weights of each criterion to calculate the final status.
- Be very specific, professional, and clear in the feedback comments (written in Portuguese).
- Provide extremely concrete, practical, and actionable improvement suggestions in Portuguese rather than theoretical or generic advice. Each suggestion must state exactly what the user should add, change, or remove in their text.
- Set status to "aprovado" if the weighted average score is >= 7.0, otherwise "revisar".
- DO NOT use unescaped double quotes (") inside the comments or suggestions. Use single quotes (') or escape them as \\\".
- Avoid literal newlines inside string values; use \\n if necessary.
- Return ONLY the JSON object. No markdown block formatting (like ```json), no conversational filler before or after the JSON.
"""
    
    return prompt


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": settings.APP_VERSION,
    }


@app.post("/logun/validate", response_model=ValidationResponse)
async def validate_text(
    request: ValidationRequest,
    user_id: str = Depends(verify_jwt_token),
):
    start_time = time.time()

    await check_rate_limit(user_id)

    is_valid, reason = validators["anti_injection"].validate(request.text)
    if not is_valid:
        logger.warning(f"Prompt injection detected: {reason}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=ErrorMessages.PROMPT_INJECTION
        )

    text = validators["anti_injection"].sanitize(request.text)

    is_valid, reason = validators["pre_validation"].validate(text)
    if not is_valid:
        logger.warning(f"Pre-validation failed: {reason}")
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST,
            detail=reason
        )

    text = validators["pre_validation"].normalize(text)

    cached_result = await get_cached_validation(request.challenge_id, text)
    if cached_result:
        cached_result["cached"] = True
        return ValidationResponse(**cached_result)

    try:
        context = await load_challenge_context(request.challenge_id)
        logger.info(
            f"Loaded context for challenge {request.challenge_id}: "
            f"{context.challenge_title} (level {context.challenge_level})"
        )
    except Exception as e:
        logger.error(f"Failed to load context for {request.challenge_id}: {e}")
        # Fallback para contexto padrão
        context = await load_challenge_context("DEFAULT")
        logger.warning(f"Using default context as fallback")

    prompt = build_prompt_from_context(text, context)

    challenge_criteria = {
        "criteria": context.evaluation_criteria,
        "expected_response": context.expected_response,
        "examples": context.examples,
    }
    
    forced_provider = None
    specific_model = None
    if request.model_choice and request.model_choice.lower() != "auto":
        if not validate_model_choice(request.model_choice):
            raise HTTPException(
                status_code=HTTPStatus.BAD_REQUEST,
                detail=f"Invalid model choice: {request.model_choice}. Valid: auto, rule, gemma2b, tiny, groq, gemini, openrt, groq:model, openrt:model"
            )
        forced_provider, specific_model = parse_model_choice(request.model_choice)
        if forced_provider and forced_provider not in providers:
            raise HTTPException(
                status_code=HTTPStatus.BAD_REQUEST,
                detail=f"Provider {forced_provider} not available"
            )
        if specific_model:
            logger.info(f"User forced provider: {forced_provider} with specific model: {specific_model} (choice: {request.model_choice})")
        else:
            logger.info(f"User forced provider: {forced_provider} (choice: {request.model_choice})")
    
    # 4. GATE ABSOLUTO: Rule Engine first (<100ms, deterministic, zero cost).
    # Skipped if a specific provider was forced by the caller.
    try:
        rule_engine = providers.get("rule_engine")
        if rule_engine and not forced_provider:
            logger.info("GATE: Trying Rule Engine first (<100ms)")
            try:
                result = await rule_engine.validate(
                    text=text,
                    challenge_criteria=challenge_criteria,
                    timeout_ms=1000,
                )
                
                # Rule Engine retornou resultado válido
                result["provider_used"] = "RULE"
                result["cached"] = False

                duration_ms = (time.time() - start_time) * 1000
                logger.info(
                    f"GATE: Rule Engine matched! "
                    f"duration={duration_ms:.0f}ms (instant)"
                )

                await cache_validation(request.challenge_id, text, result)
                await save_validation_to_supabase(
                    user_id=user_id,
                    challenge_id=request.challenge_id,
                    text=text,
                    result=result,
                    provider_used="rule_engine",
                    duration_ms=duration_ms,
                )
                
                return ValidationResponse(**result)
            
            except Exception as e:
                logger.info(f"GATE: Rule Engine no match, passing to AI gateway")
    except Exception as e:
        logger.warning(f"GATE: Rule Engine error: {e}, passing to AI gateway")
    
    # 5. AI GATEWAY — Health-Based Routing with up to 6 provider attempts.
    max_attempts = 6
    exclude_providers = []
    last_error = None
    
    for attempt in range(max_attempts):
        try:
            if forced_provider:
                provider_name = forced_provider
                provider = providers[provider_name]
                timeout_ms = 20000
                request_id = f"{int(time.time() * 1000)}_{attempt}"

                if provider_name == "mistral":
                    await logun_router._mark_ollama_active(request_id)
            else:
                routing_decision = await logun_router.route(
                    text=text,
                    challenge_level=request.challenge_level,
                    challenge_criteria=challenge_criteria,
                    attempt=attempt,
                    exclude_providers=exclude_providers,
                )
                provider_name = routing_decision["provider"]
                provider = providers[provider_name]
                timeout_ms = routing_decision["timeout_ms"]
                request_id = routing_decision.get("request_id")
            
            logger.info(f"Attempt {attempt + 1}/{max_attempts}: trying provider {provider_name}")
            
            try:
                if provider_name in ["groq", "openrouter"] and specific_model:
                    result = await provider.validate(
                        text=text,
                        challenge_criteria=challenge_criteria,
                        timeout_ms=timeout_ms,
                        custom_prompt=prompt,
                        specific_model=specific_model,
                    )
                else:
                    result = await provider.validate(
                        text=text,
                        challenge_criteria=challenge_criteria,
                        timeout_ms=timeout_ms,
                        custom_prompt=prompt,
                    )
                
                if provider_name == "mistral" and request_id:
                    await logun_router._unmark_ollama_active(request_id)
                
                expected_criteria = list(context.evaluation_criteria.keys()) if context else None
                is_valid, reason = validators["json_schema"].validate(result, expected_criteria)
                if not is_valid:
                    logger.warning(f"JSON validation failed: {reason}")
                    result = validators["json_schema"].normalize(result, expected_criteria)
                
                result["provider_used"] = get_short_name(provider_name, specific_model)
                result["cached"] = False

                duration_ms = (time.time() - start_time) * 1000
                if not forced_provider:
                    logun_router.record_result(provider_name, True, duration_ms)

                await cache_validation(request.challenge_id, text, result)
                await save_validation_to_supabase(
                    user_id=user_id,
                    challenge_id=request.challenge_id,
                    text=text,
                    result=result,
                    provider_used=provider_name,
                    duration_ms=duration_ms,
                )
                
                logger.info(
                    f"Validation completed: challenge={request.challenge_id}, "
                    f"provider={provider_name}, status={result['status']}, "
                    f"duration={duration_ms:.0f}ms, attempts={attempt + 1}"
                )
                
                return ValidationResponse(**result)
            
            except (asyncio.TimeoutError, Exception) as e:
                if provider_name == "mistral" and request_id:
                    await logun_router._unmark_ollama_active(request_id)
                raise  # Re-raise para tratamento abaixo
        
        except asyncio.TimeoutError as e:
            last_error = e
            logger.warning(
                f"Provider {provider_name} timeout (attempt {attempt + 1}/{max_attempts}), "
                f"moving to next provider"
            )
            if not forced_provider:
                logun_router.record_result(provider_name, False, timeout_ms)
                exclude_providers.append(provider_name)
                continue
            else:
                raise HTTPException(
                    status_code=HTTPStatus.SERVICE_UNAVAILABLE,
                    detail=f"Provider {provider_name} timeout"
                )
        
        except RuntimeError as e:
            logger.error(f"Router error: {e}")
            raise HTTPException(
                status_code=HTTPStatus.SERVICE_UNAVAILABLE,
                detail=ErrorMessages.NO_PROVIDERS_AVAILABLE
            )
        
        except Exception as e:
            last_error = e
            logger.warning(
                f"Provider {provider_name} error: {e} (attempt {attempt + 1}/{max_attempts}), "
                f"moving to next provider"
            )
            duration_ms = (time.time() - start_time) * 1000
            if not forced_provider:
                logun_router.record_result(provider_name, False, duration_ms)
                exclude_providers.append(provider_name)
                continue
            else:
                raise HTTPException(
                    status_code=HTTPStatus.SERVICE_UNAVAILABLE,
                    detail=f"Provider {provider_name} error: {str(e)}"
                )

    logger.error(f"All providers failed after {max_attempts} attempts")
    raise HTTPException(
        status_code=HTTPStatus.SERVICE_UNAVAILABLE,
        detail=ErrorMessages.VALIDATION_TIMEOUT if isinstance(last_error, asyncio.TimeoutError) else ErrorMessages.VALIDATION_ERROR
    )


@app.get("/logun/router/status")
async def get_router_status():
    status = logun_router.get_status()
    
    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "router": status,
        "config": logun_config.to_dict(),
    }


@app.get("/logun/contexts/{challenge_id}")
async def get_challenge_context(challenge_id: str):
    try:
        context = await load_challenge_context(challenge_id)
        return {
            "challenge_id": context.challenge_id,
            "challenge_title": context.challenge_title,
            "challenge_level": context.challenge_level,
            "challenge_type": context.challenge_type,
            "evaluation_criteria": context.evaluation_criteria,
            "expected_response": context.expected_response,
            "custom_instructions": context.custom_instructions,
        }
    except Exception as e:
        logger.error(f"Failed to load context: {e}")
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND,
            detail=f"Context not found for challenge {challenge_id}"
        )


@app.get("/logun/models")
async def get_available_models_endpoint():
    models = get_available_models()
    
    for model_id, model_info in models.items():
        provider_name = model_info.get("provider")
        if provider_name:
            model_info["available"] = provider_name in providers
        else:
            model_info["available"] = True  # AUTO sempre disponível
    
    return {
        "models": models,
        "default": "auto",
    }


if __name__ == "__main__":
    # pyrefly: ignore [missing-import]
    import uvicorn
    # pyrefly: ignore [import-error]
    uvicorn.run(app, host="0.0.0.0", port=8001)
