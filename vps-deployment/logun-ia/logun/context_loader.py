"""Context Loader — loads challenge contexts from local files, Firebase, or Supabase; caches in Redis (24h TTL)."""

import json
import os
from typing import Dict, Optional
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class ChallengeContext:
    def __init__(self, data: Dict):
        self.challenge_id = data.get("challenge_id")
        self.challenge_title = data.get("challenge_title")
        self.challenge_level = data.get("challenge_level", 1)
        self.challenge_type = data.get("challenge_type", "atendimento-cliente")
        self.personality = data.get("logun_personality", {})
        self.evaluation_criteria = data.get("evaluation_criteria", {})
        self.expected_response = data.get("expected_response", {})
        self.examples = data.get("examples", {})
        self.feedback_templates = data.get("feedback_templates", {})
        self.custom_instructions = data.get("custom_instructions", "")
        self.metadata = data.get("metadata", {})
    
    def get_criterion_weight(self, criterion: str) -> float:
        return self.evaluation_criteria.get(criterion, {}).get("weight", 0.25)
    
    def get_criterion_keywords(self, criterion: str) -> list:
        return self.evaluation_criteria.get(criterion, {}).get("keywords", [])
    
    def get_criterion_concepts(self, criterion: str) -> list:
        return self.evaluation_criteria.get(criterion, {}).get("concepts", [])
    
    def get_feedback_template(self, status: str) -> str:
        return self.feedback_templates.get(status, {}).get("template", "")
    
    def get_strengths_map(self) -> Dict:
        return self.feedback_templates.get("aprovado", {}).get("strengths_map", {})
    
    def get_weaknesses_map(self) -> Dict:
        return self.feedback_templates.get("revisar", {}).get("weaknesses_map", {})
    
    def get_suggestions_map(self) -> Dict:
        return self.feedback_templates.get("revisar", {}).get("suggestions_map", {})
    
    def to_dict(self) -> Dict:
        return {
            "challenge_id": self.challenge_id,
            "challenge_title": self.challenge_title,
            "challenge_level": self.challenge_level,
            "challenge_type": self.challenge_type,
            "personality": self.personality,
            "evaluation_criteria": self.evaluation_criteria,
            "expected_response": self.expected_response,
            "examples": self.examples,
            "feedback_templates": self.feedback_templates,
            "custom_instructions": self.custom_instructions,
            "metadata": self.metadata
        }


