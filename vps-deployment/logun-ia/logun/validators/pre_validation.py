"""
Pré-validação - Camada 2
Valida tamanho, formato e caracteres do input
"""

import logging
from typing import Tuple
from ..config.logun import LogunConfig
from ..config.constants import ErrorMessages

logger = logging.getLogger(__name__)


class PreValidator:
    """
    Valida formato e tamanho do input antes de enviar para IA.
    Segunda camada de validação.
    """
    
    def __init__(self):
        self.min_length = LogunConfig.MIN_TEXT_LENGTH
        self.max_length = LogunConfig.MAX_TEXT_LENGTH
    
    def validate(self, text: str) -> Tuple[bool, str]:
        """
        Valida formato do texto.
        
        Args:
            text: Texto a ser validado
        
        Returns:
            Tuple (is_valid, reason)
        """
        # Verifica se texto está vazio
        if not text or not text.strip():
            return False, "Texto vazio"
        
        # Verifica tamanho mínimo
        if len(text) < self.min_length:
            return False, ErrorMessages.TEXT_TOO_SHORT.format(min=self.min_length)
        
        # Verifica tamanho máximo
        if len(text) > self.max_length:
            return False, ErrorMessages.TEXT_TOO_LONG.format(max=self.max_length)
        
        # Verifica se contém apenas espaços
        if text.isspace():
            return False, "Texto contém apenas espaços"
        
        # Verifica se contém caracteres imprimíveis
        if not any(c.isprintable() for c in text):
            return False, ErrorMessages.INVALID_FORMAT
        
        return True, ""
    
    def normalize(self, text: str) -> str:
        """
        Normaliza texto para processamento.
        
        Args:
            text: Texto a ser normalizado
        
        Returns:
            Texto normalizado
        """
        text = ' '.join(text.split())
        
        text = text.strip()
        
        return text
