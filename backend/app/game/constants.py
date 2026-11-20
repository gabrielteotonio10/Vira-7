"""Constantes oficiais do jogo (espelham `js/core/constants.js`).

Baralho de 99 cartas, baseado nas regras do Flip 7:
  - 79 números: o número N aparece N vezes, mais uma carta 0;
  - 6 modificadores positivos: +2, +4, +6, +8, +10 e x2;
  - 5 penalidades: -6, -4 (x2) e -2 (x2), a partir da versao 2 do baralho;
  - 9 ações: 3x Congelar, 3x Vira Três e 3x Segunda Chance.
"""

from __future__ import annotations

# Tipos de carta
NUMBER = "number"
MODIFIER = "modifier"
ACTION = "action"

# Ações
FREEZE = "freeze"
FLIP_THREE = "flipThree"
SECOND_CHANCE = "secondChance"

# Operações dos modificadores
ADD = "add"
MULTIPLY = "multiply"

# Situação do jogador na rodada
ACTIVE = "active"
STAYED = "stayed"
FROZEN = "frozen"
BUSTED = "busted"

#: Quantidade de cópias de cada número (índice = valor da carta).
NUMBER_COPIES: tuple[int, ...] = (1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)
ADD_MODIFIERS: tuple[int, ...] = (2, 4, 6, 8, 10)
#: Penalidades (entram no baralho a partir da versão 2). Descontam da rodada, que nunca fica abaixo de 0.
NEGATIVE_MODIFIERS: tuple[int, ...] = (-6, -4, -4, -2, -2)
#: Versão atual do baralho. A 1 tinha 94 cartas (sem penalidades); partidas antigas continuam nela.
DECK_VERSION = 2
DECK_SIZES = {1: 94, 2: 99}
MULTIPLIER_VALUE = 2
ACTION_COPIES: dict[str, int] = {FREEZE: 3, FLIP_THREE: 3, SECOND_CHANCE: 3}

FLIP7_UNIQUE_COUNT = 7
FLIP7_BONUS = 15
FLIP_THREE_COUNT = 3
DECK_SIZE = DECK_SIZES[DECK_VERSION]

MIN_PLAYERS = 2
MAX_PLAYERS = 8
DEFAULT_TARGET_SCORE = 200
#: Metas de pontos que uma sala pode escolher.
TARGET_SCORES: tuple[int, ...] = (50, 100, 150, 200, 300, 500)
#: Tempos de turno permitidos, em segundos (0 = sem temporizador).
TURN_SECONDS: tuple[int, ...] = (0, 15, 30, 45, 60, 90)
