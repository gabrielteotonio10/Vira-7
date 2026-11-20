"""Pontuação da rodada e condição de vitória (espelha `js/core/scoring.js`).

Ordem oficial:
  1. Quem estourou marca 0.
  2. Soma as cartas numéricas.
  3. Aplica o x2 (dobra SOMENTE a soma dos números).
  4. Soma os modificadores +2…+10.
  5. Soma 15 se virou 7 números diferentes.
  As penalidades (-2, -4, -6) entram junto dos modificadores e o total da rodada nunca é negativo.
"""

from __future__ import annotations

from typing import Sequence

from . import constants as C


def compute(numbers: Sequence[dict], modifiers: Sequence[dict], flip7: bool = False, status: str | None = None) -> dict:
    numbers_sum = sum(card["value"] for card in numbers)

    multiplier = 1
    modifiers_sum = 0
    for card in modifiers:
        if card["op"] == C.MULTIPLY:
            multiplier *= card["value"]
        else:
            modifiers_sum += card["value"]

    numbers_total = numbers_sum * multiplier
    flip7_bonus = C.FLIP7_BONUS if flip7 else 0
    busted = status == C.BUSTED
    total = 0 if busted else max(0, numbers_total + modifiers_sum + flip7_bonus)

    return {
        "numbersSum": numbers_sum,
        "multiplier": multiplier,
        "numbersTotal": numbers_total,
        "modifiersSum": modifiers_sum,
        "flip7Bonus": flip7_bonus,
        "total": total,
        "busted": busted,
    }


def team_count(players: int) -> int:
    """Quantas duplas existem em uma mesa de `players` pessoas (duplas de 2)."""
    return players // 2


def team_of(seat: int, players: int) -> int:
    """Duplas ficam em assentos opostos: com 4 pessoas, 0 e 2 jogam juntas, assim como 1 e 3."""
    return seat % team_count(players)


def team_groups(players: int) -> list[list[int]]:
    return [[seat for seat in range(players) if team_of(seat, players) == team] for team in range(team_count(players))]


def check_victory(totals: Sequence[int], target_score: int) -> dict:
    """A partida termina quando alguém atinge a meta e há um líder isolado.

    `totals` é indexado pelo assento. Empate na liderança acima da meta = rodada extra.
    """
    best = max(totals)
    leaders = [seat for seat, total in enumerate(totals) if total == best]
    reached = best >= target_score
    return {
        "over": reached and len(leaders) == 1,
        "tie": reached and len(leaders) > 1,
        "winner": leaders[0] if reached and len(leaders) == 1 else None,
        "leaders": leaders,
    }


def standings(totals: Sequence[int]) -> list[int]:
    """Assentos ordenados por pontuação (maior primeiro; desempate pelo assento)."""
    return sorted(range(len(totals)), key=lambda seat: (-totals[seat], seat))
