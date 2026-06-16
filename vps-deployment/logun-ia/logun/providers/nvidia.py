"""NVIDIA NIM Provider — external GPU fallback."""

import asyncio
import logging
# pyrefly: ignore [missing-import]
import httpx
import os
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class NvidiaProvider:
    """
    Provider para NVIDIA NIM API.
    Fallback GPU externo - variável mas confiável.
    
    Posição no router: Após OpenRouter, antes do Ollama
    Uso: Quando Groq/OpenRouter/Gemini falham ou estão lentos
    """
    
    def __init__(self):
        self.base_url = "https://integrate.api.nvidia.com/v1"
        self.api_key = os.getenv("NVIDIA_API_KEY", "")
        
        # Modelo único disponível (testado e funcional)
        self.default_model = "meta/llama-4-maverick-17b-128e-instruct"
        
        # Nota: Outros modelos testados não funcionam:
        # - meta/llama-3.1-8b-instruct: Timeout (>30s)
        # - mistralai/mistral-7b-instruct: 404 (não existe)
        # - google/gemma-2-9b-it: 410 (end of life)
        # - qwen/qwen2.5-7b-instruct: 410 (end of life)
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 20000,  # 20s timeout (GPU variável)
        custom_prompt: str = None,
        specific_model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Valida resposta usando NVIDIA NIM.
        
        Args:
            text: Texto da resposta
            challenge_criteria: Critérios de avaliação
            timeout_ms: Timeout em ms
            custom_prompt: Prompt personalizado (opcional)
            specific_model: Modelo específico (opcional)
        
        Returns:
            Dict com resultado da validação
        """
        if not self.api_key:
            raise ValueError("NVIDIA_API_KEY não configurada")
        
        prompt = custom_prompt if custom_prompt else self._build_prompt(text, challenge_criteria)
        
        # Modelo a usar
        model = specific_model if specific_model else self.default_model
        
        logger.info(f"NVIDIA: using model {model}")
        
        try:
            async with httpx.AsyncClient(timeout=timeout_ms / 1000) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": [
                            {"role": "system", "content": "You are a customer service evaluator. You MUST respond with ONLY valid JSON. No explanations or text outside the JSON structure."},
                            {"role": "user", "content": self._build_simple_prompt(text)}
                        ],
                        "temperature": 0.1,  # Muito baixa para seguir formato
                        "max_tokens": 1024,
                    },
                )
                response.raise_for_status()
                
                result = response.json()
                response_text = result["choices"][0]["message"]["content"]
                
                logger.info(f"NVIDIA: success with model {model}, response_length={len(response_text)}")
                logger.info(f"NVIDIA: response_preview={response_text[:300]}")
                return self._parse_response(response_text)
        
        except httpx.ReadTimeout:
            logger.error(f"NVIDIA timeout após {timeout_ms}ms")
            raise asyncio.TimeoutError(f"NVIDIA timeout após {timeout_ms}ms")
        except httpx.HTTPStatusError as e:
            logger.error(f"NVIDIA HTTP error {e.response.status_code}: {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"NVIDIA error: {e}", exc_info=True)
            raise
    
    def _build_simple_prompt(self, text: str) -> str:
        """Constrói prompt simples e direto que força JSON"""
        return f"""Evaluate this customer service response and return ONLY JSON:

RESPONSE: {text}

Return this exact JSON structure (no other text):
{{
  "status": "aprovado" or "revisar",
  "confianca": 0.0-1.0,
  "feedback": {{
    "empatia": {{"score": 0-10, "comentario": "comment"}},
    "clareza": {{"score": 0-10, "comentario": "comment"}},
    "tom_profissional": {{"score": 0-10, "comentario": "comment"}},
    "proximo_passo": {{"score": 0-10, "comentario": "comment"}}
  }},
  "sugestoes": ["suggestion"]
}}"""
    
    def _build_prompt(self, text: str, criteria: Dict[str, Any]) -> str:
        """Constrói prompt otimizado para NVIDIA com JSON enforcement"""
        return f"""You are Sentury AI, an expert customer experience (CX) evaluator. Evaluate the following response.

RESPONSE: {text}

CRITERIA: Empathy, Clarity, Professional tone, Next step

YOU MUST respond with ONLY valid JSON. No explanations, no text before or after. ONLY JSON.

JSON FORMAT (copy this structure exactly):
{{
  "status": "aprovado",
  "confianca": 0.9,
  "feedback": {{
    "empatia": {{"score": 8, "comentario": "Shows empathy"}},
    "clareza": {{"score": 9, "comentario": "Clear and direct"}},
    "tom_profissional": {{"score": 9, "comentario": "Professional tone"}},
    "proximo_passo": {{"score": 9, "comentario": "Clear next step"}}
  }},
  "sugestoes": ["suggestion 1", "suggestion 2"]
}}

RESPOND WITH JSON ONLY. START WITH {{ and END WITH }}. NO OTHER TEXT."""
    
    def _parse_response(self, response_text: str) -> Dict[str, Any]:
        """Parse resposta com fallback rápido"""
        import json
        import re
        
        response_text = re.sub(r'```json\s*', '', response_text)
        response_text = re.sub(r'```\s*$', '', response_text)
        response_text = response_text.strip()
        
        # Extração recursiva de JSON com balanceamento de chaves
        def extract_json_recursive(text: str) -> str:
            """Extrai JSON com balanceamento correto de chaves (suporta múltiplos níveis)"""
            start = text.find('{')
            if start == -1:
                return None
            
            brace_count = 0
            in_string = False
            escape_next = False
            
            for i in range(start, len(text)):
                char = text[i]
                
                if escape_next:
                    escape_next = False
                    continue
                
                if char == '\\':
                    escape_next = True
                    continue
                
                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue
                
                if not in_string:
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            return text[start:i+1]
            
            return None
        
        # Tenta extrair JSON com balanceamento recursivo
        json_text = extract_json_recursive(response_text)
        logger.info(f"NVIDIA: extract_json_recursive returned {len(json_text) if json_text else 0} chars")
        if json_text:
            logger.info(f"NVIDIA: json_text_preview={json_text[:300]}")
            try:
                parsed = json.loads(json_text)
                logger.info(f"NVIDIA: JSON parsed successfully, keys={list(parsed.keys())}")
                
                # Validação rápida
                if "status" in parsed and "confianca" in parsed:
                    # Garantir estrutura mínima
                    if "feedback" not in parsed:
                        parsed["feedback"] = {}
                    if "sugestoes" not in parsed:
                        parsed["sugestoes"] = []
                    
                    # Garantir critérios básicos
                    feedback = parsed["feedback"]
                    for criterio in ["empatia", "clareza", "tom_profissional", "proximo_passo"]:
                        if criterio not in feedback or not isinstance(feedback[criterio], dict):
                            feedback[criterio] = {"score": 7, "comentario": "Critério atendido"}
                        else:
                            if "score" not in feedback[criterio]:
                                feedback[criterio]["score"] = 7
                            if "comentario" not in feedback[criterio]:
                                feedback[criterio]["comentario"] = "Critério atendido"
                    
                    logger.info(f"NVIDIA: parsed successfully - status={parsed['status']}, confianca={parsed['confianca']}")
                    return parsed
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"NVIDIA JSON parse error: {type(e).__name__} - {e}")
        
        logger.warning(f"NVIDIA: falling back to default response (no valid JSON found)")
        
        # Fallback rápido
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
        """Verifica se NVIDIA NIM está acessível"""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"}
                )
                return response.status_code == 200
        except Exception as e:
            logger.error(f"NVIDIA health check failed: {e}")
            return False
