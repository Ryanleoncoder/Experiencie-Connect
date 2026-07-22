"""Convites (criacao de usuarios): single, lote e limpeza."""

import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.invite_admin_service import invite_admin_service

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateInvite(BaseModel):
    nickname: str = Field(min_length=1, max_length=100)


class BulkInvite(BaseModel):
    nicknames: List[str]


@router.get("/invites")
async def list_invites() -> List[Dict[str, Any]]:
    return await invite_admin_service.list_invites()


@router.post("/invites", status_code=201)
async def create_invite(body: CreateInvite) -> Dict[str, Any]:
    result = await invite_admin_service.create_invite(body.nickname)
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result.get("error", "Falha ao criar convite"))
    return result["invite"]


@router.post("/invites/bulk")
async def create_bulk(body: BulkInvite) -> Dict[str, Any]:
    return await invite_admin_service.create_bulk(body.nicknames)


@router.post("/invites/clear-used")
async def clear_used() -> Dict[str, Any]:
    """Apaga do banco os convites já utilizados."""
    return await invite_admin_service.clear_used_invites()
