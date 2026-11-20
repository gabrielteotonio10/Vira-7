/**
 * Vira-7 — Aparência: tema claro/escuro, mesa, verso das cartas e modo para daltônicos.
 *
 * Tudo vira atributos em <html> (veja css/themes.css). As escolhas ficam no
 * localStorage para valer já na primeira pintura, antes de o login terminar.
 */
((F7) => {
  'use strict';

  const OPTIONS = {
    theme: ['light', 'dark', 'auto'],
    tableTheme: ['felt', 'wood', 'ocean', 'night'],
    cardBack: ['classic', 'stripes', 'dots', 'stars'],
  };
  const CACHE_KEY = 'look';
  const THEME_COLOR = { light: '#fff6e5', dark: '#161b26' };

  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let current = { theme: 'light', tableTheme: 'felt', cardBack: 'classic', colorblind: false };

  function pick(key, value) {
    return OPTIONS[key].includes(value) ? value : OPTIONS[key][0];
  }

  function paint() {
    const root = document.documentElement;
    const dark = current.theme === 'dark' || (current.theme === 'auto' && !!media && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.table = current.tableTheme;
    root.dataset.back = current.cardBack;
    if (current.colorblind) root.dataset.cb = 'on';
    else delete root.dataset.cb;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[dark ? 'dark' : 'light']);
  }

  const Theme = {
    OPTIONS,

    /** Aplica as preferências (ignora valores desconhecidos). */
    apply(settings = {}) {
      current = {
        theme: pick('theme', settings.theme),
        tableTheme: pick('tableTheme', settings.tableTheme),
        cardBack: pick('cardBack', settings.cardBack),
        colorblind: !!settings.colorblind,
      };
      paint();
      try {
        localStorage.setItem(`vira7:${CACHE_KEY}`, JSON.stringify(current));
      } catch (error) {
        /* sem armazenamento: tudo bem */
      }
    },

    /** Lê o último visual salvo neste aparelho. */
    cached() {
      try {
        return JSON.parse(localStorage.getItem(`vira7:${CACHE_KEY}`)) || {};
      } catch (error) {
        return {};
      }
    },
  };

  if (media) media.addEventListener('change', paint);
  Theme.apply(Theme.cached());
  F7.Theme = Theme;
})(globalThis.F7 = globalThis.F7 || {});
