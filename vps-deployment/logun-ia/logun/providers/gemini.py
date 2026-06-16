"""Gemini Provider — Gemini Flash free tier."""

import asyncio
import logging
import httpx
import os
from typing import Dict, Any

logger = logging.getLogger(__name__)


class GeminiProvider:
    
    def __init__(self):
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")  # Free tier
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 10000,
        custom_prompt: str = None,
    ) -> Dict[str, Any]:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY não configurada")
        
        prompt = custom_prompt if custom_prompt else self._build_prompt(text, challenge_criteria)
        
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
                response = await client.post(
                    f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}",
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{
                            "parts": [{"text": prompt}]
                        }],
                        "generationConfig": {
                            "temperature": 0.7,
                            "maxOutputTokens": 500,
                        },
                    },
                )
                response.raise_for_status()
                
                result = response.json()
                response_text = result["candidates"][0]["content"]["parts"][0]["text"]
                
                return self._parse_response(response_text)
        
        except httpx.ReadTimeout:
            logger.error(f"Gemini timeout após {timeout_ms}ms")
            raise asyncio.TimeoutError(f"Gemini timeout após {timeout_ms}ms")
        except asyncio.TimeoutError:
            logger.error(f"Gemini timeout após {timeout_ms}ms")
            raise
        except Exception as e:
            logger.error(f"Erro no Gemini: {e}", exc_info=True)
            raise
    
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

        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group())

                if "status" in parsed and "confianca" in parsed:
                    if "feedback" not in parsed or not isinstance(parsed["feedback"], dict):
                        parsed["feedback"] = {}

                    criterios = ["empatia", "clareza", "tom_profissional", "proximo_passo"]
                    for criterio in criterios:
                        if criterio not in parsed["feedback"]:
                            parsed["feedback"][criterio] = {"score": 7, "comentario": "Critério atendido"}
                        elif not isinstance(parsed["feedback"][criterio], dict):
                            parsed["feedback"][criterio] = {"score": 7, "comentario": str(parsed["feedback"][criterio])}
                        else:
                            if "score" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["score"] = 7
                            if "comentario" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["comentario"] = "Critério atendido"

                    if "sugestoes" not in parsed:
                        parsed["sugestoes"] = []

                    return parsed
            except json.JSONDecodeError as e:
                logger.warning(f"Gemini JSON decode error: {e}")
        
        return {
            "status": "revisar",
            "confianca": 0.5,
            "feedback": {
                "empatia": {"score": 5, "comentario": "Não foi possível avaliar"},
                "clareza": {"score": 5, "comentario": "Não foi possível avaliar"},
                "tom_profissional": {"score": 5, "comentario": "Não foi possível avaliar"},
                "proximo_passo": {"score": 5, "comentario": "Não foi possível avaliar"},
            },
            "sugestoes": ["Resposta não estruturada"],
        }
    
    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/models?key={self.api_key}"
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Gemini health check failed: {e}")
            return False
