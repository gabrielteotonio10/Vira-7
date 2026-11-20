"""Duplas, amigos, espectadores e chat rápido."""

import random

import pytest

from app.game import GameSession
from app.game import scoring

from .conftest import error_code
from .helpers import bots, humans


# ---------------------------------------------------------------------------
# Duplas
# ---------------------------------------------------------------------------
def test_duplas_ficam_em_assentos_opostos():
    assert scoring.team_groups(4) == [[0, 2], [1, 3]]
    assert scoring.team_groups(6) == [[0, 3], [1, 4], [2, 5]]
    assert scoring.team_of(5, 8) == 1


@pytest.mark.parametrize("count", [2, 3, 5])
def test_partida_em_duplas_exige_numero_par_a_partir_de_quatro(count):
    with pytest.raises(ValueError):
        GameSession.create(humans(*"ABCDE"[:count]), base_seed=1, teams=True)


def test_partida_em_duplas_soma_os_pontos_e_a_dupla_vence_junta():
    session = GameSession.create(humans("A", "B") + bots(2), base_seed=7, target_score=50, teams=True)
    state = session.public_state()
    assert [p["team"] for p in state["players"]] == [0, 1, 0, 1]
    assert [t["seats"] for t in state["teams"]] == [[0, 2], [1, 3]]

    rng = random.Random(7)
    steps = 0
    while not session.is_over and steps < 3000:
        steps += 1
        pending = session.awaiting
        if pending["kind"] == "move":
            value = "hit" if rng.random() < 0.6 else "stay"
        else:
            value = rng.choice(pending["candidates"])
        session.submit(pending["seat"], pending["kind"], value, token=pending["token"])
    assert session.is_over and session.data["winnerTeam"] in (0, 1)

    results = session.results()
    winners = [r["seat"] for r in results if r["isWinner"]]
    assert sorted(winners) == scoring.team_groups(4)[session.data["winnerTeam"]]
    totals = session.data["round"]["totals"]
    for r in results:
        team = scoring.team_groups(4)[scoring.team_of(r["seat"], 4)]
        assert r["score"] == sum(totals[s] for s in team), "o placar de cada pessoa é o da dupla"
    assert sorted(r["placement"] for r in results if r["isWinner"]) == [1, 2]


def test_duplas_pela_api_validam_tamanho_e_iniciam_com_cpus(signup):
    ana = signup("Ana")
    assert error_code(ana.post("/rooms", {"teamMode": True, "maxPlayers": 3})) == "TEAM_SIZE"
    created = ana.post("/rooms", {"teamMode": True, "maxPlayers": 4, "turnSeconds": 0})
    assert created.status_code == 201 and created.json()["room"]["teamMode"] is True
    code = created.json()["room"]["code"]
    assert error_code(ana.patch(f"/rooms/{code}", {"maxPlayers": 5})) == "TEAM_SIZE"
    assert error_code(ana.post(f"/rooms/{code}/start")) == "NOT_ENOUGH_PLAYERS"
    ana.post(f"/rooms/{code}/bots")
    assert error_code(ana.post(f"/rooms/{code}/start")) == "TEAM_SIZE", "2 jogadores não formam duplas"
    ana.post(f"/rooms/{code}/bots")
    ana.post(f"/rooms/{code}/bots")
    started = ana.post(f"/rooms/{code}/start")
    assert started.status_code == 200
    state = ana.get(f"/games/{started.json()['room']['gameId']}").json()["state"]
    assert state["teams"] and len(state["teams"]) == 2


