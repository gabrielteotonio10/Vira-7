"""Ambiente dos testes da API: aplicação real, banco em memória e tokens assinados."""

from __future__ import annotations

import itertools

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import MemoryStore

JWT_SECRET = "segredo-de-teste-com-mais-de-32-caracteres!"
_counter = itertools.count(1)


class Player:
    """Um jogador logado, com atalhos para chamar a API como ele."""

    def __init__(self, client: TestClient, name: str, token: str, user_id: str) -> None:
        self.client = client
        self.name = name
        self.id = user_id
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, path: str, **kwargs):
        return self.client.get(f"/api{path}", headers=self.headers, **kwargs)

    def post(self, path: str, json=None):
        return self.client.post(f"/api{path}", headers=self.headers, json=json)

    def patch(self, path: str, json=None):
        return self.client.patch(f"/api{path}", headers=self.headers, json=json)

    def put(self, path: str, json=None):
        return self.client.put(f"/api{path}", headers=self.headers, json=json)

    def delete(self, path: str):
        return self.client.delete(f"/api{path}", headers=self.headers)


@pytest.fixture
def store() -> MemoryStore:
    return MemoryStore()


@pytest.fixture
def settings() -> Settings:
    # O limite de requisições tem testes próprios (test_rate_limit.py); aqui ele atrapalharia
    # as partidas completas, que fazem centenas de chamadas em poucos segundos.
    return Settings(
        supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False, rate_limit_enabled=False
    )


@pytest.fixture
def client(settings, store):
    with TestClient(create_app(settings, store)) as test_client:
        yield test_client


@pytest.fixture
def signup(client):
    def _signup(name: str, avatar: str = "raposa") -> Player:
        response = client.post(
            "/api/dev/signup",
            json={"email": f"{name.lower()}{next(_counter)}@teste.dev", "password": "segredo123",
                  "username": name, "avatar": avatar},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        return Player(client, name, body["accessToken"], body["user"]["id"])

    return _signup


@pytest.fixture
def table(signup):
    """Cria uma sala com N pessoas prontas e devolve (jogadores, código)."""

    def _table(*names: str, **room):
        players = [signup(name) for name in names]
        created = players[0].post("/rooms", {"turnSeconds": 0, **room})
        assert created.status_code == 201, created.text
        code = created.json()["room"]["code"]
        for player in players[1:]:
            assert player.post(f"/rooms/{code}/join").status_code == 200
            assert player.post(f"/rooms/{code}/ready", {"ready": True}).status_code == 200
        return players, code

    return _table


def error_code(response) -> str:
    return response.json()["error"]["code"]
