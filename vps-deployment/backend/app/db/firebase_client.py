"""Firebase client for accessing Firestore collections."""

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
        """Initialize Firebase Admin SDK."""
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
            logger.info("Firebase initialized successfully")
        
        except Exception as e:
            logger.error(f"Failed to initialize Firebase: {e}")
            raise
    
    def close(self) -> None:
        """Close Firebase connection."""
        if self.app:
            try:
                firebase_admin.delete_app(self.app)
                self.app = None
                self.db = None
                self._initialized = False
                logger.info("Firebase connection closed")
            except Exception as e:
                logger.error(f"Error closing Firebase connection: {e}")
    
    async def health_check(self) -> dict:
        """Check if Firebase connection is healthy."""
        try:
            if not self._initialized or self.db is None:
                return {"status": "unhealthy", "error": "Firebase not initialized"}
            
            start_time = __import__('time').time()
            query = self.db.collection("challenges").limit(1)
            list(query.stream())
            latency_ms = (__import__('time').time() - start_time) * 1000
            
            return {
                "status": "healthy",
                "latency_ms": round(latency_ms, 2)
            }
        
        except Exception as e:
            logger.error(f"Firebase health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}

    async def load_level(self, season_id: str, setor: str, level: int) -> Dict[str, Any]:
        """Load one public level document from Firestore."""
        if not self._initialized or self.db is None:
            raise RuntimeError("Firebase not initialized")

        doc_path = f"seasons/{season_id}/levels/{setor}_{level}"
        doc = self.db.document(doc_path).get()
        if not doc.exists:
            raise ValueError(f"Level document not found: {doc_path}")

        data = doc.to_dict() or {}
        data.setdefault("season_id", season_id)
        data.setdefault("setor", setor)
        data.setdefault("level", level)
        return data


firebase_client = FirebaseClient()
