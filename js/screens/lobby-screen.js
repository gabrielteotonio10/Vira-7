/**
 * Vira-7 — Sala: lobby (participantes, prontos, configurações) e a partida online.
 *
 * A mesma rota (#/sala/CODIGO) mostra o lobby enquanto a sala espera e a mesa quando
 * a partida começa. O canal de tempo real e o sinal de presença duram enquanto a
 * pessoa estiver nesta tela.
 */
((F7) => {
  'use strict';

  const { h, qs, clear } = F7.dom;
  const { icon } = F7.icons;
  const App = F7.App;

  const HEARTBEAT_MS = 10000;
  const STATUS_TEXT = {
    connecting: ['Conectando…', 'warn'],
    online: ['Tempo real ativo', 'ok'],
    offline: ['Reconectando…', 'bad'],
    polling: ['Conectado (modo local)', 'ok'],
  };

  async function room({ code }) {
    code = code.toUpperCase();
    const userId = F7.Auth.user.id;
    App.render(App.loading('Entrando na sala…'));

    let detail;
    try {
      detail = await F7.Api.get(`/rooms/${code}`);
    } catch (error) {
      if (error.code !== 'NOT_IN_ROOM') {
        App.toast(error.message, { variant: 'bust' });
        return App.navigate('/', { replace: true });
      }
      try {
        detail = await F7.Api.post(`/rooms/${code}/join`);
      } catch (joinError) {
        App.toast(joinError.message, { variant: 'bust' });
        return App.navigate('/', { replace: true });
      }
    }

    const state = { detail, match: null, onlineIds: null, connection: 'connecting', closed: false, refreshing: false };
    const els = {};

    /* ---------------------------------------------------------------- lobby */

    function isOnline(player) {
      if (player.isBot) return true;
      if (player.userId === userId) return true;
      return state.onlineIds ? state.onlineIds.has(player.userId) : player.online;
    }

    function playerRow(player) {
      const { me, room: info } = state.detail;
      const online = isOnline(player);
      const canRemove = me.isHost && player.userId !== userId && info.status === 'lobby';
      return h(
        'li',
        { class: `lobby-player ${player.isReady ? 'is-ready' : ''} ${online ? '' : 'is-offline'}`, style: { '--player-color': player.color } },
        F7.Avatars.create({ avatar: player.avatar, name: player.name, color: player.color }),
        h(
          'div',
          { class: 'lobby-player__main' },
          h(
            'strong',
            {},
            player.name,
            player.userId === userId ? h('span', { class: 'badge badge--me' }, 'Você') : null,
            player.isHost ? h('span', { class: 'badge badge--host', title: 'Anfitrião' }, h('span', { html: icon('crown') }), 'Anfitrião') : null,
            player.isBot ? h('span', { class: 'badge badge--bot' }, 'CPU') : null,
          ),
          h('span', { class: 'lobby-player__status' }, h('i', { class: 'dot' }), online ? 'Conectado' : 'Sem conexão'),
        ),
        h('span', { class: `badge ${player.isReady ? 'badge--stayed' : ''}` }, player.isReady ? 'Pronto' : 'Aguardando'),
        canRemove
          ? h('button', {
              type: 'button', class: 'icon-btn', html: icon('close'),
              'aria-label': `Remover ${player.name}`, title: player.isBot ? 'Remover CPU' : 'Expulsar da sala',
              onClick: (event) => App.busy(event.currentTarget, async () => {
                apply(await F7.Api.del(`/rooms/${code}/players/${player.id}`));
              }),
            })
          : null,
      );
    }

    function renderLobby() {
      const { room: info, players, me } = state.detail;
      const mine = players.find((p) => p.userId === userId);
      const everyoneReady = players.every((p) => p.isReady || p.userId === info.hostId);
      const canStart = me.isHost && players.length >= 2 && everyoneReady;
      const link = `${window.location.origin}${window.location.pathname}#/sala/${info.code}`;
      const quick = info.mode === 'quick';

      const copy = async (text, label) => {
        try {
          await navigator.clipboard.writeText(text);
          App.toast(`${label} copiado!`, { variant: 'stay' });
        } catch (error) {
          App.toast(text);
        }
      };

      const emptySeats = Array.from({ length: Math.max(0, info.maxPlayers - players.length) }, () =>
        h('li', { class: 'lobby-player lobby-player--empty' }, h('span', { class: 'avatar' }, '?'), h('span', {}, 'Lugar livre')),
      );

      const [statusText, statusKind] = STATUS_TEXT[state.connection];
      els.connection = h('span', { class: `conn conn--${statusKind}` }, h('i', { class: 'dot' }), statusText);

      const readyButton = h(
        'button',
        {
          type: 'button',
          class: `btn btn--lg ${mine && mine.isReady ? 'btn--ghost' : 'btn--success'}`,
          onClick: (event) => App.busy(event.currentTarget, async () => {
            F7.Sound.unlock();
            apply(await F7.Api.post(`/rooms/${code}/ready`, { ready: !(mine && mine.isReady) }));
          }),
        },
        mine && mine.isReady ? 'Cancelar pronto' : 'Estou pronto!',
      );

      const hostHint = players.length < 2
        ? 'Convide alguém ou adicione uma CPU para começar.'
        : everyoneReady ? 'Todos prontos!' : 'Aguardando todos ficarem prontos…';

      App.render(
        h(
          'div',
          { class: 'lobby' },
          h(
            'section',
            { class: 'panel lobby__head' },
            h(
              'div',
              {},
              h('span', { class: 'modal__eyebrow' }, quick ? 'Partida rápida' : info.visibility === 'public' ? 'Sala pública' : 'Sala privada'),
              h('h1', {}, info.name),
              els.connection,
            ),
            h(
              'div',
              { class: 'lobby__code' },
              h('span', {}, 'Código de convite'),
              h('button', { type: 'button', class: 'code', title: 'Copiar código', onClick: () => copy(info.code, 'Código') }, info.code, h('span', { html: icon('copy') })),
              h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => copy(link, 'Link') }, 'Copiar link de convite'),
            ),
          ),
          h(
            'div',
            { class: 'lobby__grid' },
            h(
              'section',
              { class: 'panel' },
              h('div', { class: 'section-head' }, h('h2', {}, 'Jogadores'), h('span', { class: 'setup__count' }, `${players.length}/${info.maxPlayers}`)),
              h('ul', { class: 'lobby-players' }, players.map(playerRow), emptySeats),
              me.isHost && players.length < info.maxPlayers
                ? h('button', {
                    type: 'button', class: 'btn btn--ghost btn--block',
                    onClick: (event) => App.busy(event.currentTarget, async () => apply(await F7.Api.post(`/rooms/${code}/bots`))),
                  }, h('span', { html: icon('bot') }), 'Adicionar CPU')
                : null,
            ),
            h(
              'section',
              { class: 'panel' },
              h(
                'div',
                { class: 'section-head' },
                h('h2', {}, 'Regras da partida'),
                me.isHost && !quick
                  ? h('button', { type: 'button', class: 'btn btn--ghost', onClick: editSettings }, 'Alterar')
                  : null,
              ),
              h(
                'dl',
                { class: 'rules-list' },
                h('div', {}, h('dt', {}, 'Pontos para vencer'), h('dd', {}, String(info.targetScore))),
                h('div', {}, h('dt', {}, 'Jogadores'), h('dd', {}, `até ${info.maxPlayers}`)),
                h('div', {}, h('dt', {}, 'Tempo por jogada'), h('dd', {}, info.turnSeconds ? `${info.turnSeconds} segundos` : 'Sem limite')),
                h('div', {}, h('dt', {}, 'Acesso'), h('dd', {}, info.visibility === 'public' ? 'Pública' : 'Só com o código')),
              ),
              h('button', { type: 'button', class: 'btn btn--ghost btn--block', onClick: () => F7.Modals.rules() }, h('span', { html: icon('help') }), 'Como jogar'),
            ),
          ),
          h(
            'section',
            { class: 'lobby__actions' },
            h('button', { type: 'button', class: 'btn btn--ghost btn--lg', onClick: leave }, me.isHost ? 'Fechar sala' : 'Sair da sala'),
            h('span', { class: 'lobby__hint' }, quick ? 'A partida começa sozinha quando todos estiverem prontos.' : me.isHost ? hostHint : 'O anfitrião inicia a partida.'),
            me.isHost && !quick
              ? h('button', {
                  type: 'button', class: 'btn btn--primary btn--lg', disabled: !canStart,
                  onClick: (event) => App.busy(event.currentTarget, async () => {
                    F7.Sound.unlock();
                    apply(await F7.Api.post(`/rooms/${code}/start`));
                  }),
                }, h('span', { html: icon('play') }), 'Iniciar partida')
              : readyButton,
          ),
        ),
      );
    }

    async function editSettings() {
      const info = state.detail.room;
      const form = F7.Screens.roomForm(info);
      const ok = await F7.Modals.open({
        title: 'Regras da partida',
        eyebrow: 'Configurar sala',
        body: form.el,
        actions: [
          { label: 'Cancelar', value: false, variant: 'ghost' },
          { label: 'Salvar', value: true, variant: 'primary' },
        ],
      }).result;
      if (!ok) return;
      try {
        apply(await F7.Api.patch(`/rooms/${code}`, form.values()));
      } catch (error) {
        App.toast(error.message, { variant: 'bust' });
      }
    }

    async function leave() {
      const playing = state.detail.room.status === 'playing';
      const hostClosing = !playing && state.detail.me.isHost;
      const ok = await F7.Modals.confirm({
        title: playing ? 'Abandonar a partida?' : hostClosing ? 'Fechar a sala?' : 'Sair da sala?',
        text: playing
          ? 'Você sai da partida, que conta como derrota. Os outros jogadores continuam sem você.'
          : hostClosing
            ? 'Você é o anfitrião: ao sair, a sala é fechada e todos voltam para o início.'
            : 'Você pode voltar depois usando o código de convite.',
        confirmLabel: playing ? 'Abandonar' : hostClosing ? 'Fechar sala' : 'Sair',
      });
      if (!ok) return;
      state.closed = true;
      try {
        await F7.Api.post(`/rooms/${code}/leave`);
      } catch (error) {
        App.toast(error.message, { variant: 'bust' });
      }
      App.navigate('/');
    }

    /* ---------------------------------------------------------------- partida */

    async function startMatch(gameId) {
      const match = new F7.OnlineMatch({
        table: App.table,
        hud: App.hud,
        controller: App.controller,
        room: state.detail.room,
        user: F7.Auth.user,
        onExit: async (choice) => {
          match.destroy();
          if (state.match === match) state.match = null;
          if (choice === 'leave') {
            state.closed = true;
            await F7.Api.post(`/rooms/${code}/leave`).catch(() => {});
            return App.navigate('/');
          }
          App.render(App.loading('Voltando para a sala…'));
          return refresh();
        },
      });
      state.match = match;
      App.gameHandlers = { online: true, menu: leave };
      qs('#btn-restart').hidden = true;
      App.show('game');
      document.title = `Vira-7 · ${state.detail.room.name}`;
      if (state.onlineIds) match.setPresence(state.onlineIds);
      try {
        await match.open(gameId);
      } catch (error) {
        App.toast(error.message, { variant: 'bust' });
        match.destroy();
        state.match = null;
        App.navigate('/');
      }
    }

    /** Aplica um novo retrato da sala vindo da API. */
    function apply(detail) {
      if (state.closed) return;
      const before = state.detail;
      state.detail = detail;
      const { room: info, players } = detail;

      if (!state.match && before && before.players) announce(before.players, players);

      if (info.status === 'playing' && info.gameId) {
        if (!state.match || state.match.gameId !== info.gameId) {
          if (state.match) state.match.destroy();
          startMatch(info.gameId);
        }
        return;
      }
      if (state.match) return; // a partida ainda está mostrando o fim de jogo

      // Só redesenha o lobby quando algo mudou de verdade (evita piscar a tela).
      const key = JSON.stringify([info, players, detail.me]);
      if (key === state.renderedKey && qs('.lobby')) return;
      state.renderedKey = key;
      document.title = `Vira-7 · Sala ${info.code}`;
      renderLobby();
    }

    /** Avisa quem entrou e quem saiu. */
    function announce(before, after) {
      const names = (list) => new Map(list.map((p) => [p.id, p.name]));
      const old = names(before);
      const now = names(after);
      now.forEach((name, id) => {
        if (!old.has(id)) App.toast(`${name} entrou na sala.`, { variant: 'stay', iconName: 'user' });
      });
      old.forEach((name, id) => {
        if (!now.has(id)) App.toast(`${name} saiu da sala.`, { iconName: 'user' });
      });
    }

    async function refresh() {
      if (state.closed || state.refreshing) return;
      state.refreshing = true;
      try {
        apply(await F7.Api.get(`/rooms/${code}`));
      } catch (error) {
        if (state.closed) return;
        if (['NOT_IN_ROOM', 'ROOM_NOT_FOUND'].includes(error.code)) {
          state.closed = true;
          App.toast('Esta sala foi fechada ou você foi removido dela.', { variant: 'bust' });
          App.navigate('/');
        }
      } finally {
        state.refreshing = false;
      }
    }

    function setConnection(status) {
      state.connection = status;
      if (els.connection && els.connection.isConnected) {
        const [text, kind] = STATUS_TEXT[status];
        els.connection.className = `conn conn--${kind}`;
        clear(els.connection).append(h('i', { class: 'dot' }), text);
      }
      const chip = qs('#conn-chip');
      if (chip) {
        const [text, kind] = STATUS_TEXT[status];
        chip.className = `conn conn--${kind}`;
        chip.hidden = false;
        clear(chip).append(h('i', { class: 'dot' }), h('span', {}, text));
      }
    }

    /* ---------------------------------------------------------------- ciclo de vida */

    App.backHandler = leave;
    apply(detail);
    state.detail = detail;

    let pending = null;
    const channel = F7.Realtime.joinRoom({
      roomId: detail.room.id,
      code,
      userId,
      onRoomChange: () => {
        clearTimeout(pending);
        pending = setTimeout(refresh, 150);
      },
      onGameEvent: (event) => state.match && state.match.receive(event),
      onPresence: (ids) => {
        state.onlineIds = ids;
        if (state.match) state.match.setPresence(ids);
        else if (!state.closed && state.detail.room.status === 'lobby') renderLobby();
      },
      onStatus: setConnection,
    });

    const beat = () => F7.Api.post(`/rooms/${code}/heartbeat`).catch(() => {});
    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        beat();
        refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      state.closed = true;
      clearTimeout(pending);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
      channel.leave();
      if (state.match) state.match.destroy();
      state.match = null;
      App.gameHandlers = null;
      qs('#btn-restart').hidden = false;
      const chip = qs('#conn-chip');
      if (chip) chip.hidden = true;
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { room });
})(globalThis.F7 = globalThis.F7 || {});
