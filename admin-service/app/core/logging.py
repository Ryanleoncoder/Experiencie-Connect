import logging
import sys
import json
from datetime import datetime
from typing import Any, Dict
from contextvars import ContextVar
import os

# Context variable for request ID tracking
request_id_var: ContextVar[str] = ContextVar('request_id', default='')


class JSONFormatter(logging.Formatter):
    """Custom JSON formatter for structured logging."""
    
    def format(self, record: logging.LogRecord) -> str:
        log_data: Dict[str, Any] = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
        }
        
        request_id = request_id_var.get()
        if request_id:
            log_data['request_id'] = request_id
        
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        
        if hasattr(record, 'extra_fields'):
            log_data.update(record.extra_fields)
        
        return json.dumps(log_data)


class TextFormatter(logging.Formatter):
    """Custom text formatter with request ID."""
    
    def format(self, record: logging.LogRecord) -> str:
        request_id = request_id_var.get()
        request_id_str = f" [req:{request_id}]" if request_id else ""
        
        base_format = f"%(asctime)s - %(name)s - %(levelname)s{request_id_str} - %(message)s"
        formatter = logging.Formatter(base_format)
        return formatter.format(record)


def setup_logging(
    log_level: str = "INFO",
    log_format: str = "json",
    log_file: str = None
) -> None:
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))

    root_logger.handlers.clear()

    if log_format.lower() == "json":
        formatter = JSONFormatter()
    else:
        formatter = TextFormatter()

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)

    if log_file:
        log_dir = os.path.dirname(log_file)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir, exist_ok=True)
        
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)
    
    logging.getLogger("asyncpg").setLevel(logging.WARNING)
    logging.getLogger("firebase_admin").setLevel(logging.WARNING)
    logging.getLogger("aioredis").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def set_request_id(request_id: str) -> None:
    """Set the request ID for the current context."""
    request_id_var.set(request_id)


def get_request_id() -> str:
    """Get the request ID for the current context."""
    return request_id_var.get()


def log_with_extra(logger: logging.Logger, level: str, message: str, **extra_fields) -> None:
    log_method = getattr(logger, level.lower())
    
    extra = {'extra_fields': extra_fields}
    log_method(message, extra=extra)
