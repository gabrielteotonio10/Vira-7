"""Salas: criar, entrar, sair, lobby, CPUs e início da partida."""

from __future__ import annotations

import logging
import random
import re
from datetime import timedelta

from ..config import AVATARS, BOT_NAMES, SEAT_COLORS
from ..errors import ApiError, StoreError, from_store
from ..game import GameSession
from ..game import constants as C
from . import chat, games

log = logging.getLogger("vira7.rooms")

CODE_RE = re.compile(r"^[A-Z2-9]{6}$")
QUICK_DEFAULTS = {"max_players": 4, "target_score": 200, "turn_seconds": 30}
#: Personalidade das CPUs: quanto maior, mais arrisca (0 a 1).
BOT_RISK = {"cautious": 0.18, "balanced": 0.3, "bold": 0.44}
BOT_LEVELS = tuple(BOT_RISK)
ONLINE_WINDOW = timedelta(seconds=25)


def normalize_code(code: str) -> str:
    code = (code or "").strip().upper()
    if not CODE_RE.match(code):
        raise ApiError(404, "ROOM_NOT_FOUND", "Sala não encontrada. Confira o código.")
    return code


def serialize_room(room: dict) -> dict:
    return {
        "id": room["id"],
        "code": room["code"],
        "name": room["name"],
        "hostId": room["host_id"],
        "visibility": room["visibility"],
        "mode": room["mode"],
        "status": room["status"],
        "maxPlayers": room["max_players"],
        "targetScore": room["target_score"],
        "turnSeconds": room["turn_seconds"],
        "teamMode": bool(room.get("team_mode")),
        "friendsJoin": bool(room.get("friends_join")),
        "deckVersion": room.get("deck_version") or 2,
        "gameId": room.get("current_game_id"),
        "createdAt": room.get("created_at"),
    }


def serialize_player(player: dict, room: dict) -> dict:
    seen = games.parse_time(player.get("last_seen_at"))
    return {
        "id": player["id"],
        "userId": player["user_id"],
        "name": player["username"],
        "avatar": player["avatar"] or "raposa",
        "seat": player["seat"],
        "color": SEAT_COLORS[player["seat"] % len(SEAT_COLORS)],
        "isBot": player["is_bot"],
        "botLevel": player.get("bot_level") if player["is_bot"] else None,
        "isReady": player["is_ready"],
        "isHost": player["user_id"] is not None and player["user_id"] == room["host_id"],
        "online": player["is_bot"] or (seen is not None and games.utcnow() - seen < ONLINE_WINDOW),
    }


async def detail(store, room: dict, user_id: str) -> dict:
    players = await store.list_players(room["id"])
    spectators = await store.list_spectators(room["id"])
    return {
        "room": serialize_room(room),
        "players": [serialize_player(p, room) for p in players],
        "spectators": [{"userId": s["user_id"], "name": s["username"], "avatar": s["avatar"] or "raposa"} for s in spectators],
        "me": {
            "userId": user_id,
            "isHost": room["host_id"] == user_id,
            "isMember": any(p["user_id"] == user_id for p in players),
            "isSpectator": any(s["user_id"] == user_id for s in spectators),
        },
        "serverTime": games.utcnow().isoformat(),
    }


async def _room_for_member(store, code: str, user_id: str) -> dict:
    room = await store.get_room_by_code(normalize_code(code))
    if not room:
        raise ApiError(404, "ROOM_NOT_FOUND", "Sala não encontrada. Confira o código.")
    membership = await store.active_membership(user_id)
    if not membership or membership["room"]["id"] != room["id"]:
        raise ApiError(403, "NOT_IN_ROOM", "Você não está nesta sala.")
    return room


