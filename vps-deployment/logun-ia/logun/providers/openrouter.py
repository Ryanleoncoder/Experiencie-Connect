"""OpenRouter Provider — free-tier model cluster for load distribution."""

import asyncio
import logging
# pyrefly: ignore [missing-import]
import httpx
import os
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class OpenRouterProvider:
    
    def __init__(self):
        self.base_url = "https://openrouter.ai/api/v1"
        self.api_key = os.getenv("OPENROUTER_API_KEY", "")
        self.api_key_fallback = os.getenv("OPENROUTER_API_KEY_FALLBACK", "")
        self.using_fallback = False
        
        # Modelos gratuitos do OpenRouter (ATUALIZADOS com base em testes reais)
        # Estratégia: 3 pools baseados em VELOCIDADE (não qualidade)
        
        # Modelos gratuitos do OpenRouter (ATUALIZADOS com base em testes reais)
        # Estratégia: 3 pools baseados em VELOCIDADE (não qualidade)

        # FAST POOL — <3s latency, high priority
        self.models_fast = [
            "nvidia/nemotron-mini:free",
            "nvidia/nemotron-nano-v2:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "meta-llama/llama-3.2-1b-instruct:free",
            "mistralai/mistral-7b-instruct:free",
            "qwen/qwen-2.5-7b-instruct:free",
            "google/gemma-2-9b-it:free",
        ]

        # BALANCED POOL — 3-8s latency, medium-high quality
        self.models_balanced = [
            "meta-llama/llama-3.3-70b-instruct:free",
            "meta-llama/llama-3.2-11b-instruct:free",
            "qwen/qwen-2.5-32b-instruct:free",
            "mistralai/mixtral-8x7b-instruct:free",
            "deepseek/deepseek-r1-distill-qwen-32b:free",
        ]

        # HEAVY POOL — >8s latency, extreme fallback
        self.models_heavy = [
            "openai/gpt-oss-20b:free",
            "openai/gpt-oss-120b:free",
        ]

        self.all_models = self.models_fast + self.models_balanced + self.models_heavy
        self.default_model = self.models_fast[0]

        self.model_fast = self.models_fast[0] if self.models_fast else "meta-llama/llama-3.2-3b-instruct:free"
        self.model_primary = self.models_fast[1] if len(self.models_fast) > 1 else self.model_fast
        self.model_precise = self.models_balanced[0] if self.models_balanced else self.model_fast
        self.model_critical = self.models_balanced[1] if len(self.models_balanced) > 1 else self.model_precise
    
    def _get_api_key(self) -> str:
        if self.using_fallback and self.api_key_fallback:
            return self.api_key_fallback
        return self.api_key
    
    def _switch_to_fallback(self):
        if self.api_key_fallback and not self.using_fallback:
            logger.warning("Switching to OpenRouter fallback API key")
            self.using_fallback = True
            return True
        return False
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 10000,
        custom_prompt: str = None,
        model_tier: str = "primary",
        specific_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        OTIMIZAÇÃO: tenta apenas 3 modelos do FAST POOL (not all 13 sequentially).
        If specific_model is given, only that model is tried.
        """
        if not self._get_api_key():
            raise ValueError("OPENROUTER_API_KEY não configurada")
        
        prompt = custom_prompt if custom_prompt else self._build_prompt(text, challenge_criteria)
        
        if specific_model:
            models_to_try = [specific_model]
            logger.info(f"OpenRouter: using specific model {specific_model}")
        else:
            models_to_try = self.models_fast[:3]
            logger.info(f"OpenRouter: trying 3 FAST models (all <3s latency)")
        
        last_error = None
        
        for model in models_to_try:
            logger.info(f"OpenRouter: trying model {model}")
            
            # Tentar com API key primary, depois fallback se falhar
            for api_attempt in range(2):
                try:
                    api_key = self._get_api_key()
                    async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
                        response = await client.post(
                            f"{self.base_url}/chat/completions",
                            headers={
                                "Authorization": f"Bearer {api_key}",
                                "Content-Type": "application/json",
                            },
                            json={
                                "model": model,
                                "messages": [
                                    {"role": "system", "content": "Você é um avaliador de atendimento ao cliente."},
                                    {"role": "user", "content": prompt}
                                ],
                                "temperature": 0.7,
                                "max_tokens": 1024,
                            },
                        )
                        response.raise_for_status()
                        
                        result = response.json()
                        response_text = result["choices"][0]["message"]["content"]
                        
                        logger.info(f"OpenRouter: success with model {model}")
                        return self._parse_response(response_text)
                
                except httpx.ReadTimeout as e:
                    last_error = e
                    logger.warning(f"OpenRouter timeout with model {model} (attempt {api_attempt + 1}/2)")
                    if api_attempt == 0:
                        # Retry uma vez com timeout menor
                        continue
                    else:
                        # Após retry, pular para próximo modelo IMEDIATAMENTE
                        logger.info(f"OpenRouter: skipping to next model after timeout")
                        break
                
                except httpx.HTTPStatusError as e:
                    last_error = e
                    status_code = e.response.status_code
                    
                    try:
                        error_body = e.response.json()
                        logger.warning(f"OpenRouter HTTP {status_code} with model {model}: {error_body}")
                    except:
                        logger.warning(f"OpenRouter HTTP {status_code} with model {model}: {e.response.text}")
                    
                    if status_code == 429:
                        logger.info(f"OpenRouter: model {model} rate limited, trying next model")
                        break
                    elif status_code == 400:
                        logger.warning(f"OpenRouter: model {model} is invalid (400), removing from list")
                        if model in self.all_models:
                            self.all_models.remove(model)
                        break
                    elif status_code in [401, 403] and api_attempt == 0:
                        if self._switch_to_fallback():
                            logger.info(f"Retrying with fallback API key (status: {status_code})")
                            continue
                        break
                    else:
                        break

                except Exception as e:
                    last_error = e
                    logger.warning(f"OpenRouter error with model {model}: {type(e).__name__}: {e}")
                    if api_attempt == 0 and self._switch_to_fallback():
                        logger.info(f"Retrying with fallback API key (error: {type(e).__name__})")
                        continue
                    break

        logger.error(f"OpenRouter: all models failed after trying {len(models_to_try)} models")
        if last_error:
            raise last_error
        raise RuntimeError("OpenRouter: all models failed")
    
    def _build_prompt(self, text: str, criteria: Dict[str, Any]) -> str:
        return f"""You are Sentury AI, an expert customer experience (CX) evaluator.
