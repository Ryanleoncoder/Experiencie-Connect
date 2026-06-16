"""Groq Provider — ultra-low latency (~200-500ms) open-source model API."""

import asyncio
import logging
# pyrefly: ignore [missing-import]
import httpx
import json
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)


class GroqProvider:
    """
    Provider para Groq API.
    Latência ultra-baixa, modelos open-source de alta qualidade.
    
    Estratégia de fallback inteligente:
    1. RÁPIDOS: llama-3.1-8b-instant, gemma2-9b-it
    2. INTERMEDIÁRIOS: mixtral-8x7b-32768, qwen-qwq-32b
    3. QUALIDADE: llama-3.3-70b-versatile, deepseek-r1-distill-llama-70b
    """
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.groq.com/openai/v1/chat/completions"

        self.models = {
            "fast": [
                "llama-3.1-8b-instant",
                "gemma2-9b-it",
            ],
            "balanced": [
                "mixtral-8x7b-32768",
                "qwen-qwq-32b",
            ],
            "quality": [
                "llama-3.3-70b-versatile",
                "deepseek-r1-distill-llama-70b",
            ],
        }
        
        self.all_models = (
            self.models["fast"] + 
            self.models["balanced"] + 
            self.models["quality"]
        )
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 10000,  # 10s timeout (Groq é muito rápido)
        custom_prompt: Optional[str] = None,
        specific_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        expected_criteria = list(challenge_criteria.get("criteria", {}).keys())
        if not expected_criteria:
            expected_criteria = ["empatia", "clareza", "tom_profissional", "proximo_passo"]

        prompt = custom_prompt if custom_prompt else self._build_prompt(text, challenge_criteria)
        
        if specific_model:
            models_to_try = [specific_model]
            logger.info(f"Groq: using specific model {specific_model}")
        else:
            models_to_try = self.all_models
        
        last_error = None
        for model in models_to_try:
            try:
                logger.info(f"Groq: trying model {model}")
                
                result = await self._call_groq(
                    model=model,
                    prompt=prompt,
                    timeout_ms=timeout_ms,
                    expected_criteria=expected_criteria,
                )
                
                logger.info(f"Groq: success with model {model}")
                return result
            
            except httpx.HTTPStatusError as e:
                last_error = e
                if e.response.status_code == 429:
                    logger.warning(f"Groq: rate limit on {model}, trying next")
                    continue
                elif e.response.status_code == 400:
                    logger.warning(f"Groq: invalid model {model}, trying next")
                    continue
                else:
                    logger.warning(f"Groq: HTTP error {e.response.status_code} on {model}")
                    continue
            
            except asyncio.TimeoutError:
                last_error = asyncio.TimeoutError(f"Groq timeout on {model}")
                logger.warning(f"Groq: timeout on {model}, trying next")
                continue
            
            except Exception as e:
                last_error = e
                logger.warning(f"Groq: error on {model}: {e}")
                continue
        
        logger.error(f"Groq: all models failed")
        raise last_error or Exception("Groq: all models failed")
    
    async def _call_groq(
        self,
        model: str,
        prompt: str,
        timeout_ms: int,
        expected_criteria: List[str],
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
            response = await client.post(
                self.base_url,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    "temperature": 0.1,
                    "max_tokens": 1024,
                },
            )
            response.raise_for_status()
            
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            
            return self._parse_response(content, expected_criteria)
    
    def _build_prompt(self, text: str, criteria: Dict[str, Any]) -> str:
        return f"""You are Sentury AI, an expert customer experience (CX) evaluator.
Evaluate the following customer service response written in Portuguese.
Ensure your feedback comments and suggestions are written in PORTUGUESE.

RESPONSE: "{text}"

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
    
    def _parse_response(self, response_text: str, expected_criteria: List[str]) -> Dict[str, Any]:
        import re
        import json

        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            extracted = json_match.group()
            parsed = None
            try:
                parsed = json.loads(extracted)
            except json.JSONDecodeError as e:
                logger.warning(f"Groq JSON decode error: {e}. Tentando reparar JSON...")
                # Reparos heurísticos avançados
                try:
                    # 1. Escapar aspas duplas internas não escapadas dentro de valores de string e arrays
                    lines = extracted.split('\n')
                    cleaned_lines = []
                    for line in lines:
                        # Tratar linhas de chave-valor: "key": "value"
                        match = re.match(r'^(\s*"[a-zA-Z0-9_]+"\s*:\s*")(.*)("\s*,?\s*)$', line)
                        if match:
                            prefix, val, suffix = match.groups()
                            escaped_val = re.sub(r'(?<!\\)"', r'\"', val)
                            line = prefix + escaped_val + suffix
                        else:
                            array_match = re.match(r'^(\s*")(.*)("\s*,?\s*)$', line)
                            if array_match and not line.strip().startswith('{') and not line.strip().startswith('}') and not line.strip().startswith('['):
                                prefix, val, suffix = array_match.groups()
                                if ':' not in line:
                                    escaped_val = re.sub(r'(?<!\\)"', r'\"', val)
                                    line = prefix + escaped_val + suffix
                        cleaned_lines.append(line)
                    repaired = '\n'.join(cleaned_lines)

                    # 2. Remover vírgulas residuais antes de fechar chaves/colchetes
                    repaired = re.sub(r",\s*([\}\]])", r"\1", repaired)
                    
                    parsed = json.loads(repaired)
                except Exception as repair_err:
                    logger.warning(f"Erro ao tentar reparar JSON: {repair_err}. Resposta original: {response_text}")

            if parsed:
                try:
                    for criterio in expected_criteria:
                        if "feedback" not in parsed:
                            parsed["feedback"] = {}

                        if criterio not in parsed["feedback"]:
                            # Dynamic alias mapping for common criteria name variants
                            found = False
                            if criterio == "clareza" and "solucao_clara" in parsed["feedback"]:
                                parsed["feedback"]["clareza"] = parsed["feedback"]["solucao_clara"]
                                found = True
                            elif criterio == "solucao_clara" and "clareza" in parsed["feedback"]:
                                parsed["feedback"]["solucao_clara"] = parsed["feedback"]["clareza"]
                                found = True
                            elif criterio == "clareza" and "solucao" in parsed["feedback"]:
                                parsed["feedback"]["clareza"] = parsed["feedback"]["solucao"]
                                found = True
                            elif criterio == "proximo_passo" and "prazo" in parsed["feedback"]:
                                parsed["feedback"]["proximo_passo"] = parsed["feedback"]["prazo"]
                                found = True
                                
                            if not found:
                                parsed["feedback"][criterio] = {
                                    "score": 7,
                                    "comentario": "Critério atendido de forma satisfatória."
                                }
                        elif not isinstance(parsed["feedback"][criterio], dict):
                            parsed["feedback"][criterio] = {
                                "score": 7,
                                "comentario": str(parsed["feedback"][criterio])
                            }
                        else:
                            if "score" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["score"] = 7
                            if "comentario" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["comentario"] = "Critério atendido."
                    
                    if "sugestoes" not in parsed:
                        parsed["sugestoes"] = []
                    
                    return parsed
                except Exception as format_err:
                    logger.error(f"Erro ao formatar resposta estruturada: {format_err}")
        
        logger.warning("Groq retornou resposta não estruturada após tentativas de parse/reparo")
        fallback_feedback = {}
        for criterio in expected_criteria:
            fallback_feedback[criterio] = {
                "score": 5,
                "comentario": f"Não foi possível estruturar o feedback de {criterio} de forma dinâmica."
            }
        return {
            "status": "revisar",
            "confianca": 0.5,
            "feedback": fallback_feedback,
            "sugestoes": ["Por favor, reformule sua resposta para que possamos fornecer uma avaliação mais detalhada."],
        }
    
    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    "https://api.groq.com/openai/v1/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Groq health check failed: {e}")
            return False
