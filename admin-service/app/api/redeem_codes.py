"""CRUD dos codigos de resgate (redeem_codes)."""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.redeem_service import redeem_service

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateRedeemCode(BaseModel):
    codigo: str = Field(min_length=1, max_length=100)
    tipo_reward: str
    reward_payload: Dict[str, Any]
    escopo: str
    ativo: bool = True
    inicio: Optional[str] = None
    fim: Optional[str] = None


class UpdateRedeemCode(BaseModel):
    ativo: Optional[bool] = None
    inicio: Optional[str] = None
    fim: Optional[str] = None
    reward_payload: Optional[Dict[str, Any]] = None
    tipo_reward: Optional[str] = None
    escopo: Optional[str] = None


@router.get("/redeem-codes")
async def list_redeem_codes() -> List[Dict[str, Any]]:
    return await redeem_service.list_codes()


@router.post("/redeem-codes", status_code=201)
async def create_redeem_code(body: CreateRedeemCode) -> Dict[str, Any]:
    try:
        return await redeem_service.create_code(body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Falha ao criar redeem_code: %s", e)
        raise HTTPException(status_code=500, detail="Falha ao criar codigo")


@router.patch("/redeem-codes/{code_id}")
async def update_redeem_code(code_id: str, body: UpdateRedeemCode) -> Dict[str, Any]:
    try:
        return await redeem_service.update_code(code_id, body.model_dump(exclude_unset=True))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except LookupError:
        raise HTTPException(status_code=404, detail="Codigo nao encontrado")
    except Exception as e:
        logger.error("Falha ao atualizar redeem_code %s: %s", code_id, e)
        raise HTTPException(status_code=500, detail="Falha ao atualizar codigo")


@router.delete("/redeem-codes/{code_id}", status_code=204)
async def delete_redeem_code(code_id: str) -> None:
    try:
        await redeem_service.delete_code(code_id)
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.error("Falha ao apagar redeem_code %s: %s", code_id, e)
        raise HTTPException(status_code=500, detail="Falha ao apagar codigo")
