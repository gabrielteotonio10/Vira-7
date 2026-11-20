"""Decisões dos jogadores controlados pelo computador (espelha `js/core/ai.js`).

São determinísticas: dependem só do estado da mesa e da personalidade de cada CPU.
Isso permite reconstruir uma rodada sem gravar as jogadas das CPUs. As mesmas
funções escolhem a jogada automática de quem estourou o tempo ou saiu da partida.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from . import constants as C
from . import scoring

if TYPE_CHECKING:  # pragma: no cover
    from .engine import Player, RoundEngine


def _round_points(player: "Player") -> int:
    return player.score()["total"]


def _teammates(player: "Player", engine: "RoundEngine") -> list["Player"]:
    """Parceiros de `player` (vazio em partida individual)."""
    if not getattr(engine, "teams", False):
        return []
    count = len(engine.players)
    team = scoring.team_of(player.seat, count)
    return [p for p in engine.players if p is not player and scoring.team_of(p.seat, count) == team]


def _team_total(player: "Player", engine: "RoundEngine") -> int:
    """Pontos da partida de quem joga: o próprio ou, em duplas, o da dupla."""
    return player.total + sum(p.total for p in _teammates(player, engine))


def _team_round_points(player: "Player", engine: "RoundEngine") -> int:
    """Pontos da rodada em jogo: os seus mais os do parceiro (estourou = 0)."""
    return _round_points(player) + sum(_round_points(p) for p in _teammates(player, engine))


def _best_opponent_total(player: "Player", engine: "RoundEngine") -> int:
    """Maior pontuação entre os adversários (em duplas, a maior soma de uma dupla rival)."""
    if not getattr(engine, "teams", False):
        return max([0, *(p.total for p in engine.players if p is not player)])
    mates = {p.seat for p in _teammates(player, engine)} | {player.seat}
    count = len(engine.players)
    totals: dict[int, int] = {}
    for other in engine.players:
        if other.seat in mates:
            continue
        team = scoring.team_of(other.seat, count)
        totals[team] = totals.get(team, 0) + other.total
    return max([0, *totals.values()])


def decide_move(player: "Player", engine: "RoundEngine") -> str:
    """Retorna "hit" (virar) ou "stay" (parar)."""
    if not player.numbers:
        return "hit"  # sem números na mesa não há como estourar

    risk = engine.bust_chance(player)
    points = _round_points(player)
    # Em duplas, a conta é da dupla: pontos do parceiro (e o que ele tem na mesa) também valem.
    projected = _team_total(player, engine) + _team_round_points(player, engine)
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
    if best_opponent - _team_total(player, engine) > 60:
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
    mates = _teammates(player, engine)
    all_others = [p for p in candidates if p is not player]
    includes_self = player in candidates
    # Em duplas, parceiro não é rival: só entra na conta quando não há mais ninguém.
    rivals = [p for p in all_others if p not in mates]
    others = rivals or all_others
    partners = [p for p in all_others if p in mates]

    if kind == C.SECOND_CHANCE:
        # Em duplas, a Segunda Chance extra vai para o parceiro; senão, para quem menos ameaça.
        if partners:
            return min(partners, key=lambda p: (-_round_points(p), p.seat))
        return min(all_others, key=lambda p: (_threat(p), p.seat)) if all_others else candidates[0]

    if kind == C.FREEZE:
        # Congelar a si mesmo é ótimo quando há muito a perder.
        if includes_self and _round_points(player) >= 20 and engine.bust_chance(player) >= 0.25:
            return player
        # O mesmo vale para o parceiro: guardar os pontos dele é bom para a dupla.
        for partner in partners:
            if _round_points(partner) >= 20 and engine.bust_chance(partner) >= 0.25:
                return partner
        if not all_others:
            return player
        # Congela o rival que tem pouco na mesa, mas é forte na partida.
        return max(others, key=lambda p: (p.total - _round_points(p) * 2, -p.seat))

    # Vira Três: força o rival mais exposto a arriscar.
    if not all_others:
        return player
    return max(
        others,
        key=lambda p: (engine.bust_chance(p) * (_round_points(p) + 10) + _threat(p) * 0.05, -p.seat),
    )
