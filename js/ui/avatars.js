/**
 * Vira-7 — Personagens: 10 bichinhos desenhados em SVG (sem imagens externas).
 * As chaves são as mesmas aceitas pelo servidor e pelo banco.
 */
((F7) => {
  'use strict';

  // Estilo: retrato de busto (cabeça e ombros), cores chapadas, contorno de tinta e uma
  // sombra lateral também chapada — o mesmo traço do resto do jogo. O fundo vem da cor
  // do jogador (--avatar-color); o SVG só acrescenta um "holofote" claro atrás do bicho.
  const INK = '#1b2333';
  const line = (w = 2) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
  const spot = '<circle cx="32" cy="34" r="27" fill="#fff" opacity=".2"/>';
  /** Olhos: pupila oval com dois brilhos. Ficam num grupo para piscar (CSS). */
  const eyes = (y = 29, dx = 6.5, ry = 3.2) =>
    '<g class="av-eyes">' +
    [32 - dx, 32 + dx]
      .map((x) => `<ellipse cx="${x}" cy="${y}" rx="${(ry * 0.8).toFixed(2)}" ry="${ry}" fill="${INK}"/>` +
        `<circle cx="${x - 0.9}" cy="${y - 1.2}" r="1.1" fill="#fff"/><circle cx="${x + 0.8}" cy="${y + 1}" r=".5" fill="#fff"/>`)
      .join('') +
    '</g>';
  const smile = (y = 40, w = 2.6) => `<path d="M${32 - w} ${y}q${w} 2.2 ${w * 2} 0" fill="none" ${line(1.6)}/>`;
  const blush = (y = 35, dx = 11) =>
    `<ellipse cx="${32 - dx}" cy="${y}" rx="3" ry="1.8" fill="#ff8fa3" opacity=".6"/><ellipse cx="${32 + dx}" cy="${y}" rx="3" ry="1.8" fill="#ff8fa3" opacity=".6"/>`;
  /** Ombros (o "busto") na base do retrato, com um peito opcional de outra cor. */
  const shoulders = (color, chest) =>
    `<path d="M7 66c1.5-10 11.5-16 25-16s23.5 6 25 16z" fill="${color}" ${line()}/>` +
    (chest ? `<path d="M23 66c0-7 4-11 9-11s9 4 9 11z" fill="${chest}"/>` : '');
  /** Sombra chapada do lado direito de uma cabeça redonda. */
  const shade = (cx = 32, cy = 30, r = 16) =>
    `<path d="M${cx + r * 0.2} ${cy - r}a${r} ${r} 0 0 1 0 ${r * 2}a${r * 0.82} ${r} 0 0 0 0-${r * 2}z" fill="#000" opacity=".1"/>`;

  const ANIMALS = {
    raposa: {
      name: 'Raposa',
      color: '#ff922b',
      body:
        spot + shoulders('#f76707', '#fff4e6') +
        `<path d="M16 23 13 5l15 9zM48 23l3-18-15 9z" fill="#ff922b" ${line()}/>` +
        '<path d="M17.5 17.5 16 9.5l7 4.5zM46.5 17.5 48 9.5l-7 4.5z" fill="#7a2e0b"/>' +
        `<path d="M14 28c0-10 7.5-15.5 18-15.5S50 18 50 28c0 9.5-8 16.5-18 18-10-1.5-18-8.5-18-18z" fill="#ff922b" ${line()}/>` +
        '<path d="M15.5 31c5-1 10.5 1.5 16.5 7.5 6-6 11.5-8.5 16.5-7.5-1.5 7.5-8 13-16.5 14.8-8.5-1.8-15-7.3-16.5-14.8z" fill="#fff4e6"/>' +
        shade(32, 29, 17) + eyes(27.5, 7) +
        `<ellipse cx="32" cy="37.5" rx="2.8" ry="2" fill="${INK}"/>` + smile(40.5, 2.4),
    },
    panda: {
      name: 'Panda',
      color: '#74c0fc',
      body:
        spot + shoulders('#fff') +
        `<path d="M7 66c1-6 4-11 9-13.5l4 13.5zM57 66c-1-6-4-11-9-13.5L44 66z" fill="${INK}"/>` +
        `<circle cx="18" cy="15" r="6" fill="${INK}"/><circle cx="46" cy="15" r="6" fill="${INK}"/>` +
        `<circle cx="32" cy="30" r="17" fill="#fff" ${line()}/>` + shade(32, 30, 17) +
        `<ellipse cx="25" cy="29" rx="5" ry="6.5" transform="rotate(-20 25 29)" fill="${INK}"/><ellipse cx="39" cy="29" rx="5" ry="6.5" transform="rotate(20 39 29)" fill="${INK}"/>` +
        '<g class="av-eyes"><circle cx="25.5" cy="28.5" r="2.4" fill="#fff"/><circle cx="38.5" cy="28.5" r="2.4" fill="#fff"/>' +
        `<circle cx="26" cy="29" r="1.3" fill="${INK}"/><circle cx="38" cy="29" r="1.3" fill="${INK}"/></g>` +
        `<ellipse cx="32" cy="35.5" rx="2.8" ry="2" fill="${INK}"/>` + smile(38.8, 2.4) + blush(35, 12),
    },
    sapo: {
      name: 'Sapo',
      color: '#8ce99a',
      body:
        spot + shoulders('#40c057', '#b2f2bb') +
        `<ellipse cx="32" cy="33" rx="19" ry="14" fill="#51cf66" ${line()}/>` +
        `<circle cx="23" cy="20" r="7" fill="#51cf66" ${line()}/><circle cx="41" cy="20" r="7" fill="#51cf66" ${line()}/>` +
        '<path d="M14 30c3-5 33-5 36 0" fill="#51cf66"/>' + shade(32, 33, 15) +
        '<circle cx="23" cy="20" r="4.6" fill="#fff"/><circle cx="41" cy="20" r="4.6" fill="#fff"/>' + eyes(20.5, 9, 2.8) +
        `<path d="M19 35q13 10 26 0" fill="none" ${line(2)}/>` +
        '<circle cx="29" cy="30.5" r="1" fill="#2b8a3e"/><circle cx="35" cy="30.5" r="1" fill="#2b8a3e"/>' + blush(36, 14),
    },
    leao: {
      name: 'Leão',
      color: '#ffe066',
      body:
        spot + shoulders('#e8590c') +
        Array.from({ length: 14 }, (_, i) => {
          const a = (i * Math.PI * 2) / 14;
          return `<circle cx="${(32 + Math.cos(a) * 18.5).toFixed(1)}" cy="${(29 + Math.sin(a) * 18.5).toFixed(1)}" r="6.5" fill="#e8590c" ${line()}/>`;
        }).join('') +
        '<circle cx="32" cy="29" r="18.5" fill="#e8590c"/>' +
        `<circle cx="21.5" cy="17" r="4" fill="#ffd43b" ${line()}/><circle cx="42.5" cy="17" r="4" fill="#ffd43b" ${line()}/>` +
        `<circle cx="32" cy="29" r="13.5" fill="#ffd43b" ${line()}/>` + shade(32, 29, 13.5) +
        eyes(26.5, 5.5, 2.8) + '<ellipse cx="32" cy="34" rx="6" ry="4.3" fill="#fff3bf"/>' +
        `<path d="M29.5 31.5h5l-2.5 3z" fill="#7a4a22" ${line(1.2)}/>` + smile(36.6, 2.2),
    },
    gato: {
      name: 'Gato',
      color: '#ced4da',
      body:
        spot + shoulders('#868e96', '#f1f3f5') +
        `<path d="M15.5 25 15 7l13 9zM48.5 25 49 7l-13 9z" fill="#adb5bd" ${line()}/>` +
        '<path d="M18 19.5 17.6 12l5.5 4zM46 19.5l.4-7.5-5.5 4z" fill="#ffc9c9"/>' +
        `<ellipse cx="32" cy="30" rx="18" ry="16" fill="#adb5bd" ${line()}/>` + shade(32, 30, 16) +
        '<path d="M27 16.5l1.3 5M32 15.8v5.2M37 16.5l-1.3 5" stroke="#868e96" stroke-width="2" stroke-linecap="round"/>' +
        `<g class="av-eyes"><ellipse cx="25" cy="28" rx="3.4" ry="3.8" fill="#8ce99a" ${line(1.3)}/><ellipse cx="39" cy="28" rx="3.4" ry="3.8" fill="#8ce99a" ${line(1.3)}/>` +
        `<ellipse cx="25" cy="28" rx="1" ry="3" fill="${INK}"/><ellipse cx="39" cy="28" rx="1" ry="3" fill="${INK}"/><circle cx="24" cy="26.5" r=".8" fill="#fff"/><circle cx="38" cy="26.5" r=".8" fill="#fff"/></g>` +
        `<path d="M30 33.5h4l-2 2.3z" fill="#ff8fa3" ${line(1.1)}/>` +
        `<path d="M28.5 37.2q1.8 1.8 3.5 0q1.7 1.8 3.5 0" fill="none" ${line(1.5)}/>` +
        '<path d="M10 31l9 1.5M10 36.5l9-.8M54 31l-9 1.5M54 36.5l-9-.8" stroke="#495057" stroke-width="1.1" stroke-linecap="round"/>',
    },
    coelho: {
      name: 'Coelho',
      color: '#fcc2d7',
      body:
        spot + shoulders('#fff0f6') +
        `<ellipse cx="25" cy="11" rx="5" ry="12" transform="rotate(-9 25 11)" fill="#fff0f6" ${line()}/><ellipse cx="39" cy="11" rx="5" ry="12" transform="rotate(9 39 11)" fill="#fff0f6" ${line()}/>` +
        '<ellipse cx="25" cy="12" rx="2.3" ry="8" transform="rotate(-9 25 12)" fill="#faa2c1"/><ellipse cx="39" cy="12" rx="2.3" ry="8" transform="rotate(9 39 12)" fill="#faa2c1"/>' +
        `<circle cx="32" cy="32" r="15.5" fill="#fff0f6" ${line()}/>` + shade(32, 32, 15.5) +
        eyes(30.5, 6, 3) + `<path d="M30.3 35.3h3.4l-1.7 1.8z" fill="#f06595" ${line(1)}/>` +
        `<path d="M32 37.2v1.8M32 39q-2 2-3.6.8M32 39q2 2 3.6.8" fill="none" ${line(1.4)}/>` +
        `<rect x="30.2" y="39.6" width="3.6" height="3.4" rx=".8" fill="#fff" ${line(1)}/>` + blush(36, 10),
    },
    urso: {
      name: 'Urso',
      color: '#d8b48f',
      body:
        spot + shoulders('#8a5a3c', '#c99a6e') +
        `<circle cx="18.5" cy="16" r="6.5" fill="#a8754e" ${line()}/><circle cx="45.5" cy="16" r="6.5" fill="#a8754e" ${line()}/>` +
        '<circle cx="18.5" cy="16" r="3.4" fill="#ecd3b6"/><circle cx="45.5" cy="16" r="3.4" fill="#ecd3b6"/>' +
        `<circle cx="32" cy="30" r="16.5" fill="#a8754e" ${line()}/>` + shade(32, 30, 16.5) +
        '<ellipse cx="32" cy="36" rx="7.5" ry="5.5" fill="#ecd3b6"/>' + eyes(27.5, 6.5, 2.9) +
        `<ellipse cx="32" cy="33.8" rx="3.1" ry="2.2" fill="${INK}"/>` + smile(37.6, 2.4),
    },
    pinguim: {
      name: 'Pinguim',
      color: '#74c0fc',
      body:
        spot + shoulders('#1c3d5a') + '<path d="M22 66c0-8 4.5-12.5 10-12.5S42 58 42 66z" fill="#fff"/>' +
        `<circle cx="32" cy="29.5" r="17" fill="#1c3d5a" ${line()}/>` +
        '<path d="M32 22c-6-7-17-3-16 7 1 9 7.5 15 16 15s15-6 16-15c1-10-10-14-16-7z" fill="#fff"/>' + shade(32, 29.5, 17) +
        eyes(29, 6, 2.9) + `<path d="M28.3 34.3h7.4l-3.7 4.4z" fill="#ff922b" ${line(1.3)}/>` + blush(35.5, 11),
    },
    coruja: {
      name: 'Coruja',
      color: '#b197fc',
      body:
        spot + shoulders('#7048e8', '#d0bfff') +
        `<path d="M15 21 13.5 7l11 8zM49 21l1.5-14-11 8z" fill="#7048e8" ${line()}/>` +
        `<circle cx="32" cy="30" r="17" fill="#9775fa" ${line()}/>` + shade(32, 30, 17) +
        `<circle cx="25" cy="28.5" r="7.2" fill="#f3f0ff" ${line(1.6)}/><circle cx="39" cy="28.5" r="7.2" fill="#f3f0ff" ${line(1.6)}/>` +
        '<circle cx="25" cy="28.5" r="4.4" fill="#fcc419"/><circle cx="39" cy="28.5" r="4.4" fill="#fcc419"/>' + eyes(28.5, 7, 2.6) +
        `<path d="M29.4 34.5h5.2L32 39z" fill="#ff922b" ${line(1.2)}/>` +
        '<path d="M26 42.5l2 1.8 2-1.8M34 42.5l2 1.8 2-1.8" fill="none" stroke="#5f3dc4" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
    },
    macaco: {
      name: 'Macaco',
      color: '#e6b98f',
      body:
        spot + shoulders('#6b4226', '#c99a6e') +
        `<circle cx="14.5" cy="30" r="6" fill="#8a5a3c" ${line()}/><circle cx="49.5" cy="30" r="6" fill="#8a5a3c" ${line()}/>` +
        '<circle cx="14.5" cy="30" r="3.3" fill="#f3c9a5"/><circle cx="49.5" cy="30" r="3.3" fill="#f3c9a5"/>' +
        `<circle cx="32" cy="29" r="16.5" fill="#8a5a3c" ${line()}/>` + shade(32, 29, 16.5) +
        '<path d="M32 21c-4-5-12.5-3-11.8 4.5.3 2.7 1.8 4 1.8 7 0 7 4.8 11.5 10 11.5s10-4.5 10-11.5c0-3 1.5-4.3 1.8-7C44.5 18 36 16 32 21z" fill="#f3c9a5"/>' +
        eyes(28, 5.2, 2.7) + `<circle cx="30.4" cy="34.5" r=".9" fill="${INK}"/><circle cx="33.6" cy="34.5" r=".9" fill="${INK}"/>` +
        `<path d="M27.5 38q4.5 3.8 9 0" fill="none" ${line(1.6)}/>`,
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
    // Cada bichinho pisca num ritmo próprio (todos juntos ficaria artificial).
    el.style.setProperty('--blink-delay', `${(Math.random() * 6).toFixed(2)}s`);
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
