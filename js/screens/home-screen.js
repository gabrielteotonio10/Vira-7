/**
 * Vira-7 — Início: partida rápida, criar sala, entrar com código e salas públicas.
 */
((F7) => {
  'use strict';

  const { h, clear } = F7.dom;
  const { icon } = F7.icons;
  const App = F7.App;

  const TARGETS = [50, 100, 150, 200, 300, 500];
  const TIMERS = [[0, 'Sem tempo'], [15, '15s'], [30, '30s'], [45, '45s'], [60, '60s'], [90, '90s']];

  /** Controle segmentado ligado a um valor. */
  function segmented(options, value, label) {
    let current = value;
    const root = h('div', { class: 'segmented segmented--wrap', role: 'radiogroup', 'aria-label': label });
    const buttons = options.map(([optionValue, text]) => {
      const button = h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(optionValue === current),
          onClick: () => {
            current = optionValue;
            buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i][0] === current)));
            F7.Sound.click();
          },
        },
        text,
      );
      root.appendChild(button);
      return button;
    });
    return { el: root, get value() { return current; } };
  }

  function option(label, control, hint) {
    return h(
      'div',
      { class: 'form__field' },
      h('span', { class: 'form__label' }, label),
      control,
      hint ? h('small', { class: 'form__hint' }, hint) : null,
    );
  }

  /** Campos de configuração de uma sala (usados ao criar e ao editar no lobby). */
  function roomForm(initial = {}) {
    const name = h('input', {
      class: 'field', type: 'text', maxlength: 40, value: initial.name || '',
      placeholder: `Sala de ${App.state.me.profile.username}`, 'aria-label': 'Nome da sala',
    });
    const visibility = segmented([['private', 'Privada'], ['public', 'Pública']], initial.visibility || 'private', 'Quem pode entrar');
    const players = segmented([2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), initial.maxPlayers || 4, 'Número de jogadores');
    const target = segmented(TARGETS.map((n) => [n, String(n)]), initial.targetScore || 200, 'Pontos para vencer');
    const timer = segmented(TIMERS, initial.turnSeconds ?? 30, 'Tempo por jogada');
    const teams = segmented([[false, 'Cada um por si'], [true, 'Duplas (2x2)']], !!initial.teamMode, 'Modo de jogo');

    const el = h(
      'div',
      { class: 'form' },
      option('Nome da sala', name),
      option('Quem pode entrar', visibility.el, 'Privada: só com o código de convite. Pública: aparece na lista para todos.'),
      option('Jogadores (máximo)', players.el),
      option('Pontos para vencer', target.el, 'A regra original do Flip 7 é 200 pontos.'),
      option('Tempo por jogada', timer.el, 'Quando o tempo acaba, o jogador para automaticamente.'),
      option(
        'Modo de jogo',
        teams.el,
        'Duplas: quem senta na frente de você é seu parceiro e os pontos são somados. Precisa de 4, 6 ou 8 jogadores (CPUs completam a mesa).',
      ),
    );
    return {
      el,
      values: () => ({
        name: name.value.trim(),
        visibility: visibility.value,
        maxPlayers: players.value,
        targetScore: target.value,
        turnSeconds: timer.value,
        teamMode: teams.value,
      }),
    };
  }

  async function createRoom() {
    const form = roomForm();
    const ok = await F7.Modals.open({
      title: 'Criar sala',
      eyebrow: 'Partida personalizada',
      body: form.el,
      actions: [
        { label: 'Cancelar', value: false, variant: 'ghost' },
        { label: 'Criar sala', value: true, variant: 'primary', iconName: 'plus' },
      ],
    }).result;
    if (!ok) return;
    try {
      const { room } = await F7.Api.post('/rooms', form.values());
      App.navigate(`/sala/${room.code}`);
    } catch (error) {
      App.toast(error.message, { variant: 'bust' });
    }
  }

  async function joinByCode() {
    const input = h('input', {
      class: 'field field--code', type: 'text', maxlength: 6, placeholder: 'ABC123',
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Código da sala',
    });
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    const modal = F7.Modals.open({
      title: 'Entrar com código',
      eyebrow: 'Sala privada',
      body: h('div', { class: 'form' }, h('p', { class: 'form__hint' }, 'Digite o código de 6 caracteres que seu amigo enviou.'), input),
      actions: [
        { label: 'Cancelar', value: false, variant: 'ghost' },
        { label: 'Entrar', value: true, variant: 'primary' },
      ],
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') modal.close(true);
    });
    setTimeout(() => input.focus(), 80);
    if (!(await modal.result)) return;
    await enter(input.value);
  }

  async function enter(code) {
    try {
      const { room } = await F7.Api.post(`/rooms/${encodeURIComponent(code || '-')}/join`);
      App.navigate(`/sala/${room.code}`);
    } catch (error) {
      App.toast(error.message, { variant: 'bust' });
    }
  }

  async function quickMatch(button) {
    await App.busy(button, async () => {
      const { room } = await F7.Api.post('/rooms/quick');
      App.navigate(`/sala/${room.code}`);
    });
  }

  function actionCard({ iconName, title, text, accent, onClick, href }) {
    const attrs = { class: 'action-card', style: { '--accent': accent } };
    const content = [
      h('span', { class: 'action-card__icon', html: icon(iconName) }),
      h('strong', {}, title),
      h('span', {}, text),
    ];
    if (href) return h('a', { ...attrs, href }, content);
    const button = h('button', { ...attrs, type: 'button' }, content);
    button.addEventListener('click', () => onClick(button));
    return button;
  }

  function roomRow(room) {
    const full = room.playerCount >= room.maxPlayers;
    return h(
      'li',
      { class: 'room-row' },
      F7.Avatars.create({ avatar: room.hostAvatar, name: room.hostName }),
      h(
        'div',
        { class: 'room-row__main' },
        h('strong', {}, room.name),
        h(
          'span',
          {},
          `de ${room.hostName} · meta ${room.targetScore} · `,
          room.turnSeconds ? `${room.turnSeconds}s por jogada` : 'sem tempo',
          room.mode === 'quick' ? ' · partida rápida' : '',
          room.teamMode ? ' · duplas' : '',
        ),
      ),
      h('span', { class: `chip ${full ? 'is-full' : ''}` }, h('span', { html: icon('user') }), h('strong', {}, `${room.playerCount}/${room.maxPlayers}`)),
      room.teamMode ? h('span', { class: 'chip' }, 'Duplas') : null,
      h('button', { type: 'button', class: `btn ${full ? 'btn--ghost' : 'btn--success'}`, onClick: () => enter(room.code) }, full ? 'Assistir' : 'Entrar na sala'),
    );
  }

  async function home() {
    const { profile, stats, activeRoom } = await App.refreshMe();
    const list = h('ul', { class: 'room-list' }, h('li', {}, App.loading('Procurando salas…')));

    const stat = (value, label) => h('div', { class: 'stat-pill' }, h('strong', {}, String(value)), h('span', {}, label));

    App.render(
      h(
        'div',
        { class: 'home' },
        h(
          'section',
          { class: 'home__hello panel' },
          F7.Avatars.create({ avatar: profile.avatar, name: profile.username }, 'avatar--hero'),
          h(
            'div',
            { class: 'home__hello-text' },
            h('h1', {}, `E aí, ${profile.username}!`),
            h('p', {}, stats.gamesPlayed ? 'Bora virar umas cartas?' : 'Sua primeira partida começa aqui embaixo.'),
            h(
              'div',
              { class: 'stat-pills' },
              stat(stats.wins, stats.wins === 1 ? 'vitória' : 'vitórias'),
              stat(stats.gamesPlayed, stats.gamesPlayed === 1 ? 'partida' : 'partidas'),
              stat(`${stats.winRate}%`, 'aproveitamento'),
              stat(stats.flip7Count, 'Vira 7'),
            ),
          ),
        ),
        activeRoom
          ? h(
              'section',
              { class: 'home__resume panel' },
              h('span', { class: 'home__resume-icon', html: icon('bolt') }),
              h(
                'div',
                {},
                h('strong', {}, activeRoom.status === 'playing' ? 'Você tem uma partida em andamento!' : `Você está na sala ${activeRoom.name}`),
                h('span', {}, `Código ${activeRoom.code}`),
              ),
              h('a', { class: 'btn btn--primary', href: `#/sala/${activeRoom.code}` }, activeRoom.status === 'playing' ? 'Voltar para a partida' : 'Voltar para a sala'),
            )
          : null,
        h(
          'section',
          { class: 'action-grid' },
          actionCard({ iconName: 'bolt', title: 'Partida rápida', text: 'Cai numa mesa com quem estiver online', accent: '#ff9186', onClick: quickMatch }),
          actionCard({ iconName: 'plus', title: 'Criar sala', text: 'Suas regras, seus convidados', accent: '#7be0ac', onClick: createRoom }),
          actionCard({ iconName: 'lock', title: 'Entrar com código', text: 'Recebi um convite', accent: '#8fc1ff', onClick: joinByCode }),
          actionCard({ iconName: 'user', title: 'Mesma tela', text: 'Todo mundo no mesmo aparelho', accent: '#ffa3b8', href: '#/local' }),
        ),
        h(
          'a',
          { class: 'home__tutorial', href: '#/tutorial' },
          h('span', { html: icon('help') }),
          'Nunca jogou? Faça o tutorial interativo',
        ),
        h(
          'section',
          { class: 'panel home__rooms' },
          h(
            'div',
            { class: 'section-head' },
            h('h2', {}, 'Salas públicas'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Atualizar lista', title: 'Atualizar', html: icon('restart'), onClick: () => load() }),
          ),
          list,
        ),
      ),
    );

    let stopped = false;
    async function load() {
      try {
        const { rooms } = await F7.Api.get('/rooms/public');
        if (stopped) return;
        clear(list);
        if (!rooms.length) {
          list.appendChild(h('li', {}, App.empty('flip', 'Nenhuma sala pública aberta', 'Crie uma ou use a partida rápida para começar.')));
        } else {
          rooms.forEach((room) => list.appendChild(roomRow(room)));
        }
      } catch (error) {
        if (stopped) return;
        clear(list);
        list.appendChild(h('li', {}, App.empty('bolt', 'Não foi possível carregar as salas', error.message)));
      }
    }

    let pending = null;
    const watcher = F7.Realtime.watchPublicRooms(() => {
      clearTimeout(pending);
      pending = setTimeout(load, 400);
    });
    await load();

    return () => {
      stopped = true;
      clearTimeout(pending);
      watcher.stop();
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { home, roomForm, segmented });
})(globalThis.F7 = globalThis.F7 || {});
