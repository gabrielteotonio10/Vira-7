"""Aplicação FastAPI do Vira-7.

Executar em desenvolvimento (a partir da pasta `backend/`):

    uvicorn app.main:app --reload --port 8000

A API fica em /api e, por padrão, também serve o frontend em /.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets

import httpx
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, errors
from .auth import TokenVerifier
from .config import PROJECT_DIR, Settings
from .ratelimit import RateLimiter, client_ip, too_many
from .routers import account, dev, games, meta, rooms
from .services import referee
from .store import MemoryStore, SupabaseStore

log = logging.getLogger("vira7")
STATIC_DIRS = ("css", "js", "assets")
STATIC_PREFIXES = tuple(f"/{name}/" for name in STATIC_DIRS)


def content_security_policy(settings: Settings) -> str:
    """Política de segurança da página: só o próprio site, o Supabase configurado e as
    fontes e o script do Supabase (CDN) que o jogo realmente usa."""
    connect = ["'self'"]
    if settings.supabase_url:
        connect.append(settings.supabase_url)
        connect.append(settings.supabase_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1))
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src https://fonts.gstatic.com",
            "img-src 'self' data:",
            f"connect-src {' '.join(connect)}",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )


def create_app(settings: Settings | None = None, store=None) -> FastAPI:
    settings = settings or Settings.from_env()

    if settings.dev_mode and not settings.supabase_jwt_secret:
        # Segredo descartável para assinar os tokens do login local.
        settings.supabase_jwt_secret = secrets.token_urlsafe(48)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        http = httpx.AsyncClient(timeout=15)
        app.state.http = http
        app.state.store = store or (
            MemoryStore() if settings.dev_mode
            else SupabaseStore(settings.supabase_url, settings.supabase_service_key, http)
        )
        app.state.verifier = TokenVerifier(settings, http)
        if settings.dev_mode:
            log.warning("MODO DE DESENVOLVIMENTO LOCAL: sem Supabase, dados apenas em memória.")

        task = None
        if settings.referee_enabled:
            task = asyncio.create_task(
                referee.run(app.state.store, settings.referee_interval, settings.disconnect_grace_seconds)
            )
        try:
            yield
        finally:
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await http.aclose()

    app = FastAPI(
        title="Vira-7 API",
        version=__version__,
        description="API do jogo de cartas Vira-7: contas, salas e partidas online em tempo real.",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.limiter = RateLimiter(enabled=settings.rate_limit_enabled)
    errors.install(app)

    @app.middleware("http")
    async def guard(request, call_next):
        """Limite por IP nas rotas da API, cabeçalhos de segurança e cache dos arquivos."""
        path = request.url.path
        if path.startswith("/api/") and app.state.limiter.enabled:
            rule = app.state.limiter.rule_for(request.method, path)
            wait = app.state.limiter.check(rule, client_ip(request, settings.trust_proxy))
            if wait is not None:
                error = too_many(wait)
                return JSONResponse(
                    {"error": {"code": error.code, "message": error.message}}, status_code=429, headers=error.headers
                )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        if path.startswith(STATIC_PREFIXES):
            # O navegador sempre confere se o arquivo mudou (304 quando não mudou),
            # então ninguém fica com CSS/JS antigo depois de uma atualização.
            response.headers["Cache-Control"] = "no-cache"
        return response

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
        )

    api = APIRouter(prefix="/api")
    api.include_router(meta.router)
    api.include_router(account.router)
    api.include_router(rooms.router)
    api.include_router(games.router)
    if settings.dev_mode:
        api.include_router(dev.router)
    app.include_router(api)

    if settings.serve_frontend and (PROJECT_DIR / "index.html").exists():
        # Só as pastas do frontend são expostas; `backend/` (com o .env) nunca é servido.
        for name in STATIC_DIRS:
            if (PROJECT_DIR / name).is_dir():
                app.mount(f"/{name}", StaticFiles(directory=PROJECT_DIR / name), name=name)

        page_headers = {"Cache-Control": "no-cache", "Content-Security-Policy": content_security_policy(settings)}

        @app.get("/", include_in_schema=False)
        async def index() -> FileResponse:
            return FileResponse(PROJECT_DIR / "index.html", headers=page_headers)

    return app


def _lazy_app() -> FastAPI:
    return create_app()


# `uvicorn app.main:app` — a aplicação é criada na importação, lendo o ambiente.
def __getattr__(name: str):
    if name == "app":
        application = _lazy_app()
        globals()["app"] = application
        return application
    raise AttributeError(name)
