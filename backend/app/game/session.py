"""Sessão de uma partida online: várias rodadas, persistência e eventos.

O estado privado (`data`) é um dicionário JSON guardado no servidor, fora do alcance
dos clientes. Ele contém a semente da rodada e a lista de decisões já tomadas; com
isso `GameSession.load` reconstrói o motor exatamente no ponto em que parou.

Uso típico em uma requisição:

    session = GameSession.load(private_state)
    session.submit(seat, "move", "hit", token=token)   # valida e avança o jogo
    events = session.drain_events()                     # novos eventos, em ordem
    private_state, public_state = session.data, session.public_state()
"""

from __future__ import annotations

import random
import secrets
from typing import Iterable

from . import ai, scoring
from . import constants as C
from .engine import Player, RoundEngine

_START = object()

#: Tempo aproximado (ms) que o cliente leva para animar cada evento. O servidor soma
#: esses tempos ao prazo do turno, para o relógio só "valer" quando a jogada já apareceu.
PRESENTATION_MS: dict[str, int] = {
    "reshuffle": 1000,
    "roundStart": 1500,
    "cardDrawn": 950,
    "bust": 1500,
    "secondChanceUsed": 1400,
    "secondChanceGiven": 850,
    "cardDiscarded": 600,
    "actionPlayed": 750,
    "freeze": 1500,
    "flipThreeStart": 1500,
    "flipThreeEnd": 300,
    "flip7": 2600,
    "stay": 500,
    "turnEnd": 150,
    "roundEnd": 9000,
    "roundCleanup": 1300,
    "tieBreak": 1800,
}
MAX_PRESENTATION_MS = 45_000


