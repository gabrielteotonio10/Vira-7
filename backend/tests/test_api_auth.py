"""Autenticação e proteção das rotas."""

import time

import jwt
import pytest

from .conftest import JWT_SECRET, error_code

PROTECTED = [
    ("get", "/api/me"), ("get", "/api/me/matches"), ("get", "/api/leaderboard"),
    ("get", "/api/rooms/public"), ("post", "/api/rooms"), ("post", "/api/rooms/quick"),
    ("get", "/api/rooms/ABCDEF"), ("post", "/api/rooms/ABCDEF/join"),
    ("get", "/api/games/qualquer"), ("post", "/api/games/qualquer/actions"),
    ("get", "/api/profiles/alguem"),
]


def token(secret=JWT_SECRET, **claims) -> str:
    now = int(time.time())
    payload = {"sub": "u1", "role": "authenticated", "aud": "authenticated", "iat": now, "exp": now + 600}
    payload.update(claims)
    payload = {key: value for key, value in payload.items() if value is not None}
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.mark.parametrize("method,path", PROTECTED)
def test_rotas_protegidas_exigem_login(client, method, path):
    response = getattr(client, method)(path)
    assert response.status_code == 401
    assert error_code(response) == "UNAUTHORIZED"


@pytest.mark.parametrize(
    "bad",
    [
        "nao-e-um-jwt",
        token(secret="outro-segredo-qualquer-com-32-caracteres!!"),
        token(exp=int(time.time()) - 3600),
        token(aud="outra-audiencia"),
        token(role="anon"),
        token(role="service_role"),
        token(sub=None),
    ],
    ids=["malformado", "assinatura", "expirado", "audiencia", "anonimo", "service_role", "sem_sub"],
)
def test_tokens_invalidos_sao_recusados(client, bad):
    response = client.get("/api/me", headers={"Authorization": f"Bearer {bad}"})
    assert response.status_code == 401


def test_token_sem_algoritmo_nao_e_aceito(client):
    forged = jwt.encode({"sub": "u1", "role": "authenticated", "aud": "authenticated"}, None, algorithm="none")
    assert client.get("/api/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_esquema_diferente_de_bearer_e_recusado(client):
    assert client.get("/api/me", headers={"Authorization": f"Basic {token()}"}).status_code == 401


def test_login_valido_acessa_o_proprio_perfil(signup):
    ana = signup("Ana", avatar="panda")
    body = ana.get("/me").json()
    assert body["profile"] == {**body["profile"], "username": "Ana", "avatar": "panda"}
    assert body["user"]["id"] == ana.id
    assert body["stats"]["gamesPlayed"] == 0
    assert body["activeRoom"] is None


def test_login_local_confere_a_senha(client, signup):
    signup("Bia")
    emails = [u["email"] for u in client.app.state.store.users.values()]
    ok = client.post("/api/dev/login", json={"email": emails[0], "password": "segredo123"})
    assert ok.status_code == 200 and ok.json()["accessToken"]
    wrong = client.post("/api/dev/login", json={"email": emails[0], "password": "errada"})
    assert wrong.status_code == 401 and error_code(wrong) == "INVALID_CREDENTIALS"


def test_cadastro_recusa_email_e_nome_repetidos(client, signup):
    signup("Caio")
    email = next(iter(client.app.state.store.users.values()))["email"]
    again = client.post("/api/dev/signup", json={"email": email, "password": "segredo123", "username": "Outro"})
    assert again.status_code == 409 and error_code(again) == "EMAIL_TAKEN"
    name = client.post("/api/dev/signup", json={"email": "novo@teste.dev", "password": "segredo123", "username": "caio"})
    assert name.status_code == 409 and error_code(name) == "USERNAME_TAKEN"
    weak = client.post("/api/dev/signup", json={"email": "x@teste.dev", "password": "123", "username": "Fraco"})
    assert weak.status_code == 422


def test_configuracao_publica_nunca_expoe_chaves_privadas(client, settings):
    settings.supabase_service_key = "CHAVE-SERVICE-ROLE-SECRETA"
    body = client.get("/api/config").text + client.get("/api/health").text
    assert "CHAVE-SERVICE-ROLE-SECRETA" not in body
    assert JWT_SECRET not in body


def test_erros_inesperados_nao_vazam_detalhes(client, signup, store, monkeypatch):
    ana = signup("Ana")

    async def boom(*args, **kwargs):
        raise RuntimeError("senha do banco: hunter2")

    monkeypatch.setattr(store, "list_public_rooms", boom)
    client_no_raise = type(client)(client.app, raise_server_exceptions=False)
    response = client_no_raise.get("/api/rooms/public", headers=ana.headers)
    assert response.status_code == 500
    assert "hunter2" not in response.text and error_code(response) == "INTERNAL_ERROR"
