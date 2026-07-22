"""Gestao de desafios: conteudo (challenges) + gabarito (answer_keys)."""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.challenge_admin_service import challenge_admin_service

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateChallenge(BaseModel):
    challenge_id: str
    season_id: str
    setor: str = "CX"
    level: int
    tipo: str
    titulo: str
    descricao: Optional[str] = None
    categoria: Optional[str] = None
    alternativas: Optional[Dict[str, Any]] = None
    xp: Optional[int] = None
    tempo_limite: Optional[int] = None
    ordem: Optional[int] = None
    ativo: bool = True
    tags: Optional[List[str]] = None
    resposta_correta: Optional[str] = None
    correct_answers: Optional[List[str]] = None
    is_text_question: Optional[bool] = None
    points: Optional[int] = None


class UpdateChallenge(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    categoria: Optional[str] = None
    alternativas: Optional[Dict[str, Any]] = None
    tipo: Optional[str] = None
    xp: Optional[int] = None
    tempo_limite: Optional[int] = None
    ordem: Optional[int] = None
    ativo: Optional[bool] = None
    tags: Optional[List[str]] = None


class UpdateAnswer(BaseModel):
    resposta_correta: Optional[str] = None
    correct_answers: Optional[List[str]] = None
    is_text_question: Optional[bool] = None
    points: Optional[int] = None


@router.get("/challenges")
async def list_challenges(season_id: Optional[str] = Query(None), setor: Optional[str] = Query(None),
                          level: Optional[int] = Query(None)) -> List[Dict[str, Any]]:
    return await challenge_admin_service.list_challenges(season_id, setor, level)


@router.get("/challenges/{challenge_id}")
async def get_challenge(challenge_id: str) -> Dict[str, Any]:
    ch = await challenge_admin_service.get_challenge(challenge_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Desafio nao encontrado")
    return ch


@router.post("/challenges", status_code=201)
async def create_challenge(body: CreateChallenge) -> Dict[str, Any]:
    try:
        return await challenge_admin_service.create_challenge(body.model_dump(exclude_none=True))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Falha ao criar desafio: %s", e)
        raise HTTPException(status_code=500, detail="Falha ao criar desafio")


@router.patch("/challenges/{challenge_id}")
async def update_challenge(challenge_id: str, body: UpdateChallenge) -> Dict[str, Any]:
    try:
        return await challenge_admin_service.update_challenge(challenge_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Desafio nao encontrado")
    except Exception as e:
        logger.error("Falha ao atualizar desafio %s: %s", challenge_id, e)
        raise HTTPException(status_code=500, detail="Falha ao atualizar desafio")


@router.patch("/challenges/{challenge_id}/answer")
async def update_answer(challenge_id: str, body: UpdateAnswer) -> Dict[str, Any]:
    try:
        return await challenge_admin_service.update_answer(challenge_id, body.model_dump(exclude_unset=True))
    except Exception as e:
        logger.error("Falha ao atualizar gabarito %s: %s", challenge_id, e)
        raise HTTPException(status_code=500, detail="Falha ao atualizar gabarito")


@router.delete("/challenges/{challenge_id}", status_code=204)
async def delete_challenge(challenge_id: str) -> None:
    try:
        await challenge_admin_service.delete_challenge(challenge_id)
    except Exception as e:
        logger.error("Falha ao apagar desafio %s: %s", challenge_id, e)
        raise HTTPException(status_code=500, detail="Falha ao apagar desafio")
