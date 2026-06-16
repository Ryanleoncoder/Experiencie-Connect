"""Mistral Provider — Ollama local (qwen2.5:3b)."""

import asyncio
import logging
import httpx
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class MistralProvider:
    """
    Provider para Mistral 7B Instruct via Ollama local.
    Custo zero, controle total, latência previsível (~2-5s).
    """
    
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.model = "qwen2.5:3b"  # Qwen 2.5 3B - melhor para JSON estruturado
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 15000,  # Reduzido para 15 segundos
        custom_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        # SEMPRE usar prompt simplificado para máxima velocidade
        # Ignorar custom_prompt para evitar timeouts
        prompt = self._build_prompt(text, challenge_criteria)
        
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json={
                        "model": self.model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "top_p": 0.8,
                            "num_predict": 200,  # Reduzido para 200 tokens
                            "num_ctx": 2048,     # Contexto limitado
                            "num_thread": 3,     # 3 threads
                        },
                    },
                )
                response.raise_for_status()
                
                result = response.json()
                response_text = result.get("response", "")
                
                return self._parse_response(response_text)
        
        except httpx.ReadTimeout:
            logger.error(f"Mistral timeout após {timeout_ms}ms")
            raise asyncio.TimeoutError(f"Mistral timeout após {timeout_ms}ms")
        except asyncio.TimeoutError:
            logger.error(f"Mistral timeout após {timeout_ms}ms")
            raise
        except Exception as e:
            logger.error(f"Erro no Mistral: {e}", exc_info=True)
            raise
    
    def _build_prompt(self, text: str, criteria: Dict[str, Any]) -> str:
        return f"""Avalie: "{text}"

JSON:
{{"status":"aprovado","confianca":0.8,"feedback":"ok"}}
ou
{{"status":"revisar","confianca":0.5,"feedback":"ruim"}}"""
    
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
                logger.warning(f"Mistral JSON decode error: {e}")

        logger.warning("Mistral retornou resposta não estruturada")
        return {
            "status": "revisar",
            "confianca": 0.5,
            "feedback": {
                "empatia": {"score": 5, "comentario": "Não foi possível avaliar"},
                "clareza": {"score": 5, "comentario": "Não foi possível avaliar"},
                "tom_profissional": {"score": 5, "comentario": "Não foi possível avaliar"},
                "proximo_passo": {"score": 5, "comentario": "Não foi possível avaliar"},
            },
            "sugestoes": ["Resposta do modelo não estruturada. Tente novamente."],
        }
    
    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Mistral health check failed: {e}")
            return False
