/**
 * Vira-7 — Amigos: pedidos, lista com a sala de cada um ("entrar na sala de fulano")
 * e convite por WhatsApp.
 */
((F7) => {
  'use strict';

  const { h, clear } = F7.dom;
  const { icon } = F7.icons;
  const App = F7.App;

  /** Link do WhatsApp com um texto pronto. */
  function whatsappUrl(text) {
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  }

  function siteLink() {
    return `${window.location.origin}${window.location.pathname}`;
  }

  function openWhatsapp(text) {
    window.open(whatsappUrl(text), '_blank', 'noopener');
  }

  /** Convite para uma sala: usa o compartilhamento do aparelho quando existe (celular), senão o WhatsApp. */
  async function invite(room, friend) {
    const link = `${siteLink()}#/sala/${room.code}`;
    const text = `${F7.i18n.t('Bora jogar Vira-7! Entra na minha sala:')} ${link}\n${F7.i18n.t('Código')}: ${room.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Vira-7', text: friend ? `${friend.username}, ${text}` : text, url: link });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return; // a pessoa fechou a janela de compartilhar
      }
    }
    openWhatsapp(text);
  }

  function person(entry, ...extra) {
    return h(
      'li',
      { class: 'friend' },
      F7.Avatars.create({ avatar: entry.avatar, name: entry.username }),
      h(
        'div',
        { class: 'friend__main' },
        h('a', { class: 'friend__name', href: `#/perfil/${encodeURIComponent(entry.username)}` }, entry.username),
        entry.room
          ? h(
              'span',
              { class: 'friend__room' },
              h('i', { class: 'dot' }),
              entry.room.private
                ? 'Em uma sala privada'
                : entry.room.status === 'playing' ? `Jogando em ${entry.room.name}` : `Na sala ${entry.room.name} · ${entry.room.playerCount}/${entry.room.maxPlayers}`,
            )
          : null,
      ),
      ...extra,
    );
  }

  async function friends() {
    const data = { friends: [], incoming: [], outgoing: [] };
    const lists = {
      incoming: h('ul', { class: 'friend-list' }),
      outgoing: h('ul', { class: 'friend-list' }),
      friends: h('ul', { class: 'friend-list' }),
    };
    const incomingPanel = h('section', { class: 'panel', hidden: true }, h('div', { class: 'section-head' }, h('h2', {}, 'Pedidos recebidos')), lists.incoming);
    const outgoingPanel = h('section', { class: 'panel', hidden: true }, h('div', { class: 'section-head' }, h('h2', {}, 'Pedidos enviados')), lists.outgoing);

    const act = (button, request) =>
      App.busy(button, async () => {
        apply(await request());
      });

    async function removeFriend(entry) {
      const ok = await F7.Modals.confirm({
        title: `Remover ${entry.username}?`,
        text: 'Vocês deixam de ser amigos. Dá para adicionar de novo depois.',
        confirmLabel: 'Remover',
      });
      if (ok) apply(await F7.Api.del(`/friends/${entry.userId}`));
    }

    async function join(entry) {
      try {
        const { room } = await F7.Api.post(`/rooms/${entry.room.code}/join`);
        App.navigate(`/sala/${room.code}`);
      } catch (error) {
        App.toast(error.message, { variant: 'bust' });
      }
    }

    function render() {
      clear(lists.incoming);
      data.incoming.forEach((entry) =>
        lists.incoming.appendChild(
          person(
            entry,
            h('button', { type: 'button', class: 'btn btn--success', onClick: (e) => act(e.currentTarget, () => F7.Api.post(`/friends/${entry.userId}/accept`)) }, 'Aceitar'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Recusar ${entry.username}`, title: 'Recusar', html: icon('close'), onClick: (e) => act(e.currentTarget, () => F7.Api.del(`/friends/${entry.userId}`)) }),
          ),
        ),
      );
      incomingPanel.hidden = !data.incoming.length;

      clear(lists.outgoing);
      data.outgoing.forEach((entry) =>
        lists.outgoing.appendChild(
          person(
            entry,
            h('span', { class: 'badge' }, 'Aguardando'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Cancelar pedido para ${entry.username}`, title: 'Cancelar pedido', html: icon('close'), onClick: (e) => act(e.currentTarget, () => F7.Api.del(`/friends/${entry.userId}`)) }),
          ),
        ),
      );
      outgoingPanel.hidden = !data.outgoing.length;

      clear(lists.friends);
      if (!data.friends.length) {
        lists.friends.appendChild(h('li', {}, App.empty('user', 'Nenhum amigo ainda', 'Adicione pelo nome de usuário ou chame alguém pelo WhatsApp.')));
      }
      data.friends.forEach((entry) => {
        // Sala privada sem "amigos entram direto": o servidor nem manda o código, então não há botão.
        let button = null;
        if (entry.room && !entry.room.private) {
          button = h('button', { type: 'button', class: 'btn btn--success', onClick: () => join(entry) }, entry.room.mode === 'watch' ? 'Assistir' : 'Entrar na sala');
        } else if (!entry.room && App.state.me && App.state.me.activeRoom) {
          // Eu estou numa sala e o amigo não: convida (compartilhamento do celular ou WhatsApp).
          button = h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => invite(App.state.me.activeRoom, entry) }, 'Convidar para minha sala');
        }
        const profileLink = h('a', {
          class: 'icon-btn', href: `#/perfil/${encodeURIComponent(entry.username)}`, html: icon('user'),
          'aria-label': `Ver o perfil de ${entry.username}`, title: 'Ver perfil',
        });
        lists.friends.appendChild(
          person(
            entry,
            button,
            profileLink,
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remover ${entry.username}`, title: 'Remover amigo', html: icon('close'), onClick: () => removeFriend(entry) }),
          ),
        );
      });
    }

    function apply(next) {
      data.friends = next.friends;
      data.incoming = next.incoming;
      data.outgoing = next.outgoing;
      render();
    }

    const input = h('input', {
      class: 'field', type: 'text', maxlength: 20, placeholder: 'Nome de usuário do amigo',
      autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Nome de usuário do amigo',
    });
    const addButton = h('button', { type: 'submit', class: 'btn btn--primary' }, h('span', { html: icon('plus') }), 'Adicionar');
    const form = h(
      'form',
      {
        class: 'friend-add',
        onSubmit: (event) => {
          event.preventDefault();
          const username = input.value.trim();
          if (!username) return undefined;
          return App.busy(addButton, async () => {
            const result = await F7.Api.post('/friends/requests', { username });
            input.value = '';
            App.toast(result.status === 'accepted' ? 'Vocês agora são amigos!' : 'Pedido enviado!', { variant: 'stay' });
            apply(result);
          });
        },
      },
      input,
      addButton,
    );

    const invite = h(
      'button',
      {
        type: 'button', class: 'btn btn--whatsapp btn--block',
        onClick: () => openWhatsapp(`${F7.i18n.t('Vem jogar Vira-7 comigo! Cria uma conta e me adiciona:')} ${App.state.me.profile.username}\n${siteLink()}`),
      },
      h('span', { html: icon('share') }),
      'Chamar um amigo pelo WhatsApp',
    );

    App.render(
      h(
        'div',
        { class: 'profile' },
        h(
          'section',
          { class: 'panel' },
          h('div', { class: 'section-head' }, h('h1', {}, 'Amigos')),
          form,
          invite,
        ),
        incomingPanel,
        outgoingPanel,
        h('section', { class: 'panel' }, h('div', { class: 'section-head' }, h('h2', {}, 'Meus amigos')), lists.friends),
      ),
      { narrow: true },
    );

    let stopped = false;
    async function load() {
      try {
        const next = await F7.Api.get('/friends');
        if (!stopped) apply(next);
      } catch (error) {
        if (!stopped) App.toast(error.message, { variant: 'bust' });
      }
    }
    await load();
    // As salas dos amigos mudam o tempo todo.
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 6000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { friends });
  F7.Share = { whatsappUrl, openWhatsapp, siteLink, invite };
})(globalThis.F7 = globalThis.F7 || {});
