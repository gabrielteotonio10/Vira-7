"""Motor de UMA rodada do Vira-7 (espelha `js/core/game.js`).

O motor é um gerador: roda sozinho até precisar de uma decisão humana e então *cede*
um pedido, retomando quando recebe a resposta:

    {"kind": "move",   "seat": 2}                       -> "hit" | "stay"
    {"kind": "target", "seat": 2, "action": "freeze",
     "cardId": "c88", "candidates": [0, 1, 2]}          -> assento escolhido

Jogadores controlados pelo computador decidem na hora, de forma determinística.
Como o baralho é embaralhado a partir de uma semente, a rodada inteira pode ser
reconstruída só com (semente + lista de decisões) — é assim que o servidor retoma
a partida entre uma requisição e outra, sem guardar o gerador.

Cada evento carrega um retrato público do estado *depois* da mudança; a interface
só precisa redesenhar a mesa e animar a diferença.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Generator

from . import ai, scoring
from . import constants as C
from .cards import Card, Deck

Request = dict
Flow = Generator[Request, object, object]


@dataclass
class Player:
    seat: int
    name: str
    user_id: str | None = None
    color: str = "#6366f1"
    avatar: str | None = None
    is_bot: bool = False
    #: Personalidade da CPU: quanto maior, mais arrisca (0 a 1).
    risk_tolerance: float = 0.3
    #: Saiu da partida: fica fora das próximas rodadas.
    absent: bool = False

    # Acumulado da partida
    total: int = 0
    history: list[int] = field(default_factory=list)
    flip7_rounds: list[int] = field(default_factory=list)
    busts: int = 0

    # Estado da rodada
    status: str = C.ACTIVE
    numbers: list[Card] = field(default_factory=list)
    modifiers: list[Card] = field(default_factory=list)
    second_chance: Card | None = None
    action_cards: list[Card] = field(default_factory=list)
    pending_actions: list[Card] = field(default_factory=list)
    bust_card: Card | None = None
    flip7: bool = False
    round_score: int = 0

    def reset_round(self) -> None:
        self.status = C.ACTIVE
        self.numbers = []
        self.modifiers = []
        self.second_chance = None
        self.action_cards = []
        self.pending_actions = []
        self.bust_card = None
        self.flip7 = False
        self.round_score = 0

    @property
    def is_active(self) -> bool:
        return self.status == C.ACTIVE

    def has_number(self, value: int) -> bool:
        return any(card["value"] == value for card in self.numbers)

    def table_cards(self) -> list[Card]:
        cards = [*self.numbers, *self.modifiers, *self.action_cards, *self.pending_actions]
        if self.second_chance:
            cards.append(self.second_chance)
        if self.bust_card:
            cards.append(self.bust_card)
        return cards

    def collect_cards(self) -> list[Card]:
        cards = self.table_cards()
        self.numbers, self.modifiers, self.action_cards, self.pending_actions = [], [], [], []
        self.second_chance = None
        self.bust_card = None
        return cards

    def remove_pending(self, card: Card) -> None:
        if card in self.pending_actions:
            self.pending_actions.remove(card)

    def score(self) -> dict:
        return scoring.compute(self.numbers, self.modifiers, self.flip7, self.status)


class RoundEngine:
    def __init__(
        self,
        players: list[Player],
        *,
        round_number: int,
        dealer_index: int,
        target_score: int,
        seed: int | None = None,
        cards: list[Card] | None = None,
        deck_version: int = C.DECK_VERSION,
        teams: bool = False,
    ) -> None:
        self.players = players
        self.teams = teams
        self.round = round_number
        self.dealer_index = dealer_index % len(players)
        self.target_score = target_score
        self.rng = random.Random(seed)
        self.deck = Deck(self.rng, cards, deck_version)
        self.phase = "deal"
        self.current_seat: int | None = None
        self.round_over = False
        self.flip7_seat: int | None = None
        self.finished = False
        #: Assentos que já passaram pela distribuição inicial desta rodada.
        self.dealt: set[int] = set()
        self.results: list[dict] = []
        self.events: list[dict] = []

    # ------------------------------------------------------------------ consultas

    @property
    def dealer(self) -> Player:
        return self.players[self.dealer_index]

    def active_players(self) -> list[Player]:
        return [p for p in self.players if p.is_active]

    def turn_order(self) -> list[Player]:
        """Ordem de jogo: começa à esquerda do carteador."""
        n = len(self.players)
        start = (self.dealer_index + 1) % n
        return [self.players[(start + i) % n] for i in range(n)]

    def bust_odds(self, player: Player) -> dict:
        """Cartas do monte que repetiriam um número do jogador (informação pública)."""
        owned = {card["value"] for card in player.numbers}
        matches, total = self.deck.count_remaining(
            lambda card: card["type"] == C.NUMBER and card["value"] in owned
        )
        return {"matches": matches, "total": total, "chance": (matches / total) if total else 0.0}

    def bust_chance(self, player: Player) -> float:
        return self.bust_odds(player)["chance"] if player.numbers else 0.0

    def snapshot(self) -> dict:
        """Retrato público da mesa. Nunca inclui a ordem do monte."""
        return {
            "round": self.round,
            "dealer": self.dealer.seat,
            "targetScore": self.target_score,
            "phase": self.phase,
            "currentPlayer": self.current_seat,
            "deck": {"size": self.deck.size, "totalAvailable": self.deck.total_available},
            "players": [self._public_player(p) for p in self.players],
            "teams": self._public_teams(),
        }

    def _public_teams(self) -> list[dict] | None:
        """Pontos de cada dupla (soma dos jogadores). `None` quando não é partida em duplas."""
        if not self.teams:
            return None
        return [
            {"id": index, "seats": seats, "total": sum(self.players[seat].total for seat in seats)}
            for index, seats in enumerate(scoring.team_groups(len(self.players)))
        ]

    def _public_player(self, p: Player) -> dict:
        return {
            "seat": p.seat,
            "userId": p.user_id,
            "name": p.name,
            "color": p.color,
            "avatar": p.avatar,
            "isBot": p.is_bot,
            "absent": p.absent,
            "team": scoring.team_of(p.seat, len(self.players)) if self.teams else None,
            "total": p.total,
            "history": list(p.history),
            "flip7Rounds": list(p.flip7_rounds),
            "status": p.status,
            "flip7": p.flip7,
            "numbers": list(p.numbers),
            "modifiers": list(p.modifiers),
            "secondChance": p.second_chance,
            "actionCards": list(p.action_cards),
            "pendingActions": list(p.pending_actions),
            "bustCard": p.bust_card,
            "odds": self.bust_odds(p),
        }

    def _emit(self, event_type: str, **payload) -> None:
        self.events.append({"type": event_type, "payload": payload, "state": self.snapshot()})

    # ------------------------------------------------------------------ decisões

    def _ask_move(self, player: Player) -> Flow:
        if player.is_bot:
            return ai.decide_move(player, self)
        answer = yield {"kind": "move", "seat": player.seat}
        return "stay" if answer == "stay" else "hit"

    def _ask_target(self, player: Player, kind: str, candidates: list[Player], card: Card) -> Flow:
        if len(candidates) == 1:
            return candidates[0]
        if player.is_bot:
            return ai.choose_target(player, kind, candidates, self)
        answer = yield {
            "kind": "target",
            "seat": player.seat,
            "action": kind,
            "cardId": card["id"],
            "candidates": [p.seat for p in candidates],
        }
        return next((p for p in candidates if p.seat == answer), candidates[0])

    # ------------------------------------------------------------------ fluxo

    def play(self) -> Flow:
        """Joga a rodada inteira."""
        for player in self.players:
            player.reset_round()
            if player.absent:
                player.status = C.STAYED

        # Toda rodada começa com todas as cartas no monte, embaralhadas.
        if self.round > 1:
            self._emit("reshuffle", count=self.deck.size, newRound=True)
        self._emit("roundStart", round=self.round, dealer=self.dealer.seat)

        self.phase = "deal"
        yield from self._deal_initial()

        self.phase = "turns"
        yield from self._play_turns()

        self.phase = "roundEnd"
        self._end_round()
        self.finished = True

    def _deal_initial(self) -> Flow:
        """Uma carta para cada jogador; ações são resolvidas na hora. Quem já recebeu
        cartas (por um Vira Três) ou já saiu da rodada não recebe outra."""
        # Quem já foi servido (ou virou 3 cartas por um Vira Três durante a distribuição) não recebe
        # outra. Ter só uma Segunda Chance doada NÃO conta: essa pessoa ainda precisa da carta inicial.
        self.dealt = set()
        for player in self.turn_order():
            if self.round_over:
                return
            if not player.is_active or player.seat in self.dealt:
                continue
            self.dealt.add(player.seat)
            self.current_seat = player.seat
            yield from self._draw_card(player, {"source": "deal"})

    def _play_turns(self) -> Flow:
        order = self.turn_order()
        index = 0
        while not self.round_over and self.active_players():
            player = order[index % len(order)]
            index += 1
            if not player.is_active:
                continue

            self.current_seat = player.seat
            self._emit("turnStart", player=player.seat)

            move = yield from self._ask_move(player)
            if move == "stay":
                player.status = C.STAYED
                self._emit("stay", player=player.seat, score=player.score(), forced=False)
            else:
                yield from self._draw_card(player, {"source": "hit"})

            self._emit("turnEnd", player=player.seat)
        self.current_seat = None

    def _end_round(self) -> None:
        results = []
        for player in self.players:
            breakdown = player.score()
            player.round_score = breakdown["total"]
            player.total += breakdown["total"]
            player.history.append(breakdown["total"])
            if player.flip7:
                player.flip7_rounds.append(self.round)
            results.append(
                {
                    "player": player.seat,
                    "status": player.status,
                    "flip7": player.flip7,
                    "breakdown": breakdown,
                    "roundScore": breakdown["total"],
                    "total": player.total,
                }
            )
        self.results = results
        self._emit(
            "roundEnd",
            round=self.round,
            results=results,
            flip7Player=self.flip7_seat,
            standings=scoring.standings([p.total for p in self.players]),
        )

        collected = [{"player": p.seat, "cards": p.collect_cards()} for p in self.players]
        for entry in collected:
            self.deck.discard(*entry["cards"])
        self._emit("roundCleanup", collected=collected)

    # ------------------------------------------------------------------ cartas

    def _draw_from_deck(self) -> Card | None:
        if self.deck.needs_reshuffle():
            count = self.deck.reshuffle()
            self._emit("reshuffle", count=count, newRound=False)
        return self.deck.draw()

    def _draw_card(self, player: Player, context: dict) -> Flow:
        card = self._draw_from_deck()
        if card is None:
            # Não há mais cartas em lugar nenhum: o jogador é obrigado a parar.
            player.status = C.STAYED
            self._emit("stay", player=player.seat, score=player.score(), forced=True)
            return

        if card["type"] == C.NUMBER:
            self._resolve_number(player, card, context)
        elif card["type"] == C.MODIFIER:
            player.modifiers.append(card)
            self._emit_drawn(player, card, context)
        else:
            yield from self._resolve_action(player, card, context)

    def _emit_drawn(self, player: Player, card: Card, context: dict, duplicate: bool = False) -> None:
        public_context = {"source": context["source"]}
        if "index" in context:
            public_context["index"] = context["index"]
        self._emit("cardDrawn", player=player.seat, card=card, context=public_context, duplicate=duplicate)

    def _resolve_number(self, player: Player, card: Card, context: dict) -> None:
        if player.has_number(card["value"]):
            player.bust_card = card
            self._emit_drawn(player, card, context, duplicate=True)

            if player.second_chance:
                second_chance = player.second_chance
                player.second_chance = None
                player.bust_card = None
                self.deck.discard(card, second_chance)
                self._emit("secondChanceUsed", player=player.seat, card=card, secondChance=second_chance)
                return

            player.status = C.BUSTED
            player.busts += 1
            self._emit("bust", player=player.seat, card=card)
            return

        player.numbers.append(card)
        self._emit_drawn(player, card, context)

        if len(player.numbers) >= C.FLIP7_UNIQUE_COUNT:
            player.flip7 = True
            player.status = C.STAYED
            self.round_over = True
            self.flip7_seat = player.seat
            self._emit("flip7", player=player.seat, score=player.score())

    def _resolve_action(self, player: Player, card: Card, context: dict) -> Flow:
        if card["action"] == C.SECOND_CHANCE:
            yield from self._resolve_second_chance(player, card, context)
            return

        player.pending_actions.append(card)
        self._emit_drawn(player, card, context)

        # Durante um Vira Três, Congelar e Vira Três ficam guardados até o fim das 3 cartas.
        if context["source"] == "flipThree":
            context["queue"].append(card)
            return
        yield from self._play_action(player, card)

    def _resolve_second_chance(self, player: Player, card: Card, context: dict) -> Flow:
        if not player.second_chance:
            player.second_chance = card
            self._emit_drawn(player, card, context)
            self._emit("secondChanceKept", player=player.seat, card=card)
            return

        # Já tem uma: precisa dar para outro jogador ativo que ainda não tenha.
        player.pending_actions.append(card)
        self._emit_drawn(player, card, context)

        candidates = [p for p in self.active_players() if p is not player and not p.second_chance]
        if not candidates:
            player.remove_pending(card)
            self.deck.discard(card)
            self._emit("cardDiscarded", player=player.seat, card=card, reason="secondChance")
            return

        target = yield from self._ask_target(player, C.SECOND_CHANCE, candidates, card)
        player.remove_pending(card)
        target.second_chance = card
        self._emit("secondChanceGiven", **{"from": player.seat, "to": target.seat, "card": card})

    def _play_action(self, player: Player, card: Card) -> Flow:
        """Joga Congelar ou Vira Três em um jogador ativo (pode ser o próprio)."""
        candidates = self.active_players()
        if not candidates or self.round_over:
            player.remove_pending(card)
            self.deck.discard(card)
            self._emit("cardDiscarded", player=player.seat, card=card, reason="noTarget")
            return

        target = yield from self._ask_target(player, card["action"], candidates, card)
        player.remove_pending(card)
        target.action_cards.append(card)
        self._emit("actionPlayed", **{"from": player.seat, "to": target.seat, "card": card})

        if card["action"] == C.FREEZE:
            target.status = C.FROZEN
            self._emit("freeze", player=target.seat, by=player.seat, score=target.score())
        else:
            yield from self._flip_three(target, player)

    def _flip_three(self, target: Player, by: Player) -> Flow:
        """O alvo vira as próximas 3 cartas, parando antes se estourar ou fizer Vira 7."""
        self._emit("flipThreeStart", player=target.seat, by=by.seat)
        if self.phase == "deal":
            self.dealt.add(target.seat)  # já virou cartas: não precisa da carta inicial

        context = {"source": "flipThree", "index": 0, "queue": []}
        for index in range(1, C.FLIP_THREE_COUNT + 1):
            if self.round_over or not target.is_active:
                break
            context["index"] = index
            yield from self._draw_card(target, context)

        self._emit("flipThreeEnd", player=target.seat)

        # Ações guardadas só valem se o alvo continuar na rodada.
        for card in context["queue"]:
            if target.is_active and not self.round_over:
                yield from self._play_action(target, card)
            else:
                target.remove_pending(card)
                self.deck.discard(card)
                self._emit("cardDiscarded", player=target.seat, card=card, reason="flipThreeCancelled")
