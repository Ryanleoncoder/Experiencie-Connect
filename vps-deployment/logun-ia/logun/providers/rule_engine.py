"""
Rule Engine Provider - Fallback final baseado em regex e padrões linguísticos
Simula comportamento de LLM usando apenas regras determinísticas
Garante que validação nunca falha
"""

import logging
import re
from typing import Dict, Any, List, Tuple

logger = logging.getLogger(__name__)


class RuleEngineProvider:
    """
    Provider baseado em regras, regex e padrões linguísticos.
    Fallback final que sempre funciona (sem dependência de IA externa).
    
    Estratégia:
    - Detecta padrões completos (regex) com maior peso
    - Considera contexto e negação
    - Avalia intenção, não apenas palavras isoladas
    """
    
    def __init__(self):
        # Padrões regex por critério (peso maior)
        self.regex_patterns = {
            "empatia": [
                # Expressões de compreensão emocional
                (r'\b(entendo|compreendo|imagino|percebo)\s+(sua|a|o|como)\s+\w+', 3, "Expressão de compreensão"),
                (r'\b(sei|imagino)\s+como\s+(deve\s+ser|é)\s+\w+', 3, "Empatia contextual"),
                (r'\b(lamento|sinto\s+muito|desculpe)\s+(pelo|pela|por|o)\s+\w+', 3, "Pedido de desculpas contextual"),
                (r'\b(deve\s+ser|é)\s+(difícil|frustrante|complicado|chato)', 2, "Reconhecimento de dificuldade"),
                (r'\b(agradeço|obrigad[oa])\s+(pela|por|seu|sua)\s+\w+', 2, "Agradecimento contextual"),
            ],
            "clareza": [
                # Ações concretas e estrutura lógica
                (r'\b(vou|irei|farei|vamos)\s+\w+\s+(o|a|seu|sua)', 3, "Ação futura concreta"),
                (r'\b(primeiro|segundo|terceiro|em\s+seguida|depois|por\s+fim)', 3, "Estrutura sequencial"),
                (r'\b(passo\s+\d+|etapa\s+\d+)', 2, "Passos numerados"),
                (r'\b(verificar|analisar|resolver|processar|enviar)\s+(o|a|seu|sua)\s+\w+', 2, "Verbo de ação + objeto"),
                (r'\b(prazo|tempo|dias?\s+úteis|horas?)\s+(de|para|em|até)', 2, "Prazo definido"),
            ],
            "tom_profissional": [
                # Formalidade e cortesia
                (r'\b(senhor|senhora|sr\.|sra\.)\s+\w+', 3, "Tratamento formal"),
                (r'\b(prezad[oa]|estimad[oa])\s+\w+', 3, "Saudação formal"),
                (r'\b(atenciosamente|cordialmente|respeitosamente)', 2, "Despedida formal"),
                (r'\b(por\s+favor|por\s+gentileza|se\s+possível)', 2, "Cortesia"),
                (r'\b(agradeço|obrigad[oa])\s+(pela|por|a|o)', 2, "Agradecimento"),
            ],
            "proximo_passo": [
                # Ação clara e definida
                (r'\b(vou|irei|farei)\s+\w+\s+(e|para|seu|sua)', 3, "Compromisso de ação"),
                (r'\b(entrarei\s+em\s+contato|retornarei|retorno)\s+(em|dentro|até)', 3, "Promessa de continuidade"),
                (r'\b(aguarde|em\s+breve|logo|em\s+instantes)', 2, "Indicação de tempo"),
                (r'\b(caso|se)\s+\w+\s+(entre\s+em\s+contato|avise|informe)', 2, "Instrução condicional"),
                (r'\b(acompanhe|verifique|acesse)\s+(o|a|seu|sua)\s+\w+', 2, "Direcionamento"),
            ],
        }
        
        # Keywords positivas com peso (fallback se regex não detectar)
        self.positive_keywords = {
            "empatia": [
                ("entendo", 1.5), ("compreendo", 1.5), ("imagino", 1.5), ("percebo", 1.5),
                ("lamento", 2), ("sinto muito", 2), ("desculpe", 2),
                ("sei como", 1.5), ("difícil", 1), ("frustrante", 1),
                ("agradeço", 1), ("obrigado", 1), ("obrigada", 1),
            ],
            "clareza": [
                ("vou", 1.5), ("irei", 1.5), ("farei", 1.5), ("vamos", 1.5),
                ("primeiro", 1), ("segundo", 1), ("terceiro", 1),
                ("passo", 1), ("etapa", 1), ("processo", 1),
                ("verificar", 1), ("analisar", 1), ("resolver", 1),
            ],
            "tom_profissional": [
                ("senhor", 2), ("senhora", 2), ("prezado", 2), ("prezada", 2),
                ("atenciosamente", 1.5), ("cordialmente", 1.5),
                ("por favor", 1.5), ("por gentileza", 1.5),
                ("agradeço", 1), ("obrigado", 1),
            ],
            "proximo_passo": [
                ("vou", 1.5), ("irei", 1.5), ("farei", 1.5),
                ("enviarei", 1.5), ("verificarei", 1.5), ("analisarei", 1.5),
                ("entrarei em contato", 2), ("retornarei", 2),
                ("aguarde", 1), ("prazo", 1), ("em breve", 1),
            ],
        }
        
        # Padrões negativos (com detecção de negação e linguagem inadequada)
        self.negative_patterns = [
            # Linguagem inadequada/ofensiva (penalidade PESADA)
            (r'\b(porra|caralho|merda|foda|puta|cu|cacete|bosta|inferno)\b', -10, "Linguagem inadequada"),
            (r'\b(idiota|imbecil|burro|estúpido|otário|babaca)\b', -10, "Linguagem ofensiva"),
            
            # Negação de capacidade (penalidade moderada)
            (r'\bnão\s+(sei|posso|consigo|tenho|há)\b', -2, "Negação de capacidade"),
            (r'\b(impossível|jamais|nunca)\s+(resolver|ajudar|fazer)', -3, "Negação absoluta com ação"),
            
            # Falta de profissionalismo (penalidade pesada)
            (r'\b(problema\s+seu|culpa\s+sua|não\s+é\s+comigo)', -5, "Falta de responsabilidade"),
            (r'\b(não\s+me\s+importa|tanto\s+faz)', -5, "Desinteresse"),
            
            # Incerteza (penalidade leve)
            (r'\b(talvez|acho\s+que|não\s+tenho\s+certeza)', -1.5, "Incerteza"),
            
            # Falsa empatia (penalidade moderada)
            (r'\bnão\s+(entendo|compreendo)\b', -3, "Falsa empatia"),
        ]
    
    async def validate(
        self,
        text: str,
        challenge_criteria: Dict[str, Any],
        timeout_ms: int = 1000,
        custom_prompt: str = None,
    ) -> Dict[str, Any]:
        """
        Valida resposta usando regras, regex e padrões linguísticos.
        
        IMPORTANTE: Rule Engine é GATE ABSOLUTO - só pega casos EXTREMOS:
        - Respostas muito ruins (só palavrões, sem conteúdo útil)
        - Respostas muito boas (perfeitas, com todos os critérios)
        
        Se não for caso extremo, lança exceção para passar para AI providers.
        """
        text_lower = text.lower()
        text_stripped = text.strip()
        
        # ═══════════════════════════════════════════════════════════════
        # GATE 1: Respostas MUITO RUINS (só palavrões, sem conteúdo)
        # ═══════════════════════════════════════════════════════════════
        
        # Conta palavrões
        profanity_count = 0
        profanity_words = ["porra", "caralho", "merda", "foda", "puta", "cu", "cacete", "bosta"]
        for word in profanity_words:
            profanity_count += text_lower.count(word)
        
        # Conta palavras úteis (não palavrões)
        words = text_stripped.split()
        useful_words = [w for w in words if w.lower() not in profanity_words and len(w) > 2]
        
        # Calcula proporção de palavrões
        total_words = len(words)
        profanity_ratio = profanity_count / total_words if total_words > 0 else 0
        
        # Se tem MUITOS palavrões (>= 50% das palavras) OU (>=3 palavrões E <8 palavras úteis) → MUITO RUIM
        is_mostly_profanity = profanity_ratio >= 0.5
        is_profanity_spam = profanity_count >= 3 and len(useful_words) < 8
        
        if is_mostly_profanity or is_profanity_spam:
            logger.info(
                f"GATE: Resposta muito ruim detectada "
                f"(palavrões={profanity_count}, úteis={len(useful_words)}, "
                f"ratio={profanity_ratio:.2f})"
            )
            return {
                "status": "revisar",
                "confianca": 0.95,  # Alta confiança que é ruim
                "feedback": {
                    "empatia": {"score": 1, "comentario": "Linguagem inadequada para atendimento"},
                    "clareza": {"score": 1, "comentario": "Falta conteúdo útil"},
                    "tom_profissional": {"score": 0, "comentario": "Tom completamente inadequado"},
                    "proximo_passo": {"score": 1, "comentario": "Não indica próximo passo"},
                },
                "sugestoes": [
                    "Use linguagem profissional e respeitosa",
                    "Evite palavrões e expressões informais",
                    "Foque em resolver o problema do cliente"
                ],
            }
        
        # ═══════════════════════════════════════════════════════════════
        # GATE 2: Respostas MUITO BOAS (perfeitas, com todos os critérios)
        # ═══════════════════════════════════════════════════════════════
        
        # Avalia cada critério
        feedback = {}
        total_score = 0
        detected_patterns = []
        
        for criterio in ["empatia", "clareza", "tom_profissional", "proximo_passo"]:
            score, patterns = self._evaluate_criterion(text_lower, criterio)
            feedback[criterio] = {
                "score": score,
                "comentario": self._generate_comment(score, criterio, patterns),
            }
            total_score += score
            detected_patterns.extend(patterns)
        
        # Calcula média
        avg_score = total_score / 4
        
        # Se TODOS os critérios >= 9 → MUITO BOM (caso raro)
        all_excellent = all(feedback[c]["score"] >= 9 for c in feedback)
        if all_excellent:
            logger.info(f"GATE: Resposta muito boa detectada (avg_score={avg_score:.1f})")
            return {
                "status": "aprovado",
                "confianca": 0.95,
                "feedback": feedback,
                "sugestoes": [],
            }
        
        # ═══════════════════════════════════════════════════════════════
        # NÃO É CASO EXTREMO → Passa para AI providers
        # ═══════════════════════════════════════════════════════════════
        
        logger.info(
            f"GATE: Resposta normal (avg_score={avg_score:.1f}), "
            f"passando para AI providers"
        )
        raise Exception("Rule Engine: não é caso extremo, passar para AI providers")
    
    def _evaluate_criterion(self, text: str, criterio: str) -> Tuple[int, List[str]]:
        """
        Avalia um critério específico usando regex e keywords.
        Retorna (score, lista de padrões detectados)
        """
        score = 5.0  # Score base
        detected_patterns = []
        
        # 1. Avalia padrões regex (peso maior)
        for pattern, weight, description in self.regex_patterns.get(criterio, []):
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                score += weight * len(matches)
                detected_patterns.append(f"{description} ({len(matches)}x)")
                logger.debug(f"Regex match: {description} - {matches}")
        
        # 2. Avalia keywords positivas (peso menor)
        for keyword, weight in self.positive_keywords.get(criterio, []):
            if keyword in text:
                # Verifica se não está negado
                if not self._is_negated(text, keyword):
                    score += weight
                    detected_patterns.append(f"Keyword: {keyword}")
                else:
                    logger.debug(f"Keyword negated: {keyword}")
        
        # 3. Penaliza padrões negativos
        for pattern, penalty, description in self.negative_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            if matches:
                score += penalty  # penalty já é negativo
                detected_patterns.append(f"Negativo: {description}")
                logger.debug(f"Negative pattern: {description} - {matches}")
        
        # Limita entre 0 e 10
        final_score = max(0, min(10, int(score)))
        
        return final_score, detected_patterns
    
    def _is_negated(self, text: str, keyword: str) -> bool:
        """
        Verifica se uma keyword está negada no contexto.
        Procura por palavras de negação antes da keyword.
        """
        # Encontra posição da keyword
        keyword_pos = text.find(keyword)
        if keyword_pos == -1:
            return False
        
        # Pega contexto anterior (até 30 caracteres antes)
        context_start = max(0, keyword_pos - 30)
        context = text[context_start:keyword_pos]
        
        # Palavras de negação
        negation_words = ["não", "nunca", "jamais", "nem"]
        
        # Verifica se há negação no contexto
        for neg_word in negation_words:
            if neg_word in context:
                return True
        
        return False
    
    def _generate_comment(self, score: int, criterio: str, patterns: List[str]) -> str:
        """Gera comentário baseado no score e padrões detectados"""
        if score >= 8:
            if patterns:
                return f"Excelente {criterio}! Detectado: {patterns[0]}"
            return f"Excelente {criterio}!"
        elif score >= 6:
            return f"Bom {criterio}, mas pode melhorar."
        elif score >= 4:
            return f"{criterio.capitalize()} precisa de atenção."
        else:
            return f"{criterio.capitalize()} insuficiente."
    
    def _generate_suggestions(self, feedback: Dict[str, Any], patterns: List[str]) -> List[str]:
        """Gera sugestões de melhoria baseadas no feedback"""
        sugestoes = []
        
        for criterio, data in feedback.items():
            if data["score"] < 7:
                if criterio == "empatia":
                    sugestoes.append(
                        "Demonstre mais compreensão emocional usando expressões como "
                        "'entendo sua situação', 'imagino como deve ser difícil', "
                        "'lamento pelo inconveniente'"
                    )
                elif criterio == "clareza":
                    sugestoes.append(
                        "Seja mais claro e objetivo: use verbos de ação no futuro "
                        "('vou verificar', 'irei resolver'), estruture em passos "
                        "(primeiro, segundo), e defina prazos"
                    )
                elif criterio == "tom_profissional":
                    sugestoes.append(
                        "Use linguagem mais profissional: tratamento formal "
                        "(senhor/senhora), cortesia (por favor, por gentileza), "
                        "e despedidas formais (atenciosamente, cordialmente)"
                    )
                elif criterio == "proximo_passo":
                    sugestoes.append(
                        "Indique claramente o próximo passo: comprometa-se com ação "
                        "('vou enviar', 'entrarei em contato'), defina prazo "
                        "('em 24h', 'até amanhã'), ou dê instruções ('aguarde', 'verifique')"
                    )
        
        # Se detectou padrões negativos, adiciona sugestão específica
        negative_detected = [p for p in patterns if "Negativo:" in p]
        if negative_detected:
            sugestoes.append(
                f"Evite expressões negativas detectadas: {', '.join(negative_detected[:2])}"
            )
        
        return sugestoes
    
    async def health_check(self) -> bool:
        """Rule engine sempre está disponível"""
        return True
