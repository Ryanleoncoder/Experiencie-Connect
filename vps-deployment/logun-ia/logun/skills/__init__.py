from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseSkill(ABC):
    """
    Abstract base class for all Sentury AI skills.
    Each skill is a modular unit of intelligence (e.g., evaluate, classify, extract).
    """
    name: str
    description: str

    @abstractmethod
    async def execute(self, request: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Executes the skill's logic.
        
        Args:
            request: The input request parameters.
            context: Execution context containing shared services or configurations.
            
        Returns:
            A dictionary containing the structured output of the skill.
        """
        pass
