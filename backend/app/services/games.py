"""Partidas: valida cada jogada no servidor e grava o resultado de forma atômica.

Fluxo de uma jogada:
  1. carrega a partida (estado público + secreto + versão);
  2. reconstrói o motor e aplica a jogada — o motor recusa o que for inválido;
  3. grava tudo em uma transação, exigindo que a versão não tenha mudado.
     Se outra jogada chegou antes, recarrega e valida de novo.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..errors import ApiError
from ..game import GameSession, InvalidAction

MAX_ATTEMPTS = 4
CONFLICT = ApiError(409, "CONFLICT", "Outra jogada foi processada ao mesmo tempo. Tente de novo.")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value) -> datetime | None:
    if not value:
        return None
    return value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def finalize(session: GameSession, events: list[dict]) -> dict:
    """Calcula o prazo do turno e monta os argumentos de gravação."""
    public_state = session.public_state()
    deadline = None
    turn_seconds = session.data["turnSeconds"]
    if session.awaiting and turn_seconds > 0:
        allowance = GameSession.presentation_ms(events) / 1000
        deadline = (utcnow() + timedelta(seconds=turn_seconds + allowance)).isoformat()
    public_state["deadline"] = deadline
    if events:
        events[-1]["state"] = public_state

    winner = session.data["winner"]
    winner_player = session.data["players"][winner] if winner is not None else None
    return {
        "public_state": public_state,
        "secret": session.data,
        "events": events,
        "awaiting_user_id": session.awaiting_user_id(),
        "deadline": deadline,
        "status": session.status,
        "results": session.results() if session.status == "finished" else None,
        "winner_user_id": winner_player["userId"] if winner_player else None,
        "winner_name": winner_player["name"] if winner_player else None,
        "finish_reason": session.data["finishReason"],
    }


async def _load(store, game_id: str) -> tuple[dict, GameSession]:
    game = await store.get_game(game_id)
    if not game:
        raise ApiError(404, "GAME_NOT_FOUND", "Partida não encontrada.")
    if game["status"] != "playing":
        raise ApiError(409, "GAME_OVER", "A partida já terminou.")
    secret = await store.get_secret(game_id)
    return game, GameSession.load(secret)


async def _mutate(store, game_id: str, change) -> list[dict]:
    """Aplica `change(session, game)` com controle de concorrência otimista."""
    for _ in range(MAX_ATTEMPTS):
        game, session = await _load(store, game_id)
        if change(session, game) is False:
            return []
        events = session.drain_events()
        args = finalize(session, events)
        if await store.commit_game(game_id, game["version"], **args):
            return public_events(events, game_id)
    raise CONFLICT


def public_events(events: list[dict], game_id: str) -> list[dict]:
    return [
        {"seq": e["seq"], "type": e["type"], "payload": e["payload"], "state": e["state"], "gameId": game_id}
        for e in events
    ]


async def require_member(store, game: dict, user_id: str) -> None:
    membership = await store.active_membership(user_id)
    if not membership or membership["room"]["id"] != game["room_id"]:
        raise ApiError(403, "NOT_IN_GAME", "Você não participa desta partida.")


async def snapshot(store, game_id: str, user_id: str) -> dict:
    game = await store.get_game(game_id)
    if not game:
        raise ApiError(404, "GAME_NOT_FOUND", "Partida não encontrada.")
    await require_member(store, game, user_id)
    return {
        "gameId": game["id"],
        "roomId": game["room_id"],
        "status": game["status"],
        "state": game["public_state"],
        "seq": game["last_seq"],
        "serverTime": utcnow().isoformat(),
    }


async def events_after(store, game_id: str, user_id: str, after: int) -> dict:
    game = await store.get_game(game_id)
    if not game:
        raise ApiError(404, "GAME_NOT_FOUND", "Partida não encontrada.")
    await require_member(store, game, user_id)
    rows = await store.list_events(game_id, after)
    return {
        "events": [
            {"seq": r["seq"], "type": r["type"], "payload": r["payload"], "state": r["state"], "gameId": game_id}
            for r in rows
        ],
        "serverTime": utcnow().isoformat(),
    }


async def act(store, game_id: str, user_id: str, kind: str, value, token: int | None) -> dict:
    """Jogada de uma pessoa: virar, parar ou escolher o alvo de uma carta de ação."""

    def change(session: GameSession, game: dict):
        seat = session.seat_of(user_id)
        if seat is None or seat in session.data["absent"]:
            raise ApiError(403, "NOT_IN_GAME", "Você não participa desta partida.")
        try:
            session.submit(seat, kind, value, token=token)
        except InvalidAction as error:
            raise ApiError(409, error.code, error.message) from error

    events = await _mutate(store, game_id, change)
    return {"events": events, "serverTime": utcnow().isoformat()}


async def tick(store, game_id: str, grace_seconds: int, *, by_user: str | None = None) -> dict:
    """Joga pelo jogador da vez se o prazo venceu ou se ele está desconectado.

    Pode ser chamado pelo árbitro do servidor ou por qualquer participante: o servidor
    confere o prazo de novo, então chamar antes da hora não tem efeito.
    """
    if by_user:
        game = await store.get_game(game_id)
        if not game:
            raise ApiError(404, "GAME_NOT_FOUND", "Partida não encontrada.")
        await require_member(store, game, by_user)

    reason = {"value": None}

    async def due(game: dict) -> str | None:
        deadline = parse_time(game["turn_deadline"])
        if deadline and utcnow() >= deadline:
            return "timeout"
        awaiting = game["awaiting_user_id"]
        if awaiting:
            seen = await store.get_presence(game["room_id"], awaiting)
            if seen is None or utcnow() - seen > timedelta(seconds=grace_seconds):
                return "disconnected"
        return None

    for _ in range(MAX_ATTEMPTS):
        game = await store.get_game(game_id)
        if not game or game["status"] != "playing":
            return {"events": [], "applied": False}
        reason["value"] = await due(game)
        if not reason["value"]:
            return {"events": [], "applied": False}

        session = GameSession.load(await store.get_secret(game_id))
        if not session.awaiting:
            return {"events": [], "applied": False}
        session.auto_play(reason["value"])
        events = session.drain_events()
        if await store.commit_game(game_id, game["version"], **finalize(session, events)):
            return {"events": public_events(events, game_id), "applied": True}
    return {"events": [], "applied": False}


async def abandon(store, game_id: str) -> list[dict]:
    """Ninguém está mais na partida: encerra sem vencedor e sem pontuar para ninguém."""

    def change(session: GameSession, game: dict):
        if session.is_over:
            return False
        session.abandon()

    try:
        return await _mutate(store, game_id, change)
    except ApiError as error:
        if error.code in ("GAME_OVER", "GAME_NOT_FOUND"):
            return []
        raise


async def forfeit(store, game_id: str, user_id: str) -> list[dict]:
    """O jogador saiu da sala durante a partida."""

    def change(session: GameSession, game: dict):
        seat = session.seat_of(user_id)
        if seat is None or seat in session.data["absent"]:
            return False
        session.mark_absent(seat)

    try:
        return await _mutate(store, game_id, change)
    except ApiError as error:
        if error.code in ("GAME_OVER", "GAME_NOT_FOUND"):
            return []
        raise
