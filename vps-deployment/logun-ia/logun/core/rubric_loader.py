"""
Rubric Loader for Sentury AI
Loads and caches rubric JSON files from logun/rubrics directory.
Provides fallback to the default rubric if a specific challenge rubric is not found.
"""

import os
import json
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUBRICS_DIR = os.path.join(BASE_DIR, "rubrics")

class RubricLoader:
    def __init__(self, rubrics_dir: str = RUBRICS_DIR):
        self.rubrics_dir = rubrics_dir
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._default_rubric = self._load_default()

    def _load_default(self) -> Dict[str, Any]:
        """Loads the default fallback rubric."""
        default_path = os.path.join(self.rubrics_dir, "default.json")
        try:
            if os.path.exists(default_path):
                with open(default_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load default rubric: {str(e)}")
            
        # Hardcoded minimal fallback
        return {
            "rubric_id": "default_fallback",
            "challenge_id": "default",
            "version": "1.0",
            "context": "Contexto padrão de fallback.",
            "must_have": ["respeito", "clareza", "solução"],
            "bad_signals": ["indelicadeza"],
            "score_weights": {"qualidade": 1.0},
            "examples_good": [],
            "examples_bad": []
        }

    def load_rubric(self, challenge_id: str) -> Dict[str, Any]:
        """
        Loads a rubric by challenge_id.
        Caches the rubric in memory for subsequent requests.
        """
        if not challenge_id:
            return self._default_rubric

        challenge_id_clean = challenge_id.lower().strip()

        if challenge_id_clean in self._cache:
            return self._cache[challenge_id_clean]

        rubric_file = f"{challenge_id_clean}.json"
        rubric_path = os.path.join(self.rubrics_dir, rubric_file)

        # Fallback to fuzzy search in rubrics dir
        if not os.path.exists(rubric_path):
            try:
                files = os.listdir(self.rubrics_dir)
                for f in files:
                    if challenge_id_clean in f.lower() and f.endswith(".json"):
                        rubric_path = os.path.join(self.rubrics_dir, f)
                        break
            except Exception as e:
                logger.error(f"Error listing rubrics directory: {str(e)}")

        if os.path.exists(rubric_path):
            try:
                with open(rubric_path, "r", encoding="utf-8") as f:
                    rubric = json.load(f)
                    self._cache[challenge_id_clean] = rubric
                    logger.info(f"Successfully loaded rubric: {rubric.get('rubric_id')} for challenge {challenge_id}")
                    return rubric
            except Exception as e:
                logger.error(f"Failed to parse rubric file {rubric_path}: {str(e)}")
        
        logger.warning(f"Rubric for challenge '{challenge_id}' not found, falling back to default rubric.")
        return self._default_rubric

    def get_rubric_version(self, rubric: Dict[str, Any]) -> str:
        return rubric.get("version", "1.0")

rubric_loader = RubricLoader()
