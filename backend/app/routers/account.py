"""Conta do jogador: perfil, preferências, histórico, perfis públicos e ranking."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..auth import AuthUser, current_user
from ..services import profiles
from . import get_store

router = APIRouter(tags=["conta"])


class ProfileUpdate(BaseModel):
    username: str | None = Field(default=None, max_length=40)
    avatar: str | None = Field(default=None, max_length=20)


class SettingsUpdate(BaseModel):
    settings: dict


@router.get("/me")
async def me(user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await profiles.me(store, user)


@router.patch("/me")
async def update_me(body: ProfileUpdate, user: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return {"profile": await profiles.update_me(store, user.id, body.username, body.avatar)}


@router.put("/me/settings")
async def save_settings(
    body: SettingsUpdate, user: AuthUser = Depends(current_user), store=Depends(get_store)
) -> dict:
    return {"settings": await profiles.save_settings(store, user.id, body.settings)}


@router.get("/me/matches")
async def my_matches(
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: AuthUser = Depends(current_user),
    store=Depends(get_store),
) -> dict:
    return await profiles.matches(store, user.id, limit, offset)


@router.get("/profiles/{username}")
async def public_profile(username: str, _: AuthUser = Depends(current_user), store=Depends(get_store)) -> dict:
    return await profiles.public_profile(store, username)


@router.get("/leaderboard")
async def leaderboard(
    limit: int = Query(default=20, ge=1, le=100),
    _: AuthUser = Depends(current_user),
    store=Depends(get_store),
) -> dict:
    return await profiles.leaderboard(store, limit)
