"""Erros da API. Toda resposta de erro tem o formato:

    {"error": {"code": "ROOM_FULL", "message": "A sala está cheia."}}
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("vira7")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.headers = headers


class StoreError(Exception):
    """Regra violada no banco (ex.: ROOM_FULL). As camadas de serviço traduzem."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


#: Códigos vindos do banco -> (status HTTP, mensagem para o usuário).
STORE_MESSAGES: dict[str, tuple[int, str]] = {
    "ROOM_NOT_FOUND": (404, "Sala não encontrada. Confira o código."),
    "ROOM_FULL": (409, "A sala está cheia."),
    "ROOM_NOT_OPEN": (409, "Essa sala já começou a partida ou foi fechada."),
    "ALREADY_IN_ROOM": (409, "Você já está em outra sala. Saia dela antes de entrar em uma nova."),
    "USERNAME_TAKEN": (409, "Esse nome de usuário já está em uso."),
    "EMAIL_TAKEN": (409, "Já existe uma conta com esse e-mail."),
}


def from_store(error: StoreError) -> ApiError:
    status, message = STORE_MESSAGES.get(error.code, (400, "Não foi possível concluir a operação."))
    return ApiError(status, error.code, message)


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, error: ApiError):
        return JSONResponse(_body(error.code, error.message), status_code=error.status, headers=error.headers)

    @app.exception_handler(StoreError)
    async def store_error(_: Request, error: StoreError):
        api = from_store(error)
        return JSONResponse(_body(api.code, api.message), status_code=api.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError):
        first = error.errors()[0] if error.errors() else {}
        field = ".".join(str(part) for part in first.get("loc", [])[1:])
        message = f"Dados inválidos{f' em {field}' if field else ''}."
        return JSONResponse(_body("VALIDATION_ERROR", message), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, error: StarletteHTTPException):
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(error.status_code, "HTTP_ERROR")
        return JSONResponse(_body(code, str(error.detail)), status_code=error.status_code)

    @app.exception_handler(Exception)
    async def unexpected(_: Request, error: Exception):
        # Nunca devolve detalhes internos para o cliente.
        log.exception("Erro inesperado: %s", error)
        return JSONResponse(_body("INTERNAL_ERROR", "Erro interno. Tente novamente."), status_code=500)
