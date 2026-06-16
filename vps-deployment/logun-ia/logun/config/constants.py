"""System constants — values that do not vary between environments."""


class ValidationStatus:
    APROVADO = "aprovado"
    REVISAR = "revisar"
    ERRO = "erro"


class ProviderStatus:
    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    CIRCUIT_OPEN = "circuit_open"
    DISABLED = "disabled"


class RedisKeys:
    VALIDATION_CACHE = "logun:validation:{challenge_id}:{text_hash}"
    VALIDATION_QUEUE = "logun:queue"
    CIRCUIT_BREAKER = "circuit_breaker:{provider}"
    RATE_LIMIT = "rate_limit:logun:{user_id}"
    METRICS_PROVIDER = "metrics:provider:{provider}"


class HTTPStatus:
    OK = 200
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    TOO_MANY_REQUESTS = 429
    INTERNAL_SERVER_ERROR = 500
    SERVICE_UNAVAILABLE = 503


class Scores:
    MIN_SCORE = 0
    MAX_SCORE = 10
    PASSING_SCORE = 7
    MIN_CONFIDENCE = 0.0
    MAX_CONFIDENCE = 1.0
    APPROVAL_CONFIDENCE_THRESHOLD = 0.7


class Timeouts:
    MISTRAL_MS = 8000
    OPENROUTER_MS = 10000
    GEMINI_MS = 10000
    RULE_ENGINE_MS = 1000
    
    REDIS_CONNECT_SEC = 2
    SUPABASE_QUERY_SEC = 5
    HTTP_REQUEST_SEC = 30


class Limits:
    MAX_TEXT_LENGTH = 500
    MIN_TEXT_LENGTH = 10
    
    MAX_QUEUE_SIZE = 100
    MAX_CONCURRENT_VALIDATIONS = 2
    
    RATE_LIMIT_PER_MIN = 10
    RATE_LIMIT_BURST = 5


class ErrorMessages:
    TEXT_TOO_SHORT = "Texto muito curto. Mínimo de {min} caracteres."
    TEXT_TOO_LONG = "Texto muito longo. Máximo de {max} caracteres."
    INVALID_FORMAT = "Formato de texto inválido."
    PROMPT_INJECTION = "Tentativa de manipulação detectada."
    
    NO_PROVIDERS_AVAILABLE = "Nenhum provedor de IA disponível no momento."
    VALIDATION_TIMEOUT = "Tempo limite de validação excedido."
    VALIDATION_ERROR = "Erro ao processar validação."
    
    RATE_LIMIT_EXCEEDED = "Limite de requisições excedido. Tente novamente em alguns instantes."
    UNAUTHORIZED = "Autenticação necessária."
    FORBIDDEN = "Acesso negado."
    
    SERVICE_UNAVAILABLE = "Sistema temporariamente indisponível. Tente novamente em alguns instantes."


class SuccessMessages:
    VALIDATION_COMPLETED = "Validação concluída com sucesso."
    APPROVED = "Resposta aprovada!"
    NEEDS_REVIEW = "Resposta precisa de revisão."
