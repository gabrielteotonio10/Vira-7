/**
 * Vira-7 — Constantes oficiais do jogo.
 *
 * Composição do baralho (99 cartas), baseada nas regras originais do Flip 7:
 *  - 79 cartas numéricas: o número N aparece N vezes (12 cartas "12", 11 cartas "11"…),
 *    mais uma carta "1" e uma carta "0".
 *  - 6 modificadores: +2, +4, +6, +8, +10 e x2 (uma de cada).
 *  - 5 penalidades: -6 (uma), -4 (duas) e -2 (duas).
 *  - 9 cartas de ação: 3x Congelar (Freeze), 3x Vira Três (Flip Three) e 3x Segunda Chance.
 */
((F7) => {
  'use strict';

  const CARD_TYPES = Object.freeze({
    NUMBER: 'number',
    MODIFIER: 'modifier',
    ACTION: 'action',
  });

  const ACTIONS = Object.freeze({
    FREEZE: 'freeze',
    FLIP_THREE: 'flipThree',
    SECOND_CHANCE: 'secondChance',
  });

  const MODIFIER_OPS = Object.freeze({
    ADD: 'add',
    MULTIPLY: 'multiply',
  });

  const PLAYER_STATUS = Object.freeze({
    ACTIVE: 'active',
    STAYED: 'stayed',
    FROZEN: 'frozen',
    BUSTED: 'busted',
  });

  /** Quantidade de cópias de cada número (índice = valor da carta). */
  const NUMBER_COPIES = Object.freeze([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  const ADD_MODIFIERS = Object.freeze([2, 4, 6, 8, 10]);
  /** Penalidades: descontam da rodada, que nunca fica abaixo de 0. */
  const NEGATIVE_MODIFIERS = Object.freeze([-6, -4, -4, -2, -2]);
  const MULTIPLIER_VALUE = 2;

  const ACTION_COPIES = Object.freeze({
    [ACTIONS.FREEZE]: 3,
    [ACTIONS.FLIP_THREE]: 3,
    [ACTIONS.SECOND_CHANCE]: 3,
  });

  const RULES = Object.freeze({
    /** Números diferentes necessários para o bônus "Vira 7". */
    FLIP7_UNIQUE_COUNT: 7,
    /** Bônus ganho ao virar 7 números diferentes. */
    FLIP7_BONUS: 15,
    /** Pontuação padrão para vencer a partida. */
    DEFAULT_TARGET_SCORE: 200,
    /** Cartas que o jogador é obrigado a virar com "Vira Três". */
    FLIP_THREE_COUNT: 3,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 8,
    DECK_SIZE: 99,
  });

  /** "Dupla A", "Dupla B"… */
  const teamName = (index) => `Dupla ${'ABCD'[index] || index + 1}`;

  Object.assign(F7, {
    teamName,
    CARD_TYPES,
    ACTIONS,
    MODIFIER_OPS,
    PLAYER_STATUS,
    NUMBER_COPIES,
    ADD_MODIFIERS,
    NEGATIVE_MODIFIERS,
    MULTIPLIER_VALUE,
    ACTION_COPIES,
    RULES,
  });
})(globalThis.F7 = globalThis.F7 || {});
