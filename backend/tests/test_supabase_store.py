"""O acesso ao Supabase (PostgREST), com o servidor simulado por httpx.MockTransport.

Não prova que o Supabase real aceita cada chamada (isso é o papel do smoke_online.py),
mas garante o formato de cada requisição, a tradução de erros e o escape de valores.
"""

import json

import httpx
import pytest

from app.errors import StoreError
from app.store.supabase_store import SupabaseStore, like_exact

URL = "https://abc123.supabase.co"
SERVICE_KEY = "chave-service-role-de-teste"


def make_store(handler):
    calls: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    http = httpx.AsyncClient(transport=httpx.MockTransport(record))
    return SupabaseStore(URL, SERVICE_KEY, http), calls


def reply(body, status=200):
    return lambda request: httpx.Response(status, json=body)


@pytest.fixture
def run():
    import asyncio

    return lambda coro: asyncio.run(coro)


def test_like_exact_escapa_os_curingas():
    assert like_exact("gabriel_7") == "gabriel\\_7"
    assert like_exact("100%") == "100\\%"
    assert like_exact("a*b") == "a\\*b"
    assert like_exact("a\\b") == "a\\\\b"
    assert like_exact("Ana") == "Ana"


def test_busca_de_nome_nao_trata_sublinhado_como_curinga(run):
    store, calls = make_store(reply([]))
    assert run(store.username_taken("gabriel_7")) is False
    assert calls[0].url.params["username"] == "ilike.gabriel\\_7"

    run(store.get_profile_by_username("a_b"))
    assert calls[1].url.params["username"] == "ilike.a\\_b"


def test_nome_ja_usado_e_exclui_o_proprio_perfil(run):
    store, calls = make_store(reply([{"id": "u2"}]))
    assert run(store.username_taken("ana", exclude="u1")) is True
    params = calls[0].url.params
    assert params["id"] == "neq.u1" and params["select"] == "id" and params["limit"] == "1"


def test_toda_requisicao_vai_com_a_chave_de_servico_no_servidor(run):
    store, calls = make_store(reply([]))
    run(store.get_profile("u1"))
    request = calls[0]
    assert request.url.path == "/rest/v1/profiles"
    assert request.headers["apikey"] == SERVICE_KEY
    assert request.headers["authorization"] == f"Bearer {SERVICE_KEY}"


@pytest.mark.parametrize("code", ["ROOM_NOT_FOUND", "ROOM_FULL", "ROOM_NOT_OPEN", "ALREADY_IN_ROOM"])
def test_erros_de_regra_das_funcoes_viram_codigos(run, code):
    store, _ = make_store(reply({"code": "P0001", "message": code, "details": None, "hint": None}, status=400))
    with pytest.raises(StoreError) as error:
        run(store.join_room("room-1", "user-1"))
    assert error.value.code == code


def test_violacao_de_unicidade_vira_erro_de_regra(run):
    taken = {"code": "23505", "message": 'duplicate key value violates unique constraint "profiles_username_lower_key"'}
    store, _ = make_store(reply(taken, status=409))
    with pytest.raises(StoreError) as error:
        run(store.update_profile("u1", {"username": "ana"}))
    assert error.value.code == "USERNAME_TAKEN"

    busy = {"code": "23505", "message": 'duplicate key value violates unique constraint "room_players_one_active_room_key"'}
    store, _ = make_store(reply(busy, status=409))
    with pytest.raises(StoreError) as error:
        run(store.join_room("room-1", "u1"))
    assert error.value.code == "ALREADY_IN_ROOM"


def test_erro_desconhecido_do_banco_nao_vira_codigo_de_regra(run):
    store, _ = make_store(reply({"message": "falha qualquer"}, status=500))
    with pytest.raises(RuntimeError):
        run(store.get_profile("u1"))


def test_gravar_jogada_chama_a_funcao_com_os_doze_parametros(run):
    store, calls = make_store(reply(True))
    ok = run(
        store.commit_game(
            "g1", 3, {"round": 1}, {"v": 1}, [{"seq": 4}], "u2", "2026-11-16T12:00:00+00:00",
            "playing", None, None, None, None,
        )
    )
    assert ok is True
    request = calls[0]
    assert request.method == "POST" and request.url.path == "/rest/v1/rpc/vira7_commit_game"
    body = json.loads(request.content)
    assert sorted(body) == sorted(
        ["p_game", "p_expected_version", "p_public", "p_secret", "p_events", "p_awaiting", "p_deadline",
         "p_status", "p_results", "p_winner", "p_winner_name", "p_finish_reason"]
    )
    assert body["p_expected_version"] == 3 and body["p_awaiting"] == "u2"


def test_versao_desatualizada_devolve_falso(run):
    store, _ = make_store(reply(False))
    assert run(store.commit_game("g1", 1, {}, {}, [], None, None, "playing", None, None, None, None)) is False


def test_iniciar_partida_envia_a_lista_de_participantes(run):
    store, calls = make_store(reply("game-uuid"))
    assert run(store.start_game("r1", ["p1", "p2"], {"round": 1}, {"v": 1}, [], "u1", None)) == "game-uuid"
    assert json.loads(calls[0].content)["p_player_ids"] == ["p1", "p2"]

    store, _ = make_store(reply(None))
    assert run(store.start_game("r1", ["p1"], {}, {}, [], None, None)) is None


