/**
 * Vira-7 — Controlador da partida.
 *
 * É o "agente" do motor (F7.Game): recebe cada evento, anima a mesa e só então
 * devolve o controle. Também coleta as decisões das pessoas (botões/teclado/cliques)
 * e das CPUs (F7.AI), com pausas que deixam a jogada legível.
 */
((F7) => {
  'use strict';

  const { qs } = F7.dom;
  const { esc, who } = F7.Hud;
  const { CARD_TYPES: T, ACTIONS: A, MODIFIER_OPS: OPS } = F7;

  const TARGET_INFO = {
    [A.FREEZE]: { verb: 'congelar', label: 'Congelar', color: '#7fd8ff', iconName: 'snowflake' },
    [A.FLIP_THREE]: { verb: 'virar três cartas', label: 'Vira Três', color: '#c77dff', iconName: 'flipThree' },
    [A.SECOND_CHANCE]: { verb: 'receber a Segunda Chance', label: 'Segunda Chance', color: '#5ef2b0', iconName: 'heart' },
  };

  const RAINBOW = ['#ff5e7e', '#ffb547', '#ffe45e', '#5eff9b', '#5ee7ff', '#8a7bff', '#ff5ec8'];

  /** Nome da carta para o histórico, com destaque. */
  const cardLabel = (card) => `<b>${esc(F7.CardView.cardName(card))}</b>`;

  class GameController {
    constructor({ table, hud }) {
      this.table = table;
      this.hud = hud;
      this.game = null;
      this.turnPlayer = null;
      this.lastChoice = null;
    }

    attach(game) {
      this.game = game;
      this.turnPlayer = null;
      this.lastChoice = null;
    }

    /** Libera qualquer espera de entrada (usado ao interromper a partida). */
    cancelPending() {
      this.hud.cancelWait();
      this.table.cancelTargeting();
      this.hud.hidePrompt();
    }

    /* ================================================================== */
    /* Interface de agente do motor                                        */
    /* ================================================================== */

    async onEvent(type, payload, game) {
      const handler = this[`on${type.charAt(0).toUpperCase()}${type.slice(1)}`];
      if (typeof handler === 'function') await handler.call(this, payload, game);
    }

    async chooseMove(player, game) {
      if (player.isBot) {
        this.table.setThinking(player, true);
        await F7.FX.wait(550 + Math.random() * 450);
        this.table.setThinking(player, false);
        return F7.AI.decideMove(player, game);
      }
      this.hud.updateRisk(player, game);
      return this.hud.waitForMove();
    }

    async chooseTarget(player, kind, candidates, game) {
      const info = TARGET_INFO[kind];
      if (player.isBot) {
        const target = F7.AI.chooseTarget(player, kind, candidates, game);
        await this.table.previewTargets(candidates, target, info);
        return target;
      }
      this.hud.showPrompt(`${player.name}, escolha quem vai ${info.verb}`, {
        iconName: info.iconName,
        color: info.color,
      });
      const target = await this.table.chooseTarget(candidates, info);
      this.hud.hidePrompt();
      return target;
    }

    /* ================================================================== */
    /* Ajudantes de animação                                               */
    /* ================================================================== */

    /** Retângulo do tamanho de uma carta, centrado em um elemento (fallback). */
    cardRectAt(el, width = 34) {
      const rect = el.getBoundingClientRect();
      const height = width * 1.4;
      return new DOMRect(rect.left + rect.width / 2 - width / 2, rect.top + rect.height / 2 - height / 2, width, height);
    }

    sizeOf(el) {
      return el.classList.contains('card--xs') ? 'xs' : 'sm';
    }

    /** Compra: a carta sai do monte, gira no ar e pousa no lugar do jogador. */
    async flyFromDeck(card, player) {
      const from = this.table.deckTopEl().getBoundingClientRect();
      this.table.renderPiles();
      this.hud.setDeckCount(this.game.deck.size);
      this.table.reveal(player);
      this.table.renderSeat(player, { hidden: [card.id] });

      const slot = this.table.cardEl(card.id);
      if (!slot) return null;
      F7.Sound.flip();
      await F7.FX.flyCard({
        cardEl: F7.CardView.create(card, { size: this.sizeOf(slot), faceDown: true }),
        from,
        to: slot.getBoundingClientRect(),
        flip: true,
        duration: 640,
      });
      return this.landCard(card.id);
    }

    landCard(cardId) {
      const landed = this.table.cardEl(cardId);
      if (landed) {
        landed.classList.remove('is-ghost');
        landed.classList.add('is-new');
      }
      return landed;
    }

    /** Move uma carta de um lugar para outro (cartas de ação e Segunda Chance). */
    async moveBetweenSeats(card, from, to) {
      const fromEl = this.table.cardEl(card.id);
      const fromRect = fromEl ? fromEl.getBoundingClientRect() : this.cardRectAt(this.table.seatEl(from));
      this.table.renderSeat(from);
      this.table.reveal(to);
      this.table.renderSeat(to, { hidden: [card.id] });
      const slot = this.table.cardEl(card.id);
      if (!slot) return null;
      await F7.FX.flyCard({
        cardEl: F7.CardView.create(card, { size: this.sizeOf(slot) }),
        from: fromRect,
        to: slot.getBoundingClientRect(),
        duration: 600,
        lift: 1.5,
      });
      return this.landCard(card.id);
    }

    /** Leva uma carta (a partir de um retângulo já medido) até o descarte. */
    flyRectToDiscard(card, fromRect, delay = 0) {
      const to = this.table.discardTopEl().getBoundingClientRect();
      return F7.FX.wait(delay).then(() =>
        F7.FX.flyCard({
          cardEl: F7.CardView.create(card, { size: 'md' }),
          from: fromRect,
          to,
          duration: 480,
          lift: 1.05,
        }),
      );
    }

    refreshRisk() {
      if (this.turnPlayer) this.hud.updateRisk(this.turnPlayer, this.game);
    }

    /* ================================================================== */
    /* Eventos do motor                                                    */
    /* ================================================================== */

    async onGameStart(payload, game) {
      this.table.setup(game);
      this.hud.setTarget(game.targetScore);
      this.hud.setDeckCount(game.deck.size);
      this.hud.clearLog();
      this.hud.setTurn(null);
      this.hud.log(
        `Partida iniciada com ${game.players.length} jogadores. Meta: <b>${game.targetScore} pontos</b>.`,
        'var(--brand-2)',
      );
    }

    async onRoundStart({ round, dealer }) {
      this.turnPlayer = null;
      this.hud.setRound(round);
      this.hud.setTurn(null);
      this.table.setTurn(null);
      this.table.renderPiles();
      this.hud.logRound(round, dealer);
      await F7.FX.banner(`Rodada ${round}`, { sub: `${dealer.name} distribui as cartas`, variant: 'round', hold: 450 });
    }

    async onReshuffle({ count }) {
      const from = this.table.discardTopEl().getBoundingClientRect();
      const to = this.table.deckTopEl().getBoundingClientRect();
      F7.Sound.reshuffle();
      const flights = Array.from({ length: Math.min(6, count) }, (_, i) =>
        F7.FX.wait(i * 70).then(() =>
          F7.FX.flyCard({ cardEl: F7.CardView.create(null, { size: 'md' }), from, to, duration: 420, lift: 1.1 }),
        ),
      );
      await Promise.all(flights);
      this.table.renderPiles();
      this.hud.setDeckCount(this.game.deck.size);
      this.hud.toast(`Monte vazio! ${count} cartas do descarte foram embaralhadas.`, { iconName: 'restart' });
      this.hud.log(`Monte reembaralhado com ${count} cartas do descarte.`, 'var(--gold)');
    }

    async onTurnStart({ player }, game) {
      this.turnPlayer = player;
      this.table.setTurn(player);
      this.hud.setTurn(player, game);
      if (!player.isBot) F7.Sound.turn();
    }

    async onTurnEnd() {
      await F7.FX.wait(120);
    }

    async onCardDrawn({ player, card, context, duplicate }) {
      const landed = await this.flyFromDeck(card, player);
      const color = F7.CardView.cardColor(card);
      const inFlipThree = context && context.source === 'flipThree';

      if (inFlipThree) this.table.setFlipThree(player, context.index);

      if (card.type === T.NUMBER && !duplicate) {
        F7.Sound.number(player.numbers.length - 1);
        F7.FX.floatText(landed, `+${card.value}`, color);
        F7.FX.burstAt(landed, { colors: [color, '#ffffff'], count: 12, speed: 220, size: 4, life: 0.6 });
        if (player.numbers.length === F7.RULES.FLIP7_UNIQUE_COUNT - 1 && player.isActive()) {
          this.hud.toast(`${who(player)} está a um número do <b>Vira 7</b>!`, { iconName: 'sparkles' });
        }
      } else if (card.type === T.MODIFIER) {
        F7.Sound.modifier();
        F7.FX.floatText(landed, card.op === OPS.MULTIPLY ? '×2!' : `+${card.value}`, color);
        F7.FX.burstAt(landed, { colors: ['#ffd166', '#ffffff', color], count: 16, shape: 'star', speed: 260, size: 5 });
      } else if (card.type === T.ACTION) {
        if (card.action === A.SECOND_CHANCE) F7.Sound.secondChance();
        else F7.Sound.turn();
        F7.FX.floatText(landed, `${F7.CardView.ACTION_INFO[card.action].name}!`, color);
        F7.FX.burstAt(landed, { colors: [color, '#ffffff'], count: 18, shape: 'star', speed: 280, size: 5 });
      }

      const source = context.source === 'deal' ? 'recebeu' : 'virou';
      const extra = inFlipThree ? ` <small>(Vira Três ${context.index}/3)</small>` : '';
      this.hud.log(`${who(player)} ${source} ${cardLabel(card)}${extra}`, color);
      this.refreshRisk();
      await F7.FX.wait(duplicate ? 300 : 200);
    }

    async onBust({ player, card }) {
      const seat = this.table.seatEl(player);
      const dupEl = this.table.cardEl(card.id);
      F7.Sound.bust();
      F7.FX.flash();
      F7.FX.shake(seat);
      F7.FX.burstAt(dupEl || seat, {
        colors: ['#ff4d6d', '#ff8fa3', '#ffffff'],
        shape: 'shard',
        count: 26,
        speed: 420,
        size: 6,
      });
      this.table.renderSeat(player);
      this.refreshRisk();
      this.hud.toast(`${who(player)} estourou com um <b>${card.value}</b> repetido!`, {
        variant: 'bust',
        iconName: 'bolt',
      });
      this.hud.log(`${who(player)} <b style="color:var(--danger)">estourou</b> com o ${card.value} repetido`, 'var(--danger)');
      await F7.FX.banner('Estourou!', { sub: `${player.name} repetiu o ${card.value}`, variant: 'bust', hold: 450 });
    }

    async onSecondChanceUsed({ player, card, secondChance }) {
      const dupEl = this.table.cardEl(card.id);
      const scEl = this.table.cardEl(secondChance.id);
      const seat = this.table.seatEl(player);
      const dupRect = dupEl ? dupEl.getBoundingClientRect() : this.cardRectAt(seat);
      const scRect = scEl ? scEl.getBoundingClientRect() : this.cardRectAt(seat);

      F7.Sound.shieldBreak();
      F7.FX.burstAt(scEl || seat, { colors: ['#5ef2b0', '#ffffff', '#12b5a5'], shape: 'shard', count: 24, speed: 360 });
      this.table.renderSeat(player);

      const flights = [this.flyRectToDiscard(card, dupRect), this.flyRectToDiscard(secondChance, scRect, 120)];
      this.hud.toast(`A Segunda Chance salvou ${who(player)}!`, { variant: 'chance', iconName: 'shield' });
      this.hud.log(`${who(player)} usou a <b>Segunda Chance</b> e descartou o ${card.value} repetido`, '#5ef2b0');
      await Promise.all([
        ...flights,
        F7.FX.banner('Salvo!', { sub: `A Segunda Chance protegeu ${player.name}`, variant: 'chance', hold: 350 }),
      ]);
      this.table.renderPiles();
      this.refreshRisk();
    }

    async onSecondChanceKept({ player }) {
      this.hud.log(`${who(player)} guardou a Segunda Chance`, '#5ef2b0');
      this.refreshRisk();
    }

    async onSecondChanceGiven({ from, to, card }) {
      F7.Sound.secondChance();
      await this.moveBetweenSeats(card, from, to);
      F7.FX.burstAt(this.table.cardEl(card.id), { colors: ['#5ef2b0', '#ffffff'], shape: 'star', count: 16 });
      this.hud.toast(`${who(from)} deu a Segunda Chance para ${who(to)}`, { variant: 'chance', iconName: 'heart' });
      this.hud.log(`${who(from)} deu a Segunda Chance para ${who(to)}`, '#5ef2b0');
      this.refreshRisk();
    }

    async onCardDiscarded({ player, card, reason }) {
      const el = this.table.cardEl(card.id);
      const rect = el ? el.getBoundingClientRect() : this.cardRectAt(this.table.seatEl(player));
      this.table.renderSeat(player);
      await this.flyRectToDiscard(card, rect);
      this.table.renderPiles();

      const messages = {
        secondChance: `Ninguém pôde receber a Segunda Chance extra de ${who(player)}: descartada.`,
        flipThreeCancelled: `${cardLabel(card)} de ${who(player)} foi descartada.`,
        noTarget: `${cardLabel(card)} ficou sem alvo e foi descartada.`,
      };
      this.hud.log(messages[reason] || `${cardLabel(card)} foi descartada.`, 'var(--text-dim)');
    }

    async onActionPlayed({ from, to, card }) {
      await this.moveBetweenSeats(card, from, to);
      const target = from === to ? 'em si mesmo' : `em ${who(to)}`;
      this.hud.log(`${who(from)} jogou ${cardLabel(card)} ${target}`, TARGET_INFO[card.action].color);
    }

    async onFreeze({ player, score }) {
      const seat = this.table.seatEl(player);
      this.table.renderSeat(player);
      F7.Sound.freeze();
      F7.FX.snow(seat, 40);
      F7.FX.flash('rgba(127, 216, 255, 0.45)');
      this.refreshRisk();
      this.hud.toast(`${who(player)} foi congelado com <b>${score.total}</b> pontos`, {
        variant: 'freeze',
        iconName: 'snowflake',
      });
      this.hud.log(`${who(player)} foi congelado e guarda ${score.total} pontos`, '#7fd8ff');
      await F7.FX.banner('Congelado!', { sub: `${player.name} guarda ${score.total} pontos`, variant: 'freeze', hold: 500 });
    }

    async onFlipThreeStart({ player }) {
      this.table.setFlipThree(player, 0);
      this.table.reveal(player);
      F7.Sound.flipThree();
      F7.FX.shake(this.table.seatEl(player));
      this.hud.log(`${who(player)} precisa virar 3 cartas`, '#c77dff');
      await F7.FX.banner('Vira Três!', { sub: `${player.name} precisa virar 3 cartas`, variant: 'flipThree', hold: 450 });
    }

    async onFlipThreeEnd({ player }) {
      await F7.FX.wait(250);
      this.table.setFlipThree(player, null);
      this.table.renderSeat(player);
    }

    async onFlip7({ player, score }) {
      const seat = this.table.seatEl(player);
      this.table.renderSeat(player);
      F7.Sound.flip7();
      F7.FX.confetti();
      F7.FX.burstAt(seat, { colors: RAINBOW, shape: 'star', count: 40, speed: 520, size: 7, life: 1.2 });
      this.hud.log(`${who(player)} fez <b>VIRA 7</b>! +15 de bônus (${score.total} pontos na rodada)`, 'var(--gold)');
      await F7.FX.banner('Vira 7!', { sub: `${player.name} ganha +15 de bônus`, variant: 'flip7', hold: 1300 });
    }

    async onStay({ player, score, forced }) {
      const seat = this.table.seatEl(player);
      this.table.renderSeat(player);
      F7.Sound.stay();
      const roundEl = seat && qs('.seat__round', seat);
      F7.FX.floatText(roundEl || seat, `${score.total} garantidos`, '#3ee08f');
      F7.FX.burstAt(roundEl || seat, { colors: ['#3ee08f', '#ffffff'], count: 14, speed: 200, size: 4 });
      this.hud.setActionsEnabled(false);
      const why = forced ? ' (acabaram as cartas)' : '';
      this.hud.log(`${who(player)} parou com <b>${score.total}</b> pontos${why}`, 'var(--success)');
      await F7.FX.wait(350);
    }

    async onRoundEnd(payload, game) {
      const { results } = payload;
      this.turnPlayer = null;
      this.hud.setTurn(null);
      this.table.setTurn(null, { keepTotal: true });
      F7.Sound.roundEnd();

      await Promise.all(
        results.map(({ player, roundScore, total }) => {
          const totalEl = qs('.seat__total b', this.table.seatEl(player));
          if (roundScore > 0) F7.FX.floatText(totalEl, `+${roundScore}`, '#ffd166');
          return F7.FX.countUp(totalEl, total - roundScore, total, 900);
        }),
      );
      this.table.renderAll();
      await F7.FX.wait(350);

      const victory = F7.Scoring.checkVictory(game.players, game.targetScore);
      const allBots = game.players.every((p) => p.isBot);
      await F7.Modals.roundSummary(payload, game, {
        autoNextMs: allBots ? 6000 : 0,
        finalRound: victory.over,
        tie: victory.tie,
      });
    }

    async onRoundCleanup({ collected }) {
      const flights = [];
      let index = 0;
      const discard = this.table.discardTopEl().getBoundingClientRect();
      collected.forEach(({ cards }) => {
        cards.forEach((card) => {
          const el = this.table.cardEl(card.id);
          if (!el || index >= 40) return;
          const rect = el.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > window.innerHeight) return;
          flights.push(
            F7.FX.wait(index * 22).then(() =>
              F7.FX.flyCard({
                cardEl: F7.CardView.create(card, { size: 'md' }),
                from: rect,
                to: discard,
                duration: 420,
                lift: 1.05,
              }),
            ),
          );
          index += 1;
        });
      });
      if (flights.length) F7.Sound.reshuffle();
      this.table.renderAll();
      await Promise.all(flights);
      this.table.renderPiles();
    }

    async onTieBreak({ leaders }) {
      this.hud.log(`Empate entre ${leaders.map(who).join(' e ')}: rodada de desempate!`, 'var(--gold)');
      await F7.FX.banner('Empate!', { sub: 'Rodada extra de desempate', variant: 'round', hold: 700 });
    }

    async onGameOver(payload, game) {
      const { winner } = payload;
      F7.Sound.win();
      F7.FX.confetti({ count: 220 });
      setTimeout(() => F7.FX.confetti({ count: 120 }), F7.FX.dur(1200));
      this.hud.log(`🏆 ${who(winner)} venceu com <b>${winner.total}</b> pontos!`, 'var(--gold)');
      this.lastChoice = await F7.Modals.gameOver(payload, game);
    }
  }

  F7.GameController = GameController;
})(globalThis.F7 = globalThis.F7 || {});
