"""Limpeza de salas abandonadas: ninguém dá sinal há um tempo, a sala fecha sozinha."""

import asyncio
from datetime import timedelta

from app.services import games, referee, rooms

from .conftest import error_code


def run(coro):
    return asyncio.run(coro)


def age(store, minutes: float) -> None:
    """Faz de conta que todos os sinais de vida (e a última mudança) foram há `minutes` minutos."""
    past = games.utcnow() - timedelta(minutes=minutes)
    for key in list(store.presence):
        store.presence[key] = past
    for room in store.rooms.values():
        room["updated_at"] = past.isoformat()


def start_game(players, code) -> str:
    assert players[0].post(f"/rooms/{code}/start").status_code == 200
    return players[0].get(f"/rooms/{code}").json()["room"]["gameId"]


def test_sala_com_gente_online_nao_e_fechada(table, store):
    (ana, beto), code = table("Ana", "Beto", visibility="public")
    assert run(rooms.close_stale(store, 180)) == 0
    assert ana.get(f"/rooms/{code}").json()["room"]["status"] == "lobby"


def test_lobby_parado_e_fechado_e_some_da_lista(table, signup, store):
    (ana, beto), code = table("Ana", "Beto", visibility="public")
    age(store, 10)
    assert run(rooms.close_stale(store, 180)) == 1

    assert ana.get("/me").json()["activeRoom"] is None
    assert beto.get("/me").json()["activeRoom"] is None
    assert signup("Caio").get("/rooms/public").json()["rooms"] == []
    assert error_code(signup("Duda").post(f"/rooms/{code}/join")) == "ROOM_NOT_OPEN"
    assert run(rooms.close_stale(store, 180)) == 0, "salas já fechadas não contam de novo"


def test_um_sinal_recente_de_qualquer_pessoa_mantem_a_sala(table, store):
    (ana, beto), code = table("Ana", "Beto")
    age(store, 10)
    assert beto.post(f"/rooms/{code}/heartbeat").status_code == 200
    assert run(rooms.close_stale(store, 180)) == 0
    assert ana.get(f"/rooms/{code}").status_code == 200


def test_partida_abandonada_termina_sem_vencedor_e_sem_pontuar(table, store):
    players, code = table("Ana", "Beto")
    game_id = start_game(players, code)
    age(store, 10)
    assert run(rooms.close_stale(store, 180)) == 1

    game = store.games[game_id]
    assert game["status"] == "abandoned" and game["finish_reason"] == "abandoned"
    assert game["winner_user_id"] is None
    for player in players:
        me = player.get("/me").json()
        assert me["activeRoom"] is None
        assert me["stats"]["gamesPlayed"] == 0 and me["stats"]["wins"] == 0


def test_arbitro_faz_a_limpeza_em_segundo_plano(table, store, monkeypatch):
    (ana, beto), code = table("Ana", "Beto")
    age(store, 10)
    monkeypatch.setattr(referee, "CLEANUP_EVERY", 1)

    async def one_pass():
        task = asyncio.create_task(referee.run(store, 0.01, 40, stale_room_seconds=180))
        await asyncio.sleep(0.1)
        task.cancel()

    run(one_pass())
    assert ana.get("/me").json()["activeRoom"] is None


def test_anfitriao_que_sai_no_meio_da_partida_passa_a_sala_para_outro(table):
    players, code = table("Ana", "Beto", "Caio")
    game_id = start_game(players, code)
    assert players[0].post(f"/rooms/{code}/leave").json() == {"left": True, "closed": False}
    detail = players[1].get(f"/rooms/{code}").json()
    assert detail["room"]["status"] == "playing" and detail["room"]["hostId"] == players[1].id
    assert players[1].get(f"/games/{game_id}").json()["status"] == "playing"


def test_ultimo_humano_que_sai_encerra_a_partida_contra_cpus(table, store):
    players, code = table("Ana", "Beto")
    players[0].post(f"/rooms/{code}/bots")
    game_id = start_game(players, code)
    players[0].post(f"/rooms/{code}/leave")
    players[1].post(f"/rooms/{code}/leave")
    assert store.games[game_id]["status"] in ("finished", "abandoned")
    assert store.games[game_id]["status"] != "playing"
    assert players[1].get("/me").json()["activeRoom"] is None
