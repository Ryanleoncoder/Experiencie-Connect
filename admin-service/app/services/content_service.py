"""
Firebase structure: seasons/{season_id}/levels/{SETOR}_{LEVEL} — array of questions.
Answers stored separately in answer_keys collection (not exposed to frontend).

CSV format (separator `;`):
id;level;setor;season_id;titulo;descricao;tipo;alternativas;resposta_correta;xp;tempo_limite;tags;categoria
"""

import logging
import csv
import json
from io import StringIO
from typing import Dict, Any, List, Optional
from datetime import datetime
from collections import defaultdict
from firebase_admin import firestore

from app.core.config import settings
from app.db.firebase_client import firebase_client
from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)


class ContentService:
    """Handles admin operations for challenge content in Firebase."""
    
    def __init__(self):
        self.seasons_collection = "seasons"
        self.answer_keys_collection = "answer_keys"
        self.backup_bucket = "challenge-backups"
    
    def _validate_csv_format(self, csv_data: str) -> tuple[bool, Optional[str]]:
        try:
            csv_data.encode('utf-8')
        except UnicodeEncodeError:
            return False, "CSV must be UTF-8 encoded"
        
        if ';' not in csv_data:
            return False, "CSV must use semicolon (;) as separator"
        
        try:
            reader = csv.DictReader(StringIO(csv_data), delimiter=';')
            rows = list(reader)

            if not rows:
                return False, "CSV file is empty"

            required_fields = {'id', 'level', 'setor', 'season_id', 'titulo', 'tipo', 'alternativas', 'resposta_correta', 'xp'}
            first_row = rows[0]
            missing_fields = required_fields - set(first_row.keys())
            
            if missing_fields:
                return False, f"Missing required fields: {', '.join(missing_fields)}"
            
            return True, None
            
        except Exception as e:
            return False, f"CSV parsing error: {str(e)}"
    
    async def upload_challenges_bulk(self, csv_data: str) -> Dict[str, Any]:
        is_valid, error_msg = self._validate_csv_format(csv_data)
        if not is_valid:
            logger.error(f"CSV validation failed: {error_msg}")
            return {
                'success': False,
                'uploaded': 0,
                'errors': [error_msg]
            }
        
        reader = csv.DictReader(StringIO(csv_data), delimiter=';')
        rows = list(reader)

        levels_data = defaultdict(list)
        answer_keys = {}
        errors = []
        
        for row_num, row in enumerate(rows, start=2):
            try:
                challenge_id = row.get('id', '').strip()
                if not challenge_id:
                    raise ValueError("Missing required field: id")
                
                level_str = row.get('level', '').strip()
                if not level_str:
                    raise ValueError("Missing required field: level")
                
                setor = row.get('setor', '').strip()
                if not setor:
                    raise ValueError("Missing required field: setor")
                
                season_id = row.get('season_id', '').strip()
                if not season_id:
                    raise ValueError("Missing required field: season_id")
                
                titulo = row.get('titulo', '').strip()
                if not titulo:
                    raise ValueError("Missing required field: titulo")
                
                tipo = row.get('tipo', '').strip()
                if not tipo:
                    raise ValueError("Missing required field: tipo")
                
                alternativas_str = row.get('alternativas', '').strip()
                if not alternativas_str:
                    raise ValueError("Missing required field: alternativas")
                
                resposta_correta = row.get('resposta_correta', '').strip()
                if not resposta_correta:
                    raise ValueError("Missing required field: resposta_correta")
                
                xp_str = row.get('xp', '').strip()
                if not xp_str:
                    raise ValueError("Missing required field: xp")
                
                try:
                    level_int = int(level_str)
                except ValueError:
                    raise ValueError(f"Invalid level value: {level_str}")
                
                try:
                    xp = int(xp_str)
                except ValueError:
                    raise ValueError(f"Invalid xp value: {xp_str}")
                
                try:
                    alternativas = json.loads(alternativas_str)
                    if not isinstance(alternativas, dict):
                        raise ValueError("alternativas must be a JSON object")
                except json.JSONDecodeError as e:
                    raise ValueError(f"Invalid JSON in alternativas: {str(e)}")
                
                descricao = row.get('descricao', '').strip()
                tempo_limite = int(row.get('tempo_limite', '60').strip() or '60')
                tags_str = row.get('tags', '').strip()
                tags = [t.strip() for t in tags_str.split(',')] if tags_str else []
                categoria = row.get('categoria', '').strip()
                
                question_data = {
                    'id': challenge_id,
                    'titulo': titulo,
                    'descricao': descricao,
                    'tipo': tipo,
                    'alternativas': alternativas,
                    'xp': xp,
                    'tempo_limite': tempo_limite,
                    'tags': tags,
                    'categoria': categoria,
                    'ordem': 0,  # Will be set when grouping
                    'ativo': True
                }
                
                answer_keys[challenge_id] = {
                    'correct_answers': [resposta_correta.upper()],
                    'points': xp,
                    'is_text_question': tipo == 'texto'
                }
                
                level_key = (season_id, setor, level_int)
                levels_data[level_key].append(question_data)
                
            except Exception as e:
                error_msg = f"Row {row_num}: Failed to parse challenge {row.get('id', 'unknown')}: {str(e)}"
                errors.append(error_msg)
                logger.error(error_msg)
        
        uploaded_challenges = 0
        uploaded_levels = 0

        try:
            db = firebase_client.db
            if not db:
                raise RuntimeError("Firebase not initialized")

            for (season_id, setor, level), questions in levels_data.items():
                try:
                    for idx, question in enumerate(questions, start=1):
                        question['ordem'] = idx
                    
                    total_xp = sum(q['xp'] for q in questions)
                    
                    level_doc_id = f"{setor}_{level}"
                    level_data = {
                        'level': level,
                        'setor': setor,
                        'season_id': season_id,
                        'nome': f"Level {level}",
                        'descricao': '',
                        'cor': '#00E676',
                        'icone': '🎯',
                        'xp_multiplier': 1.0,
                        'total_xp': total_xp,
                        'challenge_count': len(questions),
                        'schema_version': 1,
                        'questions': questions,
                        'created_at': firestore.SERVER_TIMESTAMP
                    }
                    
                    level_ref = db.collection('seasons').document(season_id).collection('levels').document(level_doc_id)
                    level_ref.set(level_data)
                    
                    uploaded_levels += 1
                    uploaded_challenges += len(questions)
                    logger.info(f"Uploaded level {level_doc_id} with {len(questions)} questions")
                    
                except Exception as e:
                    error_msg = f"Failed to upload level {setor}_{level} for season {season_id}: {str(e)}"
                    errors.append(error_msg)
                    logger.error(error_msg)
            
            for challenge_id, answer_data in answer_keys.items():
                try:
                    answer_ref = db.collection('answer_keys').document(challenge_id)
                    answer_ref.set(answer_data)
                    logger.info(f"Uploaded answer key for {challenge_id}")
                except Exception as e:
                    error_msg = f"Failed to upload answer key for {challenge_id}: {str(e)}"
                    errors.append(error_msg)
                    logger.error(error_msg)
        
        except Exception as e:
            error_msg = f"Firebase upload failed: {str(e)}"
            errors.append(error_msg)
            logger.error(error_msg)
        
        try:
            await self._log_audit(
                operation="upload_challenges_bulk",
                details={
                    "uploaded_challenges": uploaded_challenges,
                    "uploaded_levels": uploaded_levels,
                    "errors_count": len(errors),
                    "total_rows": len(rows)
                }
            )
        except Exception as e:
            logger.error(f"Failed to log audit entry: {e}")
        
        return {
            'success': len(errors) == 0,
            'uploaded_challenges': uploaded_challenges,
            'uploaded_levels': uploaded_levels,
            'errors': errors
        }
    
    async def get_challenge_with_answer(self, challenge_id: str, season_id: str, setor: str, level: int) -> Optional[Dict[str, Any]]:
        try:
            db = firebase_client.db
            if not db:
                raise RuntimeError("Firebase not initialized")
            
            level_doc_id = f"{setor}_{level}"
            level_ref = db.collection('seasons').document(season_id).collection('levels').document(level_doc_id)
            level_doc = level_ref.get()
            
            if not level_doc.exists:
                logger.warning(f"Level document not found: {level_doc_id}")
                return None
            
            level_data = level_doc.to_dict()
            questions = level_data.get('questions', [])
            
            challenge = None
            for q in questions:
                if q.get('id') == challenge_id:
                    challenge = q
                    break
            
            if not challenge:
                logger.warning(f"Challenge not found in level: {challenge_id}")
                return None
            
            answer_ref = db.collection('answer_keys').document(challenge_id)
            answer_doc = answer_ref.get()
            
            if answer_doc.exists:
                answer_data = answer_doc.to_dict()
                challenge['resposta_correta'] = answer_data.get('correct_answers', [])
                challenge['is_text_question'] = answer_data.get('is_text_question', False)
            else:
                logger.warning(f"Answer key not found: {challenge_id}")
                challenge['resposta_correta'] = []
            
            return challenge
            
        except Exception as e:
            logger.error(f"Error fetching challenge {challenge_id}: {e}")
            return None
    
    async def _create_backup(self, challenge_id: str, challenge_data: Dict[str, Any]) -> str:
        """Logs challenge data as backup. Supabase Storage upload not yet implemented."""
        try:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"challenge_{challenge_id}_{timestamp}.json"
            backup_data = json.dumps(challenge_data, indent=2, ensure_ascii=False)

            logger.info(f"Backup created for challenge {challenge_id}: {backup_filename}")
            logger.debug(f"Backup data: {backup_data}")

            return backup_filename

        except Exception as e:
            logger.error(f"Failed to create backup for challenge {challenge_id}: {e}")
            raise
    
    async def _log_audit(self, operation: str, details: Dict[str, Any]) -> None:
        try:
            audit_entry = {
                'operation': operation,
                'user': 'admin',
                'details': details,
                'created_at': datetime.utcnow().isoformat()
            }

            result = supabase_client.table('admin_audit_logs').insert(audit_entry).execute()
            logger.info(f"Audit log created: {operation}")

        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")
            # Audit logging failure must not block the caller
    
    async def update_challenge(
        self,
        challenge_id: str,
        season_id: str,
        setor: str,
        level: int,
        updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        current_challenge = await self.get_challenge_with_answer(challenge_id, season_id, setor, level)
        if not current_challenge:
            raise ValueError(f"Challenge not found: {challenge_id}")
        
        try:
            backup_filename = await self._create_backup(challenge_id, current_challenge)
            logger.info(f"Backup created: {backup_filename}")
        except Exception as e:
            logger.error(f"Backup creation failed: {e}")
            # Backup failure must not block the update
        
        try:
            db = firebase_client.db
            if not db:
                raise RuntimeError("Firebase not initialized")
            
            level_doc_id = f"{setor}_{level}"
            level_ref = db.collection('seasons').document(season_id).collection('levels').document(level_doc_id)
            level_doc = level_ref.get()
            
            if not level_doc.exists:
                raise ValueError(f"Level document not found: {level_doc_id}")
            
            level_data = level_doc.to_dict()
            questions = level_data.get('questions', [])
            
            updated = False
            for idx, q in enumerate(questions):
                if q.get('id') == challenge_id:
                    for key, value in updates.items():
                        if key not in ['resposta_correta', 'is_text_question']:
                            q[key] = value
                    questions[idx] = q
                    updated = True
                    break
            
            if not updated:
                raise ValueError(f"Challenge not found in level: {challenge_id}")
            
            level_ref.update({'questions': questions})
            
            if 'resposta_correta' in updates or 'is_text_question' in updates:
                answer_ref = db.collection('answer_keys').document(challenge_id)
                answer_updates = {}
                if 'resposta_correta' in updates:
                    answer_updates['correct_answers'] = [updates['resposta_correta'].upper()]
                if 'is_text_question' in updates:
                    answer_updates['is_text_question'] = updates['is_text_question']
                if 'xp' in updates:
                    answer_updates['points'] = updates['xp']
                
                if answer_updates:
                    answer_ref.update(answer_updates)
            
            logger.info(f"Updated challenge: {challenge_id}")
            
            await self._log_audit(
                operation="update_challenge",
                details={
                    "challenge_id": challenge_id,
                    "season_id": season_id,
                    "setor": setor,
                    "level": level,
                    "updates": updates,
                    "backup_file": backup_filename if 'backup_filename' in locals() else None
                }
            )
            
            return await self.get_challenge_with_answer(challenge_id, season_id, setor, level)
            
        except Exception as e:
            logger.error(f"Error updating challenge {challenge_id}: {e}")
            raise
    
    async def delete_challenge(
        self,
        challenge_id: str,
        season_id: str,
        setor: str,
        level: int
    ) -> Dict[str, Any]:
        current_challenge = await self.get_challenge_with_answer(challenge_id, season_id, setor, level)
        if not current_challenge:
            raise ValueError(f"Challenge not found: {challenge_id}")
        
        backup_filename = await self._create_backup(challenge_id, current_challenge)
        logger.info(f"Backup created before deletion: {backup_filename}")
        
        try:
            db = firebase_client.db
            if not db:
                raise RuntimeError("Firebase not initialized")
            
            level_doc_id = f"{setor}_{level}"
            level_ref = db.collection('seasons').document(season_id).collection('levels').document(level_doc_id)
            level_doc = level_ref.get()
            
            if not level_doc.exists:
                raise ValueError(f"Level document not found: {level_doc_id}")
            
            level_data = level_doc.to_dict()
            questions = level_data.get('questions', [])
            
            original_count = len(questions)
            questions = [q for q in questions if q.get('id') != challenge_id]
            
            if len(questions) == original_count:
                raise ValueError(f"Challenge not found in level: {challenge_id}")
            
            total_xp = sum(q.get('xp', 0) for q in questions)
            
            level_ref.update({
                'questions': questions,
                'challenge_count': len(questions),
                'total_xp': total_xp
            })
            
            answer_ref = db.collection('answer_keys').document(challenge_id)
            answer_ref.delete()
            
            logger.info(f"Deleted challenge: {challenge_id}")
            
            await self._log_audit(
                operation="delete_challenge",
                details={
                    "challenge_id": challenge_id,
                    "season_id": season_id,
                    "setor": setor,
                    "level": level,
                    "backup_file": backup_filename,
                    "challenge_data": current_challenge
                }
            )
            
            return {
                'success': True,
                'challenge_id': challenge_id,
                'backup_file': backup_filename,
                'level_doc_id': level_doc_id,
                'remaining_challenges': len(questions)
            }
            
        except Exception as e:
            logger.error(f"Error deleting challenge {challenge_id}: {e}")
            raise
    
    async def list_challenges(
        self,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        try:
            db = firebase_client.db
            if not db:
                raise RuntimeError("Firebase not initialized")
            
            challenges = []
            
            if filters and 'season_id' in filters and 'setor' in filters and 'level' in filters:
                season_id = filters['season_id']
                setor = filters['setor']
                level = int(filters['level'])
                
                level_doc_id = f"{setor}_{level}"
                level_ref = db.collection('seasons').document(season_id).collection('levels').document(level_doc_id)
                level_doc = level_ref.get()
                
                if level_doc.exists:
                    level_data = level_doc.to_dict()
                    questions = level_data.get('questions', [])
                    
                    for q in questions:
                        q['_season_id'] = season_id
                        q['_setor'] = setor
                        q['_level'] = level
                    
                    challenges.extend(questions)
            
            elif filters and 'season_id' in filters:
                season_id = filters['season_id']
                setor_filter = filters.get('setor')
                level_filter = filters.get('level')
                
                levels_ref = db.collection('seasons').document(season_id).collection('levels')
                levels_snapshot = levels_ref.stream()
                
                for level_doc in levels_snapshot:
                    level_data = level_doc.to_dict()
                    level_id = level_doc.id
                    parts = level_id.split('_')
                    if len(parts) >= 2:
                        doc_setor = parts[0]
                        doc_level = int(parts[1])
                        
                        if setor_filter and doc_setor != setor_filter:
                            continue
                        
                        if level_filter and doc_level != int(level_filter):
                            continue
                        
                        questions = level_data.get('questions', [])
                        
                        for q in questions:
                            q['_season_id'] = season_id
                            q['_setor'] = doc_setor
                            q['_level'] = doc_level
                        
                        challenges.extend(questions)
            
            else:
                logger.warning("Listing challenges without season_id filter - this is expensive!")
                seasons_ref = db.collection('seasons')
                seasons_snapshot = seasons_ref.stream()
                
                for season_doc in seasons_snapshot:
                    season_id = season_doc.id
                    levels_ref = season_doc.reference.collection('levels')
                    levels_snapshot = levels_ref.stream()
                    
                    for level_doc in levels_snapshot:
                        level_data = level_doc.to_dict()
                        level_id = level_doc.id
                        parts = level_id.split('_')
                        if len(parts) >= 2:
                            doc_setor = parts[0]
                            doc_level = int(parts[1])
                            
                            questions = level_data.get('questions', [])
                            
                            for q in questions:
                                q['_season_id'] = season_id
                                q['_setor'] = doc_setor
                                q['_level'] = doc_level
                            
                            challenges.extend(questions)
            
            if filters:
                if 'categoria' in filters:
                    challenges = [
                        c for c in challenges
                        if c.get('categoria') == filters['categoria']
                    ]
                
                if 'tipo' in filters:
                    challenges = [
                        c for c in challenges
                        if c.get('tipo') == filters['tipo']
                    ]
                
                if 'ativo' in filters:
                    challenges = [
                        c for c in challenges
                        if c.get('ativo') == filters['ativo']
                    ]
            
            challenges = challenges[:limit]
            
            logger.info(f"Listed {len(challenges)} challenges with filters: {filters}")
            
            return challenges

        except Exception as e:
            logger.error(f"Error listing challenges: {e}")
            raise


content_service = ContentService()
