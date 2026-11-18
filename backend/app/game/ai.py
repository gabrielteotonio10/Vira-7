"""Decisões dos jogadores controlados pelo computador (espelha `js/core/ai.js`).

São determinísticas: dependem só do estado da mesa e da personalidade de cada CPU.
Isso permite reconstruir uma rodada sem gravar as jogadas das CPUs. As mesmas
funções escolhem a jogada automática de quem estourou o tempo ou saiu da partida.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from . import constants as C

if TYPE_CHECKING:  # pragma: no cover
    from .engine import Player, RoundEngine


def _round_points(player: "Player") -> int:
    return player.score()["total"]


def _best_opponent_total(player: "Player", engine: "RoundEngine") -> int:
    return max([0, *(p.total for p in engine.players if p is not player)])


def decide_move(player: "Player", engine: "RoundEngine") -> str:
    """Retorna "hit" (virar) ou "stay" (parar)."""
    if not player.numbers:
        return "hit"  # sem números na mesa não há como estourar

    risk = engine.bust_chance(player)
    points = _round_points(player)
    projected = player.total + points
    best_opponent = _best_opponent_total(player, engine)

    # Se parar agora garante a vitória, para.
    if projected >= engine.target_score and projected > best_opponent:
        return "stay"

    # Segunda Chance protege contra um estouro: dá para arriscar bastante.
    if player.second_chance:
        return "hit" if risk < 0.75 else "stay"

    threshold = player.risk_tolerance
    if len(player.numbers) == C.FLIP7_UNIQUE_COUNT - 1:
        threshold += 0.12  # perto do Vira 7, o bônus vale o risco
    if best_opponent - player.total > 60:
        threshold += 0.08  # muito atrás: precisa arriscar mais
    if points >= 35:
        threshold -= 0.08  # rodada já valiosa: protege o que tem
    if points >= 50:
        threshold -= 0.08

    return "hit" if risk <= min(0.9, max(0.05, threshold)) else "stay"


def _threat(player: "Player") -> int:
    return player.total + _round_points(player)


def choose_target(player: "Player", kind: str, candidates: list["Player"], engine: "RoundEngine") -> "Player":
    """Escolhe o alvo de Congelar, Vira Três ou de uma Segunda Chance extra."""
    others = [p for p in candidates if p is not player]
    includes_self = player in candidates

    if kind == C.SECOND_CHANCE:
        # Dá a Segunda Chance para quem menos ameaça.
        return min(others, key=lambda p: (_threat(p), p.seat)) if others else candidates[0]

    if kind == C.FREEZE:
        # Congelar a si mesmo é ótimo quando há muito a perder.
        if includes_self and _round_points(player) >= 20 and engine.bust_chance(player) >= 0.25:
            return player
        if not others:
            return player
        # Congela o rival que tem pouco na mesa, mas é forte na partida.
        return max(others, key=lambda p: (p.total - _round_points(p) * 2, -p.seat))

    # Vira Três: força o rival mais exposto a arriscar.
    if not others:
        return player
    return max(
        others,
        key=lambda p: (engine.bust_chance(p) * (_round_points(p) + 10) + _threat(p) * 0.05, -p.seat),
    )
