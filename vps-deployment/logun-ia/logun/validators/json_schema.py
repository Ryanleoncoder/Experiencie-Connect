"""
JSON Schema Validator - Camada 5
Valida resposta JSON dos provedores de IA
"""

import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger(__name__)


class JSONSchemaValidator:
    """
    Valida resposta JSON dos provedores contra schema esperado.
    Quinta camada de validação.
    """
    
    def __init__(self):
        self.required_fields = ["status", "confianca", "feedback"]
        self.valid_statuses = ["aprovado", "revisar", "erro"]
        self.required_criteria = ["empatia", "clareza", "tom_profissional", "proximo_passo"]
    
    def validate(self, response: Dict[str, Any], required_criteria: list = None) -> Tuple[bool, str]:
        """
        Valida resposta JSON contra schema.
        
        Args:
            response: Resposta do provedor
            required_criteria: Lista de critérios requeridos (opcional)
        
        Returns:
            Tuple (is_valid, reason)
        """
        if required_criteria is None:
            required_criteria = self.required_criteria

        # Verifica campos obrigatórios
        for field in self.required_fields:
            if field not in response:
                return False, f"Campo obrigatório ausente: {field}"
        
        # Valida status
        if response["status"] not in self.valid_statuses:
            return False, f"Status inválido: {response['status']}"
        
        # Valida confiança
        try:
            confianca = float(response["confianca"])
            if not (0.0 <= confianca <= 1.0):
                return False, "Confiança deve estar entre 0.0 e 1.0"
        except (ValueError, TypeError):
            return False, "Confiança deve ser um número"
        
        # Valida feedback
        feedback = response.get("feedback", {})
        if not isinstance(feedback, dict):
            return False, "Feedback deve ser um dicionário"
        
        for criterio in required_criteria:
            if criterio not in feedback:
                return False, f"Critério ausente no feedback: {criterio}"
            
            criterio_data = feedback[criterio]
            if not isinstance(criterio_data, dict):
                return False, f"Dados do critério {criterio} devem ser um dicionário"
            
            if "score" not in criterio_data:
                return False, f"Score ausente no critério {criterio}"
            
            try:
                score = int(criterio_data["score"])
                if not (0 <= score <= 10):
                    return False, f"Score do critério {criterio} deve estar entre 0 e 10"
            except (ValueError, TypeError):
                return False, f"Score do critério {criterio} deve ser um número"
        
        return True, ""
    
    def normalize(self, response: Dict[str, Any], required_criteria: list = None) -> Dict[str, Any]:
        """
        Normaliza resposta para formato padrão.
        
        Args:
            response: Resposta do provedor
            required_criteria: Lista de critérios requeridos (opcional)
        
        Returns:
            Resposta normalizada
        """
        if required_criteria is None:
            required_criteria = self.required_criteria

        normalized = {
            "status": response.get("status", "revisar"),
            "confianca": float(response.get("confianca", 0.5)),
            "feedback": {},
            "sugestoes": response.get("sugestoes", []),
        }
        
        # Normaliza feedback
        feedback = response.get("feedback", {})
        for criterio in required_criteria:
            if criterio in feedback:
                criterio_data = feedback[criterio]
                normalized["feedback"][criterio] = {
                    "score": int(criterio_data.get("score", 5)),
                    "comentario": str(criterio_data.get("comentario", "")),
                }
            else:
                # Valor padrão se critério ausente
                normalized["feedback"][criterio] = {
                    "score": 5,
                    "comentario": "Não avaliado",
                }
        
        return normalized
