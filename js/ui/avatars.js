/**
 * Vira-7 — Personagens: 10 bichinhos desenhados em SVG (sem imagens externas).
 * As chaves são as mesmas aceitas pelo servidor e pelo banco.
 */
((F7) => {
  'use strict';

  const eyes = (y = 34, dx = 9, r = 3.2, color = '#22303a') =>
    `<circle cx="${32 - dx}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${32 + dx}" cy="${y}" r="${r}" fill="${color}"/>` +
    `<circle cx="${32 - dx + 1}" cy="${y - 1.2}" r="1" fill="#fff"/><circle cx="${32 + dx + 1}" cy="${y - 1.2}" r="1" fill="#fff"/>`;
  const smile = (y = 45, w = 5) =>
    `<path d="M${32 - w} ${y} Q32 ${y + 4} ${32 + w} ${y}" fill="none" stroke="#22303a" stroke-width="1.8" stroke-linecap="round"/>`;
  const cheeks = `<circle cx="19" cy="42" r="3.4" fill="#ff8fa3" opacity=".55"/><circle cx="45" cy="42" r="3.4" fill="#ff8fa3" opacity=".55"/>`;

  const ANIMALS = {
    raposa: {
      name: 'Raposa',
      color: '#ff922b',
      body:
        '<path d="M10 28 14 6l14 12zM54 28 50 6 36 18z" fill="#f76707"/><path d="M14.5 22 16 11l7 6zM49.5 22 48 11l-7 6z" fill="#fff4e6"/>' +
        '<circle cx="32" cy="36" r="21" fill="#ff922b"/><path d="M11 40a21 21 0 0 0 42 0c-6-6-14-4-21 3-7-7-15-9-21-3z" fill="#fff4e6"/>' +
        eyes(33) + '<ellipse cx="32" cy="43" rx="3.4" ry="2.6" fill="#22303a"/>' + smile(47, 4),
    },
    panda: {
      name: 'Panda',
      color: '#c9d6e8',
      body:
        '<circle cx="13" cy="17" r="8" fill="#22303a"/><circle cx="51" cy="17" r="8" fill="#22303a"/><circle cx="32" cy="36" r="21" fill="#fff"/>' +
        '<ellipse cx="22" cy="34" rx="6.5" ry="7.5" fill="#22303a" transform="rotate(-18 22 34)"/><ellipse cx="42" cy="34" rx="6.5" ry="7.5" fill="#22303a" transform="rotate(18 42 34)"/>' +
        '<circle cx="23" cy="34" r="2.6" fill="#fff"/><circle cx="41" cy="34" r="2.6" fill="#fff"/><circle cx="23.5" cy="34.5" r="1.3" fill="#22303a"/><circle cx="40.5" cy="34.5" r="1.3" fill="#22303a"/>' +
        '<ellipse cx="32" cy="43" rx="3.2" ry="2.3" fill="#22303a"/>' + smile(47, 4),
    },
    sapo: {
      name: 'Sapo',
      color: '#51cf66',
      body:
        '<circle cx="19" cy="19" r="9" fill="#40c057"/><circle cx="45" cy="19" r="9" fill="#40c057"/><ellipse cx="32" cy="38" rx="23" ry="19" fill="#51cf66"/>' +
        '<circle cx="19" cy="19" r="5.6" fill="#fff"/><circle cx="45" cy="19" r="5.6" fill="#fff"/><circle cx="20" cy="20" r="2.8" fill="#22303a"/><circle cx="44" cy="20" r="2.8" fill="#22303a"/>' +
        '<path d="M17 42q15 12 30 0" fill="none" stroke="#22303a" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="28" cy="35" r="1.1" fill="#2b8a3e"/><circle cx="36" cy="35" r="1.1" fill="#2b8a3e"/>' + cheeks,
    },
    leao: {
      name: 'Leão',
      color: '#ffd43b',
      body:
        Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return `<circle cx="${(32 + Math.cos(a) * 21).toFixed(1)}" cy="${(35 + Math.sin(a) * 21).toFixed(1)}" r="8" fill="#e8590c"/>`;
        }).join('') +
        '<circle cx="32" cy="35" r="18" fill="#ffd43b"/><circle cx="18" cy="21" r="4.5" fill="#ffd43b"/><circle cx="46" cy="21" r="4.5" fill="#ffd43b"/>' +
        eyes(33, 8) + '<path d="M28.5 40h7l-3.5 4z" fill="#7a4a22"/>' +
        '<path d="M32 44v2.500M32 46.500q-3.5 3-6 0M32 46.500q3.5 3 6 0" fill="none" stroke="#22303a" stroke-width="1.6" stroke-linecap="round"/>',
    },
    gato: {
      name: 'Gato',
      color: '#adb5bd',
      body:
        '<path d="M11 30 13 7l15 13zM53 30 51 7 36 20z" fill="#868e96"/><path d="M15 23l1-9 6 5zM49 23l-1-9-6 5z" fill="#ffc9c9"/>' +
        '<circle cx="32" cy="37" r="21" fill="#adb5bd"/><path d="M26 18l2 7M32 17v8M38 18l-2 7" stroke="#868e96" stroke-width="2.2" stroke-linecap="round"/>' +
        eyes(35, 9, 3.4, '#2f9e44') + '<circle cx="23" cy="35" r="1.5" fill="#22303a"/><circle cx="41" cy="35" r="1.5" fill="#22303a"/>' +
        '<path d="M29.5 42h5l-2.5 3z" fill="#ff8fa3"/>' + smile(46, 4) +
        '<path d="M8 40l10 2M8 46l10-1M56 40l-10 2M56 46l-10-1" stroke="#495057" stroke-width="1.2" stroke-linecap="round"/>',
    },
    coelho: {
      name: 'Coelho',
      color: '#ffdeeb',
      body:
        '<ellipse cx="23" cy="13" rx="6" ry="14" fill="#fff0f6" transform="rotate(-10 23 13)"/><ellipse cx="41" cy="13" rx="6" ry="14" fill="#fff0f6" transform="rotate(10 41 13)"/>' +
        '<ellipse cx="23" cy="14" rx="2.8" ry="9" fill="#faa2c1" transform="rotate(-10 23 14)"/><ellipse cx="41" cy="14" rx="2.8" ry="9" fill="#faa2c1" transform="rotate(10 41 14)"/>' +
        '<circle cx="32" cy="40" r="19" fill="#fff0f6"/>' + eyes(38, 8) + '<ellipse cx="32" cy="45" rx="2.6" ry="1.9" fill="#f06595"/>' +
        '<path d="M32 47v2.5" stroke="#22303a" stroke-width="1.6" stroke-linecap="round"/><rect x="29.5" y="49.5" width="5" height="4.5" rx="1" fill="#fff" stroke="#ced4da" stroke-width=".8"/>' + cheeks,
    },
    urso: {
      name: 'Urso',
      color: '#b08968',
      body:
        '<circle cx="14" cy="18" r="8.5" fill="#8a5a3c"/><circle cx="50" cy="18" r="8.5" fill="#8a5a3c"/><circle cx="14" cy="18" r="4.5" fill="#d9a77d"/><circle cx="50" cy="18" r="4.5" fill="#d9a77d"/>' +
        '<circle cx="32" cy="37" r="21" fill="#b08968"/><ellipse cx="32" cy="44" rx="10" ry="8" fill="#ecd3b6"/>' +
        eyes(33, 9) + '<ellipse cx="32" cy="41" rx="3.6" ry="2.6" fill="#22303a"/>' + smile(46, 4),
    },
    pinguim: {
      name: 'Pinguim',
      color: '#4dabf7',
      body:
        '<circle cx="32" cy="36" r="22" fill="#1c3d5a"/><path d="M32 22c-9-8-19 0-17 12 1 12 8 20 17 20s16-8 17-20c2-12-8-20-17-12z" fill="#fff"/>' +
        eyes(34, 8.5) + '<path d="M26.5 41h11l-5.5 7z" fill="#ff922b"/>' + cheeks +
        '<path d="M26 12q6-6 12 0" fill="none" stroke="#1c3d5a" stroke-width="3" stroke-linecap="round"/>',
    },
    coruja: {
      name: 'Coruja',
      color: '#b197fc',
      body:
        '<path d="M12 28 12 8l14 10zM52 28 52 8 38 18z" fill="#7048e8"/><circle cx="32" cy="37" r="21" fill="#9775fa"/>' +
        '<path d="M16 46q16 12 32 0-4 12-16 12T16 46z" fill="#d0bfff"/>' +
        '<circle cx="22.5" cy="33" r="9" fill="#fff"/><circle cx="41.5" cy="33" r="9" fill="#fff"/><circle cx="22.5" cy="33" r="9" fill="none" stroke="#ffd43b" stroke-width="2"/><circle cx="41.5" cy="33" r="9" fill="none" stroke="#ffd43b" stroke-width="2"/>' +
        '<circle cx="23.5" cy="33.5" r="4" fill="#22303a"/><circle cx="40.5" cy="33.5" r="4" fill="#22303a"/><circle cx="24.8" cy="32" r="1.3" fill="#fff"/><circle cx="41.8" cy="32" r="1.3" fill="#fff"/>' +
        '<path d="M29 40h6l-3 6z" fill="#ff922b"/>',
    },
    macaco: {
      name: 'Macaco',
      color: '#c98a5e',
      body:
        '<circle cx="9.5" cy="35" r="7.5" fill="#8a5a3c"/><circle cx="54.5" cy="35" r="7.5" fill="#8a5a3c"/><circle cx="9.5" cy="35" r="4" fill="#f3c9a5"/><circle cx="54.5" cy="35" r="4" fill="#f3c9a5"/>' +
        '<circle cx="32" cy="35" r="21" fill="#8a5a3c"/><path d="M32 22c-5-6-15-2-14 8 0 4 2 6 2 9 0 8 6 14 12 14s12-6 12-14c0-3 2-5 2-9 1-10-9-14-14-8z" fill="#f3c9a5"/>' +
        eyes(33, 7) + '<circle cx="30" cy="41" r="1" fill="#22303a"/><circle cx="34" cy="41" r="1" fill="#22303a"/>' +
        '<path d="M25 45q7 6 14 0" fill="none" stroke="#22303a" stroke-width="1.8" stroke-linecap="round"/>',
    },
  };

  const KEYS = Object.keys(ANIMALS);
  const DEFAULT = 'raposa';

  const info = (key) => ANIMALS[key] || ANIMALS[DEFAULT];

  /** SVG do personagem como string. */
  const svg = (key) =>
    `<svg class="avatar__art" viewBox="0 0 64 64" aria-hidden="true">${info(key).body}</svg>`;

  /**
   * Preenche um elemento `.avatar` com o personagem (ou a inicial do nome, se não houver).
   * @param {HTMLElement} el
   * @param {{ avatar?: string, name?: string, color?: string }} who
   */
  function fill(el, { avatar, name, color } = {}) {
    if (!el) return el;
    if (avatar && ANIMALS[avatar]) {
      el.innerHTML = svg(avatar);
      el.classList.add('avatar--animal');
    } else {
      el.textContent = F7.dom.initial(name);
      el.classList.remove('avatar--animal');
    }
    // Sem cor definida (fora da mesa), o fundo usa a cor do próprio bichinho.
    const background = color || (avatar && ANIMALS[avatar] ? ANIMALS[avatar].color : null);
    if (background) el.style.setProperty('--avatar-color', background);
    return el;
  }

  /** Cria um avatar pronto. */
  function create(who = {}, className = '') {
    const el = document.createElement('div');
    el.className = `avatar ${className}`.trim();
    if (who.avatar) el.title = info(who.avatar).name;
    return fill(el, who);
  }

  /**
   * Grade para escolher o personagem.
   * @param {{ value?: string, onChange?: (key: string) => void }} options
   */
  function picker({ value = DEFAULT, onChange } = {}) {
    const { h } = F7.dom;
    let current = ANIMALS[value] ? value : DEFAULT;
    const buttons = new Map();
    const root = h('div', { class: 'avatar-picker', role: 'radiogroup', 'aria-label': 'Escolha seu personagem' });

    const select = (key, notify = true) => {
      current = key;
      buttons.forEach((button, k) => button.setAttribute('aria-checked', String(k === key)));
      if (notify && onChange) onChange(key);
    };

    KEYS.forEach((key) => {
      const button = h(
        'button',
        {
          type: 'button',
          class: 'avatar-picker__item',
          role: 'radio',
          title: ANIMALS[key].name,
          'aria-label': ANIMALS[key].name,
          style: { '--avatar-color': ANIMALS[key].color },
          onClick: () => {
            select(key);
            if (F7.Sound) F7.Sound.click();
            if (F7.FX) F7.FX.retrigger(button, 'is-picked', 500);
          },
        },
        h('span', { class: 'avatar avatar--animal avatar--xl', html: svg(key) }),
        h('span', { class: 'avatar-picker__name' }, ANIMALS[key].name),
      );
      buttons.set(key, button);
      root.appendChild(button);
    });
    select(current, false);

    return { el: root, get value() { return current; }, set: (key) => select(ANIMALS[key] ? key : DEFAULT, false) };
  }

  F7.Avatars = { KEYS, DEFAULT, info, svg, fill, create, picker };
})(globalThis.F7 = globalThis.F7 || {});
