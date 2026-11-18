"""Salas, lobby e perfis pela API."""

from .conftest import error_code


def test_criar_sala_privada_e_entrar_pelo_codigo(signup):
    ana, beto = signup("Ana"), signup("Beto", avatar="sapo")
    created = ana.post("/rooms", {"name": "Sala da Ana", "targetScore": 100, "maxPlayers": 3, "turnSeconds": 45})
    assert created.status_code == 201
    room = created.json()["room"]
    assert room["visibility"] == "private" and room["status"] == "lobby" and len(room["code"]) == 6
    assert (room["targetScore"], room["maxPlayers"], room["turnSeconds"]) == (100, 3, 45)

    joined = beto.post(f"/rooms/{room['code'].lower()}/join")  # o código aceita minúsculas
    assert joined.status_code == 200
    players = joined.json()["players"]
    assert [(p["name"], p["seat"], p["isHost"], p["avatar"]) for p in players] == [
        ("Ana", 0, True, "raposa"), ("Beto", 1, False, "sapo"),
    ]
    assert all(p["online"] for p in players)
    assert ana.get("/me").json()["activeRoom"]["code"] == room["code"]


def test_configuracoes_invalidas_sao_recusadas(signup):
    ana = signup("Ana")
    for bad in ({"targetScore": 123}, {"maxPlayers": 9}, {"maxPlayers": 1}, {"turnSeconds": 7}, {"visibility": "x"}):
        assert ana.post("/rooms", bad).status_code == 422, bad


def test_sala_privada_nao_aparece_na_lista_nem_para_quem_nao_esta_nela(signup):
    ana, beto = signup("Ana"), signup("Beto")
    private = ana.post("/rooms", {}).json()["room"]["code"]
    public = beto.post("/rooms", {"visibility": "public", "name": "Aberta"}).json()["room"]["code"]

    listed = signup("Caio").get("/rooms/public").json()["rooms"]
    assert [r["code"] for r in listed] == [public]
    assert listed[0]["playerCount"] == 1 and listed[0]["hostName"] == "Beto"

    forbidden = beto.get(f"/rooms/{private}")
    assert forbidden.status_code == 403 and error_code(forbidden) == "NOT_IN_ROOM"
    assert beto.get("/rooms/ZZZZZZ").status_code == 404
    assert beto.get("/rooms/!!").status_code == 404


def test_lotacao_e_uma_sala_por_pessoa(signup):
    ana, beto, caio = signup("Ana"), signup("Beto"), signup("Caio")
    code = ana.post("/rooms", {"maxPlayers": 2}).json()["room"]["code"]
    assert beto.post(f"/rooms/{code}/join").status_code == 200
    full = caio.post(f"/rooms/{code}/join")
    assert full.status_code == 409 and error_code(full) == "ROOM_FULL"

    other = caio.post("/rooms", {}).json()["room"]["code"]
    busy = beto.post(f"/rooms/{other}/join")
    assert busy.status_code == 409 and error_code(busy) == "ALREADY_IN_ROOM"
    assert error_code(beto.post("/rooms", {})) == "ALREADY_IN_ROOM"


def test_so_o_anfitriao_configura_adiciona_cpu_e_inicia(table):
    (ana, beto), code = table("Ana", "Beto")
    for response in (
        beto.patch(f"/rooms/{code}", {"targetScore": 100}),
        beto.post(f"/rooms/{code}/bots"),
        beto.post(f"/rooms/{code}/start"),
    ):
        assert response.status_code == 403 and error_code(response) == "NOT_HOST"

    updated = ana.patch(f"/rooms/{code}", {"targetScore": 300, "visibility": "public", "name": "  Nova  "})
    assert updated.json()["room"] == {**updated.json()["room"], "targetScore": 300, "visibility": "public", "name": "Nova"}
    assert ana.patch(f"/rooms/{code}", {"maxPlayers": 3}).json()["room"]["maxPlayers"] == 3

    with_bot = ana.post(f"/rooms/{code}/bots").json()["players"]
    bot = with_bot[-1]
    assert bot["isBot"] and bot["isReady"] and bot["name"] == "Rita"
    assert error_code(ana.post(f"/rooms/{code}/bots")) == "ROOM_FULL"
    assert error_code(ana.patch(f"/rooms/{code}", {"maxPlayers": 2})) == "TOO_MANY_PLAYERS"
    removed = ana.delete(f"/rooms/{code}/players/{bot['id']}").json()["players"]
    assert len(removed) == 2


