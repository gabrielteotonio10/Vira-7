/**
 * Vira-7 — Ícones SVG (desenhados para o projeto, sem dependências externas).
 * Todos usam `currentColor`, então herdam a cor do texto.
 */
((F7) => {
  'use strict';

  const svg = (body, viewBox = '0 0 24 24') =>
    `<svg class="icon" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const ICONS = {
    snowflake: svg(
      '<path d="M12 2v20M4.2 7l15.6 10M4.2 17l15.6-10"/>' +
        '<path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>' +
        '<path d="m3.3 10.3 3.4-.9-.9-3.4M20.7 13.7l-3.4.9.9 3.4M3.3 13.7l3.4.9-.9 3.4M20.7 10.3l-3.4-.9.9-3.4"/>',
    ),
    flipThree:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4.5 9A8 8 0 0 1 18 5.5L20 7.5M19.5 15A8 8 0 0 1 6 18.5L4 16.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M20 3.5v4h-4M4 20.5v-4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<text x="12" y="16.3" text-anchor="middle" font-family="Lilita One, sans-serif" font-weight="700" font-size="11" fill="currentColor">3</text>' +
      '</svg>',
    heart:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.2 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.1 1.7-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.7 4.3 7.1C19.5 16.4 12 21 12 21z" fill="currentColor"/>' +
      '<path d="M12 9v6M9 12h6" stroke="#0f9488" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>',
    shield: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3z"/><path d="m9 12 2 2 4-4"/>'),
    hand: svg(
      '<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11M15 10.5V4.5a1.5 1.5 0 0 0-3 0v6M12 10.5V5.5a1.5 1.5 0 0 0-3 0V12"/>' +
        '<path d="M9 12V9.5a1.5 1.5 0 0 0-3 0V15a6 6 0 0 0 6 6h1.5a6 6 0 0 0 4.5-2l2.5-3.5a1.6 1.6 0 0 0-2.5-2L18 15"/>',
    ),
    flip: svg(
      '<rect x="3.5" y="5" width="10" height="14" rx="2"/><path d="M17 8.5c2 .5 3.5 2 3.5 4s-1.2 3.6-3 4.2"/><path d="m16 19 2 -2.3-2.5-1.6"/>',
    ),
    help: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 4"/><path d="M12 17.5h.01"/>'),
    soundOn: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/>'),
    soundOff: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    history: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>'),
    bot: svg('<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16h5"/><circle cx="12" cy="3.5" r="1"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
    crown:
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z" fill="currentColor"/>' +
      '<rect x="5" y="19.2" width="14" height="2" rx="1" fill="currentColor"/></svg>',
    trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
    lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    bolt: svg('<path d="M13 2.5 4.5 13.5H12L11 21.5l8.5-11H12z"/>'),
    target: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
    sparkles: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    restart: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
    users: svg('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>'),
    share: svg('<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12"/>'),
    chat: svg('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/>'),
    eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    arrowUp: svg('<path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/>'),
    arrowDown: svg('<path d="M12 5v14"/><path d="m5.5 12.5 6.5 6.5 6.5-6.5"/>'),
    arrowLeft: svg('<path d="M19 12H5"/><path d="m11.5 5.5-6.5 6.5 6.5 6.5"/>'),
    home: svg('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/>'),
  };

  /** Retorna o SVG do ícone como string. */
  const icon = (name) => ICONS[name] || '';

  /** Retorna o ícone como elemento DOM. */
  function iconEl(name, className = '') {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = icon(name);
    const el = wrapper.firstElementChild;
    if (el && className) el.classList.add(...className.split(' '));
    return el;
  }

  F7.icons = { icon, iconEl, ICONS };
})(globalThis.F7 = globalThis.F7 || {});
