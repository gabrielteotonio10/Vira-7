"""Baralho: criação das 99 cartas, embaralhamento determinístico e compra.

As cartas são dicionários simples (prontos para JSON), com o mesmo formato do cliente:
    {"id": "c12", "type": "number", "value": 5}
    {"id": "c80", "type": "modifier", "op": "add", "value": 4}
    {"id": "c86", "type": "action", "action": "freeze"}
"""

from __future__ import annotations

import random
from typing import Callable

from . import constants as C

Card = dict


def create_cards(version: int = C.DECK_VERSION) -> list[Card]:
    """Lista completa de cartas, sem embaralhar. Os ids coincidem com os do cliente.

    A versão 1 (94 cartas) existe só para reconstruir partidas antigas. As penalidades da
    versão 2 ficam no fim da lista, então os ids das outras cartas não mudam."""
    cards: list[Card] = []

    def push(card: Card) -> None:
        cards.append({"id": f"c{len(cards) + 1}", **card})

    for value, copies in enumerate(C.NUMBER_COPIES):
        for _ in range(copies):
            push({"type": C.NUMBER, "value": value})

    for value in C.ADD_MODIFIERS:
        push({"type": C.MODIFIER, "op": C.ADD, "value": value})
    push({"type": C.MODIFIER, "op": C.MULTIPLY, "value": C.MULTIPLIER_VALUE})

    for action, copies in C.ACTION_COPIES.items():
        for _ in range(copies):
            push({"type": C.ACTION, "action": action})

    if version >= 2:
        for value in C.NEGATIVE_MODIFIERS:
            push({"type": C.MODIFIER, "op": C.ADD, "value": value})

    return cards


def shuffle(cards: list[Card], rng: random.Random) -> list[Card]:
    """Fisher–Yates usando apenas `rng.random()`.

    A sequência de `random()` do Mersenne Twister é garantida estável entre versões
    do Python, o que mantém reproduzível a reconstrução de uma rodada a partir da semente.
    """
    for i in range(len(cards) - 1, 0, -1):
        j = int(rng.random() * (i + 1))
        cards[i], cards[j] = cards[j], cards[i]
    return cards


class Deck:
    """Monte de compra. Não existe pilha de descarte visível: `used` guarda as cartas
    que já saíram de jogo na rodada, só para o caso de o monte acabar antes do fim."""

    def __init__(self, rng: random.Random, cards: list[Card] | None = None, version: int = C.DECK_VERSION) -> None:
        self.rng = rng
        self.used: list[Card] = []
        # `cards` monta um baralho em ordem fixa (testes): a primeira é a primeira comprada.
        self.draw_pile: list[Card] = list(reversed(cards)) if cards is not None else shuffle(create_cards(version), rng)

    @property
    def size(self) -> int:
        return len(self.draw_pile)

    @property
    def total_available(self) -> int:
        return len(self.draw_pile) + len(self.used)

    def needs_reshuffle(self) -> bool:
        return not self.draw_pile and bool(self.used)

    def draw(self) -> Card | None:
        return self.draw_pile.pop() if self.draw_pile else None

    def discard(self, *cards: Card | None) -> None:
        self.used.extend(card for card in cards if card)

    def reshuffle(self) -> int:
        """Devolve as cartas usadas ao monte e embaralha. Retorna quantas voltaram."""
        count = len(self.used)
        self.draw_pile = shuffle(self.draw_pile + self.used, self.rng)
        self.used = []
        return count

    def count_remaining(self, predicate: Callable[[Card], bool]) -> tuple[int, int]:
        """(cartas que satisfazem `predicate`, total) no próximo monte de compra."""
        pile = self.draw_pile or self.used
        return sum(1 for card in pile if predicate(card)), len(pile)
