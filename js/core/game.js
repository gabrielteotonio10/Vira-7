/**
 * Vira-7 — Motor do jogo (máquina de estados assíncrona).
 *
 * O motor aplica TODAS as regras e conversa com o mundo externo por um "agente":
 *
 *   agent.onEvent(type, payload, game)        -> Promise  (a interface anima e depois resolve)
 *   agent.chooseMove(player, game)            -> Promise<'hit' | 'stay'>
 *   agent.chooseTarget(player, kind, candidates, game) -> Promise<Player>
 *
 * O estado é sempre alterado ANTES de cada evento ser emitido, então a interface
 * pode simplesmente redesenhar a mesa a partir do estado e animar a diferença.
 *
 * Não existe pilha de descarte visível: as cartas usadas ficam fora do monte até a rodada acabar,
 * quando TODAS voltam e são reembaralhadas ('reshuffle' com `newRound: true`). Se o monte acabar
 * no meio da rodada, as cartas já usadas são reembaralhadas ('reshuffle' sem `newRound`).
 *
 * Eventos emitidos (em ordem típica):
 *   gameStart, reshuffle, roundStart, turnStart, cardDrawn, bust, secondChanceUsed,
 *   secondChanceKept, secondChanceGiven, cardDiscarded, actionPlayed, freeze,
 *   flipThreeStart, flipThreeEnd, flip7, stay, turnEnd, roundEnd, roundCleanup,
 *   tieBreak, gameOver
 */
