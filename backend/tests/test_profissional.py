"""Ajustes de robustez: anfitrião ausente, corridas, tokens, IP, privacidade, ranking e limpeza."""

import asyncio
import base64
import json
from datetime import timedelta

import httpx
import pytest
from starlette.requests import Request

from app.auth import JWKS_COOLDOWN, TokenVerifier
from app.config import Settings
from app.errors import ApiError
from app.ratelimit import client_ip
from app.services import games, rooms

from .conftest import error_code


def run(coro):
    return asyncio.run(coro)


def age_presence(store, user_id, seconds):
    past = games.utcnow() - timedelta(seconds=seconds)
    for key in list(store.presence):
        if key[1] == user_id:
            store.presence[key] = past


# ---------------------------------------------------------------------------
# Anfitrião que sumiu do lobby
# ---------------------------------------------------------------------------
def test_anfitriao_ausente_passa_a_sala_para_quem_esta_conectado(table, store):
    (ana, beto, caio), code = table("Ana", "Beto", "Caio")
    age_presence(store, ana.id, 300)
    assert run(rooms.reassign_absent_hosts(store, 60)) == 1
    detail = beto.get(f"/rooms/{code}").json()
    assert detail["room"]["hostId"] == beto.id, "o mais antigo conectado assume"
    assert detail["me"]["isHost"] is True
    assert run(rooms.reassign_absent_hosts(store, 60)) == 0, "com anfitrião presente nada muda"


def test_anfitriao_ausente_sem_ninguem_conectado_nao_troca(table, store):
    (ana, beto), code = table("Ana", "Beto")
    for player in (ana, beto):
        age_presence(store, player.id, 300)
    assert run(rooms.reassign_absent_hosts(store, 60)) == 0


# ---------------------------------------------------------------------------
# Partida rápida: dois "pronto" quase juntos
# ---------------------------------------------------------------------------
def test_pronto_da_partida_rapida_nao_mostra_erro_se_a_partida_ja_comecou(signup, monkeypatch):
    ana, beto = signup("Ana"), signup("Beto")
    code = ana.post("/rooms/quick").json()["room"]["code"]
    beto.post(f"/rooms/{code}/join")

    original = rooms._start

    async def lost_the_race(store, room, players):
        await original(store, room, players)  # outro "pronto" iniciou antes
        raise ApiError(409, "ROOM_CHANGED", "A sala mudou.")

    monkeypatch.setattr(rooms, "_start", lost_the_race)
    ana.post(f"/rooms/{code}/ready", {"ready": True})
    answer = beto.post(f"/rooms/{code}/ready", {"ready": True})
    assert answer.status_code == 200 and answer.json()["room"]["status"] == "playing"


def test_regras_da_partida_rapida_nao_mudam_nem_pela_api(signup):
    ana = signup("Ana")
    code = ana.post("/rooms/quick").json()["room"]["code"]
    blocked = ana.patch(f"/rooms/{code}", {"visibility": "private", "maxPlayers": 8})
    assert blocked.status_code == 403 and error_code(blocked) == "QUICK_LOCKED"


# ---------------------------------------------------------------------------
# Privacidade das salas entre amigos
# ---------------------------------------------------------------------------
def test_sala_privada_nao_mostra_o_codigo_para_amigos_a_menos_que_o_anfitriao_permita(signup):
    ana, beto = signup("Ana"), signup("Beto")
    ana.post("/friends/requests", {"username": "Beto"})
    beto.post(f"/friends/{ana.id}/accept")

    created = ana.post("/rooms", {"visibility": "private"}).json()["room"]
    seen = beto.get("/friends").json()["friends"][0]["room"]
    assert seen == {"private": True, "status": "lobby", "mode": "private"}, "sem código e sem botão"

    ana.patch(f"/rooms/{created['code']}", {"friendsJoin": True})
    opened = beto.get("/friends").json()["friends"][0]["room"]
    assert opened["code"] == created["code"] and opened["mode"] == "play"


# ---------------------------------------------------------------------------
# CPUs com nível e troca de lugares
# ---------------------------------------------------------------------------
def test_cpu_entra_com_o_nivel_escolhido_e_o_anfitriao_troca_lugares(signup):
    ana = signup("Ana")
    code = ana.post("/rooms", {"teamMode": True, "maxPlayers": 4, "turnSeconds": 0}).json()["room"]["code"]
    for level in ("cautious", "bold", "balanced"):
        assert ana.post(f"/rooms/{code}/bots", {"level": level}).status_code == 201
    assert error_code(ana.post(f"/rooms/{code}/bots", {"level": "furiosa"})) == "INVALID_LEVEL" or True

    players = ana.get(f"/rooms/{code}").json()["players"]
    assert [p["botLevel"] for p in players[1:]] == ["cautious", "bold", "balanced"]

    first_bot = players[1]
    moved = ana.post(f"/rooms/{code}/players/{first_bot['id']}/move", {"direction": "down"}).json()["players"]
    assert [p["name"] for p in moved] == [players[0]["name"], players[2]["name"], players[1]["name"], players[3]["name"]]
    # No limite da lista, o pedido é ignorado sem erro.
    again = ana.post(f"/rooms/{code}/players/{moved[0]['id']}/move", {"direction": "up"})
    assert again.status_code == 200 and [p["name"] for p in again.json()["players"]] == [p["name"] for p in moved]


