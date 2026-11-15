/**
 * Vira-7 — Utilitários puros usados pelo motor do jogo.
 * Não dependem do DOM, por isso também rodam nos testes em Node.
 */
((F7) => {
  'use strict';

  /**
   * Gerador pseudoaleatório determinístico (mulberry32).
   * Usado nos testes para reproduzir partidas a partir de uma semente.
   * @param {number} seed
   * @returns {() => number} função que retorna um número em [0, 1)
   */
  function createRng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Embaralha um array no lugar usando Fisher–Yates.
   * @template T
   * @param {T[]} list
   * @param {() => number} [rng]
   * @returns {T[]} o próprio array embaralhado
   */
  function shuffle(list, rng = Math.random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  const sum = (values) => values.reduce((acc, value) => acc + value, 0);

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Promessa que resolve após `ms` milissegundos. */
  const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

  /**
   * Retorna os itens de `list` começando por `startIndex`, dando a volta na mesa.
   * Ex.: rotate([a, b, c], 1) -> [b, c, a]
   */
  function rotate(list, startIndex) {
    const n = list.length;
    return list.map((_, i) => list[(startIndex + i) % n]);
  }

  F7.utils = { createRng, shuffle, sum, clamp, wait, rotate };
})(globalThis.F7 = globalThis.F7 || {});
