"""Perfis, preferências, estatísticas, histórico e ranking."""

from __future__ import annotations

import re

from ..config import AVATARS
from ..errors import ApiError
from . import rooms

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")

DEFAULT_SETTINGS = {
    "volume": 0.6,
    "sound": True,
    "animationSpeed": 1,
    "reducedMotion": False,
    "showRisk": True,
    "confirmStay": False,
}
SPEEDS = (1, 1.5, 2)


def validate_username(username: str) -> str:
    username = (username or "").strip()
    if not USERNAME_RE.match(username):
        raise ApiError(
            422, "INVALID_USERNAME", "O nome de usuário deve ter de 3 a 20 letras, números ou _."
        )
    return username


def clean_settings(raw: dict) -> dict:
    """Aceita apenas as preferências conhecidas, com valores válidos."""
    settings = dict(DEFAULT_SETTINGS)
    raw = raw or {}
    if isinstance(raw.get("volume"), (int, float)) and not isinstance(raw.get("volume"), bool):
        settings["volume"] = round(min(1.0, max(0.0, float(raw["volume"]))), 2)
    for key in ("sound", "reducedMotion", "showRisk", "confirmStay"):
        if isinstance(raw.get(key), bool):
            settings[key] = raw[key]
    if raw.get("animationSpeed") in SPEEDS:
        settings["animationSpeed"] = raw["animationSpeed"]
    return settings


def serialize_stats(stats: dict) -> dict:
    played = stats["games_played"]
    return {
        "gamesPlayed": played,
        "wins": stats["wins"],
        "losses": stats["losses"],
        "winRate": round(100 * stats["wins"] / played) if played else 0,
        "totalPoints": stats["total_points"],
        "averageScore": round(stats["total_points"] / played) if played else 0,
        "bestGameScore": stats["best_game_score"],
        "bestRoundScore": stats["best_round_score"],
        "roundsPlayed": stats["rounds_played"],
        "flip7Count": stats["flip7_count"],
        "busts": stats["busts"],
        "currentStreak": stats["current_streak"],
        "bestStreak": stats["best_streak"],
    }


def serialize_profile(profile: dict) -> dict:
    return {
        "id": profile["id"],
        "username": profile["username"],
        "avatar": profile["avatar"],
        "createdAt": profile.get("created_at"),
    }


def serialize_match(match: dict) -> dict:
    def player(row: dict) -> dict:
        return {
            "name": row["name"], "userId": row["user_id"], "isBot": row["is_bot"], "score": row["score"],
            "placement": row["placement"], "isWinner": row["is_winner"], "forfeited": row["forfeited"],
            "flip7Count": row["flip7_count"], "busts": row["busts"], "bestRound": row["best_round"],
        }

    game = match["game"]
    return {
        "gameId": game["id"],
        "finishedAt": game.get("finished_at") or match["me"].get("created_at"),
        "targetScore": game.get("target_score"),
        "rounds": match["me"]["rounds_played"],
        "finishReason": game.get("finish_reason"),
        "winnerName": game.get("winner_name"),
        "me": player(match["me"]),
        "players": [player(row) for row in match["players"]],
    }


async def _require_profile(store, user_id: str) -> dict:
    profile = await store.get_profile(user_id)
    if not profile:
        raise ApiError(404, "PROFILE_NOT_FOUND", "Perfil não encontrado.")
    return profile


async def me(store, user) -> dict:
    profile = await _require_profile(store, user.id)
    membership = await store.active_membership(user.id)
    return {
        "user": {"id": user.id, "email": user.email},
        "profile": serialize_profile(profile),
        "stats": serialize_stats(await store.get_stats(user.id)),
        "settings": clean_settings(await store.get_settings(user.id)),
        "activeRoom": rooms.serialize_room(membership["room"]) if membership else None,
    }


async def update_me(store, user_id: str, username: str | None, avatar: str | None) -> dict:
    fields = {}
    if username is not None:
        fields["username"] = validate_username(username)
        if await store.username_taken(fields["username"], exclude=user_id):
            raise ApiError(409, "USERNAME_TAKEN", "Esse nome de usuário já está em uso.")
    if avatar is not None:
        if avatar not in AVATARS:
            raise ApiError(422, "INVALID_AVATAR", "Personagem desconhecido.")
        fields["avatar"] = avatar
    profile = await store.update_profile(user_id, fields) if fields else await _require_profile(store, user_id)
    return serialize_profile(profile)


async def save_settings(store, user_id: str, raw: dict) -> dict:
    return await store.save_settings(user_id, clean_settings(raw))


async def username_available(store, username: str) -> dict:
    try:
        username = validate_username(username)
    except ApiError as error:
        return {"available": False, "reason": error.message}
    taken = await store.username_taken(username)
    return {"available": not taken, "reason": "Esse nome de usuário já está em uso." if taken else None}


async def matches(store, user_id: str, limit: int, offset: int) -> dict:
    rows = await store.list_matches(user_id, limit, offset)
    return {"matches": [serialize_match(row) for row in rows], "hasMore": len(rows) == limit}


async def public_profile(store, username: str) -> dict:
    # Só nomes válidos chegam ao banco: o resto não pode existir.
    profile = await store.get_profile_by_username(username) if USERNAME_RE.match(username or "") else None
    if not profile:
        raise ApiError(404, "PROFILE_NOT_FOUND", "Jogador não encontrado.")
    recent = await store.list_matches(profile["id"], 5, 0)
    return {
        "profile": serialize_profile(profile),
        "stats": serialize_stats(await store.get_stats(profile["id"])),
        "recentMatches": [serialize_match(row) for row in recent],
    }


async def leaderboard(store, limit: int) -> dict:
    rows = await store.leaderboard(limit)
    return {
        "players": [
            {
                "position": index + 1, "userId": row["user_id"], "username": row["username"],
                "avatar": row["avatar"], "gamesPlayed": row["games_played"], "wins": row["wins"],
                "losses": row["losses"], "winRate": row["win_rate"], "totalPoints": row["total_points"],
                "bestGameScore": row["best_game_score"], "flip7Count": row["flip7_count"],
                "bestStreak": row["best_streak"],
            }
            for index, row in enumerate(rows)
        ]
    }