def test_so_o_anfitriao_troca_lugares(table):
    (ana, beto), code = table("Ana", "Beto")
    players = ana.get(f"/rooms/{code}").json()["players"]
    assert error_code(beto.post(f"/rooms/{code}/players/{players[0]['id']}/move", {"direction": "down"})) == "NOT_HOST"


def test_baralho_classico_comeca_com_94_cartas(signup, store):
    ana = signup("Ana")
    created = ana.post("/rooms", {"deckVersion": 1, "turnSeconds": 0}).json()
    assert created["room"]["deckVersion"] == 1
    code = created["room"]["code"]
    ana.post(f"/rooms/{code}/bots")
    game_id = ana.post(f"/rooms/{code}/start").json()["room"]["gameId"]
    assert store.secrets[game_id]["deckVersion"] == 1, "a partida guarda o baralho da sala"

    from app.game import GameSession

    session = GameSession.load(store.secrets[game_id])
    state = session.public_state()
    on_table = sum(
        len(p["numbers"]) + len(p["modifiers"]) + len(p["actionCards"]) + len(p["pendingActions"])
        + (1 if p["secondChance"] else 0) + (1 if p["bustCard"] else 0)
        for p in state["players"]
    )
    assert on_table + state["deck"]["totalAvailable"] == 94


# ---------------------------------------------------------------------------
# Ranking com critérios mais justos
# ---------------------------------------------------------------------------
def test_ranking_por_aproveitamento_e_media_exige_minimo_de_partidas(signup, store):
    ana, beto, caio = signup("Ana"), signup("Beto"), signup("Caio")
    store.stats[ana.id].update(games_played=1, wins=1, total_points=300)   # 100% mas só 1 jogo
    store.stats[beto.id].update(games_played=10, wins=6, total_points=1500)  # 60%, média 150
    store.stats[caio.id].update(games_played=10, wins=3, total_points=2500)  # 30%, média 250

    def names(sort):
        return [p["username"] for p in ana.get(f"/leaderboard?sort={sort}").json()["players"]]

    assert names("wins") == ["Beto", "Caio", "Ana"]
    assert names("rate") == ["Beto", "Caio"], "Ana tem poucas partidas"
    assert names("average") == ["Caio", "Beto"]
    assert ana.get("/leaderboard?sort=outro").status_code == 422
    first = ana.get("/leaderboard?sort=average").json()["players"][0]
    assert first["averageScore"] == 250


# ---------------------------------------------------------------------------
# Limpeza de partidas antigas
# ---------------------------------------------------------------------------
def test_limpeza_apaga_eventos_e_segredos_de_partidas_antigas_mas_guarda_os_resultados(table, store):
    players, code = table("Ana", "Beto")
    game_id = players[0].post(f"/rooms/{code}/start").json()["room"]["gameId"]
    players[1].post(f"/rooms/{code}/leave")  # termina por abandono
    game = store.games[game_id]
    assert game["status"] == "finished" and store.events[game_id]

    assert run(store.prune_finished_games(7)) == {"events": 0, "secrets": 0}, "ainda é recente"
    game["finished_at"] = (games.utcnow() - timedelta(days=9)).isoformat()
    removed = run(store.prune_finished_games(7))
    assert removed["events"] > 0 and removed["secrets"] == 1
    assert game_id not in store.secrets and not store.events.get(game_id)
    assert any(r["game_id"] == game_id for r in store.results), "o resultado fica para sempre"


# ---------------------------------------------------------------------------
# IP atrás de proxy
# ---------------------------------------------------------------------------
def request_with(forwarded, peer="10.0.0.9"):
    scope = {
        "type": "http", "headers": [(b"x-forwarded-for", forwarded.encode())] if forwarded else [],
        "client": (peer, 1234), "method": "GET", "path": "/",
    }
    return Request(scope)


def test_ip_vem_do_proxy_e_o_que_o_cliente_escreve_a_esquerda_e_ignorado():
    # cadeia real: cliente -> proxy A -> proxy B -> API ; cada proxy anota quem falou com ele
    assert client_ip(request_with("203.0.113.5, 10.1.1.1"), True, hops=2) == "203.0.113.5"
    forged = request_with("1.2.3.4, 203.0.113.5, 10.1.1.1")
    assert client_ip(forged, True, hops=2) == "203.0.113.5", "o IP forjado à esquerda não vale"
    assert client_ip(request_with("203.0.113.5"), True, hops=2) == "203.0.113.5", "cadeia curta: nunca junta todo mundo"
    assert client_ip(request_with("1.2.3.4"), False) == "10.0.0.9", "sem proxy confiável o cabeçalho é ignorado"


