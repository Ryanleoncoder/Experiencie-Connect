"""Contextos de IA (challenge_contexts)."""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Body, HTTPException

from app.services.context_admin_service import context_admin_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/contexts")
async def list_contexts() -> List[Dict[str, Any]]:
    return await context_admin_service.list_contexts()


@router.get("/contexts/{challenge_id}")
async def get_context(challenge_id: str) -> Dict[str, Any]:
    c = await context_admin_service.get_context(challenge_id)
    if not c:
        raise HTTPException(status_code=404, detail="Contexto não encontrado")
    return c


@router.put("/contexts/{challenge_id}")
async def upsert_context(challenge_id: str, context: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    try:
        return await context_admin_service.upsert_context(challenge_id, context)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Falha ao salvar contexto %s: %s", challenge_id, e)
        raise HTTPException(status_code=500, detail="Falha ao salvar contexto")


@router.delete("/contexts/{challenge_id}", status_code=204)
async def delete_context(challenge_id: str) -> None:
    await context_admin_service.delete_context(challenge_id)
