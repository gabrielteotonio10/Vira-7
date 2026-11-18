"""Rotas públicas: saúde da API e configuração do frontend."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from .. import __version__
from ..services import profiles
from . import get_store

router = APIRouter(tags=["meta"])


# HEAD também: monitores gratuitos de disponibilidade costumam usá-lo.
@router.api_route("/health", methods=["GET", "HEAD"])
async def health(request: Request) -> dict:
    settings = request.app.state.settings
    return {
        "status": "ok",
        "version": __version__,
        "mode": "development-local" if settings.dev_mode else "supabase",
        "serverTime": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/config")
async def config(request: Request) -> dict:
    """O que o frontend precisa para conectar. Só valores públicos: a chave anônima
    do Supabase é feita para ficar no navegador (o RLS protege os dados)."""
    settings = request.app.state.settings
    return {
        "version": __version__,
        "devMode": settings.dev_mode,
        "supabaseUrl": settings.supabase_url or None,
        "supabaseAnonKey": settings.supabase_anon_key or None,
        "serverTime": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/usernames/{username}/available")
async def username_available(username: str, store=Depends(get_store)) -> dict:
    """Usado pelo formulário de cadastro, antes de a conta existir."""
    return await profiles.username_available(store, username)
