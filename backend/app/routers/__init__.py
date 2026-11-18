"""Rotas HTTP da API (todas sob o prefixo /api)."""

from fastapi import Request


def get_store(request: Request):
    return request.app.state.store
