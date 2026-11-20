"""Acesso ao PostgreSQL do Supabase pela API REST (PostgREST), com a service role.

A service role ignora o RLS, por isso esta chave vive SOMENTE no servidor. As
operações que precisam ser atômicas chamam as funções `vira7_*` das migrations.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx

from ..errors import StoreError


def like_exact(value: str) -> str:
    """Valor para `ilike` que casa só com o texto exato, ignorando maiúsculas.

    No LIKE, `_` e `%` são curingas (e o PostgREST também trata `*` assim): sem escapar,
    o nome `gabriel_7` casaria com `gabrielx7`. A barra invertida é o escape padrão.
    """
    for char in ("\\", "%", "_", "*"):
        value = value.replace(char, "\\" + char)
    return value


KNOWN_ERRORS = ("ROOM_NOT_FOUND", "ROOM_FULL", "ROOM_NOT_OPEN", "ALREADY_IN_ROOM")
ROOM_COLUMNS = (
    "id,code,name,host_id,visibility,mode,status,max_players,target_score,turn_seconds,"
    "current_game_id,created_at,updated_at,team_mode"
)


class SupabaseStore:
    def __init__(self, url: str, service_key: str, http: httpx.AsyncClient | None = None) -> None:
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }
        self.http = http or httpx.AsyncClient(timeout=15)

    async def close(self) -> None:
        await self.http.aclose()

    # ------------------------------------------------------------------ HTTP

    async def _request(self, method: str, path: str, *, params=None, json=None, prefer: str | None = None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        response = await self.http.request(method, f"{self.base}/{path}", params=params, json=json, headers=headers)
        if response.status_code >= 400:
            self._raise(response)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    @staticmethod
    def _raise(response: httpx.Response) -> None:
        try:
            body = response.json()
        except ValueError:
            body = {}
        message = str(body.get("message", ""))
        for code in KNOWN_ERRORS:
            if code in message:
                raise StoreError(code)
        if body.get("code") == "23505":  # unique_violation
            if "username" in message:
                raise StoreError("USERNAME_TAKEN")
            if "one_active_room" in message:
                raise StoreError("ALREADY_IN_ROOM")
        raise RuntimeError(f"Supabase respondeu {response.status_code}: {message or response.text[:200]}")

    async def _select(self, table: str, params: dict) -> list[dict]:
        return await self._request("GET", table, params=params) or []

    async def _first(self, table: str, params: dict) -> dict | None:
        rows = await self._select(table, {**params, "limit": "1"})
        return rows[0] if rows else None

    async def _rpc(self, function: str, args: dict):
        return await self._request("POST", f"rpc/{function}", json=args)

    # ------------------------------------------------------------------ perfis

    async def get_profile(self, user_id: str) -> dict | None:
        return await self._first("profiles", {"id": f"eq.{user_id}", "select": "id,username,avatar,created_at"})

    async def get_profile_by_username(self, username: str) -> dict | None:
        return await self._first(
            "profiles", {"username": f"ilike.{like_exact(username)}", "select": "id,username,avatar,created_at"}
        )

    async def username_taken(self, username: str, exclude: str | None = None) -> bool:
        params = {"username": f"ilike.{like_exact(username)}", "select": "id"}
        if exclude:
            params["id"] = f"neq.{exclude}"
        return await self._first("profiles", params) is not None

    async def update_profile(self, user_id: str, fields: dict) -> dict:
        rows = await self._request(
            "PATCH", "profiles", params={"id": f"eq.{user_id}"}, json=fields, prefer="return=representation"
        )
        return rows[0]

    async def get_settings(self, user_id: str) -> dict:
        row = await self._first("user_settings", {"user_id": f"eq.{user_id}", "select": "settings"})
        return row["settings"] if row else {}

    async def save_settings(self, user_id: str, settings: dict) -> dict:
        await self._request(
            "POST", "user_settings", params={"on_conflict": "user_id"},
            json={"user_id": user_id, "settings": settings}, prefer="resolution=merge-duplicates",
        )
        return settings

    async def get_stats(self, user_id: str) -> dict:
        row = await self._first("player_stats", {"user_id": f"eq.{user_id}", "select": "*"})
        if row:
            return row
        from .memory import new_stats

        return new_stats(user_id)

    async def leaderboard(self, limit: int = 20, user_ids: list[str] | None = None) -> list[dict]:
        params = {"select": "*", "order": "wins.desc,total_points.desc,username.asc", "limit": str(limit)}
        if user_ids is not None:
            if not user_ids:
                return []
            params["user_id"] = f"in.({','.join(user_ids)})"
        return await self._select("leaderboard", params)

    async def get_profiles(self, user_ids: list[str]) -> dict[str, dict]:
        if not user_ids:
            return {}
        rows = await self._select(
            "profiles", {"id": f"in.({','.join(user_ids)})", "select": "id,username,avatar,created_at"}
        )
        return {row["id"]: row for row in rows}

    # ------------------------------------------------------------------ amigos

    async def get_friendship(self, a: str, b: str) -> dict | None:
        return await self._first(
            "friendships",
            {
                "or": f"(and(requester_id.eq.{a},addressee_id.eq.{b}),and(requester_id.eq.{b},addressee_id.eq.{a}))",
                "select": "id,requester_id,addressee_id,status,created_at",
            },
        )

    async def list_friendships(self, user_id: str) -> list[dict]:
        return await self._select(
            "friendships",
            {
                "or": f"(requester_id.eq.{user_id},addressee_id.eq.{user_id})",
                "select": "id,requester_id,addressee_id,status,created_at", "limit": "500",
            },
        )

    async def create_friend_request(self, requester: str, addressee: str) -> dict:
        rows = await self._request(
            "POST", "friendships", json={"requester_id": requester, "addressee_id": addressee},
            prefer="return=representation",
        )
        return rows[0]

    async def accept_friendship(self, friendship_id: str) -> None:
        await self._request("PATCH", "friendships", params={"id": f"eq.{friendship_id}"}, json={"status": "accepted"})

    async def delete_friendship(self, friendship_id: str) -> None:
        await self._request("DELETE", "friendships", params={"id": f"eq.{friendship_id}"})

    # ------------------------------------------------------------------ espectadores

    async def add_spectator(self, room_id: str, user_id: str) -> None:
        # Uma pessoa assiste a uma sala por vez: entrar em outra troca a linha.
        await self._request(
            "POST", "room_spectators", params={"on_conflict": "user_id"},
            json={"room_id": room_id, "user_id": user_id}, prefer="resolution=merge-duplicates",
        )

    async def remove_spectator(self, user_id: str) -> bool:
        rows = await self._request(
            "DELETE", "room_spectators", params={"user_id": f"eq.{user_id}"}, prefer="return=representation"
        )
        return bool(rows)

    async def spectator_membership(self, user_id: str) -> dict | None:
        row = await self._first(
            "room_spectators", {"user_id": f"eq.{user_id}", "select": f"room:rooms({ROOM_COLUMNS})"}
        )
        room = (row or {}).get("room")
        if not room or room["status"] not in ("lobby", "playing"):
            return None
        return {"room": room, "player": None, "spectator": True}

    async def list_spectators(self, room_id: str) -> list[dict]:
        rows = await self._select(
            "room_spectators",
            {"room_id": f"eq.{room_id}", "order": "joined_at.asc", "select": "user_id,joined_at,profile:profiles(username,avatar)"},
        )
        out = []
        for row in rows:
            profile = row.pop("profile", None) or {}
            out.append({**row, "username": profile.get("username", "?"), "avatar": profile.get("avatar") or "raposa"})
        return out

    async def list_matches(self, user_id: str, limit: int = 20, offset: int = 0) -> list[dict]:
        mine = await self._select(
            "game_results",
            {
                "user_id": f"eq.{user_id}", "select": "*", "order": "created_at.desc",
                "limit": str(limit), "offset": str(offset),
            },
        )
        if not mine:
            return []
        ids = ",".join(row["game_id"] for row in mine)
        games = await self._select(
            "games", {"id": f"in.({ids})", "select": "id,target_score,round,finish_reason,winner_name,finished_at"}
        )
        everyone = await self._select("game_results", {"game_id": f"in.({ids})", "select": "*", "order": "placement"})
        by_id = {game["id"]: game for game in games}
        return [
            {
                "game": by_id.get(row["game_id"], {"id": row["game_id"]}),
                "me": row,
                "players": [r for r in everyone if r["game_id"] == row["game_id"]],
            }
            for row in mine
        ]

    # ------------------------------------------------------------------ salas

    async def create_room(self, host_id, name, visibility, mode, max_players, target_score, turn_seconds) -> dict:
        return await self._rpc(
            "vira7_create_room",
            {
                "p_host": host_id, "p_name": name, "p_visibility": visibility, "p_mode": mode,
                "p_max_players": max_players, "p_target_score": target_score, "p_turn_seconds": turn_seconds,
            },
        )

    async def get_room(self, room_id: str) -> dict | None:
        return await self._first("rooms", {"id": f"eq.{room_id}", "select": ROOM_COLUMNS})

    async def get_room_by_code(self, code: str) -> dict | None:
        return await self._first("rooms", {"code": f"eq.{code}", "select": ROOM_COLUMNS})

    async def update_room(self, room_id: str, fields: dict) -> dict:
        rows = await self._request(
            "PATCH", "rooms", params={"id": f"eq.{room_id}"}, json=fields, prefer="return=representation"
        )
        return rows[0]

    async def list_public_rooms(self, limit: int = 30) -> list[dict]:
        rooms = await self._select(
            "rooms",
            {
                "visibility": "eq.public", "status": "eq.lobby", "order": "created_at.desc", "limit": str(limit),
                "select": f"{ROOM_COLUMNS},host:profiles!rooms_host_id_fkey(username,avatar),"
                          "room_players(status)",
            },
        )
        for room in rooms:
            host = room.pop("host", None) or {}
            members = room.pop("room_players", None) or []
            room["host_name"] = host.get("username")
            room["host_avatar"] = host.get("avatar")
            room["player_count"] = sum(1 for m in members if m["status"] == "joined")
        return rooms

    async def find_quick_room(self) -> dict | None:
        rooms = await self._select(
            "rooms",
            {
                "visibility": "eq.public", "mode": "eq.quick", "status": "eq.lobby", "order": "created_at.asc",
                "limit": "20", "select": f"{ROOM_COLUMNS},room_players(status)",
            },
        )
        for room in rooms:
            members = room.pop("room_players", None) or []
            if sum(1 for m in members if m["status"] == "joined") < room["max_players"]:
                return room
        return None

    async def active_membership(self, user_id: str) -> dict | None:
        player = await self._first(
            "room_players", {"user_id": f"eq.{user_id}", "status": "eq.joined", "select": "*"}
        )
        if not player:
            return None
        room = await self.get_room(player["room_id"])
        return {"room": room, "player": player} if room else None

    async def join_room(self, room_id: str, user_id: str) -> dict:
        return await self._rpc("vira7_join_room", {"p_room": room_id, "p_user": user_id})

    async def add_bot(self, room_id: str, name: str, avatar: str) -> dict:
        return await self._rpc("vira7_add_bot", {"p_room": room_id, "p_name": name, "p_avatar": avatar})

    async def remove_bot(self, room_id: str, player_id: str) -> bool:
        rows = await self._request(
            "PATCH", "room_players",
            params={"id": f"eq.{player_id}", "room_id": f"eq.{room_id}", "is_bot": "eq.true", "status": "eq.joined"},
            json={"status": "left"}, prefer="return=representation",
        )
        if rows:
            await self._request("PATCH", "rooms", params={"id": f"eq.{room_id}"}, json={"updated_at": "now"})
        return bool(rows)

    async def leave_room(self, room_id: str, user_id: str) -> dict:
        return await self._rpc("vira7_leave_room", {"p_room": room_id, "p_user": user_id})

    async def close_room(self, room_id: str) -> None:
        await self._request(
            "PATCH", "rooms", params={"id": f"eq.{room_id}"},
            json={"status": "closed", "current_game_id": None, "updated_at": datetime.now(timezone.utc).isoformat()},
        )
        await self._request(
            "PATCH", "room_players", params={"room_id": f"eq.{room_id}", "status": "eq.joined"},
            json={"status": "left", "is_ready": False},
        )
        await self._request("DELETE", "player_presence", params={"room_id": f"eq.{room_id}"})
        await self._request("DELETE", "room_spectators", params={"room_id": f"eq.{room_id}"})

    async def list_open_rooms(self) -> list[dict]:
        rooms = await self._select(
            "rooms",
            {"status": "in.(lobby,playing)", "limit": "500", "select": f"{ROOM_COLUMNS},room_players(user_id,is_bot,status)"},
        )
        if not rooms:
            return []
        ids = ",".join(room["id"] for room in rooms)
        presence = await self._select(
            "player_presence", {"room_id": f"in.({ids})", "select": "room_id,user_id,last_seen_at"}
        )
        seen = {(row["room_id"], row["user_id"]): row["last_seen_at"] for row in presence}
        for room in rooms:
            members = room.pop("room_players", None) or []
            room["humans_seen"] = [
                seen.get((room["id"], m["user_id"]))
                for m in members if m["status"] == "joined" and not m["is_bot"]
            ]
        return rooms

    async def list_players(self, room_id: str) -> list[dict]:
        players = await self._select(
            "room_players",
            {
                "room_id": f"eq.{room_id}", "status": "eq.joined", "order": "seat.asc",
                "select": "id,room_id,user_id,is_bot,bot_name,bot_avatar,seat,is_ready,status,joined_at,"
                          "profile:profiles(username,avatar)",
            },
        )
        presence = await self._select(
            "player_presence", {"room_id": f"eq.{room_id}", "select": "user_id,last_seen_at"}
        )
        seen = {row["user_id"]: row["last_seen_at"] for row in presence}
        for player in players:
            profile = player.pop("profile", None) or {}
            player["username"] = profile.get("username") or player["bot_name"]
            player["avatar"] = profile.get("avatar") or player["bot_avatar"]
            player["last_seen_at"] = seen.get(player["user_id"])
        return players

    async def set_ready(self, room_id: str, user_id: str, ready: bool) -> bool:
        rows = await self._request(
            "PATCH", "room_players",
            params={"room_id": f"eq.{room_id}", "user_id": f"eq.{user_id}", "status": "eq.joined"},
            json={"is_ready": ready}, prefer="return=representation",
        )
        return bool(rows)

    async def touch_presence(self, room_id: str, user_id: str) -> None:
        await self._request(
            "POST", "player_presence", params={"on_conflict": "room_id,user_id"},
            json={"room_id": room_id, "user_id": user_id, "last_seen_at": "now"},
            prefer="resolution=merge-duplicates",
        )

    async def get_presence(self, room_id: str, user_id: str) -> datetime | None:
        row = await self._first(
            "player_presence", {"room_id": f"eq.{room_id}", "user_id": f"eq.{user_id}", "select": "last_seen_at"}
        )
        return datetime.fromisoformat(row["last_seen_at"]) if row else None

    # ------------------------------------------------------------------ partidas

    async def start_game(self, room_id, player_ids, public_state, secret, events, awaiting_user_id, deadline):
        return await self._rpc(
            "vira7_start_game",
            {
                "p_room": room_id, "p_player_ids": list(player_ids), "p_public": public_state,
                "p_secret": secret, "p_events": events, "p_awaiting": awaiting_user_id, "p_deadline": deadline,
            },
        )

    async def get_game(self, game_id: str) -> dict | None:
        return await self._first("games", {"id": f"eq.{game_id}", "select": "*"})

    async def get_secret(self, game_id: str) -> dict | None:
        row = await self._first("game_secrets", {"game_id": f"eq.{game_id}", "select": "state"})
        return row["state"] if row else None

    async def commit_game(self, game_id, expected_version, public_state, secret, events, awaiting_user_id,
                          deadline, status, results, winner_user_id, winner_name, finish_reason) -> bool:
        return bool(
            await self._rpc(
                "vira7_commit_game",
                {
                    "p_game": game_id, "p_expected_version": expected_version, "p_public": public_state,
                    "p_secret": secret, "p_events": events, "p_awaiting": awaiting_user_id,
                    "p_deadline": deadline, "p_status": status, "p_results": results,
                    "p_winner": winner_user_id, "p_winner_name": winner_name, "p_finish_reason": finish_reason,
                },
            )
        )

    async def list_events(self, game_id: str, after: int = 0) -> list[dict]:
        return await self._select(
            "game_events",
            {
                "game_id": f"eq.{game_id}", "seq": f"gt.{after}", "order": "seq.asc",
                "select": "seq,type,payload,state,game_id,room_id,created_at",
            },
        )

    async def list_playing_games(self) -> list[dict]:
        return await self._select(
            "games", {"status": "eq.playing", "select": "id,room_id,version,awaiting_user_id,turn_deadline"}
        )
