/**
 * Vira-7 — Mesa: desenha os lugares dos jogadores, as cartas e os montes.
 *
 * A mesa é sempre redesenhada a partir do estado do motor. Para animar, o controlador
 * pede para esconder (`hidden`) a carta nova, mede onde ela vai ficar e faz um clone voar até lá.
 */
((F7) => {
  'use strict';

  const { h, qs, qsa, clear, initial } = F7.dom;
  const { PLAYER_STATUS: S, RULES } = F7;

  const STATUS_LABEL = {
    [S.ACTIVE]: 'Jogando',
    [S.STAYED]: 'Parou',
    [S.FROZEN]: 'Congelado',
    [S.BUSTED]: 'Estourou',
  };

  /** Texto que o CSS mostra via attr(): passa pelo tradutor, porque conteúdo de CSS ninguém traduz sozinho. */
  const tr = (text) => (F7.i18n ? F7.i18n.t(text) : text);

  class TableView {
    constructor({ seatsEl, deckEl }) {
      this.seatsEl = seatsEl;
      this.deckEl = deckEl;
      this.game = null;
      this.seats = new Map();
      this.targeting = null;
    }

    /* ------------------------------------------------------------------ */
    /* Montagem                                                            */
    /* ------------------------------------------------------------------ */

    /**
     * Monta a mesa: o jogador de `perspective` fica embaixo e os outros se distribuem
     * em volta do baralho, no sentido do jogo.
     * @param {object} game
     * @param {{ perspective?: number|string }} [options] id do jogador que fica embaixo
     */
    setup(game, { perspective } = {}) {
      this.game = game;
      this.seats.clear();

      const meArea = qs('.arena__me', this.seatsEl);
      const opponentsArea = qs('.arena__opponents', this.seatsEl);
      if (meArea && opponentsArea) {
        clear(meArea);
        clear(opponentsArea);
      } else {
        clear(this.seatsEl);
      }

      const players = game.players;
      const meIndex = Math.max(0, players.findIndex((p) => p.id === perspective));
      const ordered = players.map((_, i) => players[(meIndex + i) % players.length]);
      const others = ordered.length - 1;
      this.seatsEl.dataset.players = String(players.length);

      ordered.forEach((player, index) => {
        const isMe = index === 0;
        const seat = this.buildSeat(player, index);
        seat.el.classList.add(isMe ? 'seat--me' : 'seat--compact');
        this.seats.set(player.id, seat);

        if (!meArea || !opponentsArea) {
          this.seatsEl.appendChild(seat.el);
          return;
        }
        // --arc vai de -1 (esquerda) a 1 (direita): quem está nas pontas fica mais baixo,
        // desenhando a curva da mesa em volta do baralho.
        const arc = isMe || others <= 2 ? 0 : ((index - 1) / (others - 1)) * 2 - 1;
        const slot = h('div', { class: 'seat-slot', style: { '--arc': arc.toFixed(3), '--arc-abs': Math.abs(arc).toFixed(3) } }, seat.el);
        (isMe ? meArea : opponentsArea).appendChild(slot);
      });

      this.renderAll();
      this.renderPiles();
    }

    buildSeat(player, index) {
      const avatar = h('div', { class: 'avatar' }, initial(player.name));
      if (F7.Avatars) F7.Avatars.fill(avatar, player);
      const parts = {
        avatar,
        name: h('span', { class: 'seat__name-text' }, player.name),
        tags: h('span', { class: 'seat__tags' }),
        status: h('span', { class: 'badge seat__status' }),
        round: h('span', { class: 'seat__round' }),
        formula: h('small', { class: 'seat__formula' }),
        total: h('b', {}, String(player.total)),
        pips: h('div', { class: 'pips', 'aria-hidden': 'true' }),
        meterFill: h('div', { class: 'seat__meter-fill' }),
        meterPreview: h('div', { class: 'seat__meter-preview' }),
        numbers: h('div', { class: 'seat__row seat__row--numbers' }),
        extras: h('div', { class: 'seat__row seat__row--extras' }),
        overlays: h('div', { class: 'seat__overlays' }),
      };

      for (let i = 0; i < RULES.FLIP7_UNIQUE_COUNT; i++) parts.pips.appendChild(h('i', { class: 'pip' }));

      const teamClass = player.team === null || player.team === undefined ? '' : ` seat--team team-${'abcd'[player.team] || 'a'}`;
      if (teamClass) parts.tags.appendChild(h('span', { class: 'badge badge--team', title: 'Dupla' }, F7.teamName(player.team)));

      const el = h(
        'article',
        {
          class: `seat${teamClass}`,
          dataset: { playerId: player.id },
          style: { '--player-color': player.color, '--seat-index': index },
          'aria-label': `Lugar de ${player.name}`,
        },
        h(
          'header',
          { class: 'seat__head' },
          parts.avatar,
          h(
            'div',
            { class: 'seat__who' },
            h('div', { class: 'seat__name' }, parts.name, parts.tags),
            parts.status,
          ),
          h(
            'div',
            { class: 'seat__score' },
            h('span', { class: 'seat__total', title: 'Pontuação total' }, parts.total, h('small', {}, 'pts')),
            parts.round,
            parts.formula,
          ),
        ),
        h(
          'div',
          { class: 'seat__progress' },
          parts.pips,
          h(
            'div',
            { class: 'seat__meter', title: `Progresso até ${this.game.targetScore} pontos` },
            parts.meterPreview,
            parts.meterFill,
          ),
        ),
        h('div', { class: 'seat__cards' }, parts.numbers, parts.extras),
        parts.overlays,
      );

      return { el, parts, player };
    }

    /* ------------------------------------------------------------------ */
    /* Consultas                                                           */
    /* ------------------------------------------------------------------ */

    seatEl(player) {
      return this.seats.get(player.id)?.el || null;
    }

    cardEl(cardId) {
      return qs(`.seat [data-card-id="${cardId}"]`, this.seatsEl);
    }

    deckTopEl() {
      return qs('.pile__stack .card:last-child', this.deckEl) || qs('.pile__stack', this.deckEl);
    }

    /** Garante que o lugar esteja visível antes de medir posições. */
    reveal(player) {
      const el = this.seatEl(player);
      if (!el) return;
      // A área da mesa rola quando não cabe (celular): mantém o lugar inteiro à vista,
      // com uma folga, sem pular a tela inteira.
      const area = this.seatsEl.parentElement;
      const box = area.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const margin = 10;
      if (rect.bottom > box.bottom - margin) area.scrollTop += rect.bottom - box.bottom + margin;
      else if (rect.top < box.top + margin) area.scrollTop -= box.top + margin - rect.top;
    }

    /** Marca um jogador como conectado ou não (partidas online). */
    setOnline(player, online) {
      const el = this.seatEl(player);
      if (!el) return;
      el.classList.toggle('is-offline', !online);
      el.dataset.offline = tr('sem conexão');
    }

    /* ------------------------------------------------------------------ */
    /* Renderização                                                        */
    /* ------------------------------------------------------------------ */

    renderAll(options = {}) {
      this.game.players.forEach((player) => this.renderSeat(player, options));
    }

    /**
     * @param {object} player
     * @param {{ hidden?: string[], keepTotal?: boolean }} [options]
     */
    /** 'nervous' | 'shocked' | 'happy' | '' conforme a situação do jogador na rodada. */
    moodOf(player, score) {
      if (player.absent) return '';
      if (player.status === S.BUSTED || player.status === S.FROZEN) return 'shocked';
      if (player.flip7 || (player.status === S.STAYED && score.total >= 18)) return 'happy';
      if (player.status === S.ACTIVE && player.numbers.length) {
        const chance = this.game.bustChance ? this.game.bustChance(player) : 0;
        if (chance >= 0.35 || player.numbers.length >= 5) return 'nervous';
      }
      return '';
    }

    /** Texto da conta de pontos: números, ×2, bônus, penalidades e Vira 7. */
    formulaOf(player, score) {
      if (player.status === S.BUSTED) return '';
      const numbers = player.numbers.map((card) => card.value);
      if (!numbers.length && !player.modifiers.length) return '';
      let text = '';
      if (numbers.length) {
        text = numbers.length > 1 ? `(${numbers.join('+')})` : String(numbers[0]);
        if (score.multiplier > 1) text += `×${score.multiplier}`;
      }
      player.modifiers
        .filter((card) => card.op !== 'multiply')
        .forEach((card) => {
          text += `${text ? ' ' : ''}${card.value < 0 ? '−' : '+'}${Math.abs(card.value)}`;
        });
      if (player.flip7) text += ' +15';
      return text;
    }

    renderSeat(player, { hidden = [], keepTotal = false } = {}) {
      const seat = this.seats.get(player.id);
      if (!seat) return;
      const { el, parts } = seat;
      const game = this.game;
      const score = F7.Scoring.compute(player);
      const isTurn = el.classList.contains('is-turn');

      el.dataset.status = player.status;
      el.dataset.flip7 = String(player.flip7);
      el.classList.toggle('is-absent', !!player.absent);

      // Expressão do bichinho: nervoso (perto de estourar), chocado (estourou/congelou) ou feliz.
      const mood = this.moodOf(player, score);
      if (parts.avatar.dataset.mood !== mood) {
        if (mood) parts.avatar.dataset.mood = mood;
        else delete parts.avatar.dataset.mood;
      }

      // "Quase Vira 7": seis números diferentes e ainda na rodada.
      const almost = player.isActive() && player.numbers.length === F7.RULES.FLIP7_UNIQUE_COUNT - 1;
      el.classList.toggle('is-almost7', almost);
      if (almost) el.dataset.almost = tr('A 1 CARTA DO VIRA 7!');
      if (almost && !seat.almost && F7.Sound.tension) F7.Sound.tension();
      seat.almost = almost;

      // Nome, CPU e carteador
      clear(parts.tags);
      if (player.isMe) parts.tags.appendChild(h('span', { class: 'badge badge--me' }, 'Você'));
      if (player.isBot) parts.tags.appendChild(h('span', { class: 'badge badge--bot' }, 'CPU'));
      if (game.dealer === player && game.round > 0) {
        // O "D" cai sobre quem passou a ser o carteador (some a animação nas redesenhadas seguintes).
        const moved = this.dealerId !== player.id;
        this.dealerId = player.id;
        parts.tags.appendChild(h('span', { class: `dealer-chip${moved ? ' is-moving' : ''}`, title: 'Carteador da rodada' }, 'D'));
      }
      if (seat.thinking) {
        parts.tags.appendChild(h('span', { class: 'seat__thinking', 'aria-label': 'pensando' }, h('i'), h('i'), h('i')));
      }

      // Situação
      const statusKey = player.flip7 ? 'flip7' : player.status;
      parts.status.className = `badge seat__status badge--${statusKey}`;
      parts.status.textContent = player.absent
        ? 'Saiu'
        : player.flip7
          ? 'Vira 7!'
          : isTurn && player.isActive()
            ? 'Na vez'
            : STATUS_LABEL[player.status];

      // Pontos
      if (!keepTotal) parts.total.textContent = String(player.total);
      const roundText = player.status === S.BUSTED ? '✕ 0' : `+${score.total}`;
      if (parts.round.textContent !== roundText) {
        parts.round.textContent = roundText;
        F7.FX.retrigger(parts.round, 'is-bumped', 380);
      }
      parts.round.hidden = game.round === 0;

      // A conta da rodada, para quem está aprendendo: (8+6+3)×2 +4 −2
      const formula = this.formulaOf(player, score);
      parts.formula.textContent = formula;
      parts.formula.hidden = !formula;
      parts.round.title = formula ? `${formula} = ${score.total}` : '';

      const target = game.targetScore;
      parts.meterFill.style.width = `${Math.min(100, (player.total / target) * 100)}%`;
      const preview = player.status === S.BUSTED ? player.total : player.total + score.total;
      parts.meterPreview.style.width = `${Math.min(100, (preview / target) * 100)}%`;

      // Os 7 marcadores de números diferentes
      qsa('.pip', parts.pips).forEach((pip, i) => {
        const card = player.numbers[i];
        pip.classList.toggle('is-on', !!card);
        if (card) pip.style.setProperty('--pip-color', `var(--n${card.value})`);
        else pip.style.removeProperty('--pip-color');
      });

      // Cartas
      this.renderRows(player, parts, hidden);
      this.renderOverlays(player, parts);
    }

    renderRows(player, parts, hidden) {
      const make = (card, extraClass = '') => {
        const el = F7.CardView.create(card, { size: 'sm', className: extraClass });
        if (hidden.includes(card.id)) el.classList.add('is-ghost');
        return el;
      };

      clear(parts.numbers);
      player.numbers.forEach((card) => parts.numbers.appendChild(make(card)));
      if (player.bustCard) parts.numbers.appendChild(make(player.bustCard, 'is-duplicate'));
      if (!parts.numbers.children.length) {
        parts.numbers.appendChild(
          h('span', { class: 'seat__empty' }, player.isActive() ? 'Aguardando cartas…' : 'Sem cartas'),
        );
      }

      clear(parts.extras);
      player.modifiers.forEach((card) => parts.extras.appendChild(make(card)));
      if (player.secondChance) parts.extras.appendChild(make(player.secondChance, 'is-held'));
      player.actionCards.forEach((card) => parts.extras.appendChild(make(card)));
      player.pendingActions.forEach((card) => parts.extras.appendChild(make(card, 'is-pending')));
      qsa('.card', parts.extras).forEach((el) => el.classList.replace('card--sm', 'card--xs'));
    }

    renderOverlays(player, parts) {
      const seat = this.seats.get(player.id);
      const want = player.flip7
        ? 'flip7'
        : player.status === S.BUSTED
          ? 'busted'
          : player.status === S.FROZEN
            ? 'frozen'
            : player.status === S.STAYED
              ? 'stayed'
              : seat.flipThree != null
                ? 'flipThree'
                : 'none';
      const key = want === 'flipThree' ? `flipThree-${seat.flipThree}` : want;
      if (seat.overlayKey === key) return;
      seat.overlayKey = key;

      clear(parts.overlays);
      if (want === 'busted') {
        parts.overlays.appendChild(h('div', { class: 'seat__stamp' }, 'Estourou!'));
      } else if (want === 'frozen') {
        parts.overlays.appendChild(h('div', { class: 'seat__frost' }));
      } else if (want === 'stayed') {
        parts.overlays.appendChild(h('div', { class: 'seat__stamp seat__stamp--stayed' }, 'Parou'));
      } else if (want === 'flip7') {
        parts.overlays.appendChild(h('div', { class: 'seat__stamp seat__stamp--flip7' }, 'Vira 7!'));
      } else if (want === 'flipThree') {
        const counter = h('span', { class: 'flip-counter' });
        for (let i = 1; i <= RULES.FLIP_THREE_COUNT; i++) {
          counter.appendChild(h('i', { class: i <= seat.flipThree ? 'is-on' : '' }));
        }
        parts.overlays.appendChild(
          h(
            'div',
            { class: 'seat__target-label', style: { '--target-color': '#c77dff' } },
            'Vira Três ',
            counter,
          ),
        );
      }
    }

    /** Contador visual do Vira Três (`index` = cartas já viradas, 0 a 3; `null` remove). */
    setFlipThree(player, index) {
      const seat = this.seats.get(player.id);
      if (!seat) return;
      seat.flipThree = index;
      this.renderOverlays(player, seat.parts);
    }

    setTurn(player, renderOptions = {}) {
      this.seats.forEach((seat) => {
        const turn = !!player && seat.player === player;
        seat.el.classList.toggle('is-turn', turn);
        if (turn) seat.el.dataset.turnLabel = tr('SUA VEZ');
      });
      if (player) this.reveal(player);
      this.renderAll(renderOptions);
    }

    setThinking(player, thinking) {
      const seat = this.seats.get(player.id);
      if (!seat) return;
      seat.thinking = thinking;
      this.renderSeat(player);
    }

    /**
     * Redesenha o monte. Com `includeUsed`, conta também as cartas já usadas
     * (é o que acontece quando a rodada acaba e tudo volta para o monte).
     */
    renderPiles({ includeUsed = false } = {}) {
      const deck = this.game.deck;
      const count = includeUsed ? deck.totalAvailable : deck.size;

      const deckStack = qs('.pile__stack', this.deckEl);
      clear(deckStack);
      const layers = Math.min(3, count);
      for (let i = 0; i < layers; i++) deckStack.appendChild(F7.CardView.create(null, { size: 'md' }));
      qs('.pile__count', this.deckEl).textContent = String(count);
      this.deckEl.classList.toggle('is-empty', count === 0);
    }

    /* ------------------------------------------------------------------ */
    /* Escolha de alvo                                                     */
    /* ------------------------------------------------------------------ */

    /**
     * Destaca os candidatos e espera o clique em um deles.
     * @returns {Promise<object>} jogador escolhido
     */
    chooseTarget(candidates, { label, color }) {
      this.cancelTargeting();
      return new Promise((resolve) => {
        const cleanups = [];
        this.seatsEl.classList.add('is-targeting');

        const finish = (player, silent = false) => {
          cleanups.forEach((fn) => fn());
          this.seatsEl.classList.remove('is-targeting');
          this.targeting = null;
          const el = this.seatEl(player);
          // Cancelado pelo jogo (partida interrompida): sem animação de "escolhido".
          if (el && !silent) F7.FX.retrigger(el, 'is-chosen', 420);
          resolve(player);
        };

        candidates.forEach((player) => {
          const el = this.seatEl(player);
          if (!el) return;
          const tag = h('div', { class: 'seat__target-label' }, player === this.game.currentPlayer ? `${label} (você)` : label);
          el.classList.add('is-targetable');
          el.style.setProperty('--target-color', color);
          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el.appendChild(tag);

          const onClick = () => finish(player);
          const onKey = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              finish(player);
            }
          };
          el.addEventListener('click', onClick);
          el.addEventListener('keydown', onKey);
          cleanups.push(() => {
            el.classList.remove('is-targetable');
            el.style.removeProperty('--target-color');
            el.removeAttribute('tabindex');
            el.removeAttribute('role');
            el.removeEventListener('click', onClick);
            el.removeEventListener('keydown', onKey);
            tag.remove();
          });
        });

        this.targeting = { cancel: () => finish(candidates[0], true), pick: (player) => finish(player) };
        this.seatEl(candidates[0])?.focus({ preventScroll: true });
      });
    }

    /** Escolhe um dos candidatos por código (usado pelo modo mãos livres). */
    pickTarget(player) {
      if (this.targeting) this.targeting.pick(player);
    }

    /** Usado quando a partida é interrompida no meio de uma escolha. */
    cancelTargeting() {
      if (this.targeting) this.targeting.cancel();
    }

    /** Destaque rápido dos candidatos enquanto a CPU "pensa" no alvo. */
    async previewTargets(candidates, chosen, { label, color }) {
      this.seatsEl.classList.add('is-targeting');
      const marked = candidates.map((player) => {
        const el = this.seatEl(player);
        el?.classList.add('is-targetable');
        el?.style.setProperty('--target-color', color);
        return el;
      });
      await F7.FX.wait(700);
      const chosenEl = this.seatEl(chosen);
      const tag = h('div', { class: 'seat__target-label' }, label);
      chosenEl?.appendChild(tag);
      if (chosenEl) F7.FX.retrigger(chosenEl, 'is-chosen', 420);
      await F7.FX.wait(450);
      tag.remove();
      marked.forEach((el) => {
        el?.classList.remove('is-targetable');
        el?.style.removeProperty('--target-color');
      });
      this.seatsEl.classList.remove('is-targeting');
    }
  }

  TableView.STATUS_LABEL = STATUS_LABEL;
  F7.TableView = TableView;
})(globalThis.F7 = globalThis.F7 || {});
