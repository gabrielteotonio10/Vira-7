/**
 * Vira-7 — Janelas modais: regras, resumo da rodada, fim de jogo e confirmação.
 */
((F7) => {
  'use strict';

  const { h, qsa, initial } = F7.dom;
  const { icon } = F7.icons;
  /** Avatar do jogador: o bichinho escolhido ou a inicial do nome. */
  const avatarOf = (player, className = '') =>
    F7.Avatars
      ? F7.Avatars.create({ avatar: player.avatar, name: player.name, color: player.color }, className)
      : h('div', { class: `avatar ${className}`, style: { '--avatar-color': player.color } }, initial(player.name));

  const card = (data, size = 'md') => F7.CardView.create({ id: `m-${Math.random()}`, ...data }, { size });

  let openCount = 0;
  /** Funções que fecham as janelas abertas (para fechar tudo ao trocar de tela). */
  const closers = new Set();

  /**
   * Abre uma janela genérica.
   * @param {{
   *   title: string, eyebrow?: string, body: Node, wide?: boolean, dismissible?: boolean,
   *   actions?: Array<{ label: string, value: any, variant?: string, iconName?: string }>,
   *   footNote?: Node,
   * }} options
   * @returns {{ el: HTMLElement, result: Promise<any>, close: (value?: any) => void }}
   */
  function open({ title, eyebrow, body, wide = false, dismissible = true, actions = [], footNote }) {
    const previousFocus = document.activeElement;
    let resolveResult;
    const result = new Promise((resolve) => (resolveResult = resolve));
    const titleId = `modal-title-${Date.now()}`;

    const closeButton = dismissible
      ? h('button', {
          type: 'button',
          class: 'icon-btn',
          'aria-label': 'Fechar',
          html: icon('close'),
          onClick: () => close(undefined),
        })
      : null;

    const buttons = actions.map((action) =>
      h(
        'button',
        {
          type: 'button',
          class: `btn ${action.variant ? `btn--${action.variant}` : ''}`,
          onClick: () => close(action.value),
        },
        action.iconName ? h('span', { html: icon(action.iconName) }) : null,
        action.label,
      ),
    );

    const el = h(
      'div',
      { class: `modal ${wide ? 'modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div', { class: 'modal__backdrop', onClick: () => dismissible && close(undefined) }),
      h(
        'div',
        { class: 'modal__dialog' },
        h(
          'header',
          { class: 'modal__head' },
          h(
            'h2',
            { class: 'modal__title', id: titleId },
            eyebrow ? h('span', { class: 'modal__eyebrow' }, eyebrow) : null,
            title,
          ),
          closeButton,
        ),
        h('div', { class: 'modal__body' }, body),
        buttons.length || footNote ? h('footer', { class: 'modal__foot' }, footNote || null, buttons) : null,
      ),
    );

    const onKey = (event) => {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation();
        close(undefined);
      }
      if (event.key === 'Tab') trapFocus(event, el);
    };

    let closed = false;
    function close(value) {
      if (closed) return;
      closed = true;
      closers.delete(close);
      openCount = Math.max(0, openCount - 1);
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), 200);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
      resolveResult(value);
    }

    openCount += 1;
    closers.add(close);
    document.body.appendChild(el);
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => (buttons[buttons.length - 1] || closeButton)?.focus({ preventScroll: true }));

    return { el, result, close };
  }

  function trapFocus(event, root) {
    const focusable = qsa('button:not(:disabled), [href], input, [tabindex]:not([tabindex="-1"])', root);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const isOpen = () => openCount > 0;

  /** Fecha todas as janelas abertas (cada uma resolve com `undefined`). */
  const closeAll = () => Array.from(closers).forEach((close) => close(undefined));

  /* ------------------------------------------------------------------ */
  /* Regras                                                              */
  /* ------------------------------------------------------------------ */

  function ruleCard(cards, title, text) {
    return h(
      'div',
      { class: 'rule-card' },
      h('div', { class: 'rule-card__cards' }, cards),
      h('div', {}, h('h4', {}, title), h('p', {}, text)),
    );
  }

  function rules() {
    const body = h(
      'div',
      { class: 'rules' },
      h(
        'p',
        { class: 'rules__goal' },
        'Seja o primeiro a chegar a 200 pontos! A cada turno, vire mais uma carta para somar pontos ' +
          'ou pare para garantir o que já tem. Mas cuidado: tirar um número repetido estoura a rodada.',
      ),
      h(
        'section',
        {},
        h('h3', {}, 'Como funciona a rodada'),
        h(
          'ol',
          { class: 'rules__steps' },
          h('li', {}, 'O carteador distribui uma carta virada para cima para cada jogador.'),
          h('li', {}, 'Na sua vez, escolha VIRAR (comprar mais uma carta) ou PARAR (guardar seus pontos e sair da rodada).'),
          h('li', {}, 'Se virar um número que você já tem na mesa, você ESTOURA e marca 0 na rodada.'),
          h('li', {}, 'A rodada acaba quando todos param ou estouram — ou na hora em que alguém faz o VIRA 7.'),
          h('li', {}, 'O carteador passa para o próximo jogador, todas as cartas voltam ao monte para serem reembaralhadas e uma nova rodada começa.'),
        ),
      ),
      h(
        'section',
        {},
        h('h3', {}, 'As cartas'),
        h(
          'div',
          { class: 'rules__grid' },
          ruleCard(
            [card({ type: 'number', value: 12 }, 'sm'), card({ type: 'number', value: 7 }, 'sm'), card({ type: 'number', value: 0 }, 'sm')],
            'Números (0 a 12)',
            'Valem o próprio número. Existem 12 cartas 12, 11 cartas 11… e apenas uma carta 1 e uma carta 0. ' +
              'Quanto maior o número, mais vezes ele aparece!',
          ),
          ruleCard(
            [card({ type: 'number', value: 1 }, 'sm'), card({ type: 'number', value: 5 }, 'sm'), card({ type: 'number', value: 9 }, 'sm')],
            'Vira 7 — bônus de 15 pontos',
            'Juntou 7 números diferentes? A rodada termina na hora para todo mundo e você ganha +15 pontos.',
          ),
          ruleCard(
            [card({ type: 'modifier', op: 'add', value: 4 }, 'sm'), card({ type: 'modifier', op: 'add', value: 10 }, 'sm')],
            'Bônus (+2 a +10)',
            'Somam pontos ao total da rodada. Não contam para o Vira 7 e nunca estouram você.',
          ),
          ruleCard(
            [card({ type: 'modifier', op: 'multiply', value: 2 }, 'sm')],
            'Dobro (×2)',
            'Dobra a soma dos seus números. Não dobra os bônus nem os 15 pontos do Vira 7.',
          ),
          ruleCard(
            [card({ type: 'action', action: 'freeze' }, 'sm')],
            'Congelar',
            'Escolha um jogador ativo (pode ser você): ele guarda os pontos que tem e sai da rodada.',
          ),
          ruleCard(
            [card({ type: 'action', action: 'flipThree' }, 'sm')],
            'Vira Três',
            'Escolha um jogador ativo (pode ser você): ele é obrigado a virar as próximas 3 cartas, uma por vez. ' +
              'Congelar ou Vira Três que aparecerem nesse meio são jogados depois — se ele não estourar.',
          ),
          ruleCard(
            [card({ type: 'action', action: 'secondChance' }, 'sm')],
            'Segunda Chance',
            'Guarde-a. Se virar um número repetido, descarte a repetida e a Segunda Chance e continue jogando. ' +
              'Só é possível ter uma: se tirar outra, dê para outro jogador ativo.',
          ),
        ),
      ),
      h(
        'section',
        {},
        h('h3', {}, 'Pontuação'),
        h(
          'div',
          { class: 'score-example' },
          '(',
          card({ type: 'number', value: 8 }, 'xs'),
          '+',
          card({ type: 'number', value: 6 }, 'xs'),
          '+',
          card({ type: 'number', value: 3 }, 'xs'),
          ')',
          card({ type: 'modifier', op: 'multiply', value: 2 }, 'xs'),
          '+',
          card({ type: 'modifier', op: 'add', value: 4 }, 'xs'),
          '= 38 pontos',
        ),
        h(
          'p',
          { style: { marginTop: '12px' } },
          'Some os números, aplique o ×2, some os bônus e, se fez Vira 7, mais 15. ' +
            'Quando alguém passar de 200 pontos no fim de uma rodada, vence quem tiver mais pontos. ' +
            'Empate na liderança? Joga-se mais uma rodada!',
        ),
      ),
      h(
        'section',
        {},
        h('h3', {}, 'Atalhos'),
        h('p', {}, h('span', { class: 'kbd' }, 'V'), ' ou ', h('span', { class: 'kbd' }, 'Espaço'), ' para virar · ', h('span', { class: 'kbd' }, 'P'), ' para parar.'),
      ),
    );

    return open({
      title: 'Como jogar',
      eyebrow: 'Regras do Vira-7',
      body,
      wide: true,
      actions: [{ label: 'Entendi!', value: true, variant: 'primary' }],
    }).result;
  }

  /* ------------------------------------------------------------------ */
  /* Resumo da rodada                                                    */
  /* ------------------------------------------------------------------ */

  function describeResult({ status, flip7, breakdown }) {
    if (status === 'busted') return 'Estourou — 0 pontos';
    const parts = [];
    if (breakdown.numbersSum || !breakdown.modifiersSum) parts.push(`${breakdown.numbersSum} em números`);
    if (breakdown.multiplier > 1) parts.push(`×${breakdown.multiplier}`);
    if (breakdown.modifiersSum) parts.push(`+${breakdown.modifiersSum} de bônus`);
    if (flip7) parts.push('+15 do Vira 7');
    const how = { stayed: 'Parou', frozen: 'Congelado', active: 'Na mesa' }[status] || '';
    return `${flip7 ? 'Vira 7!' : how} · ${parts.join(' ')}`;
  }

  /**
   * @param {{ round: number, results: object[] }} payload
   * @param {{ targetScore: number, players: object[] }} game
   * @param {{ autoNextMs?: number, finalRound?: boolean, tie?: boolean }} options
   */
  function roundSummary({ round, results }, game, { autoNextMs = 0, finalRound = false, tie = false } = {}) {
    const target = game.targetScore;
    const sorted = results.slice().sort((a, b) => b.total - a.total || b.roundScore - a.roundScore);
    const best = sorted[0].total;

    const rows = sorted.map((result, index) => {
      const { player, roundScore, total } = result;
      const previous = total - roundScore;
      const prevPct = Math.min(100, (previous / target) * 100);
      const gainPct = Math.min(100 - prevPct, (roundScore / target) * 100);
      return h(
        'div',
        {
          class: `summary-row ${total === best ? 'is-leader' : ''}`,
          style: { '--player-color': player.color, '--row-index': index },
        },
        h('div', { class: 'summary-row__rank' }, String(index + 1)),
        avatarOf(player),
        h(
          'div',
          { class: 'summary-row__main' },
          h(
            'div',
            { class: 'summary-row__name' },
            h('span', {}, player.name),
            total === best && best > 0 ? h('span', { html: icon('crown'), style: { color: 'var(--gold)' } }) : null,
          ),
          h('div', { class: 'summary-row__detail' }, describeResult(result)),
          h(
            'div',
            { class: 'summary-row__bar' },
            h('div', { class: 'summary-row__bar-prev', style: { width: `${prevPct}%` } }),
            h('div', { class: 'summary-row__bar-gain', style: { left: `${prevPct}%`, width: `${gainPct}%` } }),
          ),
        ),
        h(
          'div',
          { class: 'summary-row__points' },
          h('span', { class: `summary-row__gain ${roundScore === 0 ? 'is-zero' : ''}` }, `+${roundScore}`),
          h('span', { class: 'summary-row__total' }, `${total} pts`),
        ),
      );
    });

    const note = finalRound
      ? h('p', { class: 'summary__note' }, 'Alguém passou da meta! Vamos ver quem venceu…')
      : tie
        ? h('p', { class: 'summary__note' }, 'Empate na liderança acima da meta: rodada extra de desempate!')
        : null;

    const autoNote = autoNextMs ? h('span', { class: 'summary__autonext' }) : null;

    const modal = open({
      title: `Fim da rodada ${round}`,
      eyebrow: 'Placar',
      body: h('div', { class: 'summary' }, rows, note),
      wide: true,
      dismissible: false,
      footNote: autoNote,
      actions: [
        {
          label: finalRound ? 'Ver resultado' : 'Próxima rodada',
          value: true,
          variant: 'primary',
          iconName: finalRound ? 'trophy' : 'play',
        },
      ],
    });

    if (autoNextMs) {
      let remaining = Math.ceil(autoNextMs / 1000);
      autoNote.textContent = `Continua em ${remaining}s`;
      const timer = setInterval(() => {
        remaining -= 1;
        autoNote.textContent = `Continua em ${remaining}s`;
        if (remaining <= 0) modal.close(true);
      }, 1000);
      modal.result.then(() => clearInterval(timer));
    }

    return modal.result;
  }

  /* ------------------------------------------------------------------ */
  /* Fim de jogo                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * @param {{ winner: object|null, standings: object[], reason?: string }} payload
   * @param {object} game
   * @param {{ actions?: object[] }} [options] botões (padrão: menu / jogar de novo)
   */
  function gameOver({ winner, standings, reason }, game, { actions } = {}) {
    const podiumOrder = [standings[1], standings[0], standings[2]].filter(Boolean);
    const podium = h(
      'div',
      { class: 'podium' },
      podiumOrder.map((player) => {
        const place = standings.indexOf(player) + 1;
        return h(
          'div',
          { class: `podium__step podium__step--${place}`, style: { '--player-color': player.color } },
          avatarOf(player),
          h('div', { class: 'podium__name' }, player.name),
          h('div', { class: 'podium__block' }, `${place}º`),
        );
      }),
    );

    const rounds = Math.max(0, ...standings.map((player) => player.history.length));
    const headline = !winner
      ? 'Partida encerrada'
      : `${winner.name} venceu!`;
    const detail = !winner
      ? 'Todos os jogadores saíram.'
      : reason === 'forfeit'
        ? 'Os adversários abandonaram a partida'
        : `${winner.total} pontos em ${rounds} rodadas`;
    const headers = ['Jogador', ...Array.from({ length: rounds }, (_, i) => `R${i + 1}`), 'Total'];
    const table = h(
      'div',
      { class: 'final-table__wrap' },
      h(
        'table',
        { class: 'final-table' },
        h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))),
        h(
          'tbody',
          {},
          standings.map((player) =>
            h(
              'tr',
              {},
              h('td', {}, h('b', { style: { color: player.color } }, player.name)),
              player.history.map((points, i) => {
                const flip7 = (player.flip7Rounds || []).includes(i + 1);
                return h('td', { class: points === 0 ? 'is-zero' : flip7 ? 'is-flip7' : '' }, String(points));
              }),
              h('td', {}, String(player.total)),
            ),
          ),
        ),
      ),
    );

    const body = h(
      'div',
      {},
      h(
        'div',
        { class: 'winner' },
        winner ? h('span', { class: 'winner__crown', html: icon('crown') }) : null,
        winner ? avatarOf(winner) : null,
        h('div', { class: 'winner__name' }, headline),
        h('div', { class: 'winner__score' }, detail),
      ),
      standings.length > 1 ? podium : null,
      table,
    );

    return open({
      title: 'Fim de jogo',
      eyebrow: winner ? 'Temos um campeão' : 'Fim',
      body,
      wide: true,
      dismissible: false,
      actions: actions || [
        { label: 'Menu inicial', value: 'menu', variant: 'ghost', iconName: 'home' },
        { label: 'Jogar de novo', value: 'again', variant: 'primary', iconName: 'restart' },
      ],
    }).result;
  }

  /* ------------------------------------------------------------------ */
  /* Confirmação                                                         */
  /* ------------------------------------------------------------------ */

  async function confirm({ title, text, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
    const value = await open({
      title,
      body: h('p', { style: { color: 'var(--text-muted)' } }, text),
      actions: [
        { label: cancelLabel, value: false, variant: 'ghost' },
        { label: confirmLabel, value: true, variant: 'danger' },
      ],
    }).result;
    return value === true;
  }

  F7.Modals = { open, isOpen, closeAll, rules, roundSummary, gameOver, confirm };
})(globalThis.F7 = globalThis.F7 || {});
