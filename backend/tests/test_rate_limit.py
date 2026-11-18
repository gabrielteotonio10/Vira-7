"""Limite de requisições e cabeçalhos de segurança."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import content_security_policy, create_app
from app.ratelimit import RateLimiter
from app.store import MemoryStore

from .conftest import JWT_SECRET, error_code


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_janela_deslizante_libera_de_novo_depois_do_tempo():
    clock = Clock()
    limiter = RateLimiter(rules={"auth": (3, 60.0)}, clock=clock)
    assert [limiter.check("auth", "ip-1") for _ in range(3)] == [None, None, None]
    wait = limiter.check("auth", "ip-1")
    assert wait is not None and 59 <= wait <= 60

    clock.now += 30
    assert limiter.check("auth", "ip-1") is not None, "ainda dentro da janela"
    clock.now += 31
    assert limiter.check("auth", "ip-1") is None, "a janela passou"


def test_cada_identidade_e_cada_regra_tem_a_sua_conta():
    limiter = RateLimiter(rules={"auth": (1, 60.0), "write": (1, 60.0)})
    assert limiter.check("auth", "a") is None
    assert limiter.check("auth", "b") is None, "outro IP não é afetado"
    assert limiter.check("write", "a") is None, "outra regra não é afetada"
    assert limiter.check("auth", "a") is not None


def test_desligado_nunca_bloqueia():
    limiter = RateLimiter(enabled=False, rules={"auth": (1, 60.0)})
    assert all(limiter.check("auth", "a") is None for _ in range(50))


def test_memoria_nao_cresce_sem_fim():
    clock = Clock()
    limiter = RateLimiter(rules={"read": (5, 10.0)}, clock=clock)
    for i in range(1999):
        limiter.check("read", f"ip-{i}")
    assert len(limiter._hits) == 1999
    clock.now += 60
    limiter.check("read", "novo")  # a 2000ª chamada dispara a limpeza
    assert len(limiter._hits) == 1


def test_regras_por_rota():
    rule = RateLimiter.rule_for
    assert rule("POST", "/api/dev/login") == "auth"
    assert rule("POST", "/api/dev/signup") == "auth"
    assert rule("GET", "/api/usernames/ana/available") == "username"
    assert rule("POST", "/api/games/x/actions") == "write"
    assert rule("DELETE", "/api/rooms/ABC234/players/1") == "write"
    assert rule("GET", "/api/me") == "read"


@pytest.fixture
def limited_client():
    settings = Settings(supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False)
    app = create_app(settings, MemoryStore())
    with TestClient(app) as client:
        yield client, app.state.limiter


def test_login_local_bloqueia_tentativas_em_excesso_por_ip(limited_client):
    client, limiter = limited_client
    limiter.rules["auth"] = (3, 60.0)
    attempt = lambda: client.post("/api/dev/login", json={"email": "a@teste.dev", "password": "errada"})
    assert [attempt().status_code for _ in range(3)] == [401, 401, 401]

    blocked = attempt()
    assert blocked.status_code == 429
    assert error_code(blocked) == "RATE_LIMITED"
    assert 1 <= int(blocked.headers["retry-after"]) <= 60
    assert "tentativas" in blocked.json()["error"]["message"]


def test_consulta_de_nome_de_usuario_tem_limite_proprio(limited_client):
    client, limiter = limited_client
    limiter.rules["username"] = (2, 60.0)
    codes = [client.get(f"/api/usernames/nome{i}/available").status_code for i in range(4)]
    assert codes == [200, 200, 429, 429]
    # O resto da API não é afetado por esse limite.
    assert client.get("/api/health").status_code == 200


def test_limite_por_usuario_nao_depende_do_ip_e_nao_pune_os_outros(limited_client):
    client, limiter = limited_client
    ana = client.post("/api/dev/signup", json={"email": "ana@teste.dev", "password": "segredo123", "username": "Ana"}).json()
    beto = client.post("/api/dev/signup", json={"email": "beto@teste.dev", "password": "segredo123", "username": "Beto"}).json()
    limiter.rules["user"] = (3, 60.0)

    as_ana = {"Authorization": f"Bearer {ana['accessToken']}"}
    as_beto = {"Authorization": f"Bearer {beto['accessToken']}"}
    assert [client.get("/api/me", headers=as_ana).status_code for _ in range(3)] == [200, 200, 200]
    assert client.get("/api/me", headers=as_ana).status_code == 429
    assert client.get("/api/me", headers=as_beto).status_code == 200


def test_criar_sala_tem_limite_proprio(limited_client):
    client, limiter = limited_client
    ana = client.post("/api/dev/signup", json={"email": "ana@teste.dev", "password": "segredo123", "username": "Ana"}).json()
    headers = {"Authorization": f"Bearer {ana['accessToken']}"}
    limiter.rules["create_room"] = (2, 60.0)

    assert client.post("/api/rooms", json={}, headers=headers).status_code == 201
    # A segunda falha por já estar em uma sala (regra do jogo), mas ainda conta no limite.
    assert client.post("/api/rooms", json={}, headers=headers).status_code == 409
    blocked = client.post("/api/rooms", json={}, headers=headers)
    assert blocked.status_code == 429 and error_code(blocked) == "RATE_LIMITED"


def test_proxy_confiavel_usa_o_ip_de_x_forwarded_for():
    settings = Settings(supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False, trust_proxy=True)
    app = create_app(settings, MemoryStore())
    with TestClient(app) as client:
        app.state.limiter.rules["username"] = (1, 60.0)
        call = lambda ip: client.get("/api/usernames/ana/available", headers={"X-Forwarded-For": f"{ip}, 10.0.0.1"})
        assert call("203.0.113.5").status_code == 200
        assert call("203.0.113.5").status_code == 429
        assert call("203.0.113.6").status_code == 200, "outro cliente atrás do mesmo proxy"


def test_sem_proxy_confiavel_o_cabecalho_forjado_e_ignorado(limited_client):
    client, limiter = limited_client
    limiter.rules["username"] = (1, 60.0)
    assert client.get("/api/usernames/ana/available", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    forged = client.get("/api/usernames/ana/available", headers={"X-Forwarded-For": "2.2.2.2"})
    assert forged.status_code == 429, "trocar o cabeçalho não escapa do limite"


# ---------------------------------------------------------------------------
# Cabeçalhos de segurança
# ---------------------------------------------------------------------------
def test_toda_resposta_leva_os_cabecalhos_de_seguranca(client):
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in response.headers["permissions-policy"]


def test_politica_de_conteudo_so_libera_o_supabase_configurado():
    dev = content_security_policy(Settings())
    assert "connect-src 'self';" in dev and "supabase" not in dev

    prod = content_security_policy(Settings(supabase_url="https://abc123.supabase.co", supabase_anon_key="x", supabase_service_key="y"))
    assert "connect-src 'self' https://abc123.supabase.co wss://abc123.supabase.co;" in prod
    assert "script-src 'self' https://cdn.jsdelivr.net;" in prod, "sem scripts inline"
    assert "frame-ancestors 'none'" in prod and "object-src 'none'" in prod


def test_pagina_inicial_tem_politica_de_conteudo():
    settings = Settings(supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=True, rate_limit_enabled=False)
    with TestClient(create_app(settings, MemoryStore())) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "default-src 'self'" in response.headers["content-security-policy"]
        # A documentação da API (Swagger) precisa de scripts externos: não leva a política da página.
        assert "content-security-policy" not in client.get("/api/health").headers


def test_documentacao_da_api_some_em_producao():
    prod = Settings(
        supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False, environment="production",
        supabase_url="https://abc123.supabase.co", supabase_anon_key="x", supabase_service_key="y",
    )
    dev = Settings(supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False)
    with TestClient(create_app(prod, MemoryStore())) as client:
        assert client.get("/api/docs").status_code == 404
        assert client.get("/api/openapi.json").status_code == 404
        assert client.get("/api/health").status_code == 200
    with TestClient(create_app(dev, MemoryStore())) as client:
        assert client.get("/api/docs").status_code == 200


def test_monitores_de_disponibilidade_podem_usar_head():
    settings = Settings(supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=True, rate_limit_enabled=False)
    with TestClient(create_app(settings, MemoryStore())) as client:
        assert client.head("/api/health").status_code == 200
        page = client.head("/")
        assert page.status_code == 200 and "default-src 'self'" in page.headers["content-security-policy"]
