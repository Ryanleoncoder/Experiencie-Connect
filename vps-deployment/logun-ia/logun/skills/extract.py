from typing import Dict, Any
from logun.skills import BaseSkill

class ExtractSkill(BaseSkill):
    """Extrai entidades, parâmetros e variáveis específicas de um texto."""
    name = "extract"
    description = "Extrai entidades, parâmetros e variáveis específicas de um texto."

    async def execute(self, request: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError("ExtractSkill is not implemented yet.")
