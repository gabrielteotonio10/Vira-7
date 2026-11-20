/**
 * Vira-7 — Chat rápido: frases prontas e emojis, sem texto livre.
 *
 * `Chat.create` busca as mensagens da sala (a cada poucos segundos) e avisa quem escuta.
 * `Chat.picker` desenha os botões de envio. `Chat.floatOnTable` faz o emoji ou a frase
 * subir ao lado do jogador que mandou.
 */
((F7) => {
  'use strict';

  const { h } = F7.dom;

  const PHRASES = {
    good: 'Boa!',
    risk: 'Vai arriscar?',
    nice: 'Boa jogada!',
    oops: 'Eita!',
    hurry: 'Bora, tá demorando!',
    gg: 'Bom jogo!',
    wow: 'Uau!',
    rematch: 'Revanche?',
  };
  const EMOJIS = ['😂', '😮', '🔥', '👏', '😭', '😎', '🍀', '💀'];
  const POLL_MS = 2500;

  const textOf = (message) => (message.kind === 'say' ? PHRASES[message.key] || '' : message.key);

  /** Conexão com o chat de uma sala. Chame `destroy()` ao sair da tela. */
  function create({ code, onMessage }) {
    let after = 0;
    let first = true;
    let stopped = false;
    let timer = null;
    let busy = false;

    async function poll() {
      if (stopped || busy || document.visibilityState === 'hidden') return;
      busy = true;
      try {
        const data = await F7.Api.get(`/rooms/${code}/chat?after=${after}`);
        if (stopped) return;
        after = data.seq;
        // Na primeira consulta só marca o que já existia, sem soltar emojis antigos.
        if (!first) data.messages.forEach((message) => onMessage(message));
        else data.messages.forEach((message) => onMessage(message, { history: true }));
        first = false;
      } catch (error) {
        /* sem chat por enquanto; tenta de novo no próximo ciclo */
      } finally {
        busy = false;
      }
    }

    timer = setInterval(poll, POLL_MS);
    poll();

    return {
      async send(kind, key) {
        try {
          const { message } = await F7.Api.post(`/rooms/${code}/chat`, { kind, key });
          after = Math.max(after, message.seq - 1);
          poll();
        } catch (error) {
          if (error.code !== 'CHAT_TOO_FAST') F7.App.toast(error.message, { variant: 'bust' });
        }
      },
      poll,
      destroy() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  /** Botões de emojis e frases. `send(kind, key)` é chamado a cada toque. */
  function picker(send, { onPick } = {}) {
    const pick = (kind, key) => () => {
      F7.Sound.click();
      send(kind, key);
      if (onPick) onPick();
    };
    return h(
      'div',
      { class: 'chat-picker' },
      h(
        'div',
        { class: 'chat-picker__emojis', role: 'group', 'aria-label': 'Emojis' },
        EMOJIS.map((emoji) => h('button', { type: 'button', class: 'chat-emoji', 'aria-label': emoji, onClick: pick('emoji', emoji) }, emoji)),
      ),
      h(
        'div',
        { class: 'chat-picker__phrases', role: 'group', 'aria-label': 'Mensagens rápidas' },
        Object.entries(PHRASES).map(([key, text]) => h('button', { type: 'button', class: 'chat-phrase', onClick: pick('say', key) }, text)),
      ),
    );
  }

  /** Faz a mensagem aparecer sobre o lugar de quem mandou (ou no centro da mesa). */
  function floatOnTable(message, table) {
    let layer = document.querySelector('#chat-layer');
    if (!layer) {
      layer = h('div', { id: 'chat-layer', 'aria-hidden': 'true' });
      document.body.appendChild(layer);
    }
    const seat = table && [...table.seats.values()].find((entry) => entry.player.userId === message.userId);
    const rect = seat ? seat.el.getBoundingClientRect() : null;
    const rawX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2 + (Math.random() - 0.5) * 120;
    // Perto das bordas, o balão continua inteiro na tela.
    const x = Math.min(Math.max(rawX, 90), Math.max(90, window.innerWidth - 90));
    const y = rect ? rect.top + Math.min(40, rect.height / 2) : window.innerHeight * 0.55;

    const bubble =
      message.kind === 'emoji'
        ? h('span', { class: 'chat-float chat-float--emoji', style: { left: `${x}px`, top: `${y}px` } }, message.key)
        : h(
            'span',
            { class: 'chat-float chat-float--say', style: { left: `${x}px`, top: `${y}px` } },
            h('b', {}, message.name),
            ` ${F7.i18n.t(textOf(message))}`,
          );
    layer.appendChild(bubble);
    setTimeout(() => bubble.remove(), message.kind === 'emoji' ? 2600 : 3600);
    if (F7.Voice && F7.Voice.enabled && message.kind === 'say') F7.Voice.say(`${message.name}: ${textOf(message)}`);
  }

  /** Linha de texto para o histórico do lobby. */
  function describe(message) {
    return { who: message.name, text: message.kind === 'say' ? PHRASES[message.key] || '' : message.key };
  }

  F7.Chat = { create, picker, floatOnTable, describe, PHRASES, EMOJIS };
})(globalThis.F7 = globalThis.F7 || {});
