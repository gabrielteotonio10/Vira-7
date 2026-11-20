/**
 * Vira-7 — App instalável (PWA): registra o service worker e guarda o convite de instalação
 * do navegador para a tela de Ajustes oferecer o botão "Instalar".
 */
((F7) => {
  'use strict';

  let deferred = null;
  const listeners = new Set();

  const standalone = () =>
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });

  F7.Pwa = {
    /** 'installed' (já aberto como app), 'available' (dá para instalar), 'ios' (instalar pelo Safari) ou 'none'. */
    get status() {
      if (standalone()) return 'installed';
      if (deferred) return 'available';
      return isIos() ? 'ios' : 'none';
    },

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async install() {
      if (!deferred) return false;
      deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      listeners.forEach((fn) => fn());
      return choice.outcome === 'accepted';
    },

    register() {
      const secure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (!secure || !('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    },
  };
})(globalThis.F7 = globalThis.F7 || {});
