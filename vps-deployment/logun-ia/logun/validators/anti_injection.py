"""
Anti Prompt Injection - Camada 1
Detecta tentativas de manipulação do prompt
"""

import re
import logging
from typing import Tuple
from ..config.logun import LogunConfig

logger = logging.getLogger(__name__)


class AntiInjectionValidator:
    """
    Valida input contra tentativas de prompt injection.
    Primeira camada de defesa.
    """
    
    def __init__(self):
        self.patterns = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in LogunConfig.INJECTION_PATTERNS
        ]
    
    def validate(self, text: str) -> Tuple[bool, str]:
        """
        Valida texto contra padrões de prompt injection.
        
        Args:
            text: Texto a ser validado
        
        Returns:
            Tuple (is_valid, reason)
            - is_valid: True se texto é seguro, False se detectou injection
            - reason: Motivo da rejeição (vazio se válido)
        """
        for pattern in self.patterns:
            if pattern.search(text):
                logger.warning(
                    f"Prompt injection detected: pattern={pattern.pattern}"
                )
                return False, "Tentativa de manipulação detectada"
        
        return True, ""
    
    def sanitize(self, text: str) -> str:
        """
        Sanitiza texto removendo caracteres perigosos.
        
        Args:
            text: Texto a ser sanitizado
        
        Returns:
            Texto sanitizado
        """
        text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', text)
        
        text = re.sub(r'\s+', ' ', text)
        
        text = text.strip()
        
        return text
