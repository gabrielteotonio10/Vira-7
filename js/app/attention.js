/**
 * Vira-7 — Chama a atenção quando é a sua vez e a aba está em segundo plano:
 * o título da aba pisca ("● Sua vez!") e o ícone ganha um ponto, até a pessoa voltar.
 */
((F7) => {
  'use strict';

  let timer = null;
  let original = null;

  function stop() {
    clearInterval(timer);
    timer = null;
    if (original !== null) document.title = original;
    original = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') stop();
  });

  F7.Attention = {
    /** Pisca o título só se a página não estiver visível. */
    call(text) {
      if (document.visibilityState === 'visible' || timer) return;
      original = document.title;
      let on = false;
      timer = setInterval(() => {
        on = !on;
        document.title = on ? `● ${text}` : original;
      }, 1000);
      document.title = `● ${text}`;
    },
    clear: stop,
  };
})(globalThis.F7 = globalThis.F7 || {});
