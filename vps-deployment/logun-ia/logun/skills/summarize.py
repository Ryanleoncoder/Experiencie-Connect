from typing import Dict, Any
from logun.skills import BaseSkill

class SummarizeSkill(BaseSkill):
    """Resume conversas, feedbacks ou logs de auditoria em pontos estruturados."""
    name = "summarize"
    description = "Resume conversas, feedbacks ou logs de auditoria em pontos estruturados."

    async def execute(self, request: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError("SummarizeSkill is not implemented yet.")
