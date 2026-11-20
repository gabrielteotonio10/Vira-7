/**
 * Vira-7 — Partida online.
 *
 * O servidor é a autoridade: este módulo só mostra o que o servidor decidiu e envia
 * as intenções do jogador. Funciona assim:
 *
 *   1. busca o retrato atual da partida e os eventos já ocorridos;
 *   2. recebe novos eventos (Supabase Realtime, resposta das próprias jogadas e uma
 *      consulta periódica de segurança), descarta repetidos e preenche lacunas;
 *   3. anima os eventos em ordem, um de cada vez, reaproveitando o GameController;
 *   4. quando a fila esvazia e é a vez deste jogador, libera os botões e envia a jogada.
 */
((F7) => {
  'use strict';

  const { PLAYER_STATUS: S } = F7;
  const PLAYER_KEYS = ['player', 'from', 'to', 'by', 'winner', 'flip7Player', 'dealer'];

  /** Espelho local do estado público: tem a mesma "cara" do motor (F7.Game) para a interface. */
  class RemoteGame {
    constructor(state, myUserId) {
      this.myUserId = myUserId;
      this.players = [];
      this.deck = { size: 0, totalAvailable: 0 };
      this.targetScore = 200;
      this.round = 0;
      this.dealerSeat = 0;
      this.currentPlayer = null;
      this.awaiting = null;
      this.deadline = null;
      this.status = 'playing';
      this.turnSeconds = 0;
      /** Duplas ([{ id, seats, total }]) ou null em partida individual. */
      this.teams = null;
      this.apply(state);
    }

    get dealer() {
      return this.players[this.dealerSeat] || null;
    }

    get me() {
      return this.players.find((p) => p.isMe) || null;
    }

    apply(state) {
      if (!state || !state.players) return;
      state.players.forEach((data) => {
        let player = this.players[data.seat];
        if (!player) {
          player = new F7.Player({ id: data.seat, name: data.name, color: data.color, avatar: data.avatar, isBot: data.isBot });
          player.userId = data.userId;
          player.isMe = !!data.userId && data.userId === this.myUserId;
          this.players[data.seat] = player;
        }
        Object.assign(player, {
          total: data.total,
          history: data.history || [],
          flip7Rounds: data.flip7Rounds || [],
          status: data.status || S.ACTIVE,
          flip7: !!data.flip7,
          numbers: data.numbers || [],
          modifiers: data.modifiers || [],
          secondChance: data.secondChance || null,
          actionCards: data.actionCards || [],
          pendingActions: data.pendingActions || [],
          bustCard: data.bustCard || null,
          absent: !!data.absent,
          team: data.team === undefined ? null : data.team,
          odds: data.odds || { matches: 0, total: 0, chance: 0 },
        });
      });
      this.teams = state.teams || null;
      this.deck = { ...state.deck };
      this.targetScore = state.targetScore;
      this.round = state.round;
      this.dealerSeat = state.dealer;
      this.currentPlayer = state.currentPlayer === null || state.currentPlayer === undefined
        ? null
        : this.players[state.currentPlayer];
      // Só o último evento de cada lote traz a decisão pendente e o prazo.
      this.awaiting = state.awaiting || null;
      this.deadline = state.deadline || null;
      if (state.status) this.status = state.status;
      if (state.turnSeconds !== undefined) this.turnSeconds = state.turnSeconds;
    }

    bustOdds(player) {
      return player.odds;
    }

    bustChance(player) {
      return player.numbers.length ? player.odds.chance : 0;
    }

    /** Troca assentos (números) por objetos de jogador, como a interface espera. */
    hydrate(payload) {
      const out = { ...payload };
      const at = (seat) => (seat === null || seat === undefined ? null : this.players[seat]);
      PLAYER_KEYS.forEach((key) => {
        if (key in out) out[key] = at(out[key]);
      });
      if (out.results) out.results = out.results.map((r) => ({ ...r, player: at(r.player) }));
      if (out.collected) out.collected = out.collected.map((c) => ({ ...c, player: at(c.player) }));
      if (out.standings) out.standings = out.standings.map(at);
      if (out.leaders) out.leaders = out.leaders.map(at);
      return out;
    }
  }

  class OnlineMatch {
    /**
     * @param {{ table, hud, controller, room: object, user: object, onExit: (choice: string) => void }} deps
     */
    constructor({ table, hud, controller, room, user, onExit, spectator = false }) {
      this.table = table;
      this.hud = hud;
      this.controller = controller;
      this.room = room;
      this.user = user;
      this.onExit = onExit;
      /** Quem só assiste: vê a mesa toda, mas nunca joga. */
      this.spectator = spectator;

      this.gameId = null;
      this.game = null;
      this.queue = [];
      this.buffer = new Map();
      this.lastQueued = 0;
      this.processing = false;
      this.destroyed = false;
      this.finished = false;
      this.promptToken = 0;
      this.lastEventAt = Date.now();
      this.lastTickAt = 0;
      this.timers = [];
      this.onlineIds = null;
    }

    /* ---------------------------------------------------------------- abertura */

    async open(gameId) {
      this.gameId = gameId;
      const snapshot = await F7.Api.get(`/games/${gameId}`);
      if (this.destroyed) return;

      // Quem chega no começo assiste à distribuição; quem reconecta no meio vê a mesa pronta.
      const fresh = snapshot.state.round === 1 && snapshot.seq <= 60 && snapshot.status === 'playing';
      let history = [];
      if (fresh) history = (await F7.Api.get(`/games/${gameId}/events?after=0`)).events;
      if (this.destroyed) return;

      const first = fresh && history.length ? history[0].state : snapshot.state;
      this.game = new RemoteGame(first, this.user.id);
      const me = this.game.me;

      this.controller.attach(this.game, {
        perspective: me ? me.id : 0,
        isMe: (player) => player.isMe,
        autoNextMs: 7000,
        gameOverActions: [
          { label: 'Sair da sala', value: 'leave', variant: 'ghost', iconName: 'home' },
          this.spectator
            ? { label: 'Voltar para a sala', value: 'lobby', variant: 'primary', iconName: 'restart' }
            : { label: 'Jogar de novo', value: 'rematch', variant: 'primary', iconName: 'restart' },
        ],
      });
      document.querySelector('#spectator-bar').hidden = !this.spectator;
      document.querySelector('#game-screen').classList.toggle('is-spectating', this.spectator);
      F7.FX.setSpeed(F7.App.state.settings.animationSpeed || 1);

      if (fresh && history.length) {
        this.enqueue(history);
      } else {
        this.showSnapshot(snapshot);
      }

      // Rede de segurança: se o tempo real falhar, a consulta periódica mantém tudo em dia.
      const pollMs = F7.Realtime.live ? 4000 : 1000;
      this.timers.push(setInterval(() => this.poll(pollMs), pollMs));
      this.timers.push(setInterval(() => this.checkDeadline(), 1000));
    }

    /** Desenha a mesa direto do retrato (reconexão), sem animar o passado. */
    showSnapshot(snapshot) {
      const game = this.game;
      game.apply(snapshot.state);
      this.lastQueued = snapshot.seq;
      this.table.setup(game, { perspective: game.me ? game.me.id : 0 });
      this.hud.clearLog();
      this.hud.setTarget(game.targetScore);
      this.hud.setRound(game.round);
      this.hud.setDeckCount(game.deck.size);
      this.hud.log('Você voltou para a partida.', 'var(--brand-2)');
      this.applyPresence();
      if (snapshot.status !== 'playing') {
        this.finished = true;
        this.onExit('lobby');
        return;
      }
      if (game.currentPlayer) {
        this.controller.turnPlayer = game.currentPlayer;
        this.table.setTurn(game.currentPlayer);
        const mine = game.currentPlayer.isMe;
        this.hud.setTurn(game.currentPlayer, game, { label: mine ? 'Sua vez,' : 'Vez de' });
        this.hud.setStatus(mine ? 'Sua vez!' : `Vez de ${game.currentPlayer.name}`);
      }
      this.afterQueue();
    }

    /* ---------------------------------------------------------------- eventos */

    /** Recebe um evento do tempo real. */
    receive(event) {
      if (event.gameId && event.gameId !== this.gameId) return;
      this.enqueue([event]);
    }

    /** Coloca eventos na fila, em ordem, sem repetir. Lacunas são buscadas na API. */
    enqueue(events) {
      if (this.destroyed) return;
      events.forEach((event) => {
        if (event.seq > this.lastQueued) this.buffer.set(event.seq, event);
      });
      let advanced = false;
      while (this.buffer.has(this.lastQueued + 1)) {
        const next = this.buffer.get(this.lastQueued + 1);
        this.buffer.delete(next.seq);
        this.queue.push(next);
        this.lastQueued = next.seq;
        advanced = true;
      }
      if (advanced) this.lastEventAt = Date.now();
      if (this.buffer.size) this.fillGap();
      this.process();
    }

    async fillGap() {
      if (this.fetching) return;
      this.fetching = true;
      try {
        const { events } = await F7.Api.get(`/games/${this.gameId}/events?after=${this.lastQueued}`);
        this.fetching = false;
        this.enqueue(events);
      } catch (error) {
        this.fetching = false;
      }
    }

    async poll(interval) {
      if (this.destroyed || this.finished || this.fetching) return;
      if (Date.now() - this.lastEventAt < interval) return;
      await this.fillGap();
    }

    async process() {
      if (this.processing || this.destroyed || !this.queue.length) return;
      this.processing = true;
      // Chegou novidade: qualquer pergunta em aberto ficou desatualizada.
      this.cancelPrompt();
      const baseSpeed = F7.App.state.settings.animationSpeed || 1;

      while (this.queue.length && !this.destroyed) {
        // Muita coisa acumulada (aba em segundo plano, reconexão): acelera para alcançar.
        F7.FX.setSpeed(this.queue.length > 14 ? baseSpeed * 3 : baseSpeed);
        const event = this.queue.shift();
        this.game.apply(event.state);
        if (event.type !== 'gameStart') this.hud.setDeadline(null);
        try {
          await this.controller.onEvent(event.type, this.game.hydrate(event.payload || {}), this.game);
        } catch (error) {
          console.error('Falha ao animar o evento', event.type, error);
          this.table.renderAll();
          this.table.renderPiles();
        }
        if (event.type === 'gameStart') this.applyPresence();
        if (event.type === 'gameOver') {
          this.finished = true;
          this.processing = false;
          if (!this.destroyed) {
            const choice = this.controller.lastChoice;
            this.onExit(choice === 'leave' || choice === 'rematch' ? choice : 'lobby');
          }
          return;
        }
      }

      F7.FX.setSpeed(baseSpeed);
      this.processing = false;
      if (!this.destroyed) this.afterQueue();
    }

    /* ---------------------------------------------------------------- jogadas */

    /** Fila vazia: mostra de quem é a vez e, se for a minha, pede a jogada. */
    afterQueue() {
      const game = this.game;
      const awaiting = game.awaiting;
      game.players.forEach((p) => this.table.setThinking(p, false));
      this.hud.hidePrompt();

      if (!awaiting || this.finished) {
        this.hud.setDeadline(null);
        return;
      }

      const player = game.players[awaiting.seat];
      const deadline = F7.Api.toLocalTime(game.deadline);
      this.hud.setDeadline(deadline, Math.max(1000, game.turnSeconds * 1000));

      // Com a doca já no tamanho final, garante que o seu lugar esteja inteiro à vista.
      if (player.isMe) this.table.reveal(player);

      if (!player.isMe) {
        this.table.setThinking(player, true);
        this.hud.setActionsEnabled(false);
        this.hud.setStatus(
          awaiting.kind === 'target' ? `${player.name} está escolhendo um alvo…` : `Vez de ${player.name}`,
        );
        return;
      }
      this.prompt(awaiting, player);
    }

    async prompt(awaiting, player) {
      const token = ++this.promptToken;
      let body;
      if (awaiting.kind === 'move') {
        this.hud.setStatus('Sua vez!');
        const move = await this.controller.promptMove(player, this.game);
        body = { type: move, token: awaiting.token };
      } else {
        this.hud.setStatus('Escolha um jogador');
        const candidates = awaiting.candidates.map((seat) => this.game.players[seat]);
        const target = await this.controller.promptTarget(player, awaiting.action, candidates);
        body = { type: 'target', target: target.id, token: awaiting.token };
      }
      // A pergunta foi cancelada (chegou evento novo, tempo esgotou ou a tela fechou).
      if (token !== this.promptToken || this.destroyed) return;

      this.hud.setActionsEnabled(false);
      this.hud.setStatus('Enviando jogada…');
      try {
        const { events } = await F7.Api.post(`/games/${this.gameId}/actions`, body);
        this.enqueue(events);
      } catch (error) {
        if (this.destroyed) return;
        const stale = ['STALE_ACTION', 'NOT_YOUR_TURN', 'WRONG_ACTION', 'CONFLICT'].includes(error.code);
        if (!stale) F7.App.toast(error.message, { variant: 'bust' });
        await this.fillGap();
        // Nada novo chegou: a jogada continua sendo minha, pergunta de novo.
        if (!this.processing && !this.queue.length) this.afterQueue();
      }
    }

    cancelPrompt() {
      this.promptToken += 1;
      this.controller.cancelPending();
    }

    /** Prazo vencido: pede ao servidor para conferir (ele só age se for verdade). */
    async checkDeadline() {
      if (this.destroyed || this.finished || this.processing || !this.game || !this.game.awaiting) return;
      const deadline = F7.Api.toLocalTime(this.game.deadline);
      if (!deadline || Date.now() < deadline + 1200 || Date.now() - this.lastTickAt < 3000) return;
      this.lastTickAt = Date.now();
      try {
        const { events } = await F7.Api.post(`/games/${this.gameId}/tick`);
        this.enqueue(events);
      } catch (error) {
        /* o árbitro do servidor também cuida disso */
      }
    }

    /* ---------------------------------------------------------------- presença */

    setPresence(onlineIds) {
      this.onlineIds = onlineIds;
      this.applyPresence();
    }

    applyPresence() {
      if (!this.game || !this.onlineIds) return;
      this.game.players.forEach((player) => {
        const online = player.isBot || player.absent || this.onlineIds.has(player.userId);
        this.table.setOnline(player, online);
      });
    }

    destroy() {
      this.destroyed = true;
      this.timers.forEach(clearInterval);
      this.timers = [];
      this.queue = [];
      this.cancelPrompt();
      F7.Modals.closeAll();
      document.querySelector('#spectator-bar').hidden = true;
      document.querySelector('#game-screen').classList.remove('is-spectating');
      this.hud.setDeadline(null);
      this.hud.setTurn(null);
    }
  }

  F7.OnlineMatch = OnlineMatch;
  F7.RemoteGame = RemoteGame;
})(globalThis.F7 = globalThis.F7 || {});