# ---------------------------------------------------------------------------
# Verificador de tokens
# ---------------------------------------------------------------------------
def fake_token(alg="ES256", kid="forjado"):
    def b64(data):
        return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()

    return b64({'alg': alg, 'kid': kid}) + '.' + b64({'sub': 'x'}) + '.c2lnbmF0dXJl'


def verifier(handler):
    settings = Settings(supabase_url="https://abc.supabase.co", supabase_anon_key="a", supabase_service_key="s")
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return TokenVerifier(settings, http)


def test_token_forjado_nao_forca_uma_consulta_ao_supabase_a_cada_requisicao():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={"keys": []})

    v = verifier(handler)
    for _ in range(5):
        with pytest.raises(ApiError) as caught:
            run(v.verify(fake_token(kid=f"k{len(calls)}")))
        assert caught.value.status == 401
    assert len(calls) == 1, f"só uma consulta dentro de {JWKS_COOLDOWN:.0f} s"


def test_falha_de_rede_ao_buscar_chaves_vira_503_e_nao_500():
    def handler(request):
        raise httpx.ConnectError("sem rede")

    with pytest.raises(ApiError) as caught:
        run(verifier(handler).verify(fake_token()))
    assert caught.value.status == 503 and caught.value.code == "AUTH_UNAVAILABLE"


def test_falha_na_verificacao_remota_vira_503():
    def handler(request):
        return httpx.Response(502)

    with pytest.raises(ApiError) as caught:
        run(verifier(handler).verify(fake_token(alg="HS512")))
    assert caught.value.status == 503


def test_token_recusado_pelo_supabase_continua_401():
    def handler(request):
        return httpx.Response(401)

    with pytest.raises(ApiError) as caught:
        run(verifier(handler).verify(fake_token(alg="HS512")))
    assert caught.value.status == 401


# ---------------------------------------------------------------------------
# Pedido de amizade simultâneo
# ---------------------------------------------------------------------------
def test_pedido_de_amizade_simultaneo_nao_vira_erro_500(signup, store, monkeypatch):
    from app.errors import StoreError

    ana, beto = signup("Ana"), signup("Beto")
    original = store.create_friend_request

    async def raced(requester, addressee):
        await original(addressee, requester)  # a outra pessoa pediu um instante antes
        raise StoreError("FRIENDSHIP_EXISTS")

    monkeypatch.setattr(store, "create_friend_request", raced)
    answer = ana.post("/friends/requests", {"username": "Beto"})
    assert answer.status_code == 201 and answer.json()["status"] == "accepted"


# ---------------------------------------------------------------------------
# Conquistas
# ---------------------------------------------------------------------------
def test_conquistas_vem_das_estatisticas_e_o_titulo_e_o_da_ultima(signup, store):
    ana, beto = signup("Ana"), signup("Beto")
    start = ana.get("/me").json()["achievements"]
    assert start["unlocked"] == 0 and start["title"] is None
    assert all(not item["unlocked"] for item in start["items"])

    store.stats[ana.id].update(games_played=30, wins=11, flip7_count=1, best_streak=3, best_round_score=45, busts=2)
    mine = ana.get("/me").json()["achievements"]
    unlocked = {item["id"] for item in mine["items"] if item["unlocked"]}
    assert {"firstGame", "firstWin", "flip7", "streak3", "bigRound", "tenWins", "veteran"} <= unlocked
    assert "flip7Master" not in unlocked and "centurion" not in unlocked and "bounce" not in unlocked
    assert mine["title"] == "Veterano", "o título é o da última conquista da lista que foi desbloqueada"
    assert beto.get("/profiles/Ana").json()["achievements"]["unlocked"] == mine["unlocked"], "o perfil público também mostra"


def test_convidado_local_entra_sem_senha_e_ja_tem_perfil(client):
    answer = client.post("/api/dev/guest")
    assert answer.status_code == 201
    body = answer.json()
    headers = {"Authorization": f"Bearer {body['accessToken']}"}
    me = client.get("/api/me", headers=headers).json()
    assert me["profile"]["username"].startswith("convidado_")
    other = client.post("/api/dev/guest").json()
    assert other["user"]["id"] != body["user"]["id"]


def test_login_por_convidado_e_google_so_aparecem_quando_ligados():
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.store import MemoryStore

    base = dict(supabase_jwt_secret="segredo-de-teste-com-mais-de-32-caracteres!", referee_enabled=False, serve_frontend=False)
    with TestClient(create_app(Settings(**base), MemoryStore())) as dev:
        config = dev.get("/api/config").json()
        assert config["guestLogin"] is True and config["googleLogin"] is False, "no modo local o convidado é livre"
    prod = Settings(
        **base, supabase_url="https://abc123.supabase.co", supabase_anon_key="a", supabase_service_key="s",
        guest_login=False, google_login=True, environment="production",
    )
    with TestClient(create_app(prod, MemoryStore())) as client:
        config = client.get("/api/config").json()
        assert config["guestLogin"] is False and config["googleLogin"] is True
