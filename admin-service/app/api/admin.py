from fastapi import APIRouter, Body, HTTPException, Query
from typing import Optional, Dict, Any
import logging

from app.services.admin_service import admin_service
from app.models.requests import (
    BanUserRequest,
    CreateSeasonRequest,
    UpdateSeasonStateRequest,
)
from app.models.responses import (
    BanUserResponse,
    UserDetailsResponse,
    ListUsersResponse,
    SeasonResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/users", response_model=ListUsersResponse)
async def list_users(
    banned: Optional[bool] = Query(None),
    min_level: Optional[int] = Query(None),
    min_xp: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """Listar usuários com filtros opcionais e paginação."""
    filters = {}
    if banned is not None:
        filters['banned'] = banned
    if min_level is not None:
        filters['min_level'] = min_level
    if min_xp is not None:
        filters['min_xp'] = min_xp
    
    result = await admin_service.list_users(filters, limit, offset)
    return result


@router.get("/users/{user_id}", response_model=UserDetailsResponse)
async def get_user_details(user_id: str):
    """Obter informações detalhadas do usuário."""
    user = await admin_service.get_user_details(user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user


@router.post("/users/{user_id}/ban", response_model=BanUserResponse)
async def ban_user(user_id: str, request: BanUserRequest):
    """Banir usuário da plataforma."""
    result = await admin_service.ban_user(
        user_id,
        request.reason,
        request.banned_by or 'admin'
    )
    return result


@router.post("/users/{user_id}/unban", response_model=BanUserResponse)
async def unban_user(user_id: str):
    """Desbanir usuário da plataforma."""
    result = await admin_service.unban_user(user_id)
    return result


@router.post("/users/{user_id}/reset-progress")
async def reset_user_progress(user_id: str):
    """Redefinir progresso do usuário (XP, nível, desafios, minijogos)."""
    result = await admin_service.reset_user_progress(user_id)
    return result


@router.post("/users/reset-all")
async def reset_all_users():
    """Zera o progresso de TODOS os usuários (irreversível)."""
    return await admin_service.reset_all_progress()


@router.delete("/users/{user_id}")
async def delete_user(user_id: str):
    """Exclui o usuário e todo o progresso/tentativas (irreversível)."""
    return await admin_service.delete_user(user_id)


@router.get("/seasons/current", response_model=SeasonResponse)
async def get_current_season():
    """Obter temporada ativa atual."""
    season = await admin_service.get_current_season()
    
    if not season:
        raise HTTPException(status_code=404, detail="No active season")
    
    return season


@router.post("/seasons/{season_id}/close")
async def close_season(season_id: str):
    """Fechar temporada com transições de estado (ATIVO → BLOQUEANDO → FECHADO)."""
    result = await admin_service.close_season(season_id)
    return result


@router.put("/seasons/{season_id}/state")
async def update_season_state(season_id: str, request: UpdateSeasonStateRequest):
    """Transicionar temporada para novo estado."""
    await admin_service.transition_season_state(season_id, request.new_state)
    return {"success": True, "season_id": season_id, "new_state": request.new_state}


@router.patch("/seasons/{season_id}")
async def update_season(season_id: str, body: Dict[str, Any] = Body(...)):
    """Editar a temporada (content_seasons): status, janela (data_inicio/data_fim), nome."""
    try:
        return await admin_service.update_season(season_id, body)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Temporada não encontrada")


@router.get("/audit-logs")
async def get_audit_logs(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """Endpoint provisório (rascunho) para futura recuperação de logs de auditoria."""
    return {"message": "Audit logs endpoint - to be implemented"}
