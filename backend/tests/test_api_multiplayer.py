"""Partidas online pela API: sincronização, validação no servidor e concorrência."""

import asyncio
from datetime import timedelta

import httpx

from app.services import games as game_service
from app.services import referee

from .conftest import error_code


def start(players, code):
    response = players[0].post(f"/rooms/{code}/start")
    assert response.status_code == 200, response.text
    return response.json()["room"]["gameId"]


def state_of(player, game_id):
    return player.get(f"/games/{game_id}").json()["state"]


def play_turn(players, game_id, move="stay"):
    """Quem está na vez joga. Devolve a resposta da API."""
    state = state_of(players[0], game_id)
    awaiting = state["awaiting"]
    actor = next(p for p in players if p.id == state["players"][awaiting["seat"]]["userId"])
    if awaiting["kind"] == "target":
        body = {"type": "target", "target": awaiting["candidates"][0], "token": awaiting["token"]}
    else:
        body = {"type": move, "token": awaiting["token"]}
    response = actor.post(f"/games/{game_id}/actions", body)
    assert response.status_code == 200, response.text
    return response.json()


def play_until_over(players, game_id, limit=3000):
    for step in range(limit):
        snapshot = players[0].get(f"/games/{game_id}").json()
        if snapshot["status"] != "playing":
            return snapshot
        play_turn(players, game_id, "hit" if step % 3 else "stay")
    raise AssertionError("a partida não terminou")


def test_todos_os_jogadores_veem_o_mesmo_estado_e_os_mesmos_eventos(table):
    players, code = table("Ana", "Beto", "Caio", targetScore=50)
    game_id = start(players, code)

    seen = [0, 0, 0]
    logs = [[], [], []]
    for _ in range(40):
        if players[0].get(f"/games/{game_id}").json()["status"] != "playing":
            break
        play_turn(players, game_id, "hit")
        for index, player in enumerate(players):
            events = player.get(f"/games/{game_id}/events", params={"after": seen[index]}).json()["events"]
            logs[index] += events
            seen[index] = events[-1]["seq"] if events else seen[index]

    assert logs[0] == logs[1] == logs[2]
    assert [e["seq"] for e in logs[0]] == list(range(1, len(logs[0]) + 1))
    assert logs[0][0]["type"] == "gameStart"
    states = [state_of(p, game_id) for p in players]
    assert states[0] == states[1] == states[2]
    assert states[0]["seq"] == logs[0][-1]["seq"]


def test_servidor_recusa_jogada_fora_da_vez_e_de_quem_nao_esta_na_partida(table, signup):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    state = state_of(players[0], game_id)
    awaiting = state["awaiting"]
    current = next(p for p in players if p.id == state["players"][awaiting["seat"]]["userId"])
    other = next(p for p in players if p is not current)

    wrong = other.post(f"/games/{game_id}/actions", {"type": "hit", "token": awaiting["token"]})
    assert wrong.status_code == 409 and error_code(wrong) == "NOT_YOUR_TURN"

    intruder = signup("Intruso")
    for response in (
        intruder.get(f"/games/{game_id}"),
        intruder.get(f"/games/{game_id}/events"),
        intruder.post(f"/games/{game_id}/actions", {"type": "hit"}),
        intruder.post(f"/games/{game_id}/tick"),
    ):
        assert response.status_code == 403 and error_code(response) == "NOT_IN_GAME"

    assert current.post(f"/games/{game_id}/actions", {"type": "dobrar"}).status_code == 422
    assert current.post(f"/games/{game_id}/actions", {"type": "target"}).status_code == 422
    assert players[0].get("/games/nao-existe").status_code == 404
    # Nada disso alterou a partida.
    assert state_of(players[0], game_id) == state


def test_o_cliente_nunca_recebe_a_ordem_do_monte(table, store):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    seed = str(store.secrets[game_id]["round"]["seed"])
    payload = players[0].get(f"/games/{game_id}").text + players[0].get(f"/games/{game_id}/events").text
    assert seed not in payload and "decisions" not in payload and '"seed"' not in payload