Evaluate the following customer service response written in Portuguese.
Ensure your feedback comments and suggestions are written in PORTUGUESE.

RESPONSE: {text}

CRITERIA: Empathy, Clarity, Professional tone, Next step

Respond EXCLUSIVELY with valid JSON matching this structure:
{{
  "status": "aprovado" or "revisar",
  "confianca": 0.0-1.0,
  "feedback": {{
    "empatia": {{"score": 0-10, "comentario": "comentario em portugues"}},
    "clareza": {{"score": 0-10, "comentario": "comentario em portugues"}},
    "tom_profissional": {{"score": 0-10, "comentario": "comentario em portugues"}},
    "proximo_passo": {{"score": 0-10, "comentario": "comentario em portugues"}}
  }},
  "sugestoes": ["sugestao em portugues"]
}}"""
    
    def _parse_response(self, response_text: str) -> Dict[str, Any]:
        import json
        import re

        json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', response_text, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group())

                if "status" in parsed and "confianca" in parsed:
                    if "feedback" not in parsed:
                        parsed["feedback"] = {}
                    if "sugestoes" not in parsed:
                        parsed["sugestoes"] = []

                    feedback = parsed["feedback"]
                    for criterio in ["empatia", "clareza", "tom_profissional", "proximo_passo"]:
                        if criterio not in feedback or not isinstance(feedback[criterio], dict):
                            feedback[criterio] = {"score": 7, "comentario": "Critério atendido"}
                        else:
                            if "score" not in feedback[criterio]:
                                feedback[criterio]["score"] = 7
                            if "comentario" not in feedback[criterio]:
                                feedback[criterio]["comentario"] = "Critério atendido"
                    
                    return parsed
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"OpenRouter JSON parse error (fast fallback): {type(e).__name__}")

        return {
            "status": "revisar",
            "confianca": 0.6,
            "feedback": {
                "empatia": {"score": 6, "comentario": "Avaliação automática"},
                "clareza": {"score": 6, "comentario": "Avaliação automática"},
                "tom_profissional": {"score": 6, "comentario": "Avaliação automática"},
                "proximo_passo": {"score": 6, "comentario": "Avaliação automática"},
            },
            "sugestoes": [],
        }
    
    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"OpenRouter health check failed: {e}")
            return False