async def _room_for_viewer(store, code: str, user_id: str) -> dict:
    """Sala que a pessoa pode ver: como jogadora ou como espectadora."""
    room = await store.get_room_by_code(normalize_code(code))
    if not room:
        raise ApiError(404, "ROOM_NOT_FOUND", "Sala não encontrada. Confira o código.")
    membership = await store.active_membership(user_id) or await store.spectator_membership(user_id)
    if not membership or membership["room"]["id"] != room["id"]:
        raise ApiError(403, "NOT_IN_ROOM", "Você não está nesta sala.")
    return room


async def _promote_spectators(store, room: dict) -> dict:
    """Com a sala de volta ao lobby, quem assistia ocupa os assentos livres (o mais antigo primeiro)."""
    if room["status"] != "lobby":
        return room
    spectators = await store.list_spectators(room["id"])
    if not spectators:
        return room
    free = room["max_players"] - len(await store.list_players(room["id"]))
    promoted = False
    for spectator in spectators[: max(free, 0)]:
        try:
            await store.join_room(room["id"], spectator["user_id"])
        except StoreError:
            continue
        await store.remove_spectator(spectator["user_id"])
        promoted = True
    return await store.get_room(room["id"]) if promoted else room


def _check_team_size(team_mode: bool, max_players: int) -> None:
    if team_mode and (max_players < 4 or max_players % 2):
        raise ApiError(422, "TEAM_SIZE", "Partida em duplas precisa de uma sala para 4, 6 ou 8 jogadores.")


def _require_host(room: dict, user_id: str) -> None:
    if room["host_id"] != user_id:
        raise ApiError(403, "NOT_HOST", "Só o anfitrião da sala pode fazer isso.")


def _require_lobby(room: dict) -> None:
    if room["status"] != "lobby":
        raise ApiError(409, "ROOM_NOT_OPEN", "A partida já começou.")


async def create(store, user_id: str, data: dict) -> dict:
    _check_team_size(bool(data.get("team_mode")), data["max_players"])
    await store.remove_spectator(user_id)
    profile = await store.get_profile(user_id)
    name = (data.get("name") or "").strip() or f"Sala de {profile['username']}"
    room = await store.create_room(
        user_id, name[:40], data["visibility"], data.get("mode", "custom"),
        data["max_players"], data["target_score"], data["turn_seconds"],
    )
    extras = {}
    if data.get("team_mode"):
        extras["team_mode"] = True
    if data.get("friends_join"):
        extras["friends_join"] = True
    if data.get("deck_version") in (1, 2) and data["deck_version"] != 2:
        extras["deck_version"] = data["deck_version"]
    if extras:
        room = await store.update_room(room["id"], extras)
    return await detail(store, room, user_id)


async def quick_match(store, user_id: str) -> dict:
    """Partida rápida: entra na sala pública rápida mais antiga com vaga, ou cria uma."""
    current = await store.active_membership(user_id)
    if current:
        return await detail(store, current["room"], user_id)
    await store.remove_spectator(user_id)
    for _ in range(3):
        room = await store.find_quick_room()
        if not room:
            break
        try:
            await store.join_room(room["id"], user_id)
            return await detail(store, await store.get_room(room["id"]), user_id)
        except StoreError as error:
            if error.code == "ALREADY_IN_ROOM":
                raise
            continue  # a sala lotou ou começou nesse meio-tempo: tenta a próxima
    return await create(
        store, user_id, {"name": "Partida rápida", "visibility": "public", "mode": "quick", **QUICK_DEFAULTS}
    )


async def join(store, user_id: str, code: str) -> dict:
    room = await store.get_room_by_code(normalize_code(code))
    if not room:
        raise ApiError(404, "ROOM_NOT_FOUND", "Sala não encontrada. Confira o código.")
    spectating = await store.spectator_membership(user_id)
    if spectating and spectating["room"]["id"] == room["id"]:
        return await detail(store, room, user_id)
    await store.remove_spectator(user_id)
    try:
        await store.join_room(room["id"], user_id)
    except StoreError as error:
        # Sala cheia ou partida em andamento: a pessoa entra para assistir.
        if error.code in ("ROOM_FULL", "ROOM_NOT_OPEN") and room["status"] in ("lobby", "playing"):
            if await store.active_membership(user_id):
                raise StoreError("ALREADY_IN_ROOM") from error
            await store.add_spectator(room["id"], user_id)
        else:
            raise
    return await detail(store, await store.get_room(room["id"]), user_id)


