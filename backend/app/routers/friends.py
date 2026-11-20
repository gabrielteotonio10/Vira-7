"""Amigos: lista, pedidos e aceite."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import AuthUser, current_user
from ..services import friends
from . import get_store

router = APIRouter(prefix="/friends", tags=["amigos"])


class FriendRequest(BaseModel):
    username: str = Field(max_length=40)


@router.get("")
async def overview(user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await friends.overview(store, user.id)


@router.post("/requests", status_code=201)
async def request_friend(
    body: FriendRequest, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return await friends.request(store, user.id, body.username)


@router.post("/{other_id}/accept")
async def accept(other_id: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await friends.accept(store, user.id, other_id)


@router.delete("/{other_id}")
async def remove(other_id: str, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await friends.remove(store, user.id, other_id)
