/**
 * Vira-7 — Jogador: cartas na mesa, situação na rodada e pontuação acumulada.
 */
((F7) => {
  'use strict';

  const S = F7.PLAYER_STATUS;

  class Player {
    /**
     * @param {{ id: number, name: string, color?: string, isBot?: boolean, riskTolerance?: number }} data
     */
    constructor({ id, name, color = '#6366f1', isBot = false, riskTolerance = 0.3 }) {
      this.id = id;
      this.name = name;
      this.color = color;
      this.isBot = isBot;
      /** Personalidade do robô: quanto maior, mais arrisca (0 a 1). */
      this.riskTolerance = riskTolerance;
      this.total = 0;
      /** Pontos feitos em cada rodada, na ordem. */
      this.history = [];
      /** Rodadas (1, 2, 3…) em que o jogador fez Vira 7. */
      this.flip7Rounds = [];
      this.resetRound();
    }

    /** Limpa o estado da rodada. As cartas devem ter sido recolhidas antes. */
    resetRound() {
      this.status = S.ACTIVE;
      /** Cartas numéricas válidas (sem repetição). */
      this.numbers = [];
      /** Modificadores +2…+10 e x2. */
      this.modifiers = [];
      /** Segunda Chance guardada (no máximo uma). */
      this.secondChance = null;
      /** Cartas de ação jogadas neste jogador (Congelar / Vira Três). */
      this.actionCards = [];
      /** Cartas de ação compradas que ainda aguardam um alvo. */
      this.pendingActions = [];
      /** Carta repetida que causou o estouro (fica visível até o fim da rodada). */
      this.bustCard = null;
      this.flip7 = false;
      this.roundScore = 0;
    }

    isActive() {
      return this.status === S.ACTIVE;
    }

    hasNumber(value) {
      return this.numbers.some((card) => card.value === value);
    }

    uniqueCount() {
      return this.numbers.length;
    }

    /** Todas as cartas da mesa deste jogador. */
    tableCards() {
      return [
        ...this.numbers,
        ...this.modifiers,
        ...this.actionCards,
        ...this.pendingActions,
        this.secondChance,
        this.bustCard,
      ].filter(Boolean);
    }

    cardCount() {
      return this.tableCards().length;
    }

    /** Remove e devolve todas as cartas da mesa deste jogador. */
    collectCards() {
      const cards = this.tableCards();
      this.numbers = [];
      this.modifiers = [];
      this.actionCards = [];
      this.pendingActions = [];
      this.secondChance = null;
      this.bustCard = null;
      return cards;
    }

    removePendingAction(card) {
      const index = this.pendingActions.indexOf(card);
      if (index >= 0) this.pendingActions.splice(index, 1);
    }
  }

  F7.Player = Player;
})(globalThis.F7 = globalThis.F7 || {});
