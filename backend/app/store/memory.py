"""Banco em memória com o mesmo comportamento das funções SQL.

Usado pelos testes automatizados e pelo modo de desenvolvimento local (sem Supabase).
Os dados somem quando o processo termina.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import random
import re
import secrets
import uuid
from datetime import datetime, timezone

from ..config import AVATARS
from ..errors import StoreError

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def new_stats(user_id: str) -> dict:
    return {
        "user_id": user_id, "games_played": 0, "wins": 0, "losses": 0, "total_points": 0,
        "best_game_score": 0, "best_round_score": 0, "rounds_played": 0, "flip7_count": 0,
        "busts": 0, "current_streak": 0, "best_streak": 0,
    }


class MemoryStore:
    def __init__(self) -> None:
        self.users: dict[str, dict] = {}  # login local (modo de desenvolvimento)
        self.profiles: dict[str, dict] = {}
        self.settings: dict[str, dict] = {}
        self.stats: dict[str, dict] = {}
        self.rooms: dict[str, dict] = {}
        self.players: dict[str, dict] = {}
        self.presence: dict[tuple[str, str], datetime] = {}
        self.games: dict[str, dict] = {}
        self.secrets: dict[str, dict] = {}
        self.events: dict[str, list[dict]] = {}
        self.results: list[dict] = []
        self._lock = asyncio.Lock()

    async def close(self) -> None:
        return None

    # ------------------------------------------------------------------ contas

    def _username_free(self, username: str, exclude: str | None = None) -> bool:
        return not any(
            p["username"].lower() == username.lower() and p["id"] != exclude for p in self.profiles.values()
        )

    def create_profile(self, user_id: str, username: str = "", avatar: str = "raposa") -> dict:
        """Equivale ao trigger `handle_new_user`."""
        if not USERNAME_RE.match(username or "") or not self._username_free(username):
            attempt = 0
            while True:
                attempt += 1
                username = "jogador_" + hashlib.md5(f"{user_id}{attempt}".encode()).hexdigest()[:6]
                if self._username_free(username):
                    break
        profile = {
            "id": user_id,
            "username": username,
            "avatar": avatar if avatar in AVATARS else "raposa",
            "created_at": iso(now()),
        }
        self.profiles[user_id] = profile
        self.settings[user_id] = {}
        self.stats[user_id] = new_stats(user_id)
        return profile

    async def dev_create_user(self, email: str, password: str, username: str, avatar: str) -> dict:
        email = email.strip().lower()
        if any(u["email"] == email for u in self.users.values()):
            raise StoreError("EMAIL_TAKEN")
        if not self._username_free(username):
            raise StoreError("USERNAME_TAKEN")
        user_id = str(uuid.uuid4())
        salt = secrets.token_bytes(16)
        self.users[user_id] = {
            "id": user_id,
            "email": email,
            "salt": salt,
            "hash": hashlib.scrypt(password.encode(), salt=salt, n=2**12, r=8, p=1),
        }
        self.create_profile(user_id, username, avatar)
        return {"id": user_id, "email": email}

    async def dev_check_password(self, email: str, password: str) -> dict | None:
        email = email.strip().lower()
        for user in self.users.values():
            if user["email"] == email:
                digest = hashlib.scrypt(password.encode(), salt=user["salt"], n=2**12, r=8, p=1)
                if secrets.compare_digest(digest, user["hash"]):
                    return {"id": user["id"], "email": email}
        return None

    # ------------------------------------------------------------------ perfis

    async def get_profile(self, user_id: str) -> dict | None:
        return copy.deepcopy(self.profiles.get(user_id))

    async def get_profile_by_username(self, username: str) -> dict | None:
        for profile in self.profiles.values():
            if profile["username"].lower() == username.lower():
                return copy.deepcopy(profile)
        return None

    async def username_taken(self, username: str, exclude: str | None = None) -> bool:
        return not self._username_free(username, exclude)

    async def update_profile(self, user_id: str, fields: dict) -> dict:
        profile = self.profiles[user_id]
        if "username" in fields and not self._username_free(fields["username"], user_id):
            raise StoreError("USERNAME_TAKEN")
        profile.update(fields)
        return copy.deepcopy(profile)

    async def get_settings(self, user_id: str) -> dict:
        return copy.deepcopy(self.settings.get(user_id, {}))

    async def save_settings(self, user_id: str, settings: dict) -> dict:
        self.settings[user_id] = copy.deepcopy(settings)
        return copy.deepcopy(settings)

    async def get_stats(self, user_id: str) -> dict:
        return copy.deepcopy(self.stats.get(user_id) or new_stats(user_id))

    async def leaderboard(self, limit: int = 20) -> list[dict]:
        rows = []
        for stats in self.stats.values():
            if stats["games_played"] <= 0:
                continue
            profile = self.profiles[stats["user_id"]]
            rows.append(
                {
                    "user_id": profile["id"], "username": profile["username"], "avatar": profile["avatar"],
                    "games_played": stats["games_played"], "wins": stats["wins"], "losses": stats["losses"],
                    "total_points": stats["total_points"], "best_game_score": stats["best_game_score"],
                    "flip7_count": stats["flip7_count"], "best_streak": stats["best_streak"],
                    "win_rate": round(100 * stats["wins"] / stats["games_played"]),
                }
            )
        rows.sort(key=lambda r: (-r["wins"], -r["total_points"], r["username"]))
        return rows[:limit]

    async def list_matches(self, user_id: str, limit: int = 20, offset: int = 0) -> list[dict]:
        mine = [r for r in self.results if r["user_id"] == user_id]
        mine.sort(key=lambda r: r["created_at"], reverse=True)
        matches = []
        for result in mine[offset: offset + limit]:
            game = self.games[result["game_id"]]
            matches.append(
                {
                    "game": {
                        key: game[key]
                        for key in ("id", "target_score", "round", "finish_reason", "winner_name", "finished_at")
                    },
                    "me": copy.deepcopy(result),
                    "players": sorted(
                        (copy.deepcopy(r) for r in self.results if r["game_id"] == result["game_id"]),
                        key=lambda r: r["placement"],
                    ),
                }
            )
        return matches

    # ------------------------------------------------------------------ salas

    def _joined(self, room_id: str) -> list[dict]:
        return sorted(
            (p for p in self.players.values() if p["room_id"] == room_id and p["status"] == "joined"),
            key=lambda p: p["seat"],
        )

    def _in_any_room(self, user_id: str) -> bool:
        return any(p["user_id"] == user_id and p["status"] == "joined" for p in self.players.values())

    def _free_seat(self, room: dict) -> int | None:
        taken = {p["seat"] for p in self._joined(room["id"])}
        return next((seat for seat in range(room["max_players"]) if seat not in taken), None)

    def _touch(self, room: dict) -> None:
        room["updated_at"] = iso(now())

    async def create_room(self, host_id, name, visibility, mode, max_players, target_score, turn_seconds) -> dict:
        async with self._lock:
            if self._in_any_room(host_id):
                raise StoreError("ALREADY_IN_ROOM")
            codes = {r["code"] for r in self.rooms.values()}
            while True:
                code = "".join(random.choice(CODE_ALPHABET) for _ in range(6))
                if code not in codes:
                    break
            room = {
                "id": str(uuid.uuid4()), "code": code, "name": name, "host_id": host_id,
                "visibility": visibility, "mode": mode, "status": "lobby", "max_players": max_players,
                "target_score": target_score, "turn_seconds": turn_seconds, "current_game_id": None,
                "created_at": iso(now()), "updated_at": iso(now()),
            }
            self.rooms[room["id"]] = room
            self._add_player(room["id"], user_id=host_id, seat=0)
            return copy.deepcopy(room)

    def _add_player(self, room_id, *, seat, user_id=None, bot_name=None, bot_avatar=None) -> dict:
        player = {
            "id": str(uuid.uuid4()), "room_id": room_id, "user_id": user_id, "is_bot": user_id is None,
            "bot_name": bot_name, "bot_avatar": bot_avatar, "seat": seat, "is_ready": user_id is None,
            "status": "joined", "joined_at": iso(now()),
        }
        self.players[player["id"]] = player
        if user_id:
            self.presence[(room_id, user_id)] = now()
        return player

    async def get_room(self, room_id: str) -> dict | None:
        return copy.deepcopy(self.rooms.get(room_id))

    async def get_room_by_code(self, code: str) -> dict | None:
        for room in self.rooms.values():
            if room["code"] == code:
                return copy.deepcopy(room)
        return None

    async def update_room(self, room_id: str, fields: dict) -> dict:
        room = self.rooms[room_id]
        room.update(fields)
        self._touch(room)
        return copy.deepcopy(room)

    async def list_public_rooms(self, limit: int = 30) -> list[dict]:
        rooms = [r for r in self.rooms.values() if r["visibility"] == "public" and r["status"] == "lobby"]
        rooms.sort(key=lambda r: r["created_at"], reverse=True)
        out = []
        for room in rooms[:limit]:
            row = copy.deepcopy(room)
            row["player_count"] = len(self._joined(room["id"]))
            row["host_name"] = self.profiles[room["host_id"]]["username"]
            row["host_avatar"] = self.profiles[room["host_id"]]["avatar"]
            out.append(row)
        return out

    async def find_quick_room(self) -> dict | None:
        candidates = [
            r for r in self.rooms.values()
            if r["visibility"] == "public" and r["mode"] == "quick" and r["status"] == "lobby"
            and len(self._joined(r["id"])) < r["max_players"]
        ]
        candidates.sort(key=lambda r: r["created_at"])
        return copy.deepcopy(candidates[0]) if candidates else None

    async def active_membership(self, user_id: str) -> dict | None:
        for player in self.players.values():
            if player["user_id"] == user_id and player["status"] == "joined":
                return {"room": copy.deepcopy(self.rooms[player["room_id"]]), "player": copy.deepcopy(player)}
        return None

    async def join_room(self, room_id: str, user_id: str) -> dict:
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room:
                raise StoreError("ROOM_NOT_FOUND")
            existing = next(
                (p for p in self.players.values() if p["room_id"] == room_id and p["user_id"] == user_id), None
            )
            if existing and existing["status"] == "joined":
                return copy.deepcopy(existing)
            if room["status"] != "lobby":
                raise StoreError("ROOM_NOT_OPEN")
            if self._in_any_room(user_id):
                raise StoreError("ALREADY_IN_ROOM")
            seat = self._free_seat(room)
            if seat is None:
                raise StoreError("ROOM_FULL")
            if existing:
                existing.update(status="joined", seat=seat, is_ready=False, joined_at=iso(now()))
                self.presence[(room_id, user_id)] = now()
                player = existing
            else:
                player = self._add_player(room_id, user_id=user_id, seat=seat)
            self._touch(room)
            return copy.deepcopy(player)

    async def add_bot(self, room_id: str, name: str, avatar: str) -> dict:
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room:
                raise StoreError("ROOM_NOT_FOUND")
            if room["status"] != "lobby":
                raise StoreError("ROOM_NOT_OPEN")
            seat = self._free_seat(room)
            if seat is None:
                raise StoreError("ROOM_FULL")
            self._touch(room)
            return copy.deepcopy(self._add_player(room_id, seat=seat, bot_name=name, bot_avatar=avatar))

    async def remove_bot(self, room_id: str, player_id: str) -> bool:
        player = self.players.get(player_id)
        if not player or player["room_id"] != room_id or not player["is_bot"] or player["status"] != "joined":
            return False
        player["status"] = "left"
        self._touch(self.rooms[room_id])
        return True

    async def leave_room(self, room_id: str, user_id: str) -> dict:
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room:
                raise StoreError("ROOM_NOT_FOUND")
            player = next(
                (p for p in self._joined(room_id) if p["user_id"] == user_id), None
            )
            if not player:
                return {"left": False, "closed": room["status"] == "closed", "host_id": room["host_id"]}
            player.update(status="left", is_ready=False)
            self.presence.pop((room_id, user_id), None)

            humans = sorted(
                (p for p in self._joined(room_id) if not p["is_bot"]), key=lambda p: (p["joined_at"], p["seat"])
            )
            closed = not humans
            if closed:
                room["status"] = "closed"
                for other in self._joined(room_id):
                    other["status"] = "left"
            elif room["host_id"] == user_id:
                room["host_id"] = humans[0]["user_id"]
            self._touch(room)
            return {"left": True, "closed": closed, "host_id": None if closed else room["host_id"]}

    async def list_players(self, room_id: str) -> list[dict]:
        out = []
        for player in self._joined(room_id):
            row = copy.deepcopy(player)
            profile = self.profiles.get(player["user_id"]) if player["user_id"] else None
            row["username"] = profile["username"] if profile else player["bot_name"]
            row["avatar"] = profile["avatar"] if profile else player["bot_avatar"]
            row["last_seen_at"] = iso(self.presence.get((room_id, player["user_id"])))
            out.append(row)
        return out

    async def set_ready(self, room_id: str, user_id: str, ready: bool) -> bool:
        for player in self._joined(room_id):
            if player["user_id"] == user_id:
                player["is_ready"] = ready
                return True
        return False

    async def touch_presence(self, room_id: str, user_id: str) -> None:
        self.presence[(room_id, user_id)] = now()

    async def get_presence(self, room_id: str, user_id: str) -> datetime | None:
        return self.presence.get((room_id, user_id))

    # ------------------------------------------------------------------ partidas

    async def start_game(self, room_id, player_ids, public_state, secret, events, awaiting_user_id, deadline):
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room or room["status"] != "lobby":
                return None
            if [p["id"] for p in self._joined(room_id)] != list(player_ids):
                return None
            game = {
                "id": str(uuid.uuid4()), "room_id": room_id, "status": "playing", "version": 1,
                "target_score": room["target_score"], "turn_seconds": room["turn_seconds"],
                "round": public_state.get("round", 1), "last_seq": public_state.get("seq", 0),
                "public_state": copy.deepcopy(public_state), "awaiting_user_id": awaiting_user_id,
                "turn_deadline": deadline, "winner_user_id": None, "winner_name": None,
                "finish_reason": None, "started_at": iso(now()), "finished_at": None,
            }
            self.games[game["id"]] = game
            self.secrets[game["id"]] = copy.deepcopy(secret)
            self.events[game["id"]] = []
            self._insert_events(game, events)
            room.update(status="playing", current_game_id=game["id"])
            self._touch(room)
            return game["id"]

    def _insert_events(self, game: dict, events: list[dict]) -> None:
        stored = self.events[game["id"]]
        seqs = {e["seq"] for e in stored}
        for event in events:
            if event["seq"] in seqs:
                raise RuntimeError("game_events_game_seq_key")
            stored.append(
                {**copy.deepcopy(event), "game_id": game["id"], "room_id": game["room_id"], "created_at": iso(now())}
            )

    async def get_game(self, game_id: str) -> dict | None:
        return copy.deepcopy(self.games.get(game_id))

    async def get_secret(self, game_id: str) -> dict | None:
        return copy.deepcopy(self.secrets.get(game_id))

    async def commit_game(self, game_id, expected_version, public_state, secret, events, awaiting_user_id,
                          deadline, status, results, winner_user_id, winner_name, finish_reason) -> bool:
        async with self._lock:
            game = self.games.get(game_id)
            if not game or game["version"] != expected_version or game["status"] != "playing":
                return False
            game.update(
                version=game["version"] + 1, public_state=copy.deepcopy(public_state),
                round=public_state.get("round", game["round"]), last_seq=public_state.get("seq", game["last_seq"]),
                awaiting_user_id=awaiting_user_id, turn_deadline=deadline, status=status,
                winner_user_id=winner_user_id, winner_name=winner_name, finish_reason=finish_reason,
                finished_at=None if status == "playing" else iso(now()),
            )
            self.secrets[game_id] = copy.deepcopy(secret)
            self._insert_events(game, events)

            if status != "playing":
                for result in results or []:
                    self._insert_result(game_id, result)
                room = self.rooms[game["room_id"]]
                joined = self._joined(room["id"])
                for player in joined:
                    player["is_ready"] = player["is_bot"]
                if room["status"] == "playing":
                    room["status"] = "lobby" if any(not p["is_bot"] for p in joined) else "closed"
                    room["current_game_id"] = None
                self._touch(room)
            return True

    def _insert_result(self, game_id: str, r: dict) -> None:
        row = {
            "game_id": game_id, "user_id": r.get("userId"), "seat": r["seat"], "name": r["name"],
            "is_bot": bool(r.get("isBot")), "score": r["score"], "placement": r["placement"],
            "is_winner": bool(r.get("isWinner")), "forfeited": bool(r.get("forfeited")),
            "rounds_played": r.get("roundsPlayed", 0), "best_round": r.get("bestRound", 0),
            "flip7_count": r.get("flip7Count", 0), "busts": r.get("busts", 0), "created_at": iso(now()),
        }
        self.results.append(row)
        # Equivale ao trigger `apply_game_result`.
        if row["user_id"] and not row["is_bot"]:
            s = self.stats.setdefault(row["user_id"], new_stats(row["user_id"]))
            won = row["is_winner"]
            s["games_played"] += 1
            s["wins"] += 1 if won else 0
            s["losses"] += 0 if won else 1
            s["total_points"] += max(row["score"], 0)
            s["best_game_score"] = max(s["best_game_score"], row["score"])
            s["best_round_score"] = max(s["best_round_score"], row["best_round"])
            s["rounds_played"] += row["rounds_played"]
            s["flip7_count"] += row["flip7_count"]
            s["busts"] += row["busts"]
            s["current_streak"] = s["current_streak"] + 1 if won else 0
            s["best_streak"] = max(s["best_streak"], s["current_streak"])

    async def list_events(self, game_id: str, after: int = 0) -> list[dict]:
        events = [e for e in self.events.get(game_id, []) if e["seq"] > after]
        return copy.deepcopy(sorted(events, key=lambda e: e["seq"]))

    async def list_playing_games(self) -> list[dict]:
        return [
            {key: g[key] for key in ("id", "room_id", "version", "awaiting_user_id", "turn_deadline")}
            for g in self.games.values() if g["status"] == "playing"
        ]
