import asyncio
import hashlib
import json
import logging
import time
from datetime import datetime
from typing import Dict, Any, Optional

from logun.skills import BaseSkill
from logun.config.env import settings
from logun.config.logun import logun_config
from logun.config.constants import ValidationStatus, HTTPStatus, ErrorMessages
from logun.router import logun_router
from logun.model_selector import get_short_name, validate_model_choice, parse_model_choice
from logun.context_loader import load_challenge_context, ChallengeContext
from logun.core.output_validator import parse_and_validate, error_response
from logun.core.audit_logger import audit_logger, AuditEntry

logger = logging.getLogger(__name__)

class EvaluateSkill(BaseSkill):
    """
    EvaluateSkill wraps the main customer experience response evaluation pipeline.
    It runs validators, context loaders, rule engine gate, dynamic routing, fallback,
    JSON repair, and audit logging.
    """
    name = "evaluate"
    description = "Avalia respostas textuais de atendimento ao cliente usando critérios dinâmicos e inteligência híbrida."

    def build_prompt_from_context(self, text: str, context: ChallengeContext) -> str:
        """
        Builds a customized evaluation prompt using the challenge context.
        """
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

    async def get_cached_validation(self, redis_client: Optional[Any], challenge_id: str, text: str) -> Optional[Dict[str, Any]]:
        """Retrieves cached validation result from Redis."""
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

    async def cache_validation(self, redis_client: Optional[Any], challenge_id: str, text: str, result: Dict[str, Any]) -> None:
        """Caches validation result to Redis."""
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

    async def execute(self, request: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes the evaluation pipeline.
        
        request keys:
            - text (str)
            - challenge_id (str)
            - user_id (str)
            - challenge_level (int, optional)
            - model_choice (str, optional)
            
        context keys:
            - providers (dict)
            - validators (dict)
            - redis_client (Redis instance, optional)
            - request_id (str)
        """
        start_time = time.time()
        
        text = request.get("text", "")
        challenge_id = request.get("challenge_id", "")
        user_id = request.get("user_id", "")
        challenge_level = request.get("challenge_level", 2)
        model_choice = request.get("model_choice", "auto")
        
        providers = context.get("providers", {})
        validators = context.get("validators", {})
        redis_client = context.get("redis_client")
        request_id = context.get("request_id", f"req_{int(time.time() * 1000)}")
        
        # 1. Anti prompt injection
        anti_injection = validators.get("anti_injection")
        if anti_injection:
            is_valid, reason = anti_injection.validate(text)
            if not is_valid:
                logger.warning(f"Prompt injection detected: {reason}")
                return error_response(request_id, challenge_id, f"Prompt injection detectado: {reason}")
            text = anti_injection.sanitize(text)
            
        # 2. Pre-validation
        pre_validation = validators.get("pre_validation")
        if pre_validation:
            is_valid, reason = pre_validation.validate(text)
            if not is_valid:
                logger.warning(f"Pre-validation failed: {reason}")
                return error_response(request_id, challenge_id, f"Pré-validação falhou: {reason}")
            text = pre_validation.normalize(text)
            
        cached_result = await self.get_cached_validation(redis_client, challenge_id, text)
        if cached_result:
            cached_result["cached"] = True
            return cached_result
            
        try:
            challenge_context = await load_challenge_context(challenge_id)
        except Exception as e:
            logger.error(f"Failed to load context for {challenge_id}: {e}")
            challenge_context = await load_challenge_context("DEFAULT")
            logger.warning("Using default context as fallback")
            
        prompt = self.build_prompt_from_context(text, challenge_context)
        
        challenge_criteria = {
            "criteria": challenge_context.evaluation_criteria,
            "expected_response": challenge_context.expected_response,
            "examples": challenge_context.examples,
        }
        
        # 5. Forced model choice check
        forced_provider = None
        specific_model = None
        if model_choice and model_choice.lower() != "auto":
            if validate_model_choice(model_choice):
                forced_provider, specific_model = parse_model_choice(model_choice)
                if forced_provider and forced_provider not in providers:
                    return error_response(request_id, challenge_id, f"Forced provider {forced_provider} is not available")
            else:
                return error_response(request_id, challenge_id, f"Invalid model choice: {model_choice}")

        # 6. Rule Engine Gate (Absolute gate for fast answers, skipped if provider is forced)
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
                    
                    # Output validation & normalization on Rule Engine result
                    validated_result = parse_and_validate(
                        raw_text=json.dumps(result),
                        request_id=request_id,
                        challenge_id=challenge_id,
                        provider="RULE",
                        model="rule_engine"
                    )
                    
                    duration_ms = int((time.time() - start_time) * 1000)
                    
                    audit_entry = AuditEntry(
                        request_id=request_id,
                        challenge_id=challenge_id,
                        rubric_id=challenge_context.challenge_id,
                        prompt_version="evaluate_v1",
                        rubric_version="1.0",
                        provider="rule_engine",
                        model="rule_engine",
                        fallback_used=False,
                        latency_ms=duration_ms,
                        status=validated_result["status"],
                        score=validated_result["score"]
                    )
                    audit_logger.log(audit_entry)
                    
                    await self.cache_validation(redis_client, challenge_id, text, validated_result)
                    return validated_result
                except Exception as e:
                    logger.info(f"GATE: Rule Engine no match, passing to AI gateway: {e}")
        except Exception as e:
            logger.warning(f"GATE: Rule Engine error: {e}, passing to AI gateway")

        # 7. AI Gateway with health routing loop
        max_attempts = 6
        exclude_providers = []
        last_error = None
        fallback_used = False
        
        for attempt in range(max_attempts):
            provider_name = "unknown"
            try:
                if forced_provider:
                    provider_name = forced_provider
                    provider = providers[provider_name]
                    timeout_ms = 20000
                    if provider_name == "mistral":
                        await logun_router._mark_ollama_active(request_id)
                else:
                    routing_decision = await logun_router.route(
                        text=text,
                        challenge_level=challenge_level,
                        challenge_criteria=challenge_criteria,
                        attempt=attempt,
                        exclude_providers=exclude_providers,
                    )
                    provider_name = routing_decision["provider"]
                    provider = providers[provider_name]
                    timeout_ms = routing_decision["timeout_ms"]
                    request_id = routing_decision.get("request_id")
                    if attempt > 0:
                        fallback_used = True
                
                logger.info(f"Attempt {attempt + 1}/{max_attempts}: trying provider {provider_name}")
                
                try:
                    if provider_name in ["groq", "openrouter"] and specific_model:
                        raw_result = await provider.validate(
                            text=text,
                            challenge_criteria=challenge_criteria,
                            timeout_ms=timeout_ms,
                            custom_prompt=prompt,
                            specific_model=specific_model,
                        )
                    else:
                        raw_result = await provider.validate(
                            text=text,
                            challenge_criteria=challenge_criteria,
                            timeout_ms=timeout_ms,
                            custom_prompt=prompt,
                        )
                    
                    if provider_name == "mistral":
                        await logun_router._unmark_ollama_active(request_id)
                        
                    duration_ms = int((time.time() - start_time) * 1000)
                    
                    # Record metric success
                    if not forced_provider:
                        logun_router.record_result(provider_name, True, duration_ms)
                        
                    # Validate JSON structure and repair if needed
                    validated_result = parse_and_validate(
                        raw_text=raw_result if isinstance(raw_result, str) else json.dumps(raw_result),
                        request_id=request_id,
                        challenge_id=challenge_id,
                        provider=provider_name,
                        model=specific_model or provider_name
                    )
                    
                    validated_result["provider_used"] = get_short_name(provider_name, specific_model)
                    validated_result["fallback_used"] = fallback_used
                    
                    audit_entry = AuditEntry(
                        request_id=request_id,
                        challenge_id=challenge_id,
                        rubric_id=challenge_context.challenge_id,
                        prompt_version="evaluate_v1",
                        rubric_version="1.0",
                        provider=provider_name,
                        model=specific_model or provider_name,
                        fallback_used=fallback_used,
                        latency_ms=duration_ms,
                        status=validated_result["status"],
                        score=validated_result["score"]
                    )
                    audit_logger.log(audit_entry)
                    
                    # Cache result
                    await self.cache_validation(redis_client, challenge_id, text, validated_result)
                    
                    return validated_result
                except (asyncio.TimeoutError, Exception) as e:
                    if provider_name == "mistral":
                        await logun_router._unmark_ollama_active(request_id)
                    raise e
                    
            except asyncio.TimeoutError as e:
                last_error = e
                logger.warning(f"Provider {provider_name} timeout (attempt {attempt + 1}/{max_attempts})")
                if not forced_provider:
                    logun_router.record_result(provider_name, False, timeout_ms)
                    exclude_providers.append(provider_name)
                    continue
                else:
                    return error_response(request_id, challenge_id, f"Forced provider {provider_name} timeout: {str(e)}")
                    
            except Exception as e:
                last_error = e
                logger.warning(f"Provider {provider_name} error: {e} (attempt {attempt + 1}/{max_attempts})")
                duration_ms = int((time.time() - start_time) * 1000)
                if not forced_provider:
                    logun_router.record_result(provider_name, False, duration_ms)
                    exclude_providers.append(provider_name)
                    continue
                else:
                    return error_response(request_id, challenge_id, f"Forced provider {provider_name} error: {str(e)}")
                    
        # All providers failed
        logger.error(f"All providers failed after {max_attempts} attempts")
        return error_response(request_id, challenge_id, f"All validation providers failed. Last error: {str(last_error)}")