async def get(store, user_id: str, code: str) -> dict:
    room = await _room_for_viewer(store, code, user_id)
    room = await _promote_spectators(store, room)
    return await detail(store, room, user_id)


async def leave(store, user_id: str, code: str) -> dict:
    room = await store.get_room_by_code(normalize_code(code))
    if not room:
        return {"left": False}
    spectating = await store.spectator_membership(user_id)
    if spectating and spectating["room"]["id"] == room["id"]:
        await store.remove_spectator(user_id)
        return {"left": True, "closed": False}
    # O anfitrião que sai do lobby fecha a sala para todos (não fica sala "fantasma" esperando).
    if room["status"] == "lobby" and room["host_id"] == user_id:
        membership = await store.active_membership(user_id)
        if membership and membership["room"]["id"] == room["id"]:
            await store.close_room(room["id"])
            chat.clear(room["id"])
            return {"left": True, "closed": True}
    # Sair no meio da partida = abandonar: o jogo segue sem a pessoa.
    if room["status"] == "playing" and room.get("current_game_id"):
        await games.forfeit(store, room["current_game_id"], user_id)
    result = await store.leave_room(room["id"], user_id)
    if result["closed"]:
        chat.clear(room["id"])
        if room.get("current_game_id"):
            await games.abandon(store, room["current_game_id"])
        await store.close_room(room["id"])  # solta também quem só assistia
    return {"left": result["left"], "closed": result["closed"]}


async def reassign_absent_hosts(store, away_seconds: int) -> int:
    """No lobby, se o anfitrião sumiu (fechou a aba, perdeu a conexão) e há outra pessoa
    conectada, a sala passa para quem está há mais tempo nela. Retorna quantas salas mudaram."""
    if away_seconds <= 0:
        return 0
    now = games.utcnow()
    moved = 0
    for room in await store.list_open_rooms():
        humans = room.get("humans") or []
        if room["status"] != "lobby" or len(humans) < 2:
            continue
        seen = {h["user_id"]: games.parse_time(h["seen"]) for h in humans}

        def fresh(user_id: str) -> bool:
            stamp = seen.get(user_id)
            return bool(stamp) and (now - stamp).total_seconds() < away_seconds

        if fresh(room["host_id"]):
            continue
        successor = next((h["user_id"] for h in humans if h["user_id"] != room["host_id"] and fresh(h["user_id"])), None)
        if successor:
            try:
                await store.set_host(room["id"], successor)
                moved += 1
            except Exception:  # uma sala com problema não impede as outras
                log.exception("Falha ao trocar o anfitrião da sala %s", room["id"])
    return moved


async def close_stale(store, stale_seconds: int) -> int:
    """Fecha as salas em que ninguém dá sinal há `stale_seconds` (abas fechadas, celulares
    bloqueados, pessoas que simplesmente pararam de jogar). Retorna quantas foram fechadas."""
    now = games.utcnow()
    closed = 0
    for room in await store.list_open_rooms():
        seen = [games.parse_time(t) for t in room["humans_seen"]]
        last = max([t for t in seen if t] + [games.parse_time(room["updated_at"]) or now])
        if (now - last).total_seconds() < stale_seconds:
            continue
        try:
            if room["status"] == "playing" and room.get("current_game_id"):
                await games.abandon(store, room["current_game_id"])
            await store.close_room(room["id"])
            chat.clear(room["id"])
            closed += 1
        except Exception:  # uma sala com problema não impede a limpeza das outras
            log.exception("Falha ao fechar a sala %s", room["id"])
    return closed


