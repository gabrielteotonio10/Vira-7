/**
 * Vira-7 — Tela inicial: lista de jogadores (pessoas ou CPU), meta e velocidade.
 */
((F7) => {
  'use strict';

  const { h, qs, qsa, clear, initial } = F7.dom;
  const { icon } = F7.icons;
  const { RULES } = F7;

  const PLAYER_COLORS = ['#e5484d', '#2f7df6', '#1fa35c', '#f08c00', '#8b5cf6', '#0e9aa7', '#e64980', '#b8890b'];
  const AVATARS = F7.Avatars ? F7.Avatars.KEYS : [];
  const BOT_NAMES = ['Rita', 'Beto', 'Lia', 'Caio', 'Nina', 'Davi', 'Bia', 'Téo', 'Malu', 'Gui'];

  const DEFAULT_SETUP = {
    players: [
      { name: 'Você', isBot: false, color: PLAYER_COLORS[0], avatar: 'raposa' },
      { name: 'Rita', isBot: true, color: PLAYER_COLORS[1], avatar: 'coruja' },
      { name: 'Beto', isBot: true, color: PLAYER_COLORS[2], avatar: 'urso' },
      { name: 'Lia', isBot: true, color: PLAYER_COLORS[3], avatar: 'gato' },
    ],
    targetScore: RULES.DEFAULT_TARGET_SCORE,
    speed: 1,
    teams: 0,
    deckVersion: 2,
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
          avatar: AVATARS.includes(p.avatar) ? p.avatar : AVATARS[i % (AVATARS.length || 1)],
        })),
        targetScore: [50, 100, 150, 200, 300, 500].includes(saved.targetScore) ? saved.targetScore : RULES.DEFAULT_TARGET_SCORE,
        speed: [1, 1.6, 2.4].includes(saved.speed) ? saved.speed : 1,
        // Duplas só valem com 4, 6 ou 8 jogadores: se o que foi salvo não serve, volta ao modo individual.
        teams: saved.teams === 1 && saved.players.length >= 4 && saved.players.length % 2 === 0 ? 1 : 0,
        deckVersion: saved.deckVersion === 1 ? 1 : 2,
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
      this.bindSegmented('#deck-options', 'deckVersion');
      this.bindSegmented('#mode-options', 'teams', () => this.applyTeams());

      qs('#start-game', this.root).addEventListener('click', () => this.start());
      qs('#open-rules-setup', this.root).addEventListener('click', () => this.onRules());
    }

    bindSegmented(selector, key, after) {
      const group = qs(selector, this.root);
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (!button || button.disabled) return;
        this.state[key] = Number(button.dataset.value);
        F7.Sound.click();
        if (after) after();
        this.persist();
        this.renderSegmented();
      });
    }

    /**
     * Duplas só existem com 4, 6 ou 8 jogadores. Ao escolher Duplas com número ímpar (ou menos de 4),
     * a mesa é completada com uma CPU (ou, na mesa cheia, tira-se a última) e o aviso diz o que mudou.
     */
    applyTeams() {
      const { players } = this.state;
      if (!this.state.teams) return;
      let changed = false;
      while (players.length < 4 || players.length % 2) {
        if (players.length >= RULES.MAX_PLAYERS) {
          players.pop();
        } else {
          this.pushBot();
        }
        changed = true;
      }
      if (changed) {
        F7.App.toast(`Duplas precisam de 4, 6 ou 8 jogadores: a mesa agora tem ${players.length}.`, { iconName: 'user' });
        this.render();
      }
    }

    renderSegmented() {
      [
        ['#target-options', 'targetScore'],
        ['#speed-options', 'speed'],
        ['#deck-options', 'deckVersion'],
        ['#mode-options', 'teams'],
      ].forEach(([selector, key]) => {
        qsa(`${selector} button`, this.root).forEach((button) => {
          button.setAttribute('aria-checked', String(Number(button.dataset.value) === this.state[key]));
        });
      });
    }

    /** Acrescenta uma CPU com nome, cor e personagem que ainda não estão em uso. */
    pushBot() {
      const { players } = this.state;
      const usedNames = new Set(players.map((p) => p.name));
      const usedColors = new Set(players.map((p) => p.color));
      players.push({
        name: BOT_NAMES.find((n) => !usedNames.has(n)) || `CPU ${players.length + 1}`,
        isBot: true,
        color: PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[0],
        avatar: AVATARS.find((a) => !players.some((p) => p.avatar === a)) || AVATARS[0],
      });
    }

    addPlayer() {
      const { players } = this.state;
      if (players.length >= RULES.MAX_PLAYERS) return;
      this.pushBot();
      // Em duplas a mesa cresce de dois em dois (sempre par).
      if (this.state.teams && players.length % 2 && players.length < RULES.MAX_PLAYERS) this.pushBot();
      F7.Sound.click();
      this.persist();
      this.render();
      const inputs = qsa('.player-row .field', this.list);
      inputs[inputs.length - 1]?.focus();
    }

    removePlayer(index, row) {
      const min = this.state.teams ? 4 : RULES.MIN_PLAYERS;
      if (this.state.players.length <= min) return;
      row.classList.add('is-leaving');
      setTimeout(() => {
        this.state.players.splice(index, 1);
        // Em duplas, tirar um jogador tira também a última CPU (a mesa continua par).
        if (this.state.teams && this.state.players.length % 2) {
          const last = this.state.players.map((p) => p.isBot).lastIndexOf(true);
          this.state.players.splice(last >= 0 ? last : this.state.players.length - 1, 1);
        }
        this.persist();
        this.render();
      }, 200);
      F7.Sound.click();
    }

    /** Abre a escolha de personagem do jogador. */
    async chooseAvatar(index) {
      const player = this.state.players[index];
      if (!F7.Avatars) return this.cycleColor(index);
      const picker = F7.Avatars.picker({ value: player.avatar });
      const ok = await F7.Modals.open({
        title: `Personagem de ${player.name || `Jogador ${index + 1}`}`,
        eyebrow: 'Escolha o bichinho',
        body: picker.el,
        actions: [{ label: 'Confirmar', value: true, variant: 'primary' }],
      }).result;
      if (ok) {
        player.avatar = picker.value;
        this.persist();
        this.render();
      }
      return undefined;
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
      const hint = qs('#mode-hint', this.root);
      if (hint) {
        hint.hidden = !this.state.teams;
        hint.textContent = 'Duplas só aceitam 4, 6 ou 8 jogadores. Quem senta na frente de você é seu parceiro e os pontos são somados.';
      }
      this.renderSegmented();
    }

    renderRow(player, index) {
      const canRemove = this.state.players.length > (this.state.teams ? 4 : RULES.MIN_PLAYERS);
      const avatar = h(
        'button',
        {
          type: 'button',
          class: 'avatar',
          title: 'Trocar personagem',
          'aria-label': `Trocar o personagem de ${player.name || 'jogador'}`,
          onClick: () => this.chooseAvatar(index),
        },
        initial(player.name),
      );
      if (F7.Avatars) F7.Avatars.fill(avatar, player);

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
          if (!player.avatar) avatar.textContent = initial(player.name || 'J');
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

      if (this.state.teams && (players.length < 4 || players.length % 2)) {
        this.showError('Duplas precisam de 4, 6 ou 8 jogadores.');
        return;
      }

      // Partidas só com CPUs são permitidas e funcionam como demonstração.
      const config = {
        players: players.map((p, i) => ({
          name: p.name.trim() || `Jogador ${i + 1}`,
          isBot: p.isBot,
          color: p.color,
          avatar: p.avatar,
          riskTolerance: F7.AI.randomRiskTolerance(),
        })),
        targetScore: this.state.targetScore,
        speed: this.state.speed,
        teams: !!this.state.teams,
        deckVersion: this.state.deckVersion,
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
