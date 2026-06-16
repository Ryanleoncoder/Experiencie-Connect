import logging
import json
from datetime import datetime, date
from typing import Dict, Any, List, Optional
from uuid import UUID

from app.core.config import settings
from app.db.supabase_client import supabase_client

logger = logging.getLogger(__name__)


class AdminService:
    """Handles admin operations and system management."""
    
    def __init__(self):
        self.storage_bucket = settings.SUPABASE_STORAGE_BUCKET
        self.ranking_prefix = settings.RANKING_FILE_PREFIX
    
    async def generate_daily_ranking(self) -> Dict[str, Any]:
        """Generates ranking JSON, uploads to Supabase Storage, and also updates ranking-latest.json."""
        lock_name = "generate_daily_ranking"
        lock_acquired = await supabase_client.call_rpc(
            'acquire_distributed_lock',
            {'p_lock_name': lock_name, 'p_ttl_seconds': 300}
        )
        
        if not lock_acquired:
            logger.warning("Failed to acquire lock for ranking generation")
            raise ValueError("Another ranking generation is in progress")
        
        try:
            response = supabase_client.client.table('user_progress').select(
                'xp, level, user_id, usuarios!inner(id, nickname)'
            ).order('xp', desc=True).order('level', desc=True).limit(100).execute()
            
            users = []
            for row in response.data:
                users.append({
                    'id': row['usuarios']['id'],
                    'nickname': row['usuarios']['nickname'],
                    'xp': row['xp'],
                    'level': row['level']
                })
            
            ranking_data = {
                'generated_at': datetime.utcnow().isoformat() + 'Z',
                'date': date.today().isoformat(),
                'total_users': len(users),
                'ranking': [
                    {
                        'rank': idx + 1,
                        'user_id': user['id'],
                        'nickname': user['nickname'],
                        'xp': user['xp'],
                        'level': user['level']
                    }
                    for idx, user in enumerate(users)
                ]
            }
            
            today = date.today().isoformat()
            filename = f"ranking-{today}.json"
            
            ranking_json = json.dumps(ranking_data, indent=2).encode('utf-8')
            
            try:
                storage_response = supabase_client.client.storage.from_(self.storage_bucket).upload(
                    path=filename,
                    file=ranking_json,
                    file_options={
                        "content-type": "application/json",
                        "upsert": "true"
                    }
                )

                latest_filename = "ranking-latest.json"
                supabase_client.client.storage.from_(self.storage_bucket).upload(
                    path=latest_filename,
                    file=ranking_json,
                    file_options={
                        "content-type": "application/json",
                        "upsert": "true"
                    }
                )

                public_url = supabase_client.client.storage.from_(self.storage_bucket).get_public_url(filename)
                latest_url = supabase_client.client.storage.from_(self.storage_bucket).get_public_url(latest_filename)
                
                logger.info(f"Ranking generated and uploaded: {len(users)} users, file: {filename}, url: {public_url}")
                logger.info(f"Latest ranking updated: {latest_filename}, url: {latest_url}")
                
            except Exception as storage_error:
                logger.error(f"Failed to upload ranking to storage: {storage_error}")
                raise ValueError(f"Storage upload failed: {storage_error}")
            
            await self._log_admin_operation(
                'generate_daily_ranking',
                'system',
                {'users_count': len(users), 'filename': filename, 'public_url': public_url, 'latest_url': latest_url}
            )
            
            return {
                'success': True,
                'filename': filename,
                'public_url': public_url,
                'latest_url': latest_url,
                'users_count': len(users),
                'generated_at': ranking_data['generated_at']
            }
        
        finally:
            await supabase_client.call_rpc(
                'release_distributed_lock',
                {'p_lock_name': lock_name}
            )

    async def get_current_ranking(self) -> Dict[str, Any]:
        today = date.today().isoformat()
        filename = f"ranking-{today}.json"
        
        try:
            file_list = supabase_client.client.storage.from_(self.storage_bucket).list()
            file_exists = any(f['name'] == filename for f in file_list)
            
            if file_exists:
                public_url = supabase_client.client.storage.from_(self.storage_bucket).get_public_url(filename)

                return {
                    'status': 'success',
                    'url': public_url,
                    'filename': filename,
                    'date': today
                }
            else:
                return {
                    'status': 'pending',
                    'message': 'Ranking not yet generated for today',
                    'filename': filename,
                    'date': today
                }
        except Exception as e:
            logger.error(f"Error checking ranking file: {e}")
            return {
                'status': 'error',
                'message': f'Failed to check ranking: {str(e)}',
                'filename': filename,
                'date': today
            }
    
    async def close_season(self, season_id: str) -> Dict[str, Any]:
        """
        Transitions ACTIVE → LOCKING → CLOSED with a 30-second buffer for in-flight requests.
        Idempotent: already CLOSED/ARCHIVED returns success immediately.
        """
        import asyncio

        lock_name = f"close_season_{season_id}"
        lock_acquired = await supabase_client.call_rpc(
            'acquire_distributed_lock',
            {'p_lock_name': lock_name, 'p_ttl_seconds': 1800}
        )
        
        if not lock_acquired:
            raise ValueError("Another season close operation is in progress")
        
        try:
            season = await supabase_client.fetchrow(
                "SELECT id, name, state FROM seasons WHERE id = $1",
                UUID(season_id)
            )
            
            if not season:
                raise ValueError("Season not found")
            
            current_state = season['state']
            
            if current_state == 'CLOSED' or current_state == 'ARCHIVED':
                logger.info(f"Season {season_id} already {current_state}, returning success (idempotent)")
                return {
                    'success': True,
                    'season_id': season_id,
                    'final_state': current_state,
                    'message': f'Season already {current_state}'
                }
            
            if current_state == 'ACTIVE':
                await self.transition_season_state(season_id, 'LOCKING')
                logger.info(f"Season {season_id} transitioned to LOCKING")
                logger.info(f"Waiting 30 seconds for in-flight requests to complete...")
                await asyncio.sleep(30)

            if current_state == 'LOCKING' or current_state == 'ACTIVE':
                await self.transition_season_state(season_id, 'CLOSED')
                
                await supabase_client.execute(
                    "UPDATE seasons SET closed_at = NOW() WHERE id = $1",
                    UUID(season_id)
                )
                
                logger.info(f"Season {season_id} closed successfully")
            
            try:
                ranking_result = await self.generate_daily_ranking()
                logger.info(f"Final ranking snapshot created: {ranking_result['filename']}")
            except Exception as ranking_error:
                logger.error(f"Failed to create final ranking snapshot: {ranking_error}")
                # Ranking failure must not fail the close operation
            
            await self._log_admin_operation(
                'close_season',
                'admin',
                {'season_id': season_id, 'season_name': season['name']}
            )
            
            return {
                'success': True,
                'season_id': season_id,
                'final_state': 'CLOSED'
            }
        
        finally:
            await supabase_client.call_rpc(
                'release_distributed_lock',
                {'p_lock_name': lock_name}
            )
    
    async def get_current_season(self) -> Optional[Dict[str, Any]]:
        season = await supabase_client.fetchrow(
            """
            SELECT id, name, state, start_date, end_date, created_at
            FROM seasons
            WHERE state = 'ACTIVE'
            ORDER BY start_date DESC
            LIMIT 1
            """
        )
        
        if not season:
            return None
        
        return {
            'id': str(season['id']),
            'name': season['name'],
            'state': season['state'],
            'start_date': season['start_date'].isoformat(),
            'end_date': season['end_date'].isoformat() if season['end_date'] else None
        }
    
    async def transition_season_state(
        self,
        season_id: str,
        new_state: str
    ) -> None:
        valid_transitions = {
            'ACTIVE': ['LOCKING'],
            'LOCKING': ['CLOSED', 'ACTIVE'],
            'CLOSED': ['ARCHIVED'],
            'ARCHIVED': []
        }
        
        season = await supabase_client.fetchrow(
            "SELECT state FROM seasons WHERE id = $1",
            UUID(season_id)
        )
        
        if not season:
            raise ValueError("Season not found")
        
        current_state = season['state']
        
        if new_state not in valid_transitions.get(current_state, []):
            raise ValueError(
                f"Invalid transition: {current_state} → {new_state}. "
                f"Valid transitions: {valid_transitions.get(current_state, [])}"
            )
        
        await supabase_client.execute(
            "UPDATE seasons SET state = $1, updated_at = NOW() WHERE id = $2",
            new_state, UUID(season_id)
        )
        
        await supabase_client.execute(
            """
            INSERT INTO state_transitions (season_id, from_state, to_state, transitioned_by)
            VALUES ($1, $2, $3, $4)
            """,
            UUID(season_id), current_state, new_state, 'admin'
        )
        
        logger.info(f"Season {season_id} transitioned: {current_state} → {new_state}")
    
    async def cleanup_old_data(self, retention_days: int = 90) -> Dict[str, Any]:
        """Deletes old attempts beyond retention period. Preserves all current-season data."""
        lock_acquired = await supabase_client.call_rpc(
            'acquire_distributed_lock',
            {'p_lock_name': 'cleanup_old_data', 'p_ttl_seconds': 600}
        )
        
        if not lock_acquired:
            raise ValueError("Another cleanup operation is in progress")
        
        try:
            login_attempts_deleted = await supabase_client.fetchval(
                "SELECT cleanup_old_login_attempts()"
            )

            current_season = await self.get_current_season()

            if current_season:
                attempts_deleted = await supabase_client.fetchval(
                    """
                    WITH deleted AS (
                        DELETE FROM attempts
                        WHERE created_at < NOW() - INTERVAL '1 day' * $1
                        AND created_at < (
                            SELECT start_date FROM seasons WHERE id = $2
                        )
                        RETURNING 1
                    )
                    SELECT COUNT(*) FROM deleted
                    """,
                    retention_days,
                    UUID(current_season['id'])
                )
            else:
                attempts_deleted = await supabase_client.fetchval(
                    """
                    WITH deleted AS (
                        DELETE FROM attempts
                        WHERE created_at < NOW() - INTERVAL '1 day' * $1
                        RETURNING 1
                    )
                    SELECT COUNT(*) FROM deleted
                    """,
                    retention_days
                )
            
            logger.info(
                f"Cleanup completed: {attempts_deleted} attempts, "
                f"{login_attempts_deleted} login attempts deleted. "
                f"Current season data preserved."
            )
            
            await self._log_admin_operation(
                'cleanup_old_data',
                'system',
                {
                    'retention_days': retention_days,
                    'attempts_deleted': attempts_deleted,
                    'login_attempts_deleted': login_attempts_deleted,
                    'current_season_preserved': current_season is not None
                }
            )
            
            return {
                'success': True,
                'attempts_deleted': attempts_deleted,
                'login_attempts_deleted': login_attempts_deleted,
                'retention_days': retention_days
            }
        
        finally:
            await supabase_client.call_rpc(
                'release_distributed_lock',
                {'p_lock_name': 'cleanup_old_data'}
            )
    
    async def ban_user(
        self,
        user_id: str,
        reason: str,
        banned_by: str = 'admin'
    ) -> Dict[str, Any]:
        await supabase_client.execute(
            """
            UPDATE usuarios
            SET banned = true, banned_at = NOW(), ban_reason = $2
            WHERE id = $1
            """,
            UUID(user_id), reason
        )
        
        logger.info(f"User {user_id} banned by {banned_by}: {reason}")
        
        await self._log_admin_operation(
            'ban_user',
            banned_by,
            {'user_id': user_id, 'reason': reason}
        )
        
        return {
            'success': True,
            'user_id': user_id,
            'banned': True
        }
    
    async def unban_user(
        self,
        user_id: str,
        unbanned_by: str = 'admin'
    ) -> Dict[str, Any]:
        await supabase_client.execute(
            """
            UPDATE usuarios
            SET banned = false, banned_at = NULL, ban_reason = NULL
            WHERE id = $1
            """,
            UUID(user_id)
        )
        
        logger.info(f"User {user_id} unbanned by {unbanned_by}")
        
        await self._log_admin_operation(
            'unban_user',
            unbanned_by,
            {'user_id': user_id}
        )
        
        return {
            'success': True,
            'user_id': user_id,
            'banned': False
        }
    
    async def reset_user_progress(
        self,
        user_id: str,
        reset_by: str = 'admin'
    ) -> Dict[str, Any]:
        await supabase_client.execute(
            """
            UPDATE user_progress
            SET xp = 0,
                level = 1,
                completed_challenges = ARRAY[]::text[],
                completed_minigames = ARRAY[]::text[],
                attempt_history = '[]'::jsonb,
                updated_at = NOW()
            WHERE user_id = $1
            """,
            UUID(user_id)
        )
        
        logger.info(f"User {user_id} progress reset by {reset_by}")
        
        await self._log_admin_operation(
            'reset_user_progress',
            reset_by,
            {'user_id': user_id}
        )
        
        return {
            'success': True,
            'user_id': user_id,
            'progress_reset': True
        }
    
    async def get_user_details(self, user_id: str) -> Optional[Dict[str, Any]]:
        user = await supabase_client.fetchrow(
            """
            SELECT u.id, u.nickname, u.banned, u.banned_at, u.ban_reason,
                   u.criado_em as created_at, u.updated_at,
                   COALESCE(up.xp, 0) as xp,
                   COALESCE(up.level, 1) as level,
                   COALESCE(array_length(up.completed_challenges, 1), 0) as challenges_completed,
                   COALESCE(array_length(up.completed_minigames, 1), 0) as minigames_completed
            FROM usuarios u
            LEFT JOIN user_progress up ON u.id = up.user_id
            WHERE u.id = $1
            """,
            UUID(user_id)
        )
        
        if not user:
            return None
        
        return {
            'id': str(user['id']),
            'nickname': user['nickname'],
            'xp': user['xp'],
            'level': user['level'],
            'challenges_completed': user['challenges_completed'],
            'minigames_completed': user['minigames_completed'],
            'banned': user['banned'],
            'banned_at': user['banned_at'].isoformat() if user['banned_at'] else None,
            'ban_reason': user['ban_reason'],
            'created_at': user['created_at'].isoformat(),
            'updated_at': user['updated_at'].isoformat()
        }
    
    async def list_users(
        self,
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Dict[str, Any]:
        query = """
            SELECT u.id, u.nickname, u.banned, u.criado_em as created_at,
                   COALESCE(up.xp, 0) as xp,
                   COALESCE(up.level, 1) as level,
                   COALESCE(array_length(up.completed_challenges, 1), 0) as challenges_completed,
                   COALESCE(array_length(up.completed_minigames, 1), 0) as minigames_completed
            FROM usuarios u
            LEFT JOIN user_progress up ON u.id = up.user_id
            WHERE 1=1
        """
        params = []
        param_idx = 1

        if filters:
            if 'banned' in filters:
                query += f" AND banned = ${param_idx}"
                params.append(filters['banned'])
                param_idx += 1
            
            if 'min_level' in filters:
                query += f" AND up.level >= ${param_idx}"
                params.append(filters['min_level'])
                param_idx += 1
            
            if 'min_xp' in filters:
                query += f" AND up.xp >= ${param_idx}"
                params.append(filters['min_xp'])
                param_idx += 1
        
        query += f" ORDER BY up.xp DESC, up.level DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
        params.extend([limit, offset])

        users = await supabase_client.fetch(query, *params)
        
        count_query = "SELECT COUNT(*) FROM usuarios u LEFT JOIN user_progress up ON u.id = up.user_id WHERE 1=1"
        count_params = []
        if filters:
            if 'banned' in filters:
                count_query += " AND u.banned = $1"
                count_params.append(filters['banned'])
        
        total = await supabase_client.fetchval(count_query, *count_params)
        
        return {
            'users': [
                {
                    'id': str(user['id']),
                    'nickname': user['nickname'],
                    'xp': user['xp'],
                    'level': user['level'],
                    'challenges_completed': user['challenges_completed'],
                    'minigames_completed': user['minigames_completed'],
                    'banned': user['banned'],
                    'created_at': user['created_at'].isoformat()
                }
                for user in users
            ],
            'total': total,
            'limit': limit,
            'offset': offset
        }
    
    async def _log_admin_operation(
        self,
        operation: str,
        user: str,
        details: Dict[str, Any]
    ) -> None:
        supabase_client.client.table('admin_audit_logs').insert({
            'operation': operation,
            'user': user,
            'details': details
        }).execute()


admin_service = AdminService()
