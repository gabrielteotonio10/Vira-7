"""Chat rápido da sala: só mensagens prontas e emojis (nada de texto livre).

As mensagens ficam na memória do processo, em uma fila curta por sala: servem para
conversar durante a partida e não precisam sobreviver a um reinício. O servidor valida
a chave recebida, então ninguém consegue enviar outra coisa que não seja uma opção da lista.
"""

from __future__ import annotations

from collections import deque
from time import monotonic

from ..errors import ApiError

#: Frases prontas. O texto de cada uma é traduzido pelo cliente.
PHRASES = ("good", "risk", "nice", "oops", "hurry", "gg", "wow", "rematch")
EMOJIS = ("😂", "😮", "🔥", "👏", "😭", "😎", "🍀", "💀")

KEEP = 60
MIN_GAP_SECONDS = 0.8

_rooms: dict[str, dict] = {}


def _state(room_id: str) -> dict:
    return _rooms.setdefault(room_id, {"seq": 0, "messages": deque(maxlen=KEEP), "last": {}})


def post(room_id: str, user_id: str, name: str, avatar: str, kind: str, key: str) -> dict:
    if kind == "say" and key not in PHRASES:
        raise ApiError(422, "INVALID_MESSAGE", "Mensagem desconhecida.")
    if kind == "emoji" and key not in EMOJIS:
        raise ApiError(422, "INVALID_MESSAGE", "Emoji desconhecido.")
    if kind not in ("say", "emoji"):
        raise ApiError(422, "INVALID_MESSAGE", "Mensagem desconhecida.")

    state = _state(room_id)
    now = monotonic()
    if now - state["last"].get(user_id, -10) < MIN_GAP_SECONDS:
        raise ApiError(429, "CHAT_TOO_FAST", "Calma! Espere um instante para enviar outra.")
    state["last"][user_id] = now
    state["seq"] += 1
    message = {
        "seq": state["seq"], "userId": user_id, "name": name, "avatar": avatar, "kind": kind, "key": key,
    }
    state["messages"].append(message)
    return message


def since(room_id: str, after: int) -> dict:
    state = _rooms.get(room_id)
    if not state:
        return {"messages": [], "seq": 0}
    return {"messages": [m for m in state["messages"] if m["seq"] > after], "seq": state["seq"]}


def clear(room_id: str) -> None:
    _rooms.pop(room_id, None)
