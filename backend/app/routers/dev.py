"""Login local do MODO DE DESENVOLVIMENTO (sem Supabase).

Estas rotas só existem quando `SUPABASE_URL` não está configurado. Servem para
rodar e testar o jogo na própria máquina; em produção o cadastro, o login e a
recuperação de senha são feitos pelo Supabase Auth.
"""

from __future__ import annotations

import time

import jwt
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ..config import AVATARS
from ..errors import ApiError
from ..services import profiles
from . import get_store

router = APIRouter(prefix="/dev", tags=["desenvolvimento"])
TOKEN_SECONDS = 12 * 60 * 60


class SignUp(BaseModel):
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6, max_length=72)
    username: str = Field(max_length=40)
    avatar: str = "raposa"


class SignIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=72)


def issue_token(secret: str, user: dict) -> dict:
    now = int(time.time())
    token = jwt.encode(
        {
            "sub": user["id"], "email": user["email"], "role": "authenticated",
            "aud": "authenticated", "iat": now, "exp": now + TOKEN_SECONDS,
        },
        secret,
        algorithm="HS256",
    )
    return {"accessToken": token, "expiresAt": now + TOKEN_SECONDS, "user": user}


@router.post("/signup", status_code=201)
async def signup(body: SignUp, request: Request, store=Depends(get_store)) -> dict:
    username = profiles.validate_username(body.username)
    avatar = body.avatar if body.avatar in AVATARS else "raposa"
    user = await store.dev_create_user(body.email, body.password, username, avatar)
    return issue_token(request.app.state.settings.supabase_jwt_secret, user)


@router.post("/login")
async def login(body: SignIn, request: Request, store=Depends(get_store)) -> dict:
    user = await store.dev_check_password(body.email, body.password)
    if not user:
        raise ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.")
    return issue_token(request.app.state.settings.supabase_jwt_secret, user)
