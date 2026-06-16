"""
Output Validator for Sentury AI
Validates, parses, repairs and normalizes JSON outputs from LLM providers.
Garantees that evaluations always conform to the required JSON schema.
"""

import json
import re
import logging
from typing import Dict, Any, List, Optional
# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field, field_validator, ValidationError
from datetime import datetime

logger = logging.getLogger(__name__)

# Enums as lists/sets for fast validation
VALID_STATUSES = {"approved", "rejected", "partial", "error"}
VALID_LEVELS = {"excellent", "good", "average", "weak", "invalid"}

class AuditInfo(BaseModel):
    prompt_version: str = Field(default="unknown")
    rubric_version: str = Field(default="unknown")
    latency_ms: int = Field(default=0)
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

class EvaluationOutput(BaseModel):
    request_id: str = Field(default="")
    status: str = Field(default="error")
    score: int = Field(default=0)
    level: str = Field(default="invalid")
    feedback: str = Field(default="")
    reason: str = Field(default="")
    rubric_id: str = Field(default="")
    challenge_id: str = Field(default="")
    provider: str = Field(default="unknown")
    model: str = Field(default="unknown")
    fallback_used: bool = Field(default=False)
    confidence: float = Field(default=0.0)
    flags: List[str] = Field(default_factory=list)
    audit: AuditInfo = Field(default_factory=AuditInfo)

    @field_validator("status")
    def validate_status(cls, v):
        v = str(v).lower().strip()
        if v not in VALID_STATUSES:
            return "error"
        return v

    @field_validator("level")
    def validate_level(cls, v):
        v = str(v).lower().strip()
        if v not in VALID_LEVELS:
            return "invalid"
        return v

    @field_validator("score")
    def validate_score(cls, v):
        try:
            val = int(v)
            return max(0, min(100, val))
        except (ValueError, TypeError):
            return 0

    @field_validator("confidence")
    def validate_confidence(cls, v):
        try:
            val = float(v)
            return max(0.0, min(1.0, val))
        except (ValueError, TypeError):
            return 0.0

def extract_json(raw_text: str) -> str:
    """Extracts the JSON substring from a raw string, stripping markdown wrappers and conversational text."""
    if not raw_text:
        return ""

    text = raw_text.strip()

    markdown_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if markdown_match:
        text = markdown_match.group(1).strip()

    first_brace = text.find('{')
    last_brace = text.rfind('}')

    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return text[first_brace:last_brace + 1]

    return text

def repair_json(text: str) -> str:
    """
    Applies heuristic repairs to broken JSON string to make it parseable.
    """
    if not text:
        return ""
        
    repaired = text.strip()
    
    # 1. Fix trailing commas before closing braces/brackets (e.g. {"a": 1,} -> {"a": 1})
    repaired = re.sub(r",\s*([\}\]])", r"\1", repaired)
    
    # 2. Fix unescaped control characters inside JSON strings (newlines, tabs, etc.)
    # We can replace literal newlines within quotes with escaped newlines \n.
    # A simple way is to replace actual newlines that are not outside quotes, but a basic replace of newlines with spaces
    # inside key-value strings can be tricky. Let's do a basic repair for newline characters in strings:
    # We target matches like: "key": "value_line1\nvalue_line2"
    # To keep it simple and safe, we can try to escape actual newlines if they are within double quotes.
    # Or just replace control characters (ASCII < 32) except tabs and newlines if they are not escaped.
    
    # 3. If json parser still fails, try wrapping key names in quotes if they are unquoted
    # (e.g. {score: 80} -> {"score": 80})
    # We match word characters that are keys followed by colon
    repaired = re.sub(r"([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1"\2":', repaired)
    
    # 4. If quotes are single quotes instead of double quotes, swap them
    # But only if double quotes are not present, or by converting single quotes to double quotes
    # (very primitive check: if we have '{' and '}' and mostly single quotes)
    if "'" in repaired and '"' not in repaired:
        repaired = repaired.replace("'", '"')
        
    return repaired

def parse_and_validate(raw_text: str, request_id: str = "", challenge_id: str = "", provider: str = "unknown", model: str = "unknown") -> Dict[str, Any]:
    """
    Core function that extracts, parses, repairs, and validates the output into the correct schema.
    Returns a valid dict conformant to the EvaluationOutput schema.
    """
    extracted = extract_json(raw_text)
    parsed_data = {}

    try:
        if extracted:
            parsed_data = json.loads(extracted)
    except json.JSONDecodeError:
        repaired = repair_json(extracted)
        try:
            parsed_data = json.loads(repaired)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON even after repair. Raw text: {raw_text[:200]}... Error: {str(e)}")
            return error_response(request_id, challenge_id, f"JSON parse error: {str(e)}")

    try:
        if not parsed_data.get("request_id") and request_id:
            parsed_data["request_id"] = request_id
        if not parsed_data.get("challenge_id") and challenge_id:
            parsed_data["challenge_id"] = challenge_id
        if not parsed_data.get("provider") and provider:
            parsed_data["provider"] = provider
        if not parsed_data.get("model") and model:
            parsed_data["model"] = model

        if "audit" not in parsed_data or not isinstance(parsed_data["audit"], dict):
            parsed_data["audit"] = {}

        validated = EvaluationOutput(**parsed_data)
        return validated.model_dump()
    except Exception as e:
        logger.error(f"Validation failed during normalization: {str(e)}")
        return error_response(request_id, challenge_id, f"Schema validation error: {str(e)}")

def error_response(request_id: str, challenge_id: str, reason: str) -> Dict[str, Any]:
    """
    Generates a standardized error response dictionary.
    """
    return {
        "request_id": request_id,
        "status": "error",
        "score": 0,
        "level": "invalid",
        "feedback": f"Erro interno na validação da resposta: {reason}",
        "reason": reason,
        "rubric_id": "error",
        "challenge_id": challenge_id,
        "provider": "system",
        "model": "rule-engine-fallback",
        "fallback_used": True,
        "confidence": 0.0,
        "flags": ["error", "system_fallback"],
        "audit": {
            "prompt_version": "unknown",
            "rubric_version": "unknown",
            "latency_ms": 0,
            "created_at": datetime.utcnow().isoformat() + "Z"
        }
    }
