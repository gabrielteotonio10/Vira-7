"""Salas e lobby."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..auth import AuthUser, current_user
from ..game import constants as C
from ..ratelimit import user_limit
from ..services import rooms
from . import get_store

router = APIRouter(prefix="/rooms", tags=["salas"])


def _check_target(value: int | None) -> int | None:
    if value is not None and value not in C.TARGET_SCORES:
        raise ValueError(f"Meta inválida. Use uma de {C.TARGET_SCORES}.")
    return value


def _check_turn(value: int | None) -> int | None:
    if value is not None and value not in C.TURN_SECONDS:
        raise ValueError(f"Tempo de turno inválido. Use um de {C.TURN_SECONDS}.")
    return value


class RoomCreate(BaseModel):
    name: str = Field(default="", max_length=40)
    visibility: Literal["public", "private"] = "private"
    max_players: int = Field(default=4, ge=C.MIN_PLAYERS, le=C.MAX_PLAYERS, alias="maxPlayers")
    target_score: int = Field(default=C.DEFAULT_TARGET_SCORE, alias="targetScore")
    turn_seconds: int = Field(default=30, alias="turnSeconds")
    team_mode: bool = Field(default=False, alias="teamMode")

    model_config = {"populate_by_name": True}

    _target = field_validator("target_score")(_check_target)
    _turn = field_validator("turn_seconds")(_check_turn)


class RoomUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    visibility: Literal["public", "private"] | None = None
    max_players: int | None = Field(default=None, ge=C.MIN_PLAYERS, le=C.MAX_PLAYERS, alias="maxPlayers")
    target_score: int | None = Field(default=None, alias="targetScore")
    turn_seconds: int | None = Field(default=None, alias="turnSeconds")
    team_mode: bool | None = Field(default=None, alias="teamMode")

    model_config = {"populate_by_name": True}

    _target = field_validator("target_score")(_check_target)
    _turn = field_validator("turn_seconds")(_check_turn)


class ChatMessage(BaseModel):
    kind: Literal["say", "emoji"]
    key: str = Field(max_length=8)


class ReadyUpdate(BaseModel):
    ready: bool


@router.get("/public")
async def public_rooms(_: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return {"rooms": await rooms.public_rooms(store)}


@router.post("", status_code=201, dependencies=[Depends(user_limit("create_room"))])
async def create_room(body: RoomCreate, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.create(store, user.id, body.model_dump())


@router.post("/quick", dependencies=[Depends(user_limit("create_room"))])
async def quick_match(user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.quick_match(store, user.id)


@router.post("/{code}/join")
async def join_room(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.join(store, user.id, code)


@router.get("/{code}")
async def get_room(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.get(store, user.id, code)


@router.patch("/{code}")
async def update_room(
    code: str, body: RoomUpdate, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await rooms.update_settings(store, user.id, code, body.model_dump())


@router.post("/{code}/leave")
async def leave_room(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.leave(store, user.id, code)


@router.post("/{code}/ready")
async def set_ready(
    code: str, body: ReadyUpdate, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await rooms.set_ready(store, user.id, code, body.ready)


@router.post("/{code}/bots", status_code=201)
async def add_bot(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.add_bot(store, user.id, code)


@router.delete("/{code}/players/{player_id}")
async def remove_player(
    code: str, player_id: str, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await rooms.remove_player(store, user.id, code, player_id)


@router.post("/{code}/start")
async def start_game(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.start(store, user.id, code)


@router.post("/{code}/chat", status_code=201)
async def send_chat(
    code: str, body: ChatMessage, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await rooms.send_chat(store, user.id, code, body.kind, body.key)


@router.get("/{code}/chat")
async def read_chat(
    code: str, after: int = 0, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await rooms.read_chat(store, user.id, code, max(after, 0))


@router.post("/{code}/heartbeat")
async def heartbeat(code: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await rooms.heartbeat(store, user.id, code)
