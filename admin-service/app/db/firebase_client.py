import firebase_admin
from firebase_admin import credentials, firestore
from typing import Optional, Dict, Any, List
import logging
import base64
import json

from app.core.config import settings

logger = logging.getLogger(__name__)


class FirebaseClient:
    def __init__(self):
        self.app: Optional[firebase_admin.App] = None
        self.db: Optional[firestore.Client] = None
        self._initialized = False
    
    def initialize(self) -> None:
        if self._initialized:
            logger.warning("Firebase already initialized")
            return
        
        try:
            credentials_json = base64.b64decode(settings.FIREBASE_CREDENTIALS_BASE64).decode('utf-8')
            credentials_dict = json.loads(credentials_json)
            
            cred = credentials.Certificate(credentials_dict)
            self.app = firebase_admin.initialize_app(cred)
            
            self.db = firestore.client()
            
            self._initialized = True
            logger.info(f"Firebase initialized for project: {settings.FIREBASE_PROJECT_ID}")
        
        except Exception as e:
            logger.error(f"Failed to initialize Firebase: {e}")
            raise
    
    def close(self) -> None:
        if self.app:
            try:
                firebase_admin.delete_app(self.app)
                self.app = None
                self.db = None
                self._initialized = False
                logger.info("Firebase connection closed")
            except Exception as e:
                logger.error(f"Error closing Firebase connection: {e}")
    
    def _ensure_initialized(self) -> None:
        """Ensure Firebase is initialized before operations."""
        if not self._initialized or self.db is None:
            raise RuntimeError("Firebase not initialized. Call initialize() first.")
    
    async def get_answer_key(self, challenge_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_initialized()
        
        try:
            doc_ref = self.db.collection('answer_keys').document(challenge_id)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                return {
                    'answers': data.get('correct_answers', []),
                    'points': data.get('points', 0),
                    'is_text_question': data.get('is_text_question', False)
                }
            else:
                logger.warning(f"Answer key not found: {challenge_id}")
                return None
        
        except Exception as e:
            logger.error(f"Error fetching answer key {challenge_id}: {e}")
            raise
    
    async def get_challenge(self, challenge_id: str) -> Optional[Dict[str, Any]]:
        self._ensure_initialized()
        
        try:
            doc_ref = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).document(challenge_id)
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                data['id'] = doc.id
                return data
            else:
                logger.warning(f"Challenge not found: {challenge_id}")
                return None
        
        except Exception as e:
            logger.error(f"Error fetching challenge {challenge_id}: {e}")
            raise
    
    async def get_challenges_by_level(
        self,
        level: int,
        setor: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        
        try:
            query = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).where('level', '==', level)
            
            if setor:
                query = query.where('setor', '==', setor)
            
            docs = query.stream()
            
            challenges = []
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                challenges.append(data)
            
            logger.info(f"Found {len(challenges)} challenges for level={level}, setor={setor}")
            return challenges
        
        except Exception as e:
            logger.error(f"Error fetching challenges for level={level}, setor={setor}: {e}")
            raise
    
    async def get_all_challenges(self) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        
        try:
            docs = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).stream()
            
            challenges = []
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                challenges.append(data)
            
            logger.info(f"Found {len(challenges)} total challenges")
            return challenges
        
        except Exception as e:
            logger.error(f"Error fetching all challenges: {e}")
            raise
    
    async def get_achievements(self) -> List[Dict[str, Any]]:
        self._ensure_initialized()
        
        try:
            docs = self.db.collection(settings.FIREBASE_ACHIEVEMENTS_COLLECTION).stream()
            
            achievements = []
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                achievements.append(data)
            
            logger.info(f"Found {len(achievements)} achievements")
            return achievements
        
        except Exception as e:
            logger.error(f"Error fetching achievements: {e}")
            raise
    
    async def health_check(self) -> bool:
        try:
            self._ensure_initialized()

            query = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).limit(1)
            list(query.stream())
            
            return True
        
        except Exception as e:
            logger.error(f"Firebase health check failed: {e}")
            return False
    
    async def create_challenge(self, challenge_data: Dict[str, Any]) -> str:
        self._ensure_initialized()
        
        try:
            doc_ref = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).document()
            doc_ref.set(challenge_data)
            
            logger.info(f"Created challenge: {doc_ref.id}")
            return doc_ref.id
        
        except Exception as e:
            logger.error(f"Error creating challenge: {e}")
            raise
    
    async def update_challenge(self, challenge_id: str, updates: Dict[str, Any]) -> None:
        self._ensure_initialized()
        
        try:
            doc_ref = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).document(challenge_id)
            doc_ref.update(updates)
            
            logger.info(f"Updated challenge: {challenge_id}")
        
        except Exception as e:
            logger.error(f"Error updating challenge {challenge_id}: {e}")
            raise
    
    async def delete_challenge(self, challenge_id: str) -> None:
        self._ensure_initialized()
        
        try:
            doc_ref = self.db.collection(settings.FIREBASE_CHALLENGES_COLLECTION).document(challenge_id)
            doc_ref.delete()
            
            logger.info(f"Deleted challenge: {challenge_id}")
        
        except Exception as e:
            logger.error(f"Error deleting challenge {challenge_id}: {e}")
            raise


firebase_client = FirebaseClient()
