"""Autenticação: valida o token de acesso emitido pelo Supabase Auth.

O frontend faz login direto no Supabase e envia `Authorization: Bearer <token>`.
A API confere a assinatura e a validade do token em toda rota protegida:

  * HS256  -> segredo do JWT do projeto (`SUPABASE_JWT_SECRET`);
  * ES256/RS256 -> chaves públicas do projeto (JWKS), baixadas e guardadas em cache;
  * sem segredo configurado -> consulta o próprio Supabase (`/auth/v1/user`).
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Request

from .config import Settings
from .errors import ApiError

ASYMMETRIC = ("ES256", "RS256", "EdDSA")
UNAUTHORIZED = ApiError(401, "UNAUTHORIZED", "Sessão inválida ou expirada. Entre novamente.")


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: str | None = None


class TokenVerifier:
    def __init__(self, settings: Settings, http: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.http = http
        self._jwks: dict[str, object] = {}
        self._jwks_at = 0.0
        self._remote_cache: dict[str, tuple[float, AuthUser]] = {}

    async def verify(self, token: str) -> AuthUser:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as error:
            raise UNAUTHORIZED from error

        algorithm = header.get("alg", "")
        try:
            if algorithm == "HS256" and self.settings.supabase_jwt_secret:
                claims = self._decode(token, self.settings.supabase_jwt_secret, ["HS256"])
            elif algorithm in ASYMMETRIC:
                key = await self._signing_key(header.get("kid"))
                claims = self._decode(token, key, [algorithm])
            else:
                return await self._verify_remotely(token)
        except jwt.PyJWTError as error:
            raise UNAUTHORIZED from error

        # Tokens "anon" e "service_role" não representam uma pessoa logada.
        if claims.get("role") != "authenticated" or not claims.get("sub"):
            raise UNAUTHORIZED
        return AuthUser(id=str(claims["sub"]), email=claims.get("email"))

    @staticmethod
    def _decode(token: str, key, algorithms: list[str]) -> dict:
        return jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience="authenticated",
            options={"require": ["exp", "sub"]},
            leeway=10,
        )

    async def _signing_key(self, kid: str | None):
        if kid not in self._jwks or time.monotonic() - self._jwks_at > 600:
            await self._load_jwks()
        if kid not in self._jwks:
            raise jwt.InvalidKeyError("Chave de assinatura desconhecida.")
        return self._jwks[kid]

    async def _load_jwks(self) -> None:
        if not self.http or not self.settings.supabase_url:
            raise jwt.InvalidKeyError("JWKS indisponível.")
        response = await self.http.get(f"{self.settings.supabase_url}/auth/v1/.well-known/jwks.json")
        response.raise_for_status()
        self._jwks = {
            item["kid"]: jwt.PyJWK(item).key for item in response.json().get("keys", []) if "kid" in item
        }
        self._jwks_at = time.monotonic()

    async def _verify_remotely(self, token: str) -> AuthUser:
        """Pergunta ao Supabase se o token é válido (com cache curto)."""
        cached = self._remote_cache.get(token)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        if not self.http or not self.settings.supabase_url:
            raise UNAUTHORIZED
        response = await self.http.get(
            f"{self.settings.supabase_url}/auth/v1/user",
            headers={"apikey": self.settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
        )
        if response.status_code != 200:
            raise UNAUTHORIZED
        data = response.json()
        user = AuthUser(id=str(data["id"]), email=data.get("email"))
        if len(self._remote_cache) > 2000:
            self._remote_cache.clear()
        self._remote_cache[token] = (time.monotonic() + 60, user)
        return user


async def current_user(request: Request) -> AuthUser:
    """Dependência do FastAPI: exige um token válido."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "UNAUTHORIZED", "Você precisa entrar na sua conta.")
    user = await request.app.state.verifier.verify(token.strip())
    limiter = getattr(request.app.state, "limiter", None)
    if limiter:
        limiter.enforce_user("user", user.id)
    return user
