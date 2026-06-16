"""
TinyLlama Provider - Ollama local
Ultra-rápido (~1-2s), fallback antes do Rule Engine
"""

import asyncio
import logging
import httpx
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class TinyLlamaProvider:
    """
    Provider para TinyLlama via Ollama local.
    Ultra-rápido, baixa qualidade, mas melhor que Rule Engine.
    Usado como último fallback antes do Rule Engine.
    """
    
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.model = "tinyllama:latest"
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 5000,  # 5s - deve ser ultra-rápido
        custom_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Valida resposta textual usando TinyLlama.
        
        Args:
            text: Texto da resposta do usuário
            challenge_criteria: Critérios de avaliação
            timeout_ms: Timeout em milissegundos
            custom_prompt: Prompt personalizado (opcional)
        
        Returns:
            Dict com resultado da validação
        """
        if custom_prompt:
            prompt = custom_prompt
        else:
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
                            "num_predict": 50,  # Resposta curta
                        },
                    },
                )
                response.raise_for_status()
                
                result = response.json()
                response_text = result.get("response", "")
                
                return self._parse_response(response_text)
        
        except httpx.ReadTimeout:
            logger.error(f"TinyLlama timeout após {timeout_ms}ms")
            raise asyncio.TimeoutError(f"TinyLlama timeout após {timeout_ms}ms")
        except asyncio.TimeoutError:
            logger.error(f"TinyLlama timeout após {timeout_ms}ms")
            raise
        except Exception as e:
            logger.error(f"Erro no TinyLlama: {e}", exc_info=True)
            raise
    
    def _build_prompt(self, text: str, criteria: Dict[str, Any]) -> str:
        """Constrói prompt ultra simples para TinyLlama"""
        return f"""Avalie esta resposta de atendimento: "{text}"

Responda em JSON:
{{"status":"aprovado","confianca":0.7,"feedback":"boa resposta"}}
ou
{{"status":"revisar","confianca":0.4,"feedback":"precisa melhorar"}}"""
    
    def _parse_response(self, response_text: str) -> Dict[str, Any]:
        """Parse resposta do TinyLlama para formato padronizado"""
        import json
        import re
        
        # Tenta extrair JSON da resposta
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
                # Garantir estrutura mínima
                if "status" in parsed and "confianca" in parsed:
                    # Garantir que feedback existe e tem estrutura correta
                    if "feedback" not in parsed or not isinstance(parsed["feedback"], dict):
                        parsed["feedback"] = {}
                    
                    # Garantir que cada critério tem score e comentario
                    criterios = ["empatia", "clareza", "tom_profissional", "proximo_passo"]
                    for criterio in criterios:
                        if criterio not in parsed["feedback"]:
                            parsed["feedback"][criterio] = {
                                "score": 7,
                                "comentario": "Critério atendido"
                            }
                        elif not isinstance(parsed["feedback"][criterio], dict):
                            parsed["feedback"][criterio] = {
                                "score": 7,
                                "comentario": str(parsed["feedback"][criterio])
                            }
                        else:
                            # Garantir que tem score e comentario
                            if "score" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["score"] = 7
                            if "comentario" not in parsed["feedback"][criterio]:
                                parsed["feedback"][criterio]["comentario"] = "Critério atendido"
                    
                    if "sugestoes" not in parsed:
                        parsed["sugestoes"] = []
                    
                    return parsed
            except json.JSONDecodeError as e:
                logger.warning(f"TinyLlama JSON decode error: {e}")
        
        # Fallback: resposta não estruturada
        logger.warning("TinyLlama retornou resposta não estruturada")
        return {
            "status": "revisar",
            "confianca": 0.4,
            "feedback": {
                "empatia": {"score": 4, "comentario": "Avaliação básica - modelo pequeno"},
                "clareza": {"score": 4, "comentario": "Avaliação básica - modelo pequeno"},
                "tom_profissional": {"score": 4, "comentario": "Avaliação básica - modelo pequeno"},
                "proximo_passo": {"score": 4, "comentario": "Avaliação básica - modelo pequeno"},
            },
            "sugestoes": ["Considere revisar a resposta"],
        }
    
    async def health_check(self) -> bool:
        """Verifica se Ollama está acessível"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            logger.error(f"TinyLlama health check failed: {e}")
            return False
