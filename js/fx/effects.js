/**
 * Vira-7 — Efeitos visuais.
 *
 *  - flyCard:   carta voando (com giro 3D) de um ponto da tela até outro.
 *  - burst / confetti / snow: sistema de partículas em um canvas de tela cheia.
 *  - banner:    grandes anúncios no centro da tela ("VIRA 7!", "ESTOUROU!").
 *  - floatText: números flutuantes ("+8").
 *  - flash, shake, countUp: pequenos detalhes de "game feel".
 *
 * Todas as funções que animam retornam Promises, para o controlador poder aguardá-las.
 */
((F7) => {
  'use strict';

  const state = {
    speed: 1,
    reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  /** Converte uma duração "base" na duração real (velocidade e movimento reduzido). */
  const dur = (ms) => (state.reduced ? Math.min(ms, 60) : ms / state.speed);
  const wait = (ms) => F7.utils.wait(dur(ms));

  function setSpeed(speed) {
    state.speed = speed > 0 ? speed : 1;
  }

  function layer(className) {
    let el = document.querySelector(`.${className}`);
    if (!el) {
      el = document.createElement('div');
      el.className = className;
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }

  const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

  /* ------------------------------------------------------------------ */
  /* Carta voando                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * @param {{
   *   cardEl: HTMLElement, from: DOMRect, to: DOMRect,
   *   flip?: boolean, duration?: number, lift?: number, spin?: number,
   * }} options
   *   `cardEl` é um elemento de carta já montado (veja F7.CardView). Ele é usado como clone
   *   e removido no fim. Com `flip`, a carta sai de costas e termina de frente.
   */
  function flyCard({ cardEl, from, to, flip = false, duration = 560, lift = 1.25, spin = 0 }) {
    const host = layer('fly-layer');
    const el = cardEl;
    el.style.setProperty('--w', `${to.width}px`);
    if (flip) el.classList.remove('is-face-down');
    host.appendChild(el);

    const scaleFrom = from.width / to.width;
    const midX = (from.left + to.left) / 2;
    const midY = Math.min(from.top, to.top) - 40;
    const tilt = spin || (to.left > from.left ? 8 : -8);
    const time = dur(duration);

    const move = el.animate(
      [
        { transform: `translate(${from.left}px, ${from.top}px) scale(${scaleFrom}) rotate(0deg)` },
        {
          transform: `translate(${midX}px, ${midY}px) scale(${lift}) rotate(${tilt}deg)`,
          offset: 0.45,
        },
        { transform: `translate(${to.left}px, ${to.top}px) scale(1) rotate(0deg)` },
      ],
      { duration: time, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'forwards' },
    );

    if (flip) {
      const inner = el.querySelector('.card__inner');
      inner.style.transition = 'none';
      inner.animate(
        [
          { transform: 'rotateY(180deg)' },
          { transform: 'rotateY(180deg)', offset: 0.15 },
          { transform: 'rotateY(0deg)' },
        ],
        { duration: time * 0.85, easing: 'ease-in-out', fill: 'forwards' },
      );
    }

    return move.finished
      .catch(() => {})
      .then(() => el.remove());
  }

  /**
   * Carta que sai de jogo: sobe um pouco, encolhe girando e some em uma nuvem de partículas.
   * @param {{ cardEl: HTMLElement, rect: DOMRect, duration?: number }} options
   */
  function vanish({ cardEl, rect, duration = 520 }) {
    const host = layer('fly-layer');
    cardEl.style.setProperty('--w', `${rect.width}px`);
    host.appendChild(cardEl);

    const time = dur(duration);
    const base = `translate(${rect.left}px, ${rect.top}px)`;
    const spin = Math.random() < 0.5 ? -24 : 24;

    const anim = cardEl.animate(
      [
        { transform: `${base} scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `${base} translateY(-14px) scale(1.12) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35 },
        { transform: `${base} translateY(-30px) scale(0.1) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: time, easing: 'cubic-bezier(0.4, 0, 0.8, 0.4)', fill: 'forwards' },
    );

    const { x, y } = center(rect);
    setTimeout(() => burst(x, y, { colors: ['#ffffff', '#c9c4ff'], count: 8, speed: 160, size: 3, life: 0.5, gravity: 200 }), time * 0.6);

    return anim.finished.catch(() => {}).then(() => cardEl.remove());
  }

  /* ------------------------------------------------------------------ */
  /* Partículas                                                          */
  /* ------------------------------------------------------------------ */

  const particles = [];
  let canvas = null;
  let ctx = null;
  let running = false;
  let lastTime = 0;

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function spawn(particle) {
    if (state.reduced) return;
    ensureCanvas();
    particles.push({
      rotation: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() - 0.5) * 10,
      gravity: 900,
      drag: 0.985,
      shape: 'circle',
      age: 0,
      wobble: Math.random() * 10,
      ...particle,
    });
    if (!running) {
      running = true;
      lastTime = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function drawStar(c, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 ? r * 0.45 : r;
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      c.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    c.closePath();
    c.fill();
  }

  function drawFlake(c, r) {
    c.lineWidth = Math.max(1, r * 0.22);
    c.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      c.rotate(Math.PI / 3);
      c.beginPath();
      c.moveTo(-r, 0);
      c.lineTo(r, 0);
      c.stroke();
    }
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000) * state.speed;
    lastTime = now;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * dt;
      p.x += p.vx * dt + (p.shape === 'confetti' ? Math.sin(p.age * 6 + p.wobble) * 0.6 : 0);
      p.y += p.vy * dt;
      p.rotation += p.spinSpeed * dt;

      const fade = 1 - p.age / p.life;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;

      if (p.shape === 'confetti') {
        const flipScale = Math.cos(p.age * 8 + p.wobble);
        ctx.scale(1, flipScale);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.shape === 'star') {
        drawStar(ctx, p.size);
      } else if (p.shape === 'flake') {
        drawFlake(ctx, p.size);
      } else if (p.shape === 'shard') {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.6, p.size);
        ctx.lineTo(-p.size * 0.6, p.size * 0.4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size * fade + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (particles.length) requestAnimationFrame(tick);
    else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /** Explosão de partículas a partir de um ponto. */
  function burst(x, y, { colors = ['#fff'], count = 24, speed = 380, shape = 'circle', size = 5, life = 0.9, gravity = 700 } = {}) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.65);
      spawn({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - speed * 0.25,
        color: pick(colors),
        size: size * (0.6 + Math.random() * 0.8),
        life: life * (0.7 + Math.random() * 0.6),
        shape: Array.isArray(shape) ? pick(shape) : shape,
        gravity,
      });
    }
  }

  /** Explosão centrada em um elemento. */
  function burstAt(el, options) {
    if (!el) return;
    const { x, y } = center(el.getBoundingClientRect());
    burst(x, y, options);
  }

  const CONFETTI_COLORS = ['#ff5e7e', '#ffb547', '#ffe45e', '#5eff9b', '#5ee7ff', '#8a7bff', '#ff5ec8', '#ffffff'];

  /** Chuva de confete pela tela inteira. */
  function confetti({ count = 160, colors = CONFETTI_COLORS } = {}) {
    const w = window.innerWidth;
    for (let i = 0; i < count; i++) {
      spawn({
        x: Math.random() * w,
        y: -20 - Math.random() * window.innerHeight * 0.5,
        vx: (Math.random() - 0.5) * 160,
        vy: 120 + Math.random() * 220,
        color: pick(colors),
        size: 8 + Math.random() * 8,
        life: 3 + Math.random() * 1.5,
        shape: 'confetti',
        gravity: 140,
        drag: 0.995,
      });
    }
    // Dois canhões laterais
    [0.05, 0.95].forEach((side) => {
      for (let i = 0; i < count / 4; i++) {
        const dir = side < 0.5 ? 1 : -1;
        spawn({
          x: w * side,
          y: window.innerHeight * 0.85,
          vx: dir * (250 + Math.random() * 500),
          vy: -(600 + Math.random() * 600),
          color: pick(colors),
          size: 8 + Math.random() * 7,
          life: 2.6 + Math.random(),
          shape: 'confetti',
          gravity: 700,
          drag: 0.99,
        });
      }
    });
  }

  /** Flocos de neve caindo sobre um elemento (Congelar). */
  function snow(el, count = 36) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      spawn({
        x: rect.left + Math.random() * rect.width,
        y: rect.top - 10 + Math.random() * rect.height * 0.4,
        vx: (Math.random() - 0.5) * 60,
        vy: 30 + Math.random() * 80,
        color: pick(['#ffffff', '#c9f1ff', '#7fd8ff']),
        size: 3 + Math.random() * 5,
        life: 1.4 + Math.random() * 1.2,
        shape: 'flake',
        gravity: 30,
        drag: 0.99,
        spinSpeed: (Math.random() - 0.5) * 3,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Textos, anúncios e detalhes                                         */
  /* ------------------------------------------------------------------ */

  function floatText(el, text, color = '#fff') {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const node = document.createElement('div');
    node.className = 'float-text';
    node.textContent = text;
    node.style.left = `${rect.left + rect.width / 2}px`;
    node.style.top = `${rect.top}px`;
    node.style.setProperty('--float-color', color);
    node.style.animationDuration = `${dur(1100)}ms`;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), dur(1100) + 50);
  }

  /**
   * Mostra um anúncio grande no centro da tela.
   * @returns {Promise<void>} resolve quando o anúncio some.
   */
  async function banner(title, { sub = '', variant = 'round', hold = 900 } = {}) {
    const host = layer('banner-layer');
    const node = document.createElement('div');
    node.className = `banner banner--${variant}`;
    node.setAttribute('role', 'status');
    const titleEl = document.createElement('div');
    titleEl.className = 'banner__title';
    titleEl.textContent = title;
    node.appendChild(titleEl);
    if (sub) {
      const subEl = document.createElement('div');
      subEl.className = 'banner__sub';
      subEl.textContent = sub;
      node.appendChild(subEl);
    }
    host.appendChild(node);
    await wait(520 + hold);
    node.classList.add('is-leaving');
    await wait(360);
    node.remove();
  }

  function flash(color) {
    if (state.reduced) return;
    const node = document.createElement('div');
    node.className = 'screen-flash';
    if (color) node.style.setProperty('--flash-color', color);
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 700);
  }

  /** Reinicia uma animação CSS adicionando a classe novamente. */
  function retrigger(el, className, duration = 600) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth; // força reflow
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), dur(duration));
  }

  const shake = (el) => retrigger(el, 'is-shaking', 600);

  /** Anima um número de `from` até `to`. */
  function countUp(el, from, to, duration = 600) {
    if (!el) return Promise.resolve();
    const time = dur(duration);
    if (from === to || time < 30) {
      el.textContent = String(to);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / time);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(from + (to - from) * eased));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  F7.FX = {
    state,
    dur,
    wait,
    setSpeed,
    flyCard,
    vanish,
    burst,
    burstAt,
    confetti,
    snow,
    floatText,
    banner,
    flash,
    shake,
    retrigger,
    countUp,
    center,
  };
})(globalThis.F7 = globalThis.F7 || {});