class ContextLoader:
    
    def __init__(
        self,
        source: str = "local",  # "local", "firebase", "supabase"
        local_path: Optional[str] = None,
        redis_client=None,
        firebase_client=None,
        supabase_client=None
    ):
        self.source = source
        self.local_path = local_path or self._get_default_local_path()
        self.redis_client = redis_client
        self.firebase_client = firebase_client
        self.supabase_client = supabase_client
        
        # Cache em memória (para evitar leituras repetidas)
        self._memory_cache: Dict[str, ChallengeContext] = {}
        
        self._default_context = self._load_default_context()
    
    def _get_default_local_path(self) -> str:
        current_dir = Path(__file__).parent
        return str(current_dir.parent / "challenge-contexts")
    
    def _load_default_context(self) -> ChallengeContext:
        try:
            default_path = Path(self.local_path) / "default.json"
            with open(default_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            logger.info("Contexto padrão carregado com sucesso")
            return ChallengeContext(data)
        except Exception as e:
            logger.error(f"Erro ao carregar contexto padrão: {e}")
            return self._get_minimal_context()
    
    def _get_minimal_context(self) -> ChallengeContext:
        minimal_data = {
            "challenge_id": "MINIMAL",
            "challenge_title": "Contexto Mínimo",
            "challenge_level": 1,
            "logun_personality": {
                "tone": "profissional-amigavel",
                "style": "mentor-experiente",
                "language": "pt-BR",
                "formality": "semi-formal"
            },
            "evaluation_criteria": {
                "completude": {"weight": 0.30, "keywords": [], "concepts": []},
                "clareza_conceitual": {"weight": 0.25, "keywords": [], "concepts": []},
                "exemplos_praticos": {"weight": 0.30, "keywords": [], "concepts": []},
                "profundidade": {"weight": 0.15, "keywords": [], "concepts": []}
            },
            "expected_response": {
                "min_length": 50,
                "max_length": 500,
                "must_include": [],
                "should_include": [],
                "avoid": []
            },
            "examples": {},
            "feedback_templates": {
                "aprovado": {"template": "Ótima resposta!"},
                "revisar": {"template": "Sua resposta pode melhorar."}
            },
            "custom_instructions": "",
            "metadata": {"is_minimal": True}
        }
        return ChallengeContext(minimal_data)
    
    async def load_context(self, challenge_id: str) -> ChallengeContext:
        if challenge_id in self._memory_cache:
            logger.debug(f"Contexto {challenge_id} encontrado em memória")
            return self._memory_cache[challenge_id]
        
        if self.redis_client:
            cached = await self._load_from_redis(challenge_id)
            if cached:
                self._memory_cache[challenge_id] = cached
                return cached
        
        context = None
        
        if self.source == "local":
            context = await self._load_from_local(challenge_id)
        elif self.source == "firebase":
            context = await self._load_from_firebase(challenge_id)
        elif self.source == "supabase":
            context = await self._load_from_supabase(challenge_id)
        
        if not context:
            logger.warning(f"Contexto {challenge_id} não encontrado, usando padrão")
            context = self._default_context

        self._memory_cache[challenge_id] = context
        
        if self.redis_client:
            await self._save_to_redis(challenge_id, context)
        
        return context
    
    async def _load_from_local(self, challenge_id: str) -> Optional[ChallengeContext]:
        try:
            file_path = Path(self.local_path) / f"{challenge_id}.json"

            # Fallback to fuzzy glob search (e.g. txt-101-empatia-atendimento.json)
            if not file_path.exists():
                matching_files = list(Path(self.local_path).glob(f"*{challenge_id}*.json"))
                if matching_files:
                    file_path = matching_files[0]
                else:
                    logger.debug(f"Arquivo {file_path} não encontrado")
                    return None
            
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            logger.info(f"Contexto {challenge_id} carregado de arquivo local: {file_path}")
            return ChallengeContext(data)
        
        except Exception as e:
            logger.error(f"Erro ao carregar contexto local {challenge_id}: {e}")
            return None
    
    async def _load_from_firebase(self, challenge_id: str) -> Optional[ChallengeContext]:
        if not self.firebase_client:
            logger.warning("Firebase client não configurado")
            return None

        try:
            doc_ref = self.firebase_client.collection('challenge_contexts').document(challenge_id)
            doc = doc_ref.get()
            
            if not doc.exists:
                logger.debug(f"Contexto {challenge_id} não encontrado no Firebase")
                return None
            
            data = doc.to_dict()
            logger.info(f"Contexto {challenge_id} carregado do Firebase")
            return ChallengeContext(data)
        
        except Exception as e:
            logger.error(f"Erro ao carregar contexto do Firebase {challenge_id}: {e}")
            return None
    
    async def _load_from_supabase(self, challenge_id: str) -> Optional[ChallengeContext]:
        if not self.supabase_client:
            logger.warning("Supabase client não configurado")
            return None

        try:
            response = self.supabase_client.table('challenge_contexts') \
                .select('*') \
                .eq('challenge_id', challenge_id) \
                .execute()
            
            if not response.data:
                logger.debug(f"Contexto {challenge_id} não encontrado no Supabase")
                return None
            
            data = response.data[0]
            logger.info(f"Contexto {challenge_id} carregado do Supabase")
            return ChallengeContext(data)
        
        except Exception as e:
            logger.error(f"Erro ao carregar contexto do Supabase {challenge_id}: {e}")
            return None
    
    async def _load_from_redis(self, challenge_id: str) -> Optional[ChallengeContext]:
        try:
            cache_key = f"logun:context:{challenge_id}"
            cached_data = await self.redis_client.get(cache_key)
            
            if not cached_data:
                return None
            
            data = json.loads(cached_data)
            logger.debug(f"Contexto {challenge_id} encontrado no Redis")
            return ChallengeContext(data)
        
        except Exception as e:
            logger.error(f"Erro ao carregar contexto do Redis {challenge_id}: {e}")
            return None
    
    async def _save_to_redis(self, challenge_id: str, context: ChallengeContext):
        try:
            cache_key = f"logun:context:{challenge_id}"
            data = json.dumps(context.to_dict())
            await self.redis_client.setex(cache_key, 86400, data)  # 24h TTL
            logger.debug(f"Contexto {challenge_id} cacheado no Redis")
        
        except Exception as e:
            logger.error(f"Erro ao cachear contexto no Redis {challenge_id}: {e}")
    
    def reload_contexts(self):
        self._memory_cache.clear()
        self._default_context = self._load_default_context()
        logger.info("Contextos recarregados")


_context_loader: Optional[ContextLoader] = None


def init_context_loader(
    source: str = "local",
    local_path: Optional[str] = None,
    redis_client=None,
    firebase_client=None,
    supabase_client=None
):
    global _context_loader
    _context_loader = ContextLoader(
        source=source,
        local_path=local_path,
        redis_client=redis_client,
        firebase_client=firebase_client,
        supabase_client=supabase_client
    )
    logger.info(f"Context loader inicializado (source: {source})")


async def load_challenge_context(challenge_id: str) -> ChallengeContext:
    if not _context_loader:
        raise RuntimeError("Context loader não inicializado. Chame init_context_loader() primeiro.")
    
    return await _context_loader.load_context(challenge_id)


def get_context_loader() -> ContextLoader:
    if not _context_loader:
        raise RuntimeError("Context loader não inicializado. Chame init_context_loader() primeiro.")
    
    return _context_loader