# ---------------------------------------------------------------------------
# Amigos
# ---------------------------------------------------------------------------
def test_pedido_de_amizade_aceite_e_lista_com_a_sala_do_amigo(signup):
    ana, beto = signup("Ana"), signup("Beto")
    assert error_code(ana.post("/friends/requests", {"username": "Ana"})) == "FRIEND_SELF"
    assert error_code(ana.post("/friends/requests", {"username": "Fantasma"})) == "PROFILE_NOT_FOUND"

    sent = ana.post("/friends/requests", {"username": "beto"})
    assert sent.status_code == 201 and sent.json()["status"] == "pending"
    assert [p["username"] for p in sent.json()["outgoing"]] == ["Beto"]
    assert error_code(ana.post("/friends/requests", {"username": "Beto"})) == "FRIEND_REQUEST_EXISTS"

    inbox = beto.get("/friends").json()
    assert [p["username"] for p in inbox["incoming"]] == ["Ana"] and inbox["friends"] == []
    assert error_code(ana.post(f"/friends/{beto.id}/accept")) == "FRIEND_REQUEST_NOT_FOUND", "só quem recebeu aceita"

    accepted = beto.post(f"/friends/{ana.id}/accept").json()
    assert [p["username"] for p in accepted["friends"]] == ["Ana"]
    assert [p["username"] for p in ana.get("/friends").json()["friends"]] == ["Beto"]
    assert error_code(beto.post("/friends/requests", {"username": "Ana"})) == "ALREADY_FRIENDS"

    code = ana.post("/rooms", {"visibility": "public"}).json()["room"]["code"]
    friend = beto.get("/friends").json()["friends"][0]
    assert friend["room"]["code"] == code and friend["room"]["mode"] == "play"

    assert ana.delete(f"/friends/{beto.id}").json()["friends"] == []
    assert beto.get("/friends").json()["friends"] == []


def test_pedido_cruzado_vira_amizade(signup):
    ana, beto = signup("Ana"), signup("Beto")
    ana.post("/friends/requests", {"username": "Beto"})
    answer = beto.post("/friends/requests", {"username": "Ana"}).json()
    assert answer["status"] == "accepted" and [p["username"] for p in answer["friends"]] == ["Ana"]


def test_ranking_de_amigos_so_traz_voce_e_seus_amigos(signup, store):
    ana, beto, caio = signup("Ana"), signup("Beto"), signup("Caio")
    for player in (ana, beto, caio):
        store.stats[player.id].update(games_played=2, wins=1, total_points=100)
    ana.post("/friends/requests", {"username": "Beto"})
    beto.post(f"/friends/{ana.id}/accept")

    everyone = [p["username"] for p in ana.get("/leaderboard").json()["players"]]
    assert sorted(everyone) == ["Ana", "Beto", "Caio"]
    mine = [p["username"] for p in ana.get("/leaderboard?scope=friends").json()["players"]]
    assert sorted(mine) == ["Ana", "Beto"]
    assert [p["username"] for p in caio.get("/leaderboard?scope=friends").json()["players"]] == ["Caio"]
    assert ana.get("/leaderboard?scope=xyz").status_code == 422


# ---------------------------------------------------------------------------
# Espectadores
# ---------------------------------------------------------------------------
def test_quem_chega_com_a_sala_cheia_assiste_e_vira_jogador_na_proxima_partida(table, signup):
    (ana, beto), code = table("Ana", "Beto", maxPlayers=2)
    caio = signup("Caio")
    joined = caio.post(f"/rooms/{code}/join").json()
    assert joined["me"]["isSpectator"] and not joined["me"]["isMember"]
    assert [s["name"] for s in joined["spectators"]] == ["Caio"]
    assert caio.get("/me").json()["activeRoom"]["code"] == code

    started = ana.post(f"/rooms/{code}/start")
    assert started.status_code == 200
    game_id = started.json()["room"]["gameId"]

    # Espectador vê a partida, mas não joga.
    assert caio.get(f"/games/{game_id}").status_code == 200
    assert caio.get(f"/games/{game_id}/events").status_code == 200
    state = caio.get(f"/games/{game_id}").json()["state"]
    blocked = caio.post(f"/games/{game_id}/actions", {"type": "stay", "token": state["awaiting"]["token"]})
    assert blocked.status_code == 403
    assert caio.post(f"/rooms/{code}/heartbeat").status_code == 200

    # Beto sai: a partida acaba por abandono e, de volta ao lobby, o espectador ocupa a vaga.
    beto.post(f"/rooms/{code}/leave")
    assert caio.get(f"/games/{game_id}").json()["status"] == "finished"
    detail = caio.get(f"/rooms/{code}").json()
    assert detail["room"]["status"] == "lobby"
    assert detail["me"]["isMember"] and not detail["me"]["isSpectator"]
    assert sorted(p["name"] for p in detail["players"]) == ["Ana", "Caio"]


def test_espectador_pode_sair_e_trocar_de_sala(table, signup):
    (ana, beto), code = table("Ana", "Beto", maxPlayers=2)
    caio = signup("Caio")
    caio.post(f"/rooms/{code}/join")
    assert caio.post(f"/rooms/{code}/leave").json() == {"left": True, "closed": False}
    assert caio.get("/me").json()["activeRoom"] is None

    caio.post(f"/rooms/{code}/join")
    novo = caio.post("/rooms", {})
    assert novo.status_code == 201, "quem assiste pode criar a própria sala"
    assert ana.get(f"/rooms/{code}").json()["spectators"] == []