((F7) => {
  'use strict';

  const { CARD_TYPES: T, ACTIONS: A, PLAYER_STATUS: S, RULES } = F7;

  /** Lançado quando a partida é interrompida (ex.: "Nova partida" no meio do jogo). */
  class GameAbortedError extends Error {
    constructor() {
      super('Partida interrompida');
      this.name = 'GameAbortedError';
    }
  }

  const PHASES = Object.freeze({
    IDLE: 'idle',
    DEAL: 'deal',
    TURNS: 'turns',
    ROUND_END: 'roundEnd',
    OVER: 'over',
  });

  class Game {
    /**
     * @param {{
     *   players: Array<{ name: string, color?: string, isBot?: boolean, riskTolerance?: number }>,
     *   targetScore?: number,
     *   rng?: () => number,
     *   deck?: F7.Deck,
     *   firstDealer?: number,
     * }} config
     * @param {object} agent
     */
    constructor(config, agent = {}) {
      const count = config.players.length;
      if (count < RULES.MIN_PLAYERS || count > RULES.MAX_PLAYERS) {
        throw new RangeError(`O jogo aceita de ${RULES.MIN_PLAYERS} a ${RULES.MAX_PLAYERS} jogadores.`);
      }

      this.rng = config.rng || Math.random;
      this.players = config.players.map((data, id) => new F7.Player({ ...data, id }));
      this.targetScore = config.targetScore || RULES.DEFAULT_TARGET_SCORE;
      this.deck = config.deck || new F7.Deck({ rng: this.rng, version: config.deckVersion || 2 });
      this.agent = agent;

      // Duplas (2x2): só com 4, 6 ou 8 jogadores. Parceiros ficam em lugares opostos.
      this.teamMode = !!config.teams;
      if (this.teamMode) {
        if (count < 4 || count % 2) throw new RangeError('Partida em duplas precisa de 4, 6 ou 8 jogadores.');
        this.players.forEach((player) => {
          player.team = F7.Scoring.teamOf(player.id, count);
        });
      }

      const firstDealer = Number.isInteger(config.firstDealer)
        ? config.firstDealer
        : Math.floor(this.rng() * count);
      // O índice é incrementado no início de cada rodada.
      this.dealerIndex = (firstDealer - 1 + count) % count;

      this.round = 0;
      this.phase = PHASES.IDLE;
      this.currentPlayer = null;
      this.roundOver = false;
      this.flip7Player = null;
      this.winner = null;
      this.aborted = false;
    }

    /* ------------------------------------------------------------------ */
    /* Consultas                                                           */
    /* ------------------------------------------------------------------ */

    get dealer() {
      return this.players[this.dealerIndex];
    }

    /** Pontos de cada dupla (soma dos jogadores) ou null em partida individual. */
    get teams() {
      if (!this.teamMode) return null;
      return F7.Scoring.teamGroups(this.players.length).map((seats, id) => ({
        id,
        seats,
        total: seats.reduce((sum, seat) => sum + this.players[seat].total, 0),
      }));
    }

    activePlayers() {
      return this.players.filter((p) => p.isActive());
    }

    anyActive() {
      return this.players.some((p) => p.isActive());
    }

    /** Jogadores em ordem de turno, começando à esquerda do carteador. */
    turnOrder() {
      return F7.utils.rotate(this.players, (this.dealerIndex + 1) % this.players.length);
    }

    /** Pontos que o jogador marcaria se parasse agora. */
    scoreFor(player) {
      return F7.Scoring.compute(player);
    }

    /**
     * Quantas cartas do monte repetiriam um número do jogador.
     * (Todas as cartas são públicas no Flip 7, então essa informação é legítima.)
     * @returns {{ matches: number, total: number, chance: number }}
     */
    bustOdds(player) {
      const owned = new Set(player.numbers.map((c) => c.value));
      const { matches, total } = this.deck.countRemaining(
        (card) => card.type === T.NUMBER && owned.has(card.value),
      );
      return { matches, total, chance: total ? matches / total : 0 };
    }

    /** Probabilidade exata de a próxima carta estourar o jogador (0 a 1). */
    bustChance(player) {
      return player.numbers.length ? this.bustOdds(player).chance : 0;
    }

    /** Classificação: por pontos (ou, em duplas, pelos pontos da dupla e depois do jogador). */
    standings() {
      if (!this.teamMode) return F7.Scoring.standings(this.players);
      const total = new Map(this.teams.map((team) => [team.id, team.total]));
      return this.players.slice().sort((a, b) => total.get(b.team) - total.get(a.team) || b.total - a.total || a.id - b.id);
    }

    /** Interrompe a partida na próxima oportunidade. */
    abort() {
      this.aborted = true;
    }

    /* ------------------------------------------------------------------ */
    /* Comunicação com o agente                                            */
    /* ------------------------------------------------------------------ */

    async emit(type, payload = {}) {
      if (this.aborted) throw new GameAbortedError();
      if (typeof this.agent.onEvent === 'function') {
        await this.agent.onEvent(type, payload, this);
      }
      if (this.aborted) throw new GameAbortedError();
    }

    async askMove(player) {
      const ask = this.agent.chooseMove || ((p, g) => F7.AI.decideMove(p, g));
      const move = await ask.call(this.agent, player, this);
      if (this.aborted) throw new GameAbortedError();
      return move === 'stay' ? 'stay' : 'hit';
    }

    async askTarget(player, kind, candidates) {
      if (candidates.length === 1) return candidates[0];
      const ask = this.agent.chooseTarget || ((p, k, c, g) => F7.AI.chooseTarget(p, k, c, g));
      const target = await ask.call(this.agent, player, kind, candidates, this);
      if (this.aborted) throw new GameAbortedError();
      return candidates.includes(target) ? target : candidates[0];
    }

    /* ------------------------------------------------------------------ */
    /* Fluxo da partida                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Joga a partida inteira.
     * @returns {Promise<Player|null>} vencedor, ou `null` se a partida for interrompida.
     */
    async run() {
      try {
        await this.emit('gameStart', { players: this.players, targetScore: this.targetScore });
        let result;
        do {
          await this.playRound();
          result = F7.Scoring.checkVictory(this.teamMode ? this.teams : this.players, this.targetScore);
          if (result.tie) {
            // Em duplas, `leaders` são duplas: o aviso mostra as pessoas de cada uma.
            const leaders = this.teamMode ? result.leaders.flatMap((team) => team.seats.map((seat) => this.players[seat])) : result.leaders;
            await this.emit('tieBreak', { leaders });
          }
        } while (!result.over);

        this.phase = PHASES.OVER;
        let winnerTeam = null;
        if (this.teamMode) {
          // Quem fechou a partida é a pessoa da dupla vencedora com mais pontos.
          winnerTeam = result.winner.id;
          this.winner = result.winner.seats.map((seat) => this.players[seat]).sort((a, b) => b.total - a.total || a.id - b.id)[0];
        } else {
          this.winner = result.winner;
        }
        await this.emit('gameOver', {
          winner: this.winner,
          winnerTeam,
          standings: this.standings(),
        });
        return this.winner;
      } catch (error) {
        if (error instanceof GameAbortedError) return null;
        throw error;
      }
    }

    async playRound() {
      this.round += 1;
      this.dealerIndex = (this.dealerIndex + 1) % this.players.length;
      this.roundOver = false;
      this.flip7Player = null;
      this.currentPlayer = null;
      this.players.forEach((p) => p.resetRound());

      // Toda rodada começa com todas as cartas de volta ao monte, embaralhadas.
      if (this.round > 1) {
        this.deck.reshuffle();
        await this.emit('reshuffle', { count: this.deck.size, newRound: true });
      }

      await this.emit('roundStart', { round: this.round, dealer: this.dealer });

      this.phase = PHASES.DEAL;
      await this.dealInitialCards();

      this.phase = PHASES.TURNS;
      await this.playTurns();

      this.phase = PHASES.ROUND_END;
      await this.endRound();
    }

    /**
     * Distribuição inicial: uma carta para cada jogador, começando à esquerda do carteador.
     * Cartas de ação são resolvidas na hora. Quem já recebeu cartas (por um Vira Três)
     * ou já saiu da rodada (congelado/estourado) não recebe outra.
     */
    async dealInitialCards() {
      // Só quem já foi servido (ou virou 3 cartas durante a distribuição) é pulado: uma
      // Segunda Chance doada não conta como carta inicial.
      this.dealt = new Set();
      for (const player of this.turnOrder()) {
        if (this.roundOver) return;
        if (!player.isActive() || this.dealt.has(player)) continue;
        this.dealt.add(player);
        this.currentPlayer = player;
        await this.drawCard(player, { source: 'deal' });
      }
    }

    async playTurns() {
      const order = this.turnOrder();
      let index = 0;
      while (!this.roundOver && this.anyActive()) {
        const player = order[index % order.length];
        index += 1;
        if (!player.isActive()) continue;

        this.currentPlayer = player;
        await this.emit('turnStart', { player });

        const move = await this.askMove(player);
        if (move === 'stay') {
          player.status = S.STAYED;
          await this.emit('stay', { player, score: this.scoreFor(player) });
        } else {
          await this.drawCard(player, { source: 'hit' });
        }

        await this.emit('turnEnd', { player });
      }
      this.currentPlayer = null;
    }

    async endRound() {
      const results = this.players.map((player) => {
        const breakdown = F7.Scoring.compute(player);
        player.roundScore = breakdown.total;
        player.total += breakdown.total;
        player.history.push(breakdown.total);
        if (player.flip7) player.flip7Rounds.push(this.round);
        return {
          player,
          status: player.status,
          flip7: player.flip7,
          breakdown,
          roundScore: breakdown.total,
          total: player.total,
        };
      });

      await this.emit('roundEnd', {
        round: this.round,
        results,
        flip7Player: this.flip7Player,
        standings: this.standings(),
      });

      const collected = this.players.map((player) => ({ player, cards: player.collectCards() }));
      collected.forEach(({ cards }) => this.deck.discard(cards));
      await this.emit('roundCleanup', { collected });
    }

    /* ------------------------------------------------------------------ */
    /* Cartas                                                              */
    /* ------------------------------------------------------------------ */

    async drawFromDeck() {
      if (this.deck.needsReshuffle()) {
        const count = this.deck.reshuffle();
        await this.emit('reshuffle', { count });
      }
      return this.deck.draw();
    }

    /**
     * Compra uma carta para `player` e aplica seu efeito.
     * @param {{ source: 'deal'|'hit'|'flipThree', index?: number, queue?: object[] }} context
     */
    async drawCard(player, context) {
      const card = await this.drawFromDeck();
      if (!card) {
        // Não há mais cartas em lugar nenhum: o jogador é obrigado a parar.
        player.status = S.STAYED;
        await this.emit('stay', { player, score: this.scoreFor(player), forced: true });
        return;
      }

      if (card.type === T.NUMBER) return this.resolveNumber(player, card, context);
      if (card.type === T.MODIFIER) return this.resolveModifier(player, card, context);
      return this.resolveAction(player, card, context);
    }

    async resolveNumber(player, card, context) {
      if (player.hasNumber(card.value)) {
        player.bustCard = card;
        await this.emit('cardDrawn', { player, card, context, duplicate: true });

        if (player.secondChance) {
          const secondChance = player.secondChance;
          player.secondChance = null;
          player.bustCard = null;
          this.deck.discard(card, secondChance);
          await this.emit('secondChanceUsed', { player, card, secondChance });
          return;
        }

        player.status = S.BUSTED;
        await this.emit('bust', { player, card });
        return;
      }

      player.numbers.push(card);
      await this.emit('cardDrawn', { player, card, context });

      if (player.uniqueCount() >= RULES.FLIP7_UNIQUE_COUNT) {
        player.flip7 = true;
        player.status = S.STAYED;
        this.roundOver = true;
        this.flip7Player = player;
        await this.emit('flip7', { player, score: this.scoreFor(player) });
      }
    }

    async resolveModifier(player, card, context) {
      player.modifiers.push(card);
      await this.emit('cardDrawn', { player, card, context });
    }

    async resolveAction(player, card, context) {
      if (card.action === A.SECOND_CHANCE) return this.resolveSecondChance(player, card, context);

      player.pendingActions.push(card);
      await this.emit('cardDrawn', { player, card, context });

      // Durante um Vira Três, Congelar e Vira Três ficam guardados até o fim das 3 cartas.
      if (context.source === 'flipThree') {
        context.queue.push(card);
        return;
      }
      await this.playAction(player, card);
    }

    async resolveSecondChance(player, card, context) {
      if (!player.secondChance) {
        player.secondChance = card;
        await this.emit('cardDrawn', { player, card, context });
        await this.emit('secondChanceKept', { player, card });
        return;
      }

      // Já tem uma: precisa dar para outro jogador ativo que ainda não tenha.
      player.pendingActions.push(card);
      await this.emit('cardDrawn', { player, card, context });

      const candidates = this.activePlayers().filter((p) => p !== player && !p.secondChance);
      player.removePendingAction(card);

      if (!candidates.length) {
        this.deck.discard(card);
        await this.emit('cardDiscarded', { player, card, reason: 'secondChance' });
        return;
      }

      const target = await this.askTarget(player, A.SECOND_CHANCE, candidates);
      target.secondChance = card;
      await this.emit('secondChanceGiven', { from: player, to: target, card });
    }

    /** Joga uma carta de Congelar ou Vira Três em um jogador ativo (pode ser o próprio). */
    async playAction(player, card) {
      const candidates = this.activePlayers();
      if (!candidates.length || this.roundOver) {
        player.removePendingAction(card);
        this.deck.discard(card);
        await this.emit('cardDiscarded', { player, card, reason: 'noTarget' });
        return;
      }

      const target = await this.askTarget(player, card.action, candidates);
      player.removePendingAction(card);
      target.actionCards.push(card);
      await this.emit('actionPlayed', { from: player, to: target, card });

      if (card.action === A.FREEZE) {
        target.status = S.FROZEN;
        await this.emit('freeze', { player: target, by: player, score: this.scoreFor(target) });
      } else {
        await this.flipThree(target, player);
      }
    }

    /**
     * Vira Três: o alvo é obrigado a virar as próximas 3 cartas, uma de cada vez.
     * Para antes se ele estourar ou completar o Vira 7.
     */
    async flipThree(target, by) {
      await this.emit('flipThreeStart', { player: target, by });
      if (this.phase === PHASES.DEAL && this.dealt) this.dealt.add(target);

      const context = { source: 'flipThree', index: 0, queue: [] };
      for (let i = 1; i <= RULES.FLIP_THREE_COUNT; i++) {
        if (this.roundOver || !target.isActive()) break;
        context.index = i;
        await this.drawCard(target, context);
      }

      await this.emit('flipThreeEnd', { player: target });

      // Ações guardadas só valem se o alvo continuar na rodada.
      for (const card of context.queue) {
        if (target.isActive() && !this.roundOver) {
          await this.playAction(target, card);
        } else {
          target.removePendingAction(card);
          this.deck.discard(card);
          await this.emit('cardDiscarded', { player: target, card, reason: 'flipThreeCancelled' });
        }
      }
    }
  }

  Game.PHASES = PHASES;
  F7.Game = Game;
  F7.GameAbortedError = GameAbortedError;
})(globalThis.F7 = globalThis.F7 || {});