class InvalidAction(Exception):
    """Jogada recusada pelo servidor."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class GameSession:
    VERSION = 1

    def __init__(self, data: dict) -> None:
        self.data = data
        self._engine: RoundEngine | None = None
        self._flow = None
        self._pending: dict | None = None
        self._events: list[dict] = []

    # ------------------------------------------------------------------ criação

    @classmethod
    def create(
        cls,
        players: Iterable[dict],
        *,
        target_score: int = C.DEFAULT_TARGET_SCORE,
        turn_seconds: int = 0,
        first_dealer: int | None = None,
        base_seed: int | None = None,
        cards: list[dict] | None = None,
    ) -> "GameSession":
        """Cria a partida e joga até a primeira decisão humana.

        `base_seed` e `cards` existem para os testes (partidas reproduzíveis). Em
        produção, cada rodada usa uma semente aleatória criptograficamente segura.
        """
        roster = []
        for seat, p in enumerate(players):
            roster.append(
                {
                    "seat": seat,
                    "userId": p.get("userId"),
                    "name": p["name"],
                    "color": p.get("color") or "#6366f1",
                    "avatar": p.get("avatar"),
                    "isBot": bool(p.get("isBot")),
                    "riskTolerance": float(p.get("riskTolerance", 0.3)),
                }
            )
        count = len(roster)
        if not C.MIN_PLAYERS <= count <= C.MAX_PLAYERS:
            raise ValueError(f"O jogo aceita de {C.MIN_PLAYERS} a {C.MAX_PLAYERS} jogadores.")

        data = {
            "v": cls.VERSION,
            "status": "playing",
            "targetScore": int(target_score),
            "turnSeconds": int(turn_seconds),
            "players": roster,
            "absent": [],
            "seq": 0,
            "decisionCount": 0,
            "winner": None,
            "finishReason": None,
            "baseSeed": base_seed,
            "deckVersion": C.DECK_VERSION,
            "round": None,
        }
        session = cls(data)
        if first_dealer is None:
            first_dealer = secrets.randbelow(count) if base_seed is None else random.Random(base_seed).randrange(count)
        session._start_round(
            number=1,
            dealer_index=first_dealer % count,
            totals=[0] * count,
            history=[[] for _ in range(count)],
            flip7_rounds=[[] for _ in range(count)],
            busts=[0] * count,
            cards=cards,
        )
        session._emit_session("gameStart", {"players": [p["seat"] for p in roster], "targetScore": int(target_score)})
        session._advance(_START)
        return session

    @classmethod
    def load(cls, data: dict) -> "GameSession":
        """Reconstrói a sessão: refaz a rodada atual com as decisões já gravadas."""
        session = cls(data)
        if data["status"] == "playing":
            session._build_engine()
            session._replay()
        return session

    # ------------------------------------------------------------------ consultas

    @property
    def status(self) -> str:
        return self.data["status"]

    @property
    def is_over(self) -> bool:
        return self.data["status"] != "playing"

    @property
    def awaiting(self) -> dict | None:
        """Decisão que o jogo está esperando, com o `token` que a identifica."""
        if self._pending is None or self.is_over:
            return None
        return {**self._pending, "token": self.data["decisionCount"]}

    def awaiting_user_id(self) -> str | None:
        pending = self.awaiting
        return self.data["players"][pending["seat"]]["userId"] if pending else None

    def seat_of(self, user_id: str) -> int | None:
        for p in self.data["players"]:
            if p["userId"] == user_id:
                return p["seat"]
        return None

    def public_state(self) -> dict:
        """Retrato público completo (o que os clientes podem ver)."""
        state = self._engine.snapshot() if self._engine else {}
        for player in state.get("players", []):
            player["absent"] = player["seat"] in self.data["absent"]
        state.update(
            {
                "status": self.data["status"],
                "winner": self.data["winner"],
                "finishReason": self.data["finishReason"],
                "turnSeconds": self.data["turnSeconds"],
                "awaiting": self.awaiting,
                "seq": self.data["seq"],
            }
        )
        return state

    def drain_events(self) -> list[dict]:
        """Eventos novos desde a última chamada. O último leva o estado final,
        com a decisão que o jogo está esperando."""
        events, self._events = self._events, []
        if events:
            events[-1]["state"] = self.public_state()
        return events

    @staticmethod
    def presentation_ms(events: Iterable[dict]) -> int:
        total = sum(PRESENTATION_MS.get(event["type"], 0) for event in events)
        return min(total, MAX_PRESENTATION_MS)

    def results(self) -> list[dict]:
        """Resultado final por jogador (para o histórico e as estatísticas)."""
        r = self.data["round"]
        absent = set(self.data["absent"])
        winner = self.data["winner"]

        def rank_key(seat: int):
            return (seat != winner, seat in absent, -r["totals"][seat], seat)

        order = sorted(range(len(self.data["players"])), key=rank_key)
        placement = {seat: index + 1 for index, seat in enumerate(order)}
        results = []
        for p in self.data["players"]:
            seat = p["seat"]
            history = r["history"][seat]
            results.append(
                {
                    "seat": seat,
                    "userId": p["userId"],
                    "name": p["name"],
                    "isBot": p["isBot"],
                    "score": r["totals"][seat],
                    "placement": placement[seat],
                    "isWinner": seat == winner,
                    "forfeited": seat in absent,
                    "roundsPlayed": len(history),
                    "bestRound": max(history, default=0),
                    "flip7Count": len(r["flip7Rounds"][seat]),
                    "busts": r["busts"][seat],
                }
            )
        return results

    # ------------------------------------------------------------------ ações

    def submit(self, seat: int, kind: str, value, token: int | None = None) -> None:
        """Aplica a decisão de um jogador. Lança `InvalidAction` se não for válida."""
        pending = self._require_pending()
        if token is not None and token != self.data["decisionCount"]:
            raise InvalidAction("STALE_ACTION", "Essa jogada já foi processada. A mesa foi atualizada.")
        if seat != pending["seat"]:
            raise InvalidAction("NOT_YOUR_TURN", "Não é a sua vez de jogar.")
        if kind != pending["kind"]:
            expected = "escolher um alvo" if pending["kind"] == "target" else "virar ou parar"
            raise InvalidAction("WRONG_ACTION", f"Agora você precisa {expected}.")

        if kind == "move":
            if value not in ("hit", "stay"):
                raise InvalidAction("INVALID_MOVE", "Jogada desconhecida.")
        elif not isinstance(value, int) or isinstance(value, bool) or value not in pending["candidates"]:
            raise InvalidAction("INVALID_TARGET", "Esse jogador não pode ser escolhido.")

        self._record(pending, value)
        self._advance(value)

    def auto_play(self, reason: str = "timeout") -> None:
        """Joga pelo jogador da vez (tempo esgotado ou desconectado): para, ou escolhe
        o alvo com a mesma lógica das CPUs."""
        pending = self._require_pending()
        value = self._default_answer(pending)
        self._emit_session("autoPlay", {"player": pending["seat"], "kind": pending["kind"], "reason": reason})
        self._record(pending, value)
        self._advance(value)

    def mark_absent(self, seat: int) -> None:
        """O jogador saiu da partida: suas decisões passam a ser automáticas e ele
        fica fora das próximas rodadas. Pode encerrar a partida por abandono."""
        if self.is_over or seat in self.data["absent"]:
            return
        self.data["absent"].append(seat)
        self._emit_session("playerLeft", {"player": seat})

        if self._check_forfeit():
            return
        if self._pending and self._pending["seat"] == seat:
            pending = self._pending
            value = self._default_answer(pending)
            self._record(pending, value)
            self._advance(value)

    def abandon(self) -> None:
        """Encerra sem vencedor (sala fechada ou abandonada por todos)."""
        if not self.is_over:
            self._finish("abandoned", winner=None, reason="abandoned")

    # ------------------------------------------------------------------ interno

    def _require_pending(self) -> dict:
        if self.is_over:
            raise InvalidAction("GAME_OVER", "A partida já terminou.")
        if self._pending is None:
            raise InvalidAction("NOT_AWAITING", "O jogo não está esperando nenhuma jogada.")
        return self._pending

    def _record(self, request: dict, value) -> None:
        self.data["round"]["decisions"].append({"k": request["kind"], "s": request["seat"], "v": value})
        self.data["decisionCount"] += 1
        self._pending = None

    def _default_answer(self, request: dict):
        if request["kind"] == "move":
            return "stay"
        engine = self._engine
        player = engine.players[request["seat"]]
        candidates = [engine.players[seat] for seat in request["candidates"]]
        return ai.choose_target(player, request["action"], candidates, engine).seat

    def _round_seed(self, number: int) -> int:
        base = self.data.get("baseSeed")
        if base is None:
            return secrets.randbits(62)
        return random.Random(f"{base}:{number}").getrandbits(62)

    def _start_round(self, *, number, dealer_index, totals, history, flip7_rounds, busts, cards=None) -> None:
        self.data["round"] = {
            "number": number,
            "dealerIndex": dealer_index,
            "seed": self._round_seed(number),
            "totals": totals,
            "history": history,
            "flip7Rounds": flip7_rounds,
            "busts": busts,
            "absent": list(self.data["absent"]),
            "decisions": [],
            "emitted": 0,
        }
        if cards is not None:
            self.data["round"]["cards"] = cards
        self._build_engine()

    def _build_engine(self) -> None:
        r = self.data["round"]
        players = [
            Player(
                seat=p["seat"],
                name=p["name"],
                user_id=p["userId"],
                color=p["color"],
                avatar=p["avatar"],
                is_bot=p["isBot"],
                risk_tolerance=p["riskTolerance"],
                absent=p["seat"] in r["absent"],
                total=r["totals"][p["seat"]],
                history=list(r["history"][p["seat"]]),
                flip7_rounds=list(r["flip7Rounds"][p["seat"]]),
                busts=r["busts"][p["seat"]],
            )
            for p in self.data["players"]
        ]
        self._engine = RoundEngine(
            players,
            round_number=r["number"],
            dealer_index=r["dealerIndex"],
            target_score=self.data["targetScore"],
            seed=r["seed"],
            cards=r.get("cards"),
            deck_version=self.data.get("deckVersion", 1),
        )
        self._flow = self._engine.play()
        self._pending = None

    def _replay(self) -> None:
        """Refaz a rodada atual alimentando o motor com as decisões gravadas."""
        r = self.data["round"]
        try:
            request = next(self._flow)
            for decision in r["decisions"]:
                if request["kind"] != decision["k"] or request["seat"] != decision["s"]:
                    raise RuntimeError("Estado da partida inconsistente: decisões não conferem com o motor.")
                request = self._flow.send(decision["v"])
        except StopIteration as stop:
            raise RuntimeError("Estado da partida inconsistente: a rodada terminou durante a reconstrução.") from stop
        if len(self._engine.events) != r["emitted"]:
            raise RuntimeError("Estado da partida inconsistente: os eventos reconstruídos não conferem.")
        self._pending = request

    def _flush_engine_events(self) -> None:
        r = self.data["round"]
        for event in self._engine.events[r["emitted"]:]:
            self.data["seq"] += 1
            self._events.append({"seq": self.data["seq"], **event})
        r["emitted"] = len(self._engine.events)

    def _emit_session(self, event_type: str, payload: dict) -> None:
        self._flush_engine_events()
        self.data["seq"] += 1
        state = self._engine.snapshot()
        for player in state["players"]:
            player["absent"] = player["seat"] in self.data["absent"]
        self._events.append({"seq": self.data["seq"], "type": event_type, "payload": payload, "state": state})

    def _advance(self, value) -> None:
        """Roda o motor até a próxima decisão humana ou o fim da partida."""
        while True:
            try:
                request = next(self._flow) if value is _START else self._flow.send(value)
            except StopIteration:
                self._flush_engine_events()
                if not self._complete_round():
                    self._pending = None
                    return
                value = _START
                continue

            if request["seat"] in self.data["absent"]:
                # Quem saiu da partida não decide mais nada.
                self._pending = request
                value = self._default_answer(request)
                self._record(request, value)
                continue

            self._pending = request
            self._flush_engine_events()
            return

    def _complete_round(self) -> bool:
        """Fecha a rodada. Retorna False se a partida acabou; senão inicia a próxima."""
        engine = self._engine
        r = self.data["round"]
        r["totals"] = [p.total for p in engine.players]
        r["history"] = [list(p.history) for p in engine.players]
        r["flip7Rounds"] = [list(p.flip7_rounds) for p in engine.players]
        r["busts"] = [p.busts for p in engine.players]

        absent = set(self.data["absent"])
        eligible = [-1 if seat in absent else total for seat, total in enumerate(r["totals"])]
        victory = scoring.check_victory(eligible, self.data["targetScore"])

        if victory["over"]:
            self._finish("finished", winner=victory["winner"], reason="score")
            return False
        if victory["tie"]:
            self._emit_session("tieBreak", {"leaders": victory["leaders"]})

        count = len(self.data["players"])
        self._start_round(
            number=r["number"] + 1,
            dealer_index=(r["dealerIndex"] + 1) % count,
            totals=r["totals"],
            history=r["history"],
            flip7_rounds=r["flip7Rounds"],
            busts=r["busts"],
        )
        return True

    def _check_forfeit(self) -> bool:
        """Encerra a partida se não sobrou gente suficiente. Retorna True se encerrou."""
        absent = set(self.data["absent"])
        present = [p for p in self.data["players"] if p["seat"] not in absent]
        humans = [p for p in present if not p["isBot"]]
        if not humans:
            self._finish("abandoned", winner=None, reason="abandoned")
            return True
        if len(present) < C.MIN_PLAYERS:
            self._finish("finished", winner=present[0]["seat"], reason="forfeit")
            return True
        return False

    def _finish(self, status: str, *, winner: int | None, reason: str) -> None:
        r = self.data["round"]
        # Em caso de abandono no meio da rodada, vale o placar das rodadas completas.
        self.data["status"] = status
        self.data["winner"] = winner
        self.data["finishReason"] = reason
        self._pending = None
        self._emit_session(
            "gameOver",
            {"winner": winner, "reason": reason, "standings": scoring.standings(r["totals"])},
        )
