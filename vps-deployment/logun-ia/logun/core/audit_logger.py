"""
Audit Logger for Sentury AI
Writes structured JSONL audit logs with daily rotation and data sanitization.
"""

import os
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT_LOG_DIR = os.path.join(BASE_DIR, "audit")

@dataclass
class AuditEntry:
    request_id: str
    challenge_id: str
    rubric_id: str
    prompt_version: str
    rubric_version: str
    provider: str
    model: str
    fallback_used: bool
    latency_ms: int
    status: str
    score: int
    error: Optional[str] = None
    created_at: str = None

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow().isoformat() + "Z"

class AuditLogger:
    def __init__(self, log_dir: str = AUDIT_LOG_DIR):
        self.log_dir = log_dir
        try:
            os.makedirs(self.log_dir, exist_ok=True)
        except Exception as e:
            logger.error(f"Failed to create audit log directory {self.log_dir}: {str(e)}")

    def _sanitize(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitizes data dictionary to remove any potential secrets, keys, or sensitive PII.
        """
        sanitized = data.copy()
        sensitive_keys = {
            "api_key", "apikey", "secret", "token", "password", "auth", 
            "jwt", "key", "authorization", "credentials"
        }
        
        def sanitize_val(v):
            if isinstance(v, dict):
                return self._sanitize(v)
            elif isinstance(v, list):
                return [sanitize_val(item) for item in v]
            return v

        for k, v in list(sanitized.items()):
            k_lower = k.lower()
            if any(s in k_lower for s in sensitive_keys):
                sanitized[k] = "******"
            else:
                sanitized[k] = sanitize_val(v)
                
        return sanitized

    def log(self, entry: AuditEntry) -> bool:
        """
        Logs an AuditEntry to the daily JSONL file.
        Daily rotation is handled by using the current date in the filename.
        """
        try:
            # Daily rotation filename: audit-YYYY-MM-DD.jsonl
            date_str = datetime.utcnow().strftime("%Y-%m-%d")
            filename = f"audit-{date_str}.jsonl"
            filepath = os.path.join(self.log_dir, filename)
            
            entry_dict = asdict(entry)
            sanitized_dict = self._sanitize(entry_dict)

            with open(filepath, "a", encoding="utf-8") as f:
                f.write(json.dumps(sanitized_dict) + "\n")
            return True
        except Exception as e:
            logger.error(f"Failed to write to audit log: {str(e)}")
            return False

audit_logger = AuditLogger()