def test_lista_de_salas_publicas_junta_anfitriao_e_conta_so_quem_esta(run):
    row = {
        "id": "r1", "code": "ABC234", "name": "Sala", "host_id": "u1", "visibility": "public", "mode": "custom",
        "status": "lobby", "max_players": 4, "target_score": 200, "turn_seconds": 30, "current_game_id": None,
        "created_at": "2026-11-16T12:00:00+00:00", "updated_at": "2026-11-16T12:00:00+00:00",
        "host": {"username": "ana", "avatar": "panda"},
        "room_players": [{"status": "joined"}, {"status": "joined"}, {"status": "left"}],
    }
    store, calls = make_store(reply([row]))
    rooms = run(store.list_public_rooms())
    assert rooms[0]["player_count"] == 2
    assert (rooms[0]["host_name"], rooms[0]["host_avatar"]) == ("ana", "panda")
    assert "host" not in rooms[0] and "room_players" not in rooms[0]
    params = calls[0].url.params
    assert params["visibility"] == "eq.public" and params["status"] == "eq.lobby"


def test_jogadores_da_sala_trazem_perfil_ou_dados_da_cpu_e_presenca(run):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/room_players"):
            return httpx.Response(200, json=[
                {"id": "p1", "user_id": "u1", "is_bot": False, "bot_name": None, "bot_avatar": None, "seat": 0,
                 "is_ready": True, "status": "joined", "joined_at": "x", "room_id": "r1",
                 "profile": {"username": "ana", "avatar": "panda"}},
                {"id": "p2", "user_id": None, "is_bot": True, "bot_name": "Rita", "bot_avatar": "coruja", "seat": 1,
                 "is_ready": True, "status": "joined", "joined_at": "x", "room_id": "r1", "profile": None},
            ])
        return httpx.Response(200, json=[{"user_id": "u1", "last_seen_at": "2026-11-16T12:00:00+00:00"}])

    store, _ = make_store(handler)
    players = run(store.list_players("r1"))
    assert [(p["username"], p["avatar"]) for p in players] == [("ana", "panda"), ("Rita", "coruja")]
    assert players[0]["last_seen_at"] == "2026-11-16T12:00:00+00:00" and players[1]["last_seen_at"] is None


def test_ranking_pede_ordem_explicita(run):
    store, calls = make_store(reply([]))
    run(store.leaderboard(20))
    params = calls[0].url.params
    assert params["order"] == "wins.desc,total_points.desc,username.asc" and params["limit"] == "20"


def test_presenca_e_configuracoes_usam_upsert(run):
    store, calls = make_store(reply(None, status=201))
    run(store.touch_presence("r1", "u1"))
    request = calls[0]
    assert request.url.params["on_conflict"] == "room_id,user_id"
    assert request.headers["prefer"] == "resolution=merge-duplicates"
    assert json.loads(request.content) == {"room_id": "r1", "user_id": "u1", "last_seen_at": "now"}

    run(store.save_settings("u1", {"volume": 0.5}))
    assert calls[1].url.params["on_conflict"] == "user_id"
    assert json.loads(calls[1].content) == {"user_id": "u1", "settings": {"volume": 0.5}}


def test_historico_junta_partida_e_placar(run):
    def handler(request: httpx.Request) -> httpx.Response:
        table = request.url.path.rsplit("/", 1)[-1]
        if table == "game_results" and "user_id" in request.url.params:
            return httpx.Response(200, json=[{"game_id": "g1", "user_id": "u1", "placement": 1}])
        if table == "game_results":
            return httpx.Response(200, json=[
                {"game_id": "g1", "user_id": "u1", "placement": 1}, {"game_id": "g1", "user_id": None, "placement": 2},
            ])
        return httpx.Response(200, json=[{"id": "g1", "target_score": 200, "round": 5}])

    store, _ = make_store(handler)
    matches = run(store.list_matches("u1", 10, 0))
    assert len(matches) == 1
    assert matches[0]["game"]["id"] == "g1" and len(matches[0]["players"]) == 2


def test_fechar_sala_marca_sala_e_jogadores_e_apaga_a_presenca(run):
    store, calls = make_store(lambda request: httpx.Response(204))
    run(store.close_room("r1"))
    assert [(c.method, c.url.path.rsplit("/", 1)[-1]) for c in calls] == [
        ("PATCH", "rooms"), ("PATCH", "room_players"), ("DELETE", "player_presence"),
    ]
    assert json.loads(calls[0].content)["status"] == "closed"
    assert calls[0].url.params["id"] == "eq.r1"
    assert json.loads(calls[1].content) == {"status": "left", "is_ready": False}
    assert calls[2].url.params["room_id"] == "eq.r1"


def test_salas_abertas_trazem_o_ultimo_sinal_so_de_pessoas(run):
    def handler(request):
        if request.url.path.endswith("/rooms"):
            return httpx.Response(200, json=[{
                "id": "r1", "status": "lobby", "updated_at": "2026-01-01T00:00:00+00:00",
                "room_players": [
                    {"user_id": "u1", "is_bot": False, "status": "joined"},
                    {"user_id": None, "is_bot": True, "status": "joined"},
                    {"user_id": "u2", "is_bot": False, "status": "left"},
                ],
            }])
        return httpx.Response(200, json=[
            {"room_id": "r1", "user_id": "u1", "last_seen_at": "2026-01-01T00:01:00+00:00"},
            {"room_id": "r1", "user_id": "u2", "last_seen_at": "2026-01-01T00:09:00+00:00"},
        ])

    store, calls = make_store(handler)
    rooms = run(store.list_open_rooms())
    assert rooms[0]["humans_seen"] == ["2026-01-01T00:01:00+00:00"]
    assert calls[0].url.params["status"] == "in.(lobby,playing)"
    assert calls[1].url.params["room_id"] == "in.(r1)"
