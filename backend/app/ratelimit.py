"""Limite de requisições (janela deslizante, em memória).

Protege contra força bruta no login local, enumeração de nomes de usuário e spam
de salas, sem atrapalhar quem joga de verdade: os limites são folgados para o uso
normal (uma partida gera poucas requisições por minuto).

Dois níveis:
  * por endereço IP, em todas as rotas de /api (o mais barato, vale até para quem
    ainda não entrou);
  * por usuário autenticado, depois de validar o token (um usuário não consegue
    contornar o limite trocando de IP, e o vizinho de IP não é punido por ele).

Em produção com vários processos, cada processo conta separadamente; para um limite
global use também o limitador do proxy ou da hospedagem.
"""

from __future__ import annotations

import time
from collections import deque
from math import ceil
from typing import Callable

from fastapi import Depends, Request

from .auth import AuthUser, current_user
from .errors import ApiError

#: nome da regra -> (máximo de requisições, janela em segundos)
DEFAULT_RULES: dict[str, tuple[int, float]] = {
    "auth": (10, 60.0),          # login e cadastro locais, por IP
    "username": (40, 60.0),      # consulta de nome de usuário (cadastro), por IP
    "write": (400, 60.0),        # POST/PUT/PATCH/DELETE, por IP
    "read": (1500, 60.0),        # GET, por IP
    "user": (900, 60.0),         # qualquer rota autenticada, por usuário
    "create_room": (20, 60.0),   # criar sala ou partida rápida, por usuário
    "friend_request": (20, 60.0),  # pedidos de amizade, por usuário
    "chat": (40, 60.0),          # mensagens rápidas, por usuário
}

MESSAGE = "Muitas tentativas em pouco tempo. Aguarde alguns segundos e tente de novo."


class RateLimiter:
    def __init__(
        self,
        enabled: bool = True,
        rules: dict[str, tuple[int, float]] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.enabled = enabled
        self.rules = {**DEFAULT_RULES, **(rules or {})}
        self.clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._calls = 0

    def check(self, rule: str, identity: str) -> float | None:
        """Registra uma requisição. Devolve `None` se passou ou quantos segundos esperar."""
        if not self.enabled:
            return None
        limit, window = self.rules[rule]
        now = self.clock()

        # A limpeza vem antes de registrar esta requisição, para não apagá-la.
        self._calls += 1
        if self._calls % 2000 == 0:
            self._purge(now)

        hits = self._hits.setdefault(f"{rule}:{identity}", deque())
        while hits and now - hits[0] >= window:
            hits.popleft()

        if len(hits) >= limit:
            return max(0.1, window - (now - hits[0]))
        hits.append(now)
        return None

    def _purge(self, now: float) -> None:
        """Descarta quem não faz requisições há mais que a janela (evita crescer sem fim)."""
        for key in list(self._hits):
            hits = self._hits[key]
            window = self.rules[key.split(":", 1)[0]][1]
            if not hits or now - hits[-1] >= window:
                del self._hits[key]

    @staticmethod
    def rule_for(method: str, path: str) -> str:
        if path in ("/api/dev/login", "/api/dev/signup"):
            return "auth"
        if path.startswith("/api/usernames/"):
            return "username"
        return "write" if method in ("POST", "PUT", "PATCH", "DELETE") else "read"

    def enforce_user(self, rule: str, user_id: str) -> None:
        wait = self.check(rule, user_id)
        if wait is not None:
            raise too_many(wait)


def too_many(wait: float) -> ApiError:
    return ApiError(429, "RATE_LIMITED", MESSAGE, headers={"Retry-After": str(ceil(wait))})


def client_ip(request: Request, trust_proxy: bool, hops: int = 2) -> str:
    """IP de quem chama.

    Atrás de proxies confiáveis, o IP real é o que o proxy mais próximo anotou: contando da direita
    para a esquerda em X-Forwarded-For, o item `hops`. Tudo que o cliente escreveu antes disso
    (à esquerda) é ignorado, então forjar o cabeçalho não escapa do limite. Se a cadeia for mais
    curta do que `hops`, vale o primeiro item (nunca junta todo mundo num IP só)."""
    if trust_proxy:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if parts:
            return parts[max(0, len(parts) - max(1, hops))]
    return request.client.host if request.client else "desconhecido"


def user_limit(rule: str):
    """Dependência: aplica uma regra por usuário (ex.: `Depends(user_limit("create_room"))`)."""

    async def dependency(request: Request, user: AuthUser = Depends(current_user)) -> None:
        request.app.state.limiter.enforce_user(rule, user.id)

    return dependency
