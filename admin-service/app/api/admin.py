from fastapi import APIRouter, HTTPException, Query
from typing import Optional, Dict, Any
import logging

from app.services.admin_service import admin_service
from app.services.content_service import content_service
from app.models.requests import (
    BanUserRequest,
    CreateSeasonRequest,
    UpdateSeasonStateRequest,
    UploadChallengesRequest,
    UpdateChallengeRequest
)
from app.models.responses import (
    BanUserResponse,
    UserDetailsResponse,
    ListUsersResponse,
    SeasonResponse,
    ChallengeResponse,
    UploadChallengesResponse
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


@router.post("/challenges/upload", response_model=UploadChallengesResponse)
async def upload_challenges(request: UploadChallengesRequest):
    """Fazer upload de desafios a partir de dados CSV."""
    result = await content_service.upload_challenges_bulk(request.csv_data)
    return result


@router.get("/challenges", response_model=list[ChallengeResponse])
async def list_challenges(
    difficulty: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000)
):
    """Listar desafios com filtros opcionais."""
    filters = {}
    if difficulty:
        filters['difficulty'] = difficulty
    if category:
        filters['category'] = category
    
    challenges = await content_service.list_challenges(filters, limit)
    return challenges


@router.get("/challenges/{challenge_id}", response_model=ChallengeResponse)
async def get_challenge(challenge_id: str):
    """Obter desafio com resposta (apenas administrador)."""
    challenge = await content_service.get_challenge_with_answer(challenge_id)
    
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    
    return challenge


@router.put("/challenges/{challenge_id}", response_model=ChallengeResponse)
async def update_challenge(challenge_id: str, request: UpdateChallengeRequest):
    """Atualizar campos do desafio."""
    updates = request.dict(exclude_unset=True)
    challenge = await content_service.update_challenge(challenge_id, updates)
    return challenge


@router.delete("/challenges/{challenge_id}")
async def delete_challenge(challenge_id: str):
    """Excluir desafio do Firebase."""
    result = await content_service.delete_challenge(challenge_id)
    return result


@router.get("/audit-logs")
async def get_audit_logs(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
):
    """Endpoint provisório (rascunho) para futura recuperação de logs de auditoria."""
    return {"message": "Audit logs endpoint - to be implemented"}
