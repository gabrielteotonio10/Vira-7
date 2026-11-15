/**
 * Vira-7 — Baralho: criação das 94 cartas, compra, descarte e reembaralhamento.
 */
((F7) => {
  'use strict';

  const { CARD_TYPES: T, MODIFIER_OPS: OPS } = F7;

  /**
   * Cria a lista completa de cartas, sem embaralhar.
   * Cada carta recebe um `id` único, usado pela interface para animar e localizar a carta.
   * @returns {object[]}
   */
  function createCards() {
    const cards = [];
    let nextId = 1;
    const push = (card) => cards.push({ id: `c${nextId++}`, ...card });

    F7.NUMBER_COPIES.forEach((copies, value) => {
      for (let i = 0; i < copies; i++) push({ type: T.NUMBER, value });
    });

    F7.ADD_MODIFIERS.forEach((value) => push({ type: T.MODIFIER, op: OPS.ADD, value }));
    push({ type: T.MODIFIER, op: OPS.MULTIPLY, value: F7.MULTIPLIER_VALUE });

    Object.entries(F7.ACTION_COPIES).forEach(([action, copies]) => {
      for (let i = 0; i < copies; i++) push({ type: T.ACTION, action });
    });

    return cards;
  }

  class Deck {
    /**
     * @param {{ rng?: () => number, cards?: object[] }} [options]
     *   `cards` monta um baralho em ordem fixa (útil nos testes):
     *   a primeira carta da lista é a primeira a ser comprada.
     */
    constructor({ rng = Math.random, cards } = {}) {
      this.rng = rng;
      this.discardPile = [];
      this.drawPile = cards ? cards.slice().reverse() : F7.utils.shuffle(createCards(), rng);
    }

    get size() {
      return this.drawPile.length;
    }

    /** Precisa reembaralhar antes da próxima compra? */
    needsReshuffle() {
      return this.drawPile.length === 0 && this.discardPile.length > 0;
    }

    /**
     * Compra a carta do topo. Retorna `null` se não houver cartas.
     * O reembaralhamento é responsabilidade do motor, que precisa avisar a interface.
     */
    draw() {
      return this.drawPile.length ? this.drawPile.pop() : null;
    }

    /** Mostra (sem remover) as próximas `count` cartas, da próxima para a última. */
    peek(count = 1) {
      return this.drawPile.slice(-count).reverse();
    }

    /** Envia uma ou mais cartas (ou listas de cartas) para o descarte. */
    discard(...items) {
      items.flat().filter(Boolean).forEach((card) => this.discardPile.push(card));
    }

    topDiscard() {
      return this.discardPile[this.discardPile.length - 1] || null;
    }

    /**
     * Devolve o descarte para o monte de compra e embaralha.
     * Cartas que estão na mesa permanecem com os jogadores (regra oficial).
     * @returns {number} quantidade de cartas reembaralhadas
     */
    reshuffle() {
      const count = this.discardPile.length;
      this.drawPile = F7.utils.shuffle(this.drawPile.concat(this.discardPile), this.rng);
      this.discardPile = [];
      return count;
    }

    /**
     * Conta quantas cartas do próximo monte de compra satisfazem `predicate`.
     * Se o monte estiver vazio, considera o descarte (que seria reembaralhado).
     */
    countRemaining(predicate) {
      const pile = this.drawPile.length ? this.drawPile : this.discardPile;
      return { matches: pile.filter(predicate).length, total: pile.length };
    }
  }

  Deck.createCards = createCards;
  F7.Deck = Deck;
})(globalThis.F7 = globalThis.F7 || {});