async def set_ready(store, user_id: str, code: str, ready: bool) -> dict:
    room = await _room_for_member(store, code, user_id)
    _require_lobby(room)
    await store.set_ready(room["id"], user_id, ready)
    # Partida rápida começa sozinha quando todos estão prontos.
    if ready and room["mode"] == "quick":
        players = await store.list_players(room["id"])
        if len(players) >= C.MIN_PLAYERS and all(p["is_ready"] for p in players):
            try:
                await _start(store, room, players)
            except ApiError as error:
                # Dois "pronto" quase juntos: um deles já iniciou (ou alguém entrou no meio). Não é erro.
                if error.code != "ROOM_CHANGED":
                    raise
            room = await store.get_room(room["id"])
    return await detail(store, room, user_id)


async def update_settings(store, user_id: str, code: str, fields: dict) -> dict:
    room = await _room_for_member(store, code, user_id)
    _require_host(room, user_id)
    _require_lobby(room)
    changes = {key: value for key, value in fields.items() if value is not None}
    if room["mode"] == "quick" and changes:
        # A partida rápida tem regras fixas: só a API poderia mexer, então a API também recusa.
        raise ApiError(403, "QUICK_LOCKED", "As regras da partida rápida não podem ser alteradas.")
    _check_team_size(changes.get("team_mode", room.get("team_mode", False)), changes.get("max_players", room["max_players"]))
    if "max_players" in changes:
        count = len(await store.list_players(room["id"]))
        if changes["max_players"] < count:
            raise ApiError(409, "TOO_MANY_PLAYERS", f"Já há {count} jogadores na sala.")
    if "name" in changes:
        changes["name"] = changes["name"].strip()[:40] or room["name"]
    if changes:
        room = await store.update_room(room["id"], changes)
    return await detail(store, room, user_id)


async def add_bot(store, user_id: str, code: str, level: str | None = None) -> dict:
    room = await _room_for_member(store, code, user_id)
    _require_host(room, user_id)
    _require_lobby(room)
    if level is not None and level not in BOT_LEVELS:
        raise ApiError(422, "INVALID_LEVEL", "Nível de CPU desconhecido.")
    players = await store.list_players(room["id"])
    used_names = {p["username"] for p in players}
    used_avatars = {p["avatar"] for p in players}
    name = next((n for n in BOT_NAMES if n not in used_names), f"CPU {len(players) + 1}")
    avatar = next((a for a in reversed(AVATARS) if a not in used_avatars), AVATARS[len(players) % len(AVATARS)])
    await store.add_bot(room["id"], name, avatar, level or "balanced")
    return await detail(store, room, user_id)


async def move_player(store, user_id: str, code: str, player_id: str, direction: str) -> dict:
    """O anfitrião troca um jogador de lugar com o vizinho (em duplas, isso muda a dupla)."""
    room = await _room_for_member(store, code, user_id)
    _require_host(room, user_id)
    _require_lobby(room)
    players = await store.list_players(room["id"])
    index = next((i for i, p in enumerate(players) if p["id"] == player_id), None)
    if index is None:
        raise ApiError(404, "PLAYER_NOT_FOUND", "Esse jogador não está mais na sala.")
    other = index - 1 if direction == "up" else index + 1
    if 0 <= other < len(players):
        try:
            await store.swap_seats(room["id"], players[index]["id"], players[other]["id"])
        except StoreError as error:
            raise from_store(error) from error
    return await detail(store, await store.get_room(room["id"]), user_id)


async def remove_player(store, user_id: str, code: str, player_id: str) -> dict:
    """O anfitrião remove uma CPU ou expulsa uma pessoa (só no lobby)."""
    room = await _room_for_member(store, code, user_id)
    _require_host(room, user_id)
    _require_lobby(room)
    players = await store.list_players(room["id"])
    target = next((p for p in players if p["id"] == player_id), None)
    if not target:
        raise ApiError(404, "PLAYER_NOT_FOUND", "Esse jogador não está mais na sala.")
    if target["is_bot"]:
        await store.remove_bot(room["id"], player_id)
    elif target["user_id"] == user_id:
        raise ApiError(400, "CANNOT_KICK_SELF", "Para sair, use o botão Sair da sala.")
    else:
        await store.leave_room(room["id"], target["user_id"])
    return await detail(store, await store.get_room(room["id"]), user_id)


