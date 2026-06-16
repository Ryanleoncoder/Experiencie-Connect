"""
PII Filter - Detecta e remove/anonimiza dados pessoais identificáveis

Protege contra envio de dados sensíveis para IA externa:
- CPF
- Email
- Telefone (BR)
- CEP
- Nomes próprios (heurística)
- Endereços (rua, avenida, etc.)

Conformidade LGPD: Art. 46 - Segurança e prevenção de incidentes

Modo inteligente: Se detectar PII + resposta fora de contexto → BLOQUEIA
"""

import re
import logging
from typing import Tuple, List, Dict, Any, Optional

logger = logging.getLogger(__name__)


class PIIFilter:
    """
    Filtro de PII (Personally Identifiable Information)
    Detecta e remove/anonimiza dados pessoais antes de enviar para IA
    
    Modo inteligente: Bloqueia respostas com PII que estão fora de contexto
    """
    
    def __init__(self, mode: str = "smart"):
        """
        Args:
            mode: "block" (rejeita texto), "anonymize" (substitui por [REMOVIDO]), 
                  "smart" (bloqueia se PII + fora de contexto, senão anonimiza)
        """
        self.mode = mode
        
        # Padrões de detecção
        self.patterns = {
            "cpf": [
                # CPF formatado: 123.456.789-00
                r'\b\d{3}\.\d{3}\.\d{3}-\d{2}\b',
                # CPF sem formatação: 12345678900
                r'\b\d{11}\b',
            ],
            "email": [
                # Email padrão: usuario@dominio.com
                r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
            ],
            "telefone": [
                # Telefone BR formatado: (11) 98765-4321, (11) 3456-7890
                r'\(?\d{2}\)?\s*9?\d{4}-?\d{4}\b',
                # Telefone com +55: +55 11 98765-4321
                r'\+55\s*\(?\d{2}\)?\s*9?\d{4}-?\d{4}\b',
                # Telefone sem formatação: 11987654321
                r'\b\d{10,11}\b',
            ],
            "cep": [
                # CEP formatado: 12345-678
                r'\b\d{5}-\d{3}\b',
                # CEP sem formatação: 12345678
                r'\b\d{8}\b',
            ],
            "endereco": [
                # Rua, Avenida, Alameda + número
                r'\b(rua|avenida|av\.|alameda|travessa|praça)\s+[A-Za-zÀ-ÿ\s]+,?\s*\d+',
            ],
        }
        
        # Lista de nomes próprios comuns brasileiros (top 100)
        # Usado para detectar "Meu nome é João" ou "Sou Maria"
        self.common_names = {
            # Masculinos
            "joão", "josé", "antonio", "francisco", "carlos", "paulo", "pedro", "lucas", 
            "luiz", "marcos", "luis", "gabriel", "rafael", "daniel", "marcelo", "bruno",
            "rodrigo", "felipe", "gustavo", "eduardo", "andre", "fernando", "fabio",
            # Femininos
            "maria", "ana", "francisca", "antonia", "adriana", "juliana", "marcia", 
            "fernanda", "patricia", "aline", "juliane", "camila", "amanda", "leticia",
            "bruna", "jessica", "tatiana", "vanessa", "carla", "sandra", "monica",
        }
        
        # Padrões de resposta fora de contexto (indicam que pessoa está falando de si)
        self.off_topic_patterns = [
            r'\b(trabalho|atuo|sou|faço|exerço)\s+(com|na|no|em|como)',
            r'\b(meu|minha)\s+(empresa|trabalho|cargo|função|área)',
            r'\b(me\s+chamo|meu\s+nome\s+é|sou\s+o|sou\s+a)',
        ]
    
    def validate(self, text: str, question: Optional[str] = None) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Valida texto e detecta PII
        
        Args:
            text: Texto da resposta do usuário
            question: Pergunta do desafio (opcional, para validação contextual)
        
        Returns:
            (is_valid, reason, metadata)
            - is_valid: False se detectou PII e mode="block" ou "smart" + fora de contexto
            - reason: Mensagem de erro ou "OK"
            - metadata: Detalhes sobre PII detectado
        """
        detected_pii = self._detect_pii(text)
        
        if not detected_pii:
            return True, "OK", {}
        
        # Monta mensagem de erro
        pii_types = list(detected_pii.keys())
        pii_count = sum(len(v) for v in detected_pii.values())
        
        logger.warning(
            f"PII detectado: {pii_types} ({pii_count} ocorrências)"
        )
        
        # Modo BLOCK: sempre rejeita
        if self.mode == "block":
            return False, f"Dados pessoais detectados: {', '.join(pii_types)}", detected_pii
        
        # Modo SMART: verifica se resposta está fora de contexto
        if self.mode == "smart":
            is_off_topic = self._is_off_topic(text)
            is_too_short = len(text.strip()) < 50
            
            # Se PII + (fora de contexto OU muito curta) → BLOQUEIA
            if is_off_topic or is_too_short:
                logger.warning(
                    f"PII + resposta suspeita detectada: "
                    f"off_topic={is_off_topic}, too_short={is_too_short}"
                )
                return False, (
                    "Sua resposta contém dados pessoais e parece estar fora do contexto da pergunta. "
                    "Por favor, responda focando na situação apresentada sem incluir informações pessoais."
                ), detected_pii
        
        # Mode = "anonymize" ou "smart" (mas resposta OK) - retorna válido mas com metadata
        return True, "PII detectado (será anonimizado)", detected_pii
    
    def anonymize(self, text: str) -> Tuple[str, Dict[str, Any]]:
        """
        Anonimiza texto substituindo PII por [REMOVIDO]
        
        Returns:
            (anonymized_text, metadata)
        """
        detected_pii = self._detect_pii(text)
        
        if not detected_pii:
            return text, {}
        
        anonymized = text
        replacements = []
        
        # Substitui cada tipo de PII
        for pii_type, matches in detected_pii.items():
            for match in matches:
                placeholder = f"[{pii_type.upper()}_REMOVIDO]"
                anonymized = anonymized.replace(match, placeholder)
                replacements.append({
                    "type": pii_type,
                    "original": match[:3] + "***",  # Mostra só primeiros 3 chars
                    "placeholder": placeholder
                })
        
        logger.info(
            f"Texto anonimizado: {len(replacements)} substituições "
            f"({list(detected_pii.keys())})"
        )
        
        return anonymized, {
            "anonymized": True,
            "replacements": replacements,
            "pii_types": list(detected_pii.keys())
        }
    
    def _is_off_topic(self, text: str) -> bool:
        """
        Verifica se resposta está fora de contexto (pessoa falando de si mesma)
        
        Indicadores:
        - "trabalho com", "atuo na", "sou gerente"
        - "minha empresa", "meu cargo"
        - "me chamo", "meu nome é"
        """
        text_lower = text.lower()
        
        for pattern in self.off_topic_patterns:
            if re.search(pattern, text_lower):
                return True
        
        return False
    
    def _detect_pii(self, text: str) -> Dict[str, List[str]]:
        """
        Detecta todos os tipos de PII no texto
        
        Returns:
            Dict com tipo de PII e lista de matches
            Ex: {"cpf": ["123.456.789-00"], "email": ["user@example.com"]}
        """
        detected = {}
        
        # 1. Detecta padrões via regex
        for pii_type, patterns in self.patterns.items():
            matches = []
            for pattern in patterns:
                found = re.findall(pattern, text, re.IGNORECASE)
                matches.extend(found)
            
            unique_matches = list(set(matches))
            validated = self._validate_matches(pii_type, unique_matches)
            
            if validated:
                detected[pii_type] = validated
        
        # 2. Detecta nomes próprios (heurística)
        names = self._detect_names(text)
        if names:
            detected["nome"] = names
        
        return detected
    
    def _validate_matches(self, pii_type: str, matches: List[str]) -> List[str]:
        """
        Valida matches para reduzir falsos positivos
        """
        validated = []
        
        for match in matches:
            if pii_type == "cpf":
                # Valida CPF (não pode ser sequência tipo 11111111111)
                digits = re.sub(r'\D', '', match)
                if len(digits) == 11 and not self._is_sequential(digits):
                    validated.append(match)
            
            elif pii_type == "telefone":
                # Valida telefone (deve ter 10 ou 11 dígitos)
                digits = re.sub(r'\D', '', match)
                if len(digits) in [10, 11]:
                    # Não pode ser sequência tipo 11111111111
                    if not self._is_sequential(digits):
                        validated.append(match)
            
            elif pii_type == "cep":
                # Valida CEP (8 dígitos, não sequencial)
                digits = re.sub(r'\D', '', match)
                if len(digits) == 8 and not self._is_sequential(digits):
                    validated.append(match)
            
            else:
                # Email e endereço: aceita todos os matches
                validated.append(match)
        
        return validated
    
    def _is_sequential(self, digits: str) -> bool:
        """
        Verifica se é sequência repetida (11111111111, 12345678901, etc.)
        """
        # Todos os dígitos iguais
        if len(set(digits)) == 1:
            return True
        
        # Sequência crescente/decrescente
        is_ascending = all(int(digits[i]) == int(digits[i-1]) + 1 for i in range(1, len(digits)))
        is_descending = all(int(digits[i]) == int(digits[i-1]) - 1 for i in range(1, len(digits)))
        
        return is_ascending or is_descending
    
    def _detect_names(self, text: str) -> List[str]:
        """
        Detecta nomes próprios usando heurística:
        1. Padrões como "Meu nome é X", "Sou X", "Me chamo X"
        2. Palavras capitalizadas que estão na lista de nomes comuns
        """
        detected_names = []
        text_lower = text.lower()
        
        # Padrão 1: "Meu nome é João", "Sou Maria", "Me chamo Pedro"
        name_patterns = [
            r'\b(meu\s+nome\s+é|me\s+chamo|sou)\s+([A-Z][a-zà-ÿ]+)',
            r'\b(nome|chamado|chamada):\s*([A-Z][a-zà-ÿ]+)',
        ]
        
        for pattern in name_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                # match é tupla: (prefixo, nome)
                name = match[1] if isinstance(match, tuple) else match
                if name.lower() in self.common_names:
                    detected_names.append(name)
        
        # Padrão 2: Palavras capitalizadas que são nomes comuns
        # (mais conservador - só detecta se estiver em contexto de apresentação)
        if any(phrase in text_lower for phrase in ["meu nome", "me chamo", "sou o", "sou a"]):
            words = text.split()
            for word in words:
                clean_word = re.sub(r'[^\w]', '', word)
                if clean_word and clean_word[0].isupper() and clean_word.lower() in self.common_names:
                    detected_names.append(clean_word)
        
        return list(set(detected_names))


# Instância global
pii_filter = PIIFilter(mode="smart")  # Modo padrão: smart (bloqueia se fora de contexto)


def validate_pii(text: str, question: Optional[str] = None) -> Tuple[bool, str]:
    """
    Função helper para validação rápida
    
    Returns:
        (is_valid, reason)
    """
    is_valid, reason, _ = pii_filter.validate(text, question)
    return is_valid, reason


def anonymize_pii(text: str) -> str:
    """
    Função helper para anonimização rápida
    
    Returns:
        Texto anonimizado
    """
    anonymized, _ = pii_filter.anonymize(text)
    return anonymized


