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
        """Transiciona ACTIVE -> LOCKING -> CLOSED. Idempotente se ja CLOSED/ARCHIVED."""
        res = supabase_client.table('seasons').select('id,name,state').eq('id', season_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            raise ValueError("Season not found")
        current_state = rows[0]['state']
        if current_state in ('CLOSED', 'ARCHIVED'):
            return {'success': True, 'season_id': season_id, 'final_state': current_state,
                    'message': f'Season already {current_state}'}
        if current_state == 'ACTIVE':
            await self.transition_season_state(season_id, 'LOCKING')
        await self.transition_season_state(season_id, 'CLOSED')
        supabase_client.table('seasons').update({'closed_at': datetime.utcnow().isoformat()}).eq('id', season_id).execute()
        await self._log_admin_operation('close_season', 'admin',
                                        {'season_id': season_id, 'season_name': rows[0].get('name')})
        return {'success': True, 'season_id': season_id, 'final_state': 'CLOSED'}

    async def get_current_season(self) -> Optional[Dict[str, Any]]:
        # content_seasons e' a temporada real do jogo (status 'ativa'). Fallback: a mais recente.
        cols = 'id,nome,descricao,status,data_inicio,data_fim,total_levels,setores'
        res = supabase_client.table('content_seasons').select(cols).eq('status', 'ativa').order('created_at', desc=True).limit(1).execute()
        rows = res.data or []
        if not rows:
            res = supabase_client.table('content_seasons').select(cols).order('created_at', desc=True).limit(1).execute()
            rows = res.data or []
        if not rows:
            return None
        s = rows[0]
        return {
            'id': s['id'], 'nome': s.get('nome'), 'name': s.get('nome'),
            'status': s.get('status'), 'state': s.get('status'),
            'start_date': s.get('data_inicio'), 'end_date': s.get('data_fim'),
            'total_levels': s.get('total_levels'), 'descricao': s.get('descricao'), 'setores': s.get('setores'),
        }

    async def update_season(self, season_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        fields = {k: data[k] for k in ('status', 'data_inicio', 'data_fim', 'nome', 'descricao') if k in data and data[k] is not None}
        if not fields:
            raise ValueError('nada para atualizar')
        res = supabase_client.table('content_seasons').update(fields).eq('id', season_id).execute()
        if not res.data:
            raise LookupError('temporada nao encontrada')
        await self._log_admin_operation('update_season', 'admin', {'season_id': season_id, 'fields': list(fields.keys())})
        return res.data[0]

    async def transition_season_state(self, season_id: str, new_state: str) -> None:
        valid = {'ACTIVE': ['LOCKING'], 'LOCKING': ['CLOSED', 'ACTIVE'], 'CLOSED': ['ARCHIVED'], 'ARCHIVED': []}
        res = supabase_client.table('seasons').select('state').eq('id', season_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            raise ValueError("Season not found")
        current_state = rows[0]['state']
        if new_state not in valid.get(current_state, []):
            raise ValueError(f"Invalid transition: {current_state} -> {new_state}. Valid: {valid.get(current_state, [])}")
        supabase_client.table('seasons').update({
            'state': new_state, 'updated_at': datetime.utcnow().isoformat(),
        }).eq('id', season_id).execute()
        try:
            supabase_client.table('state_transitions').insert({
                'season_id': season_id, 'from_state': current_state, 'to_state': new_state, 'transitioned_by': 'admin',
            }).execute()
        except Exception as e:
            logger.warning(f"state_transitions insert falhou (ignorado): {e}")
        logger.info(f"Season {season_id} transitioned: {current_state} -> {new_state}")
    
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
    
    async def ban_user(self, user_id: str, reason: str, banned_by: str = 'admin') -> Dict[str, Any]:
        supabase_client.table('usuarios').update({
            'banned': True,
            'banned_at': datetime.utcnow().isoformat(),
            'ban_reason': reason,
        }).eq('id', user_id).execute()
        logger.info(f"User {user_id} banned by {banned_by}: {reason}")
        await self._log_admin_operation('ban_user', banned_by, {'user_id': user_id, 'reason': reason})
        return {'success': True, 'user_id': user_id, 'banned': True}

    async def unban_user(self, user_id: str, unbanned_by: str = 'admin') -> Dict[str, Any]:
        supabase_client.table('usuarios').update({
            'banned': False, 'banned_at': None, 'ban_reason': None,
        }).eq('id', user_id).execute()
        logger.info(f"User {user_id} unbanned by {unbanned_by}")
        await self._log_admin_operation('unban_user', unbanned_by, {'user_id': user_id})
        return {'success': True, 'user_id': user_id, 'banned': False}

    async def reset_user_progress(self, user_id: str, reset_by: str = 'admin') -> Dict[str, Any]:
        supabase_client.table('user_progress').update({
            'xp': 0, 'level': 1,
            'completed_challenges': [], 'completed_minigames': [], 'attempt_history': [],
            'updated_at': datetime.utcnow().isoformat(),
        }).eq('user_id', user_id).execute()
        logger.info(f"User {user_id} progress reset by {reset_by}")
        await self._log_admin_operation('reset_user_progress', reset_by, {'user_id': user_id})
        return {'success': True, 'user_id': user_id, 'progress_reset': True}

    async def delete_user(self, user_id: str, deleted_by: str = 'admin') -> Dict[str, Any]:
        # Limpa os filhos explicitamente (FKs variam entre CASCADE e nao) e depois o usuario.
        for tbl in ('challenge_attempts', 'intermission_game_sessions', 'phase_sessions', 'progress_history', 'user_progress'):
            try:
                supabase_client.table(tbl).delete().eq('user_id', user_id).execute()
            except Exception as e:
                logger.warning(f"delete_user: {tbl} falhou (ignorado): {e}")
        supabase_client.table('usuarios').delete().eq('id', user_id).execute()
        logger.info(f"User {user_id} DELETED by {deleted_by}")
        await self._log_admin_operation('delete_user', deleted_by, {'user_id': user_id})
        return {'success': True, 'user_id': user_id, 'deleted': True}

    async def reset_all_progress(self, reset_by: str = 'admin') -> Dict[str, Any]:
        import uuid as _uuid
        impossible = '00000000-0000-0000-0000-000000000000'
        for tbl in ('challenge_attempts', 'intermission_game_sessions', 'phase_sessions', 'progress_history'):
            try:
                supabase_client.table(tbl).delete().neq('user_id', impossible).execute()
            except Exception as e:
                logger.warning(f"reset_all: delete {tbl} falhou (ignorado): {e}")
        supabase_client.table('user_progress').update({
            'xp': 0, 'level': 1,
            'completed_challenges': [], 'completed_minigames': [], 'attempt_history': [],
            'phase_generation': str(_uuid.uuid4()),
            'updated_at': datetime.utcnow().isoformat(),
        }).neq('user_id', impossible).execute()
        logger.info(f"ALL user progress reset by {reset_by}")
        await self._log_admin_operation('reset_all_progress', reset_by, {})
        return {'success': True, 'reset_all': True}

    def _shape_user(self, up_row: Dict[str, Any]) -> Dict[str, Any]:
        u = up_row.get('usuarios') or {}
        cc = up_row.get('completed_challenges') or []
        cm = up_row.get('completed_minigames') or []
        return {
            'id': u.get('id'),
            'nickname': u.get('nickname'),
            'xp': up_row.get('xp') or 0,
            'level': up_row.get('level') or 1,
            'challenges_completed': len(cc),
            'minigames_completed': len(cm),
            'banned': u.get('banned', False),
            'created_at': u.get('criado_em'),
        }

    async def get_user_details(self, user_id: str) -> Optional[Dict[str, Any]]:
        res = supabase_client.table('user_progress').select(
            'xp,level,completed_challenges,completed_minigames,'
            'usuarios!inner(id,nickname,banned,banned_at,ban_reason,criado_em)'
        ).eq('user_id', user_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            return None
        shaped = self._shape_user(rows[0])
        u = rows[0].get('usuarios') or {}
        shaped['banned_at'] = u.get('banned_at')
        shaped['ban_reason'] = u.get('ban_reason')
        return shaped

    async def list_users(self, filters: Optional[Dict[str, Any]] = None, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
        q = supabase_client.table('user_progress').select(
            'xp,level,completed_challenges,completed_minigames,'
            'usuarios!inner(id,nickname,banned,criado_em)',
            count='exact',
        )
        if filters:
            if 'banned' in filters:
                q = q.eq('usuarios.banned', filters['banned'])
            if 'min_level' in filters:
                q = q.gte('level', filters['min_level'])
            if 'min_xp' in filters:
                q = q.gte('xp', filters['min_xp'])
        res = q.order('xp', desc=True).order('level', desc=True).range(offset, offset + limit - 1).execute()
        return {
            'users': [self._shape_user(r) for r in (res.data or [])],
            'total': res.count if res.count is not None else len(res.data or []),
            'limit': limit,
            'offset': offset,
        }

    async def _log_admin_operation(self, operation: str, user: str, details: Dict[str, Any]) -> None:
        # Auditoria e' secundaria: nao derruba a operacao se a tabela nao existir.
        try:
            supabase_client.table('admin_audit_logs').insert({
                'operation': operation, 'user': user, 'details': details,
            }).execute()
        except Exception as e:
            logger.warning(f"admin_audit_logs insert falhou (ignorado): {e}")


admin_service = AdminService()
