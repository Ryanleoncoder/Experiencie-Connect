"""
Prompt Builder for Sentury AI
Loads prompt templates and compiles them with rubrics and player responses.
"""

import os
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS_DIR = os.path.join(BASE_DIR, "prompts")

class PromptBuilder:
    def __init__(self, prompts_dir: str = PROMPTS_DIR):
        self.prompts_dir = prompts_dir
        self._templates_cache: Dict[str, str] = {}

    def _load_template(self, template_name: str) -> str:
        """Loads prompt template from file with caching."""
        template_name_clean = template_name.replace(".txt", "") + ".txt"
        
        if template_name_clean in self._templates_cache:
            return self._templates_cache[template_name_clean]
            
        template_path = os.path.join(self.prompts_dir, template_name_clean)
        try:
            if os.path.exists(template_path):
                with open(template_path, "r", encoding="utf-8") as f:
                    template_content = f.read()
                    self._templates_cache[template_name_clean] = template_content
                    return template_content
        except Exception as e:
            logger.error(f"Failed to load prompt template {template_path}: {str(e)}")
            
        # Minimal inline fallback template
        return """
Avalie esta resposta para o desafio {challenge_id}:
Contexto: {challenge_context}
Diretrizes: {must_have}
Resposta: "{player_response}"
Retorne em JSON.
"""

    def build_prompt(self, rubric: Dict[str, Any], player_response: str, template_name: str = "evaluate_v1") -> str:
        """
        Builds the final prompt string by populating the template with rubric values
        and the player response.
        """
        template = self._load_template(template_name)

        must_have_list = rubric.get("must_have", [])
        must_have_str = "\n".join(f"- {item}" for item in must_have_list) if must_have_list else "Nenhuma diretriz específica."
        
        bad_signals_list = rubric.get("bad_signals", [])
        bad_signals_str = "\n".join(f"- {item}" for item in bad_signals_list) if bad_signals_list else "Nenhum sinal negativo específico."
        
        examples_good_list = rubric.get("examples_good", [])
        examples_good_str = "\n".join(f"Exemplo:\n{item}\n" for item in examples_good_list) if examples_good_list else "Nenhum exemplo disponível."

        prompt = template.format(
            challenge_context=rubric.get("context", "Sem contexto adicional."),
            must_have=must_have_str,
            bad_signals=bad_signals_str,
            examples_good=examples_good_str,
            player_response=player_response
        )
        
        return prompt

    def get_prompt_version(self) -> str:
        """Returns the current prompt version identifier."""
        return "evaluate_v1"

prompt_builder = PromptBuilder()