def test_fechar_a_sala_solta_os_espectadores(table, signup):
    (ana, beto), code = table("Ana", "Beto", maxPlayers=2)
    caio = signup("Caio")
    caio.post(f"/rooms/{code}/join")
    beto.post(f"/rooms/{code}/leave")
    assert caio.get("/me").json()["activeRoom"] is not None, "ainda há gente na sala"
    ana.post(f"/rooms/{code}/leave")  # o anfitrião sai do lobby: a sala fecha
    assert caio.get("/me").json()["activeRoom"] is None


# ---------------------------------------------------------------------------
# Chat rápido
# ---------------------------------------------------------------------------
def test_chat_so_aceita_mensagens_prontas_e_emojis(table, signup):
    (ana, beto), code = table("Ana", "Beto")
    assert error_code(ana.post(f"/rooms/{code}/chat", {"kind": "say", "key": "ola"})) == "INVALID_MESSAGE"
    assert ana.post(f"/rooms/{code}/chat", {"kind": "texto", "key": "good"}).status_code == 422
    assert ana.post(f"/rooms/{code}/chat", {"kind": "say", "key": "good"}).status_code == 201

    feed = beto.get(f"/rooms/{code}/chat").json()
    assert [(m["name"], m["kind"], m["key"]) for m in feed["messages"]] == [("Ana", "say", "good")]
    assert beto.get(f"/rooms/{code}/chat?after={feed['seq']}").json()["messages"] == []

    # Quem não está na sala não lê nem escreve.
    intruso = signup("Intruso")
    assert intruso.get(f"/rooms/{code}/chat").status_code == 403
    assert intruso.post(f"/rooms/{code}/chat", {"kind": "emoji", "key": "🔥"}).status_code == 403


def test_chat_limita_a_velocidade_e_espectadores_participam(table, signup):
    (ana, beto), code = table("Ana", "Beto", maxPlayers=2)
    assert ana.post(f"/rooms/{code}/chat", {"kind": "emoji", "key": "🔥"}).status_code == 201
    fast = ana.post(f"/rooms/{code}/chat", {"kind": "emoji", "key": "😂"})
    assert fast.status_code == 429 and error_code(fast) == "CHAT_TOO_FAST"

    caio = signup("Caio")
    caio.post(f"/rooms/{code}/join")
    assert caio.post(f"/rooms/{code}/chat", {"kind": "say", "key": "wow"}).status_code == 201
    assert [m["name"] for m in ana.get(f"/rooms/{code}/chat").json()["messages"]] == ["Ana", "Caio"]


def test_lista_publica_mostra_no_maximo_10_salas_sorteadas(signup):
    codes = set()
    for i in range(14):
        codes.add(signup(f"Host{i}").post("/rooms", {"visibility": "public"}).json()["room"]["code"])
    viewer = signup("Viewer")
    seen = set()
    for _ in range(6):
        rooms = viewer.get("/rooms/public").json()["rooms"]
        assert len(rooms) == 10
        seen.update(r["code"] for r in rooms)
    assert seen <= codes and len(seen) > 10, "a lista muda a cada consulta"


def test_respostas_grandes_vem_compactadas(client):
    response = client.get("/api/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert response.headers.get("content-encoding") == "gzip"


def test_cabecalhos_de_seguranca_extras(client):
    headers = client.get("/api/health").headers
    assert headers["cross-origin-opener-policy"] == "same-origin"
    assert "microphone=(self)" in headers["permissions-policy"]


def test_perfil_publico_mostra_a_relacao_de_amizade(signup):
    ana, beto, caio = signup("Ana"), signup("Beto"), signup("Caio")
    assert ana.get("/profiles/Beto").json()["friendship"] == "none"
    assert ana.get("/profiles/Ana").json()["friendship"] == "self"
    ana.post("/friends/requests", {"username": "Beto"})
    assert ana.get("/profiles/Beto").json()["friendship"] == "sent"
    assert beto.get("/profiles/Ana").json()["friendship"] == "received"
    beto.post(f"/friends/{ana.id}/accept")
    assert ana.get("/profiles/Beto").json()["friendship"] == "friends"
    assert caio.get("/profiles/Ana").json()["friendship"] == "none"
