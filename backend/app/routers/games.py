"""Partidas: estado, eventos e jogadas."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ..auth import AuthUser, current_user
from ..errors import ApiError
from ..services import games
from . import get_store

router = APIRouter(prefix="/games", tags=["partidas"])


class Action(BaseModel):
    """`hit` = virar, `stay` = parar, `target` = escolher o alvo de uma carta de ação."""

    type: Literal["hit", "stay", "target"]
    target: int | None = Field(default=None, ge=0, le=7)
    #: Identifica a decisão que o cliente está respondendo; evita jogadas duplicadas.
    token: int | None = Field(default=None, ge=0)


@router.get("/{game_id}")
async def get_game(game_id: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await games.snapshot(store, game_id, user.id)


@router.get("/{game_id}/events")
async def get_events(
    game_id: str,
    after: int = Query(default=0, ge=0),
    user: AuthUser = Depends(current_user),
    store=Depends(get_store),
) -> dict:
    return await games.events_after(store, game_id, user.id, after)


@router.post("/{game_id}/actions")
async def post_action(
    game_id: str, body: Action, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    if body.type == "target":
        if body.target is None:
            raise ApiError(422, "VALIDATION_ERROR", "Informe o jogador escolhido.")
        return await games.act(store, game_id, user.id, "target", body.target, body.token)
    return await games.act(store, game_id, user.id, "move", body.type, body.token)


@router.post("/{game_id}/tick")
async def post_tick(
    game_id: str, request: Request, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    """Pede ao servidor para conferir o prazo do turno (ele só age se já venceu)."""
    grace = request.app.state.settings.disconnect_grace_seconds
    return await games.tick(store, game_id, grace, by_user=user.id)