def test_partida_so_comeca_com_todos_prontos(signup):
    ana, beto = signup("Ana"), signup("Beto")
    code = ana.post("/rooms", {}).json()["room"]["code"]
    assert error_code(ana.post(f"/rooms/{code}/start")) == "NOT_ENOUGH_PLAYERS"
    beto.post(f"/rooms/{code}/join")
    assert error_code(ana.post(f"/rooms/{code}/start")) == "PLAYERS_NOT_READY"
    beto.post(f"/rooms/{code}/ready", {"ready": True})
    started = ana.post(f"/rooms/{code}/start")
    assert started.status_code == 200
    room = started.json()["room"]
    assert room["status"] == "playing" and room["gameId"]
    # Não dá para iniciar de novo nem entrar depois que começou.
    assert error_code(ana.post(f"/rooms/{code}/start")) == "ROOM_NOT_OPEN"
    assert error_code(signup("Caio").post(f"/rooms/{code}/join")) == "ROOM_NOT_OPEN"


def test_anfitriao_expulsa_e_sair_transfere_a_sala(table, signup):
    (ana, beto, caio), code = table("Ana", "Beto", "Caio")
    beto_row = next(p for p in ana.get(f"/rooms/{code}").json()["players"] if p["name"] == "Beto")
    assert len(ana.delete(f"/rooms/{code}/players/{beto_row['id']}").json()["players"]) == 2
    assert beto.get(f"/rooms/{code}").status_code == 403
    assert beto.get("/me").json()["activeRoom"] is None

    assert ana.post(f"/rooms/{code}/leave").json() == {"left": True, "closed": False}
    detail = caio.get(f"/rooms/{code}").json()
    assert detail["me"]["isHost"] and detail["room"]["hostId"] == caio.id

    assert caio.post(f"/rooms/{code}/leave").json()["closed"] is True
    assert error_code(signup("Duda").post(f"/rooms/{code}/join")) == "ROOM_NOT_OPEN"


def test_partida_rapida_junta_jogadores_e_comeca_quando_todos_ficam_prontos(signup):
    ana, beto = signup("Ana"), signup("Beto")
    first = ana.post("/rooms/quick").json()
    second = beto.post("/rooms/quick").json()
    code = first["room"]["code"]
    assert second["room"]["code"] == code and first["room"]["mode"] == "quick"
    assert first["room"]["visibility"] == "public"
    assert ana.post("/rooms/quick").json()["room"]["code"] == code  # já está nela

    assert ana.post(f"/rooms/{code}/ready", {"ready": True}).json()["room"]["status"] == "lobby"
    started = beto.post(f"/rooms/{code}/ready", {"ready": True}).json()
    assert started["room"]["status"] == "playing" and started["room"]["gameId"]


def test_batimento_exige_participar_da_sala(table, signup):
    (ana, _), code = table("Ana", "Beto")
    assert ana.post(f"/rooms/{code}/heartbeat").json()["ok"] is True
    assert signup("Caio").post(f"/rooms/{code}/heartbeat").status_code == 403


def test_editar_perfil_e_preferencias(signup, client):
    ana, beto = signup("Ana"), signup("Beto")
    updated = ana.patch("/me", {"username": "Aninha_7", "avatar": "coruja"})
    assert updated.json()["profile"] == {**updated.json()["profile"], "username": "Aninha_7", "avatar": "coruja"}
    assert error_code(ana.patch("/me", {"username": "BETO"})) == "USERNAME_TAKEN"
    assert error_code(ana.patch("/me", {"username": "a b"})) == "INVALID_USERNAME"
    assert error_code(ana.patch("/me", {"avatar": "dragao"})) == "INVALID_AVATAR"

    saved = ana.put("/me/settings", {"settings": {"volume": 7, "sound": False, "animationSpeed": 9, "hack": 1}})
    assert saved.json()["settings"] == {
        "volume": 1.0, "sound": False, "animationSpeed": 1, "reducedMotion": False,
        "showRisk": True, "confirmStay": False,
    }
    assert ana.get("/me").json()["settings"]["sound"] is False
    assert beto.get("/me").json()["settings"]["sound"] is True

    assert client.get("/api/usernames/aninha_7/available").json()["available"] is False
    assert client.get("/api/usernames/livre_123/available").json()["available"] is True
    assert client.get("/api/usernames/x/available").json()["available"] is False
    assert beto.get("/profiles/ANINHA_7").json()["profile"]["avatar"] == "coruja"
    assert beto.get("/profiles/ninguem").status_code == 404
