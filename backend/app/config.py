"""Configuração da API, lida de variáveis de ambiente (ou de `backend/.env`).

Nenhuma credencial fica no código. A chave `service_role` e o segredo do JWT
existem só no servidor; o frontend recebe apenas a URL do projeto e a chave anônima,
que são públicas por natureza.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

#: Personagens disponíveis (os mesmos da migration 0001 e do frontend).
AVATARS: tuple[str, ...] = (
    "raposa", "panda", "sapo", "leao", "gato", "coelho", "urso", "pinguim", "coruja", "macaco",
)
#: Cor de cada assento na mesa.
SEAT_COLORS: tuple[str, ...] = (
    "#e5484d", "#2f7df6", "#1fa35c", "#f08c00", "#8b5cf6", "#0e9aa7", "#e64980", "#b8890b",
)
BOT_NAMES: tuple[str, ...] = ("Rita", "Beto", "Lia", "Caio", "Nina", "Davi", "Bia", "Téo")


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in ("1", "true", "yes", "sim", "on")


def _csv(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


@dataclass
class Settings:
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    #: Só é necessário em projetos que assinam o JWT com HS256 (segredo legado).
    supabase_jwt_secret: str = ""
    cors_origins: list[str] = field(default_factory=list)
    #: Serve o frontend (index.html, css, js, assets) pela própria API.
    serve_frontend: bool = True
    #: Árbitro em segundo plano: aplica prazos de turno e trata desconectados.
    referee_enabled: bool = True
    referee_interval: float = 2.0
    #: Sem sinal do jogador da vez por este tempo, o servidor joga por ele.
    disconnect_grace_seconds: int = 40
    #: Sala sem nenhum jogador dando sinal por este tempo é fechada (0 desliga a limpeza).
    stale_room_seconds: int = 180
    #: Limite de requisições por IP e por usuário (veja app/ratelimit.py).
    rate_limit_enabled: bool = True
    #: Atrás de um proxy/CDN confiável, usa o IP de X-Forwarded-For para o limite.
    trust_proxy: bool = False
    #: Quantos proxies confiáveis existem na frente da API. O IP do visitante é o que cada proxy
    #: acrescentou à direita de X-Forwarded-For: o que o cliente escreve à esquerda é ignorado.
    trusted_proxy_hops: int = 2
    #: Anfitrião do lobby sem sinal por este tempo passa a sala para outra pessoa (0 desliga).
    host_away_seconds: int = 60
    #: Eventos e segredos de partidas terminadas há mais de N dias são apagados (0 desliga).
    prune_games_days: int = 7
    #: Entrar como convidado (login anônimo) e entrar com Google: precisam estar ligados no Supabase.
    guest_login: bool = False
    google_login: bool = False
    environment: str = "development"

    @property
    def dev_mode(self) -> bool:
        """Sem Supabase configurado, a API roda em modo de desenvolvimento local:
        banco em memória e login local. Serve só para testar na própria máquina."""
        return not self.supabase_url

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(BACKEND_DIR / ".env")
        settings = cls(
            supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
            supabase_anon_key=os.environ.get("SUPABASE_ANON_KEY", ""),
            supabase_service_key=os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
            supabase_jwt_secret=os.environ.get("SUPABASE_JWT_SECRET", ""),
            cors_origins=_csv("CORS_ORIGINS"),
            serve_frontend=_flag("SERVE_FRONTEND", True),
            referee_enabled=_flag("REFEREE_ENABLED", True),
            disconnect_grace_seconds=int(os.environ.get("DISCONNECT_GRACE_SECONDS", "40")),
            stale_room_seconds=int(os.environ.get("STALE_ROOM_SECONDS", "180")),
            rate_limit_enabled=_flag("RATE_LIMIT_ENABLED", True),
            trust_proxy=_flag("TRUST_PROXY", False),
            trusted_proxy_hops=max(1, int(os.environ.get("TRUSTED_PROXY_HOPS", "2"))),
            host_away_seconds=int(os.environ.get("HOST_AWAY_SECONDS", "60")),
            prune_games_days=int(os.environ.get("PRUNE_GAMES_DAYS", "7")),
            guest_login=_flag("GUEST_LOGIN", False),
            google_login=_flag("GOOGLE_LOGIN", False),
            environment=os.environ.get("APP_ENV", "development"),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.supabase_url and not (self.supabase_anon_key and self.supabase_service_key):
            raise RuntimeError(
                "SUPABASE_URL está definido, mas faltam SUPABASE_ANON_KEY e/ou "
                "SUPABASE_SERVICE_ROLE_KEY. Veja backend/.env.example."
            )
        if self.dev_mode and self.environment == "production":
            raise RuntimeError("APP_ENV=production exige o Supabase configurado (SUPABASE_URL).")
