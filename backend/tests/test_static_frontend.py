"""A API serve o frontend, mas nunca arquivos do backend (onde ficam as credenciais)."""

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.store import MemoryStore

from .conftest import JWT_SECRET


@pytest.fixture
def site():
    settings = Settings(
        supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=True, rate_limit_enabled=False
    )
    with TestClient(create_app(settings, MemoryStore())) as client:
        yield client


def test_serve_a_pagina_e_os_arquivos_do_frontend(site):
    index = site.get("/")
    assert index.status_code == 200 and "<title>Vira-7" in index.text
    for path in ("/css/tokens.css", "/js/main.js", "/js/app/api.js", "/assets/favicon.svg"):
        response = site.get(path)
        assert response.status_code == 200, path
        assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize(
    "path",
    [
        "/backend/.env", "/backend/.env.example", "/backend/app/config.py", "/.env", "/.git/config",
        "/database/migrations/0001_perfis.sql", "/package.json", "/js/../backend/.env",
        "/css/..%2Fbackend%2F.env", "/assets/%2e%2e/backend/.env",
    ],
)
def test_nunca_expoe_arquivos_fora_do_frontend(site, path):
    response = site.get(path)
    assert response.status_code == 404, f"{path} não deveria ser servido"
    assert "SUPABASE" not in response.text


def test_todos_os_scripts_e_estilos_da_pagina_existem(site):
    import re

    html = site.get("/").text
    assets = re.findall(r'(?:src|href)="((?:css|js|assets)/[^"]+)"', html)
    assert len(assets) > 40
    missing = [path for path in assets if site.get(f"/{path}").status_code != 200]
    assert missing == []


def test_modo_so_api_nao_serve_o_frontend():
    settings = Settings(
        supabase_jwt_secret=JWT_SECRET, referee_enabled=False, serve_frontend=False, rate_limit_enabled=False
    )
    with TestClient(create_app(settings, MemoryStore())) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/health").json()["status"] == "ok"
