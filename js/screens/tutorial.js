/**
 * Vira-7 — Tutorial interativo (só abre quando a pessoa pede: #/tutorial).
 *
 * Uma rodada de verdade contra a Rita, com o baralho arrumado para mostrar tudo:
 * virar, Vira Três (com escolha de alvo), medidor de risco, ×2, Segunda Chance salvando
 * um estouro, penalidade, bônus e parar. Durante cada passo SÓ o que o balão indica
 * responde ao toque: o resto da tela fica travado. Dá para sair pela seta a qualquer hora.
 */
((F7) => {
  'use strict';

  const { h, qs } = F7.dom;
  const App = F7.App;

  const SPEED = 1.6;
  let nextId = 1;
  const card = (data) => ({ id: `tut${nextId++}`, ...data });
  const num = (value) => card({ type: 'number', value });
  const mod = (value, op = 'add') => card({ type: 'modifier', op, value });
  const action = (name) => card({ type: 'action', action: name });

  /**
   * Ordem fixa. Distribuição: você 5, Rita 9. Você vira Vira Três e escolhe a Rita
   * (ela vira 1, 4 e 6 e para). Depois: 7, ×2, Segunda Chance, 7 repetido (salvo),
   * −2 e +4. Você para com (5 + 7) × 2 − 2 + 4 = 26 pontos.
   */
  function stackedDeck() {
    nextId = 1;
    const script = [
      num(5), num(9),
      action('flipThree'), num(1), num(4), num(6),
      num(7), mod(2, 'multiply'), action('secondChance'), num(7), mod(-2), mod(4),
      num(3), num(2), num(10), num(11), num(12), num(8), num(0),
    ];
    return new F7.Deck({ cards: script });
  }

  /** Balão do tutorial + trava de toques. */
  function createCoach() {
    const el = h('div', { class: 'coach', role: 'dialog', 'aria-live': 'polite', 'aria-modal': 'false' });
    document.body.appendChild(el);
    let marked = [];
    let allowed = [];

    const isAllowed = (target) =>
      target.closest('.coach') ||
      target.closest('#btn-menu') ||
      target.closest('.modal') ||
      allowed.some((item) => (typeof item === 'string' ? target.closest(item) : item && item.contains(target)));

    // Fase de captura: o toque é barrado antes de chegar a qualquer botão.
    const guard = (event) => {
      if (event.type === 'keydown') {
        const key = event.key.toLowerCase();
        const hitOk = allowed.includes('#btn-hit') && (key === 'v' || key === ' ');
        const stayOk = allowed.includes('#btn-stay') && (key === 'p' || key === 's');
        if (hitOk || stayOk || key === 'tab' || key === 'enter' || event.target.closest?.('.coach, .modal')) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!isAllowed(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const events = ['click', 'pointerdown', 'mousedown', 'touchstart', 'keydown'];
    events.forEach((type) => document.addEventListener(type, guard, { capture: true, passive: false }));

    const unmark = () => {
      marked.forEach((node) => node.classList.remove('coach-target'));
      marked = [];
    };

    return {
      /** Mostra um passo. `allow`: seletores/elementos que respondem; `actions`: [[rótulo, fn, variante]]. */
      show({ step, text, allow = [], highlight = allow, actions = [] }) {
        unmark();
        allowed = allow;
        highlight.forEach((item) => {
          const node = typeof item === 'string' ? qs(item) : item;
          if (node) {
            node.classList.add('coach-target');
            marked.push(node);
          }
        });
        // O balão fica do lado oposto ao que está destacado.
        const first = marked[0];
        const top = first ? first.getBoundingClientRect().top < window.innerHeight * 0.45 : false;
        el.classList.toggle('coach--bottom', top);
        el.innerHTML = '';
        el.append(
          h('span', { class: 'coach__step' }, step),
          h('p', {}, text),
          actions.length
            ? h('div', { class: 'coach__actions' }, actions.map(([label, fn, variant]) => h('button', { type: 'button', class: `btn ${variant || 'btn--ghost'}`, onClick: fn }, label)))
            : null,
        );
        el.hidden = false;
      },
      wait(text) {
        unmark();
        allowed = [];
        el.classList.remove('coach--bottom');
        el.innerHTML = '';
        el.append(h('p', { class: 'coach__wait' }, text));
      },
      destroy() {
        unmark();
        events.forEach((type) => document.removeEventListener(type, guard, { capture: true }));
        el.remove();
      },
    };
  }

  function tutorial() {
    const controller = App.controller;
    const coach = createCoach();
    const restore = [];
    let moves = 0;

    const players = [
      { name: 'Você', isBot: false, color: '#e5484d', avatar: 'raposa', riskTolerance: 0.3 },
      { name: 'Rita', isBot: true, color: '#2f7df6', avatar: 'coruja', riskTolerance: 0 },
    ];
    const game = new F7.Game({ players, targetScore: 200, deck: stackedDeck(), firstDealer: 1, rng: () => 0.5 }, controller);
    const rita = game.players[1];
    const total = TOTAL;

    const exit = () => {
      game.abort();
      App.navigate('/');
    };

    /** Troca um método do controlador enquanto o tutorial durar. */
    const override = (target, name, fn) => {
      const own = Object.prototype.hasOwnProperty.call(target, name);
      const original = target[name];
      target[name] = fn(original.bind(target));
      restore.push(() => {
        if (own) target[name] = original;
        else delete target[name];
      });
    };

    // A Rita sempre para: assim as cartas arrumadas chegam até você.
    override(F7.AI, 'decideMove', () => () => 'stay');

    const STEPS = {
      1: { step: 'Passo 1 de 9', allow: ['#btn-hit'], text: 'Você recebeu um 5. Na sua vez, toque em VIRAR para comprar mais uma carta e somar pontos.' },
      2: { step: 'Passo 3 de 9', allow: ['#btn-hit'], text: 'A Rita virou 1, 4 e 6 sem estourar e decidiu parar. Sua vez de novo: toque em VIRAR.' },
      3: { step: 'Passo 4 de 9', allow: ['#btn-hit'], highlight: ['#risk', '#btn-hit'], text: 'Agora você tem 5 e 7. Este medidor mostra a chance de ESTOURAR (virar um número que você já tem e zerar a rodada). Está baixa: vire de novo.' },
      4: { step: 'Passo 5 de 9', allow: ['#btn-hit'], text: 'Um ×2! Ele dobra a soma dos seus números no fim da rodada. Continue: VIRAR.' },
      5: { step: 'Passo 6 de 9', allow: ['#btn-hit'], text: 'Segunda Chance guardada: se você repetir um número, ela é gasta no lugar do estouro. Vire mais uma.' },
      6: { step: 'Passo 7 de 9', allow: ['#btn-hit'], text: 'Outro 7! Seria estouro, mas a Segunda Chance salvou você: as duas cartas foram descartadas. Vire de novo.' },
      7: { step: 'Passo 8 de 9', allow: ['#btn-hit'], text: 'Penalidade −2: tira pontos da rodada (que nunca fica abaixo de 0) e nunca estoura você. Vire mais uma.' },
      8: { step: 'Passo 9 de 9', allow: ['#btn-stay'], text: `Bônus +4: soma pontos e nunca estoura. Você tem ${total} pontos: (5 + 7) × 2 − 2 + 4. Toque em PARAR para guardar tudo.` },
    };

    override(controller, 'promptMove', (original) => (player, g) => {
      moves += 1;
      const promise = original(player, g);
      const step = STEPS[Math.min(moves, 8)];
      coach.show(step);
      promise.then(() => coach.wait('Olhe a mesa…'));
      return promise;
    });

    override(controller, 'promptTarget', (original) => (player, kind, candidates) => {
      const promise = original(player, kind, candidates);
      const seat = App.table.seatEl(rita);
      coach.show({
        step: 'Passo 2 de 9',
        allow: [seat],
        text: 'Você virou VIRA TRÊS! Escolha alguém ativo para ser obrigado a virar 3 cartas seguidas. Toque na Rita.',
      });
      promise.then(() => coach.wait('A Rita está virando 3 cartas…'));
      return promise;
    });

    override(controller, 'onRoundEnd', (original) => async (payload, g) => {
      coach.wait('Fim da rodada! Veja o placar e toque no botão.');
      await original(payload, g);
      coach.show({
        step: 'Pronto!',
        text: 'É isso! Também existem Congelar (o alvo para na hora) e o VIRA 7: juntar 7 números diferentes vale +15 e encerra a rodada. Ganha quem passar de 200 pontos primeiro.',
        actions: [['Jogar de verdade', exit, 'btn--primary']],
      });
      game.abort();
    });

    App.gameHandlers = {
      menu: async () => {
        const ok = await F7.Modals.confirm({ title: 'Sair do tutorial?', text: 'Você pode abrir o tutorial de novo quando quiser.', confirmLabel: 'Sair' });
        if (ok) exit();
      },
    };
    qs('#btn-restart').hidden = true;
    document.title = 'Vira-7 · Tutorial';
    App.show('game');
    controller.attach(game, { autoNextMs: 0 });
    F7.FX.setSpeed(SPEED);

    coach.show({
      step: 'Tutorial',
      text: 'Vamos jogar uma rodada de treino contra a Rita. Em cada passo, só o botão destacado funciona. Para sair, use a seta no canto.',
      actions: [['Começar', () => {
        coach.wait('Distribuindo as cartas…');
        game.run().catch(() => {
          /* interrompida ao sair */
        });
      }, 'btn--primary']],
    });

    return () => {
      game.abort();
      controller.cancelPending();
      F7.Modals.closeAll();
      restore.reverse().forEach((fn) => fn());
      coach.destroy();
      F7.FX.setSpeed(App.state.settings.animationSpeed || 1);
      qs('#btn-restart').hidden = false;
      App.gameHandlers = null;
    };
  }

  /** Pontos finais da rodada do tutorial (veja `stackedDeck`). */
  const TOTAL = (5 + 7) * 2 - 2 + 4;

  F7.Screens = Object.assign(F7.Screens || {}, { tutorial });
})(globalThis.F7 = globalThis.F7 || {});
