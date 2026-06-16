"""
Motor de validação híbrida para questões dissertativas.

Combina validação LLM com regras fixas:
- Regras rígidas: contagem de palavras, limiar de confiança
- Correspondência de palavras-chave com suporte a sinônimos
- Penalidade suave quando palavras-chave estão ausentes
- Limiares específicos por provedor de LLM
"""

import json
import re
from typing import Dict, List, Optional, Tuple
from pathlib import Path


class HybridValidator:
    """
    Hybrid validation engine that combines LLM scores with rule-based checks.
    
    Validation Flow:
    1. Check hard rules (word count, confidence)
    2. Calculate keyword match score
    3. Apply soft penalty if keywords missing
    4. Apply provider-specific threshold
    5. Return final decision
    """
    
    def __init__(self, synonyms_path: Optional[str] = None):
        """
        Initialize hybrid validator.
        
        Args:
            synonyms_path: Path to synonyms.json file (optional)
        """
        self.synonyms = self._load_synonyms(synonyms_path)
        
        # Limiares de aceitação por provedor de LLM
        self.thresholds = {
            'mistral': {
                'score': 7.5,
                'confidence': 0.75
            },
            'rule_engine': {
                'score': 8.0,
                'confidence': 0.70
            },
            'openrouter': {
                'score': 7.5,
                'confidence': 0.75
            },
            'gemini': {
                'score': 7.0,
                'confidence': 0.70
            }
        }
    
    def _load_synonyms(self, synonyms_path: Optional[str]) -> Dict[str, List[str]]:
        """
        Load synonyms dictionary from JSON file.
        
        Args:
            synonyms_path: Path to synonyms.json
            
        Returns:
            Dictionary mapping keywords to synonyms
        """
        if not synonyms_path:
            # Default path relative to this file
            synonyms_path = Path(__file__).parent.parent / 'data' / 'synonyms.json'
        
        try:
            with open(synonyms_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except FileNotFoundError:
            print(f"[hybrid_validator] Synonyms file not found: {synonyms_path}")
            return {}
        except json.JSONDecodeError as e:
            print(f"[hybrid_validator] Error parsing synonyms file: {e}")
            return {}
    
    def validate(
        self,
        text: str,
        llm_score: float,
        llm_confidence: float,
        provider: str,
        context: Dict
    ) -> Tuple[bool, Dict]:
        """
        Validate text using hybrid approach.
        
        Args:
            text: User's answer text
            llm_score: Score from LLM (0-10)
            llm_confidence: Confidence from LLM (0-1)
            provider: Provider used ('mistral', 'rule_engine', etc.)
            context: Challenge context with evaluation criteria
            
        Returns:
            Tuple of (approved: bool, details: dict)
        """
        hard_rule_passed, hard_rule_reason = self._check_hard_rules(
            text, llm_confidence, context
        )
        
        if not hard_rule_passed:
            return False, {
                'reason': 'hard_rule_failed',
                'details': hard_rule_reason,
                'final_score': llm_score,
                'keyword_match_score': 0.0
            }
        
        # 2. Calculate keyword match score
        keyword_match_score = self._calculate_keyword_match_score(text, context)
        
        # 3. Apply soft penalty if keywords missing
        final_score = llm_score
        if keyword_match_score < 0.5:
            final_score = max(0, llm_score - 0.5)
            print(f"[hybrid_validator] Applied soft penalty: {llm_score} → {final_score}")
        
        # 4. Apply provider-specific threshold
        threshold = self.thresholds.get(provider, self.thresholds['mistral'])
        approved = (
            final_score >= threshold['score'] and
            llm_confidence >= threshold['confidence']
        )
        
        return approved, {
            'reason': 'approved' if approved else 'below_threshold',
            'final_score': final_score,
            'original_score': llm_score,
            'keyword_match_score': keyword_match_score,
            'threshold': threshold,
            'penalty_applied': keyword_match_score < 0.5
        }
    
    def _check_hard_rules(
        self,
        text: str,
        confidence: float,
        context: Dict
    ) -> Tuple[bool, Optional[str]]:
        """
        Check hard rules that must pass.
        
        Args:
            text: User's answer text
            confidence: LLM confidence (0-1)
            context: Challenge context
            
        Returns:
            Tuple of (passed: bool, reason: str)
        """
        # Rule 1: Minimum word count
        min_words = context.get('min_word_count', 50)
        word_count = len(text.split())
        
        if word_count < min_words:
            return False, f'word_count_too_low (got {word_count}, need {min_words})'
        
        # Rule 2: Minimum confidence (already checked by provider threshold)
        # This is redundant but kept for clarity
        
        return True, None
    
    def _calculate_keyword_match_score(
        self,
        text: str,
        context: Dict
    ) -> float:
        """
        Calculate keyword match score with synonym support.
        
        Args:
            text: User's answer text
            context: Challenge context with required_keywords
            
        Returns:
            Score between 0.0 and 1.0
        """
        required_keywords = context.get('required_keywords', [])
        
        if not required_keywords:
            return 1.0  # No keywords required
        
        # Normalize text for matching
        text_lower = text.lower()
        
        # Count matched keywords
        matched = 0
        for keyword in required_keywords:
            keyword_lower = keyword.lower()
            
            if keyword_lower in text_lower:
                matched += 1
                continue
            
            synonyms = self.synonyms.get(keyword_lower, [])
            if any(syn.lower() in text_lower for syn in synonyms):
                matched += 1
        
        # Calculate score
        score = matched / len(required_keywords)
        
        print(f"[hybrid_validator] Keyword match: {matched}/{len(required_keywords)} = {score:.2f}")
        
        return score
    
    def get_keyword_details(
        self,
        text: str,
        context: Dict
    ) -> Dict[str, List[str]]:
        """
        Get detailed keyword matching information.
        
        Args:
            text: User's answer text
            context: Challenge context
            
        Returns:
            Dictionary with 'found' and 'missing' keyword lists
        """
        required_keywords = context.get('required_keywords', [])
        text_lower = text.lower()
        
        found = []
        missing = []
        
        for keyword in required_keywords:
            keyword_lower = keyword.lower()
            
            if keyword_lower in text_lower:
                found.append(keyword)
                continue
            
            synonyms = self.synonyms.get(keyword_lower, [])
            if any(syn.lower() in text_lower for syn in synonyms):
                found.append(keyword)
                continue
            
            missing.append(keyword)
        
        return {
            'found': found,
            'missing': missing
        }
