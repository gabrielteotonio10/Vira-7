"""Verificação de ponta a ponta contra o Supabase REAL.

Pré-requisitos: backend/.env preenchido, migrations aplicadas e a API rodando
(`uvicorn app.main:app --port 8000`). Depois:

    python scripts/smoke_online.py [http://localhost:8000]

O script cria três contas de teste, joga uma partida inteira pela API, confere
histórico, estatísticas e as políticas de segurança (RLS) com o token de cada
jogador, e no fim apaga as contas de teste.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

API = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PASSWORD = "Vira7-" + uuid.uuid4().hex[:12]

checks: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> bool:
    checks.append((bool(ok), label))
    print(("  ok   " if ok else "  FALHA") + f" {label}")
    return bool(ok)


def admin_headers() -> dict:
    return {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"}


class Player:
    def __init__(self, http: httpx.Client, name: str) -> None:
        self.http = http
        self.name = name
        self.email = f"vira7-teste-{uuid.uuid4().hex[:10]}@example.com"
        # Conta já confirmada, criada pela API de administração do Supabase Auth.
        created = http.post(
            f"{URL}/auth/v1/admin/users",
            headers=admin_headers(),
            json={"email": self.email, "password": PASSWORD, "email_confirm": True,
                  "user_metadata": {"username": name, "avatar": "coruja"}},
        )
        created.raise_for_status()
        self.id = created.json()["id"]
        login = http.post(
            f"{URL}/auth/v1/token?grant_type=password",
            headers={"apikey": ANON, "Content-Type": "application/json"},
            json={"email": self.email, "password": PASSWORD},
        )
        login.raise_for_status()
        self.token = login.json()["access_token"]

    def api(self, method: str, path: str, json=None) -> httpx.Response:
        return self.http.request(method, f"{API}/api{path}", json=json, headers={"Authorization": f"Bearer {self.token}"})

    def rest(self, table: str, query: str) -> httpx.Response:
        """Acesso DIRETO ao banco com o token do jogador (é aqui que o RLS age)."""
        return self.http.get(
            f"{URL}/rest/v1/{table}?{query}", headers={"apikey": ANON, "Authorization": f"Bearer {self.token}"}
        )

    def delete(self) -> None:
        self.http.delete(f"{URL}/auth/v1/admin/users/{self.id}", headers=admin_headers())


def main() -> int:
    if not (URL and ANON and SERVICE):
        print("Preencha SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY em backend/.env.")
        return 2

    suffix = uuid.uuid4().hex[:5]
    with httpx.Client(timeout=20) as http:
        health = http.get(f"{API}/api/health").json()
        if not check(health.get("mode") == "supabase", f"API em modo Supabase ({API})"):
            print("A API está em modo de desenvolvimento local. Confira o backend/.env e reinicie-a.")
            return 1

        players: list[Player] = []
        try:
            print("\nContas")
            ana, beto, intruso = (Player(http, f"{n}_{suffix}") for n in ("ana", "beto", "intruso"))
            players = [ana, beto, intruso]
            me = ana.api("GET", "/me")
            check(me.status_code == 200 and me.json()["profile"]["username"] == ana.name, "trigger criou o perfil no cadastro")
            check(me.json()["profile"]["avatar"] == "coruja", "personagem escolhido no cadastro foi salvo")
            check(http.get(f"{API}/api/me").status_code == 401, "rota protegida recusa quem não tem token")

            print("\nSala")
            room = ana.api("POST", "/rooms", {"targetScore": 50, "turnSeconds": 0, "maxPlayers": 2}).json()["room"]
            code = room["code"]
            check(beto.api("POST", f"/rooms/{code}/join").status_code == 200, "segundo jogador entrou pelo código")
            full = intruso.api("POST", f"/rooms/{code}/join")
            check(full.status_code == 409 and full.json()["error"]["code"] == "ROOM_FULL", "sala cheia recusa o terceiro")
            beto.api("POST", f"/rooms/{code}/ready", {"ready": True})
            started = ana.api("POST", f"/rooms/{code}/start")
            game_id = started.json().get("room", {}).get("gameId")
            check(started.status_code == 200 and bool(game_id), "partida iniciada pelo anfitrião")

            print("\nSegurança no banco (RLS, com o token de cada jogador)")
            check(len(ana.rest("game_events", f"game_id=eq.{game_id}&select=seq").json()) > 0, "participante lê os eventos da partida")
            check(intruso.rest("game_events", f"game_id=eq.{game_id}&select=seq").json() == [], "quem está fora não lê os eventos")
            check(intruso.rest("rooms", f"id=eq.{room['id']}&select=id").json() == [], "quem está fora não vê a sala privada")
            secret = ana.rest("game_secrets", f"game_id=eq.{game_id}&select=state")
            check(secret.status_code in (401, 403) or secret.json() == [], "ninguém lê o estado secreto (ordem do monte)")
            forged = http.patch(
                f"{URL}/rest/v1/player_stats?user_id=eq.{ana.id}",
                headers={"apikey": ANON, "Authorization": f"Bearer {ana.token}", "Content-Type": "application/json"},
                json={"wins": 999},
            )
            check(forged.status_code in (401, 403), "cliente não consegue alterar as próprias estatísticas")

            print("\nPartida")
            by_id = {p.id: p for p in (ana, beto)}
            state = ana.api("GET", f"/games/{game_id}").json()["state"]
            wrong = next(p for p in (ana, beto) if p.id != state["players"][state["awaiting"]["seat"]]["userId"])
            refused = wrong.api("POST", f"/games/{game_id}/actions", {"type": "hit"})
            check(refused.status_code == 409, "jogada fora da vez é recusada pelo servidor")

            for step in range(1500):
                snapshot = ana.api("GET", f"/games/{game_id}").json()
                if snapshot["status"] != "playing":
                    break
                awaiting = snapshot["state"]["awaiting"]
                actor = by_id[snapshot["state"]["players"][awaiting["seat"]]["userId"]]
                if awaiting["kind"] == "target":
                    body = {"type": "target", "target": awaiting["candidates"][0], "token": awaiting["token"]}
                else:
                    body = {"type": "hit" if step % 3 else "stay", "token": awaiting["token"]}
                response = actor.api("POST", f"/games/{game_id}/actions", body)
                if response.status_code != 200:
                    check(False, f"jogada recusada inesperadamente: {response.text[:120]}")
                    break
            final = ana.api("GET", f"/games/{game_id}").json()
            check(final["status"] == "finished", "partida jogada até o fim")
            events = ana.api("GET", f"/games/{game_id}/events?after=0").json()["events"]
            check([e["seq"] for e in events] == list(range(1, len(events) + 1)), f"{len(events)} eventos em sequência, sem lacunas")
            check(beto.api("GET", f"/games/{game_id}").json()["state"] == final["state"], "os dois jogadores veem o mesmo estado final")

            print("\nPersistência")
            winner_seat = final["state"]["winner"]
            winner = by_id[final["state"]["players"][winner_seat]["userId"]]
            stats = winner.api("GET", "/me").json()["stats"]
            check(stats["wins"] == 1 and stats["gamesPlayed"] == 1, "trigger atualizou as estatísticas do vencedor")
            history = winner.api("GET", "/me/matches").json()["matches"]
            check(len(history) == 1 and history[0]["me"]["isWinner"], "partida aparece no histórico")
            ranking = ana.api("GET", "/leaderboard").json()["players"]
            check(any(p["username"] == winner.name for p in ranking), "vencedor aparece no ranking")
            check(ana.api("GET", f"/rooms/{code}").json()["room"]["status"] == "lobby", "sala voltou ao lobby para a revanche")
        finally:
            print("\nLimpando contas de teste…")
            for player in players:
                try:
                    player.api("POST", f"/rooms/{code}/leave") if "code" in locals() else None
                    player.delete()
                except Exception as error:  # limpeza não deve esconder o resultado
                    print(f"  aviso: não foi possível apagar {player.email}: {error}")

    failed = [label for ok, label in checks if not ok]
    print(f"\n{len(checks) - len(failed)} de {len(checks)} verificações passaram.")
    if failed:
        print("Falharam:\n  - " + "\n  - ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