async def start(store, user_id: str, code: str) -> dict:
    room = await _room_for_member(store, code, user_id)
    _require_host(room, user_id)
    _require_lobby(room)
    players = await store.list_players(room["id"])
    if len(players) < C.MIN_PLAYERS:
        raise ApiError(409, "NOT_ENOUGH_PLAYERS", "São necessários pelo menos 2 jogadores.")
    if room.get("team_mode") and (len(players) < 4 or len(players) % 2):
        raise ApiError(409, "TEAM_SIZE", "Partida em duplas precisa de 4, 6 ou 8 jogadores (as CPUs completam a mesa).")
    if not all(p["is_ready"] or p["user_id"] == user_id for p in players):
        raise ApiError(409, "PLAYERS_NOT_READY", "Nem todos os jogadores estão prontos.")
    await _start(store, room, players)
    return await detail(store, await store.get_room(room["id"]), user_id)


async def _start(store, room: dict, players: list[dict]) -> str:
    roster = [
        {
            "userId": p["user_id"],
            "name": p["username"],
            "avatar": p["avatar"] or "raposa",
            "color": SEAT_COLORS[index % len(SEAT_COLORS)],
            "isBot": p["is_bot"],
            # Personalidade fixa por CPU: da mais cautelosa à mais ousada.
            "riskTolerance": BOT_RISK.get(p.get("bot_level")) or 0.2 + 0.04 * (index % 6),
        }
        for index, p in enumerate(players)
    ]
    session = GameSession.create(
        roster, target_score=room["target_score"], turn_seconds=room["turn_seconds"], teams=bool(room.get("team_mode")),
        deck_version=room.get("deck_version") or 2,
    )
    events = session.drain_events()
    args = games.finalize(session, events)
    game_id = await store.start_game(
        room["id"], [p["id"] for p in players], args["public_state"], args["secret"], args["events"],
        args["awaiting_user_id"], args["deadline"],
    )
    if not game_id:
        raise ApiError(409, "ROOM_CHANGED", "A sala mudou enquanto a partida era criada. Tente de novo.")
    return game_id


async def heartbeat(store, user_id: str, code: str) -> dict:
    room = await _room_for_viewer(store, code, user_id)
    membership = await store.active_membership(user_id)
    if membership:
        await store.touch_presence(room["id"], user_id)
    room = await _promote_spectators(store, room)
    return {"ok": True, "status": room["status"], "gameId": room.get("current_game_id")}


async def send_chat(store, user_id: str, code: str, kind: str, key: str) -> dict:
    room = await _room_for_viewer(store, code, user_id)
    profile = await store.get_profile(user_id)
    return {"message": chat.post(room["id"], user_id, profile["username"], profile["avatar"] or "raposa", kind, key)}


async def read_chat(store, user_id: str, code: str, after: int) -> dict:
    room = await _room_for_viewer(store, code, user_id)
    return chat.since(room["id"], after)


#: Quantas salas públicas a lista mostra (sorteadas entre as abertas).
PUBLIC_ROOMS_SHOWN = 10


async def public_rooms(store) -> list[dict]:
    """Até 10 salas públicas abertas, sorteadas: ninguém vê "todas" e as salas
    se espalham melhor entre quem procura. Salas com vaga vêm antes das cheias."""
    candidates = await store.list_public_rooms(limit=60)
    random.shuffle(candidates)
    candidates.sort(key=lambda room: room["player_count"] >= room["max_players"])
    return [
        {
            **serialize_room(room),
            "playerCount": room["player_count"],
            "hostName": room["host_name"],
            "hostAvatar": room.get("host_avatar") or "raposa",
        }
        for room in candidates[:PUBLIC_ROOMS_SHOWN]
    ]