def test_clique_duplo_nao_vira_duas_jogadas(table):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    state = state_of(players[0], game_id)
    awaiting = state["awaiting"]
    current = next(p for p in players if p.id == state["players"][awaiting["seat"]]["userId"])
    if awaiting["kind"] == "target":
        body = {"type": "target", "target": awaiting["candidates"][0], "token": awaiting["token"]}
    else:
        body = {"type": "stay", "token": awaiting["token"]}
    assert current.post(f"/games/{game_id}/actions", body).status_code == 200
    again = current.post(f"/games/{game_id}/actions", body)
    assert again.status_code == 409 and error_code(again) in ("STALE_ACTION", "NOT_YOUR_TURN")


def test_jogadas_simultaneas_so_uma_e_aplicada(table, client, store):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    state = state_of(players[0], game_id)
    awaiting = state["awaiting"]
    current = next(p for p in players if p.id == state["players"][awaiting["seat"]]["userId"])
    before = len(store.events[game_id])

    async def race():
        transport = httpx.ASGITransport(app=client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://teste") as http:
            if awaiting["kind"] == "target":
                body = {"type": "target", "target": awaiting["candidates"][0], "token": awaiting["token"]}
            else:
                body = {"type": "hit", "token": awaiting["token"]}
            return await asyncio.gather(
                *[http.post(f"/api/games/{game_id}/actions", json=body, headers=current.headers) for _ in range(8)]
            )

    responses = asyncio.run(race())
    assert sorted(r.status_code for r in responses) == [200] + [409] * 7
    decisions = store.secrets[game_id]["round"]["decisions"]
    assert len(decisions) == 1
    seqs = [e["seq"] for e in store.events[game_id]]
    assert seqs == list(range(1, len(seqs) + 1)) and len(seqs) > before


def test_prazo_do_turno_vencido_faz_o_servidor_jogar(table, store, settings):
    players, code = table("Ana", "Beto", turnSeconds=15)
    game_id = start(players, code)
    game = store.games[game_id]
    assert game["turn_deadline"] and state_of(players[0], game_id)["deadline"] == game["turn_deadline"]

    early = players[0].post(f"/games/{game_id}/tick").json()
    assert early == {"events": [], "applied": False}, "antes do prazo o servidor não faz nada"

    game["turn_deadline"] = (game_service.utcnow() - timedelta(seconds=1)).isoformat()
    # O baralho é aleatório: a primeira decisão pode ser virar/parar ou escolher um alvo.
    waiting = game["public_state"]["awaiting"]
    late = players[1].post(f"/games/{game_id}/tick").json()
    assert late["applied"] is True
    assert late["events"][0]["type"] == "autoPlay"
    assert late["events"][0]["payload"] == {"player": waiting["seat"], "kind": waiting["kind"], "reason": "timeout"}
    assert state_of(players[0], game_id)["awaiting"]["token"] > waiting["token"], "o jogo andou para a decisão seguinte"


def test_arbitro_joga_por_quem_perdeu_a_conexao(table, store):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    game = store.games[game_id]
    assert asyncio.run(referee.sweep(store, 40)) == 0, "todos conectados: nada a fazer"

    awaiting_user = game["awaiting_user_id"]
    token_before = game["public_state"]["awaiting"]["token"]
    store.presence[(game["room_id"], awaiting_user)] = game_service.utcnow() - timedelta(seconds=120)
    assert asyncio.run(referee.sweep(store, 40)) == 1
    assert any(
        e["type"] == "autoPlay" and e["payload"]["reason"] == "disconnected" for e in store.events[game_id]
    )
    # A decisão pendente avançou (pode continuar sendo do mesmo jogador, se vier um alvo).
    assert store.games[game_id]["public_state"]["awaiting"]["token"] > token_before


def test_partida_completa_grava_historico_estatisticas_e_ranking(table):
    players, code = table("Ana", "Beto", "Caio", targetScore=50)
    game_id = start(players, code)
    final = play_until_over(players, game_id)
    assert final["status"] == "finished"
    state = final["state"]
    winner = state["players"][state["winner"]]
    assert winner["total"] >= 50 and state["finishReason"] == "score"

    assert error_code(players[0].post(f"/games/{game_id}/actions", {"type": "hit"})) == "GAME_OVER"

    champion = next(p for p in players if p.id == winner["userId"])
    me = champion.get("/me").json()
    assert me["stats"]["wins"] == 1 and me["stats"]["gamesPlayed"] == 1 and me["stats"]["currentStreak"] == 1
    assert me["stats"]["totalPoints"] == winner["total"]
    losers = [p for p in players if p is not champion]
    assert all(p.get("/me").json()["stats"]["losses"] == 1 for p in losers)

    history = champion.get("/me/matches").json()["matches"]
    assert len(history) == 1
    match = history[0]
    assert match["gameId"] == game_id and match["me"]["isWinner"] and match["winnerName"] == champion.name
    assert [p["placement"] for p in match["players"]] == [1, 2, 3]
    assert match["rounds"] == state["round"]

    ranking = players[0].get("/leaderboard").json()["players"]
    assert ranking[0]["username"] == champion.name and ranking[0]["wins"] == 1
    assert len(ranking) == 3


def test_revanche_na_mesma_sala(table):
    players, code = table("Ana", "Beto", targetScore=50)
    first = start(players, code)
    play_until_over(players, first)

    room = players[0].get(f"/rooms/{code}").json()
    assert room["room"]["status"] == "lobby" and room["room"]["gameId"] is None
    assert not any(p["isReady"] for p in room["players"])

    players[1].post(f"/rooms/{code}/ready", {"ready": True})
    second = start(players, code)
    assert second != first
    assert state_of(players[0], second)["round"] == 1
    play_until_over(players, second)
    assert players[0].get("/me").json()["stats"]["gamesPlayed"] == 2


def test_sair_no_meio_da_partida_da_a_vitoria_ao_adversario(table):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    assert players[0].post(f"/rooms/{code}/leave").json()["left"] is True

    snapshot = players[1].get(f"/games/{game_id}").json()
    assert snapshot["status"] == "finished"
    assert snapshot["state"]["finishReason"] == "forfeit"
    events = players[1].get(f"/games/{game_id}/events").json()["events"]
    assert [e["type"] for e in events[-2:]] == ["playerLeft", "gameOver"]

    assert players[1].get("/me").json()["stats"]["wins"] == 1
    loser = players[0].get("/me").json()
    assert loser["stats"]["losses"] == 1 and loser["activeRoom"] is None
    assert players[0].get(f"/games/{game_id}").status_code == 403


def test_partida_com_tres_segue_quando_um_sai_e_com_cpus(table):
    players, code = table("Ana", "Beto", "Caio", targetScore=50)
    players[0].post(f"/rooms/{code}/bots")
    game_id = start(players, code)
    assert len(state_of(players[0], game_id)["players"]) == 4

    players[2].post(f"/rooms/{code}/leave")
    remaining = players[:2]
    state = state_of(remaining[0], game_id)
    assert state["status"] == "playing" and state["players"][2]["absent"]
    final = play_until_over(remaining, game_id)
    assert final["status"] == "finished"
    results = remaining[0].get("/me/matches").json()["matches"][0]["players"]
    assert next(r for r in results if r["name"] == "Caio")["forfeited"] is True
    assert next(r for r in results if r["isBot"])["name"] == "Rita"


def test_reconexao_recupera_a_sala_e_a_partida(table):
    players, code = table("Ana", "Beto")
    game_id = start(players, code)
    play_turn(players, game_id, "hit")

    # Como se a Ana tivesse fechado e reaberto o navegador.
    me = players[0].get("/me").json()
    assert me["activeRoom"]["code"] == code and me["activeRoom"]["gameId"] == game_id
    rejoin = players[0].post(f"/rooms/{code}/join")
    assert rejoin.status_code == 200 and rejoin.json()["room"]["status"] == "playing"
    snapshot = players[0].get(f"/games/{game_id}").json()
    missed = players[0].get(f"/games/{game_id}/events", params={"after": snapshot["seq"] - 2}).json()["events"]
    assert [e["seq"] for e in missed] == [snapshot["seq"] - 1, snapshot["seq"]]
    assert missed[-1]["state"] == snapshot["state"]
