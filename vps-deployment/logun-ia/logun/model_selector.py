"""Model Selector — choose a specific provider or model for preview/debug."""

from typing import Optional, Dict, Any, Tuple
from enum import Enum


class ModelChoice(str, Enum):
    AUTO = "auto"
    RULE = "rule"
    GEMMA2B = "gemma2b"
    TINY = "tiny"
    GROQ = "groq"
    GEMINI = "gemini"
    NVIDIA = "nvidia"
    OPENRT = "openrt"


MODEL_TO_PROVIDER = {
    ModelChoice.AUTO: None,
    ModelChoice.RULE: "rule_engine",
    ModelChoice.GEMMA2B: "mistral",
    ModelChoice.TINY: "tinyllama",
    ModelChoice.GROQ: "groq",
    ModelChoice.GEMINI: "gemini",
    ModelChoice.NVIDIA: "nvidia",
    ModelChoice.OPENRT: "openrouter",
}

PROVIDER_SHORT_NAMES = {
    "rule_engine": "RULE",
    "mistral": "GEMMA2B",
    "tinyllama": "TINY",
    "groq": "GROQ",
    "gemini": "GEMINI",
    "nvidia": "NVIDIA",
    "openrouter": "OPENRT",
}

PROVIDER_FULL_NAMES = {
    "rule_engine": "Rule Engine (Regex)",
    "mistral": "Gemma 2B (Ollama)",
    "tinyllama": "TinyLlama (Ollama)",
    "groq": "Groq (Multi-Model)",
    "gemini": "Google Gemini",
    "nvidia": "NVIDIA NIM (GPU)",
    "openrouter": "OpenRouter (Cluster)",
}


def parse_model_choice(model_choice: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse model_choice into (provider_name, specific_model).
    Formats: "auto", "groq", "groq:llama-3.1-8b-instant", "openrt:openai/gpt-oss-120b:free".
    """
    if not model_choice or model_choice.lower() == "auto":
        return (None, None)

    if ":" in model_choice:
        parts = model_choice.split(":", 1)
        provider_choice = parts[0].lower()
        specific_model = parts[1]

        try:
            choice_enum = ModelChoice(provider_choice)
            provider_name = MODEL_TO_PROVIDER.get(choice_enum)
            return (provider_name, specific_model)
        except ValueError:
            return (None, None)

    try:
        choice = ModelChoice(model_choice.lower())
        return (MODEL_TO_PROVIDER.get(choice), None)
    except ValueError:
        return (None, None)


def get_short_name(provider_name: str, specific_model: Optional[str] = None) -> str:
    if specific_model:
        model_lower = specific_model.lower()

        if "llama-3.1-8b" in model_lower:
            return "LLAMA8B"
        elif "llama-3.3-70b" in model_lower:
            return "LLAMA70B"
        elif "gemma2-9b" in model_lower:
            return "GEMMA9B"
        elif "mixtral" in model_lower:
            return "MIXTRAL"
        elif "qwen" in model_lower:
            return "QWEN32B"
        elif "deepseek" in model_lower:
            return "DEEPSEEK"
        elif "gpt-oss-120b" in model_lower:
            return "GPT120B"
        elif "gpt-oss-20b" in model_lower:
            return "GPT20B"
        elif "llama-3.3-70b" in model_lower:
            return "LLAMA70B"
        elif "llama-3.2-3b" in model_lower:
            return "LLAMA3B"
        elif "minimax" in model_lower:
            return "MINIMAX"
        elif "glm" in model_lower:
            return "GLM45"
        elif "gemma-3-12b" in model_lower:
            return "GEMMA12B"
        elif "nemotron-3-nano-30b" in model_lower:
            return "NEMOT30B"
        elif "nemotron-nano-9b" in model_lower:
            return "NEMOT9B"
    
    return PROVIDER_SHORT_NAMES.get(provider_name, provider_name.upper()[:8])


def get_full_name(provider_name: str) -> str:
    return PROVIDER_FULL_NAMES.get(provider_name, provider_name)


def get_provider_from_choice(model_choice: str) -> Optional[str]:
    provider_name, _ = parse_model_choice(model_choice)
    return provider_name


def get_available_models() -> Dict[str, Dict[str, Any]]:
    return {
        ModelChoice.AUTO: {
            "name": "Automático",
            "description": "Roteamento inteligente baseado em saúde",
            "short": "AUTO",
            "provider": None,
        },
        ModelChoice.RULE: {
            "name": "Rule Engine",
            "description": "Regex/Keywords (ultra-rápido)",
            "short": "RULE",
            "provider": "rule_engine",
        },
        ModelChoice.GEMMA2B: {
            "name": "Gemma 2B",
            "description": "Ollama local (boa qualidade)",
            "short": "GEMMA2B",
            "provider": "mistral",
        },
        ModelChoice.TINY: {
            "name": "TinyLlama",
            "description": "Ollama local (rápido)",
            "short": "TINY",
            "provider": "tinyllama",
        },
        ModelChoice.GROQ: {
            "name": "Groq",
            "description": "API ultra-rápida (6 modelos)",
            "short": "GROQ",
            "provider": "groq",
        },
        ModelChoice.GEMINI: {
            "name": "Gemini",
            "description": "Google API (alta qualidade)",
            "short": "GEMINI",
            "provider": "gemini",
        },
        ModelChoice.NVIDIA: {
            "name": "NVIDIA NIM",
            "description": "GPU API (fallback confiável)",
            "short": "NVIDIA",
            "provider": "nvidia",
        },
        ModelChoice.OPENRT: {
            "name": "OpenRouter",
            "description": "Cluster de 13 modelos",
            "short": "OPENRT",
            "provider": "openrouter",
        },
    }


def validate_model_choice(model_choice: str) -> bool:
    provider_name, _ = parse_model_choice(model_choice)
    return provider_name is not None or model_choice.lower() == "auto"
