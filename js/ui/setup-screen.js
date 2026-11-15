/**
 * Vira-7 — Tela inicial: lista de jogadores (pessoas ou CPU), meta e velocidade.
 */
((F7) => {
  'use strict';

  const { h, qs, qsa, clear, initial } = F7.dom;
  const { icon } = F7.icons;
  const { RULES } = F7;

  const PLAYER_COLORS = ['#ff5e7e', '#3d8bff', '#2fc76a', '#ffa62b', '#9b5cff', '#12c2a6', '#e05cf0', '#f2c12e'];
  const BOT_NAMES = ['Rita', 'Beto', 'Lia', 'Caio', 'Nina', 'Davi', 'Bia', 'Téo', 'Malu', 'Gui'];

  const DEFAULT_SETUP = {
    players: [
      { name: 'Você', isBot: false, color: PLAYER_COLORS[0] },
      { name: 'Rita', isBot: true, color: PLAYER_COLORS[1] },
      { name: 'Beto', isBot: true, color: PLAYER_COLORS[2] },
      { name: 'Lia', isBot: true, color: PLAYER_COLORS[3] },
    ],
    targetScore: RULES.DEFAULT_TARGET_SCORE,
    speed: 1,
  };

  class SetupScreen {
    /**
     * @param {{ root: HTMLElement, onStart: (config: object) => void, onRules: () => void }} options
     */
    constructor({ root, onStart, onRules }) {
      this.root = root;
      this.onStart = onStart;
      this.onRules = onRules;
      this.state = this.loadState();

      this.list = qs('#player-list', root);
      this.count = qs('#player-count', root);
      this.addButton = qs('#add-player', root);
      this.error = qs('#setup-error', root);

      this.renderHeroCards();
      this.bindEvents();
      this.render();
    }

    loadState() {
      const saved = F7.storage.load('setup', null);
      if (!saved || !Array.isArray(saved.players) || saved.players.length < RULES.MIN_PLAYERS) {
        return structuredClone(DEFAULT_SETUP);
      }
      return {
        players: saved.players.slice(0, RULES.MAX_PLAYERS).map((p, i) => ({
          name: String(p.name || '').slice(0, 14),
          isBot: !!p.isBot,
          color: PLAYER_COLORS.includes(p.color) ? p.color : PLAYER_COLORS[i % PLAYER_COLORS.length],
        })),
        targetScore: [100, 200, 300].includes(saved.targetScore) ? saved.targetScore : RULES.DEFAULT_TARGET_SCORE,
        speed: [1, 1.6, 2.4].includes(saved.speed) ? saved.speed : 1,
      };
    }

    persist() {
      F7.storage.save('setup', this.state);
    }

    show() {
      this.root.hidden = false;
      this.render();
    }

    hide() {
      this.root.hidden = true;
    }

    /* ---------------- Apresentação ---------------- */

    renderHeroCards() {
      const host = qs('#hero-cards', this.root);
      if (!host) return;
      const cards = [
        { id: 'h1', type: 'number', value: 3 },
        { id: 'h2', type: 'action', action: 'freeze' },
        { id: 'h3', type: 'number', value: 7 },
        { id: 'h4', type: 'modifier', op: 'multiply', value: 2 },
        { id: 'h5', type: 'number', value: 12 },
      ];
      const angles = [-28, -14, 0, 14, 28];
      clear(host);
      cards.forEach((card, i) => {
        const el = F7.CardView.create(card, { size: 'lg' });
        el.style.setProperty('--angle', `${angles[i]}deg`);
        el.style.setProperty('--delay', `${i * 90}ms`);
        el.style.zIndex = i === 2 ? 5 : 5 - Math.abs(i - 2);
        host.appendChild(el);
      });
    }

    /* ---------------- Eventos ---------------- */

    bindEvents() {
      this.addButton.addEventListener('click', () => this.addPlayer());

      this.bindSegmented('#target-options', 'targetScore');
      this.bindSegmented('#speed-options', 'speed');

      qs('#start-game', this.root).addEventListener('click', () => this.start());
      qs('#open-rules-setup', this.root).addEventListener('click', () => this.onRules());
    }

    bindSegmented(selector, key) {
      const group = qs(selector, this.root);
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (!button) return;
        this.state[key] = Number(button.dataset.value);
        F7.Sound.click();
        this.persist();
        this.renderSegmented();
      });
    }

    renderSegmented() {
      [
        ['#target-options', 'targetScore'],
        ['#speed-options', 'speed'],
      ].forEach(([selector, key]) => {
        qsa(`${selector} button`, this.root).forEach((button) => {
          button.setAttribute('aria-checked', String(Number(button.dataset.value) === this.state[key]));
        });
      });
    }

    addPlayer() {
      const { players } = this.state;
      if (players.length >= RULES.MAX_PLAYERS) return;
      const usedNames = new Set(players.map((p) => p.name));
      const usedColors = new Set(players.map((p) => p.color));
      players.push({
        name: BOT_NAMES.find((n) => !usedNames.has(n)) || `CPU ${players.length + 1}`,
        isBot: true,
        color: PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[0],
      });
      F7.Sound.click();
      this.persist();
      this.render();
      const inputs = qsa('.player-row .field', this.list);
      inputs[inputs.length - 1]?.focus();
    }

    removePlayer(index, row) {
      if (this.state.players.length <= RULES.MIN_PLAYERS) return;
      row.classList.add('is-leaving');
      setTimeout(() => {
        this.state.players.splice(index, 1);
        this.persist();
        this.render();
      }, 200);
      F7.Sound.click();
    }

    cycleColor(index) {
      const { players } = this.state;
      const used = new Set(players.map((p) => p.color));
      const current = PLAYER_COLORS.indexOf(players[index].color);
      for (let step = 1; step <= PLAYER_COLORS.length; step++) {
        const candidate = PLAYER_COLORS[(current + step) % PLAYER_COLORS.length];
        if (!used.has(candidate)) {
          players[index].color = candidate;
          break;
        }
      }
      F7.Sound.click();
      this.persist();
      this.render();
    }

    /* ---------------- Renderização ---------------- */

    render() {
      const { players } = this.state;
      clear(this.list);
      players.forEach((player, index) => this.list.appendChild(this.renderRow(player, index)));
      this.count.textContent = `${players.length}/${RULES.MAX_PLAYERS}`;
      this.addButton.disabled = players.length >= RULES.MAX_PLAYERS;
      this.error.hidden = true;
      this.renderSegmented();
    }

    renderRow(player, index) {
      const canRemove = this.state.players.length > RULES.MIN_PLAYERS;
      const avatar = h(
        'button',
        {
          type: 'button',
          class: 'avatar',
          title: 'Trocar cor',
          'aria-label': `Trocar a cor de ${player.name || 'jogador'}`,
          onClick: () => this.cycleColor(index),
        },
        initial(player.name),
      );

      const input = h('input', {
        class: 'field',
        type: 'text',
        value: player.name,
        maxlength: 14,
        placeholder: `Jogador ${index + 1}`,
        'aria-label': `Nome do jogador ${index + 1}`,
        autocomplete: 'off',
        spellcheck: 'false',
        onInput: (event) => {
          player.name = event.target.value;
          avatar.textContent = initial(player.name || `J`);
          this.persist();
        },
        onKeydown: (event) => {
          if (event.key === 'Enter') this.start();
        },
      });

      const typeToggle = h(
        'div',
        { class: 'segmented segmented--sm', role: 'radiogroup', 'aria-label': 'Tipo de jogador' },
        [false, true].map((isBot) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(player.isBot === isBot),
              onClick: () => {
                player.isBot = isBot;
                F7.Sound.click();
                this.persist();
                this.render();
              },
            },
            isBot ? 'CPU' : 'Pessoa',
          ),
        ),
      );

      const remove = h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': `Remover ${player.name || 'jogador'}`,
        title: 'Remover',
        disabled: !canRemove,
        html: icon('trash'),
        onClick: (event) => this.removePlayer(index, event.currentTarget.closest('.player-row')),
      });

      return h(
        'li',
        { class: 'player-row', style: { '--player-color': player.color, animationDelay: `${index * 40}ms` } },
        avatar,
        input,
        typeToggle,
        remove,
      );
    }

    /* ---------------- Início ---------------- */

    start() {
      const { players } = this.state;
      if (players.length < RULES.MIN_PLAYERS || players.length > RULES.MAX_PLAYERS) {
        this.showError(`Escolha de ${RULES.MIN_PLAYERS} a ${RULES.MAX_PLAYERS} jogadores.`);
        return;
      }

      // Partidas só com CPUs são permitidas e funcionam como demonstração.
      const config = {
        players: players.map((p, i) => ({
          name: p.name.trim() || `Jogador ${i + 1}`,
          isBot: p.isBot,
          color: p.color,
          riskTolerance: F7.AI.randomRiskTolerance(),
        })),
        targetScore: this.state.targetScore,
        speed: this.state.speed,
      };
      this.persist();
      this.onStart(config);
    }

    showError(message) {
      this.error.textContent = message;
      this.error.hidden = false;
      F7.FX.shake(this.error);
    }
  }

  SetupScreen.PLAYER_COLORS = PLAYER_COLORS;
  F7.SetupScreen = SetupScreen;
})(globalThis.F7 = globalThis.F7 || {});
