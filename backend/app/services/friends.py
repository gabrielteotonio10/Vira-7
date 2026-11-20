"""Amigos: pedidos, lista com a sala de cada um e filtro do ranking."""

from __future__ import annotations

from ..errors import ApiError
from . import profiles

MAX_FRIENDS = 100


def _public(profile: dict) -> dict:
    return {"userId": profile["id"], "username": profile["username"], "avatar": profile["avatar"] or "raposa"}


async def _relations(store, user_id: str) -> dict:
    """Agrupa as linhas de `friendships` do ponto de vista de `user_id`."""
    rows = await store.list_friendships(user_id)
    other_ids = {r["addressee_id"] if r["requester_id"] == user_id else r["requester_id"] for r in rows}
    profile_by_id = await store.get_profiles(list(other_ids))
    friends, incoming, outgoing = [], [], []
    for row in rows:
        mine = row["requester_id"] == user_id
        other = row["addressee_id"] if mine else row["requester_id"]
        profile = profile_by_id.get(other)
        if not profile:
            continue
        if row["status"] == "accepted":
            friends.append(profile)
        elif mine:
            outgoing.append(profile)
        else:
            incoming.append(profile)
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}


async def friend_ids(store, user_id: str) -> list[str]:
    return [p["id"] for p in (await _relations(store, user_id))["friends"]]


def _friend_room(room: dict | None) -> dict | None:
    """A sala em que o amigo está, se dá para entrar nela (jogando ou assistindo)."""
    if not room:
        return None
    full = room["player_count"] >= room["max_players"]
    return {
        "code": room["code"],
        "name": room["name"],
        "status": room["status"],
        "playerCount": room["player_count"],
        "maxPlayers": room["max_players"],
        # Sala cheia ou em andamento: a pessoa entra como espectadora.
        "mode": "watch" if full or room["status"] != "lobby" else "play",
    }


async def overview(store, user_id: str) -> dict:
    relations = await _relations(store, user_id)
    # Uma consulta para as salas de todos os amigos (em vez de duas por amigo).
    rooms_by_user = await store.rooms_of_users([p["id"] for p in relations["friends"]])
    friends = []
    for profile in sorted(relations["friends"], key=lambda p: p["username"].lower()):
        entry = _public(profile)
        entry["room"] = _friend_room(rooms_by_user.get(profile["id"]))
        friends.append(entry)
    return {
        "friends": friends,
        "incoming": [_public(p) for p in relations["incoming"]],
        "outgoing": [_public(p) for p in relations["outgoing"]],
    }


async def request(store, user_id: str, username: str) -> dict:
    username = (username or "").strip().lstrip("@")
    target = await store.get_profile_by_username(username) if profiles.USERNAME_RE.match(username) else None
    if not target:
        raise ApiError(404, "PROFILE_NOT_FOUND", "Jogador não encontrado. Confira o nome de usuário.")
    if target["id"] == user_id:
        raise ApiError(400, "FRIEND_SELF", "Você não pode adicionar a si mesmo.")

    existing = await store.get_friendship(user_id, target["id"])
    if existing:
        if existing["status"] == "accepted":
            raise ApiError(409, "ALREADY_FRIENDS", f"Você e {target['username']} já são amigos.")
        if existing["requester_id"] == user_id:
            raise ApiError(409, "FRIEND_REQUEST_EXISTS", "Você já enviou um pedido para essa pessoa.")
        # A outra pessoa já tinha pedido: aceitar é o que se quer.
        await store.accept_friendship(existing["id"])
        return {"status": "accepted", **await overview(store, user_id)}

    if len((await _relations(store, user_id))["friends"]) >= MAX_FRIENDS:
        raise ApiError(409, "TOO_MANY_FRIENDS", f"O limite é de {MAX_FRIENDS} amigos.")
    await store.create_friend_request(user_id, target["id"])
    return {"status": "pending", **await overview(store, user_id)}


async def accept(store, user_id: str, other_id: str) -> dict:
    row = await store.get_friendship(user_id, other_id)
    if not row or row["status"] != "pending" or row["addressee_id"] != user_id:
        raise ApiError(404, "FRIEND_REQUEST_NOT_FOUND", "Esse pedido de amizade não existe mais.")
    await store.accept_friendship(row["id"])
    return await overview(store, user_id)


async def remove(store, user_id: str, other_id: str) -> dict:
    """Desfaz a amizade, recusa um pedido recebido ou cancela um pedido enviado."""
    row = await store.get_friendship(user_id, other_id)
    if row:
        await store.delete_friendship(row["id"])
    return await overview(store, user_id)
