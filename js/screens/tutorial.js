/**
 * Vira-7 — Tutorial interativo (só abre quando a pessoa pede: #/tutorial).
 *
 * Uma rodada de verdade contra uma CPU cautelosa, com o baralho arrumado para ensinar:
 * virar, o medidor de risco, um bônus e parar. Um balão amarelo guia cada passo e
 * destaca o botão certo. Dá para pular a qualquer momento.
 */
((F7) => {
  'use strict';

  const { h, qs } = F7.dom;
  const App = F7.App;

  let nextId = 1;
  const num = (value) => ({ id: `tut${nextId++}`, type: 'number', value });
  const plus = (value) => ({ id: `tut${nextId++}`, type: 'modifier', op: 'add', value });

  /** Ordem fixa: 1ª carta de cada um, depois o que a pessoa vai comprar. O resto é só enchimento. */
  function stackedDeck() {
    nextId = 1;
    const script = [num(5), num(9), num(7), plus(4), num(3), num(2), num(8), num(10), num(11), num(6), num(4), num(12), num(1), num(0)];
    return new F7.Deck({ cards: script });
  }

  function coach() {
    const el = h('div', { class: 'coach', role: 'dialog', 'aria-live': 'polite' });
    document.body.appendChild(el);
    let target = null;
    const clearTarget = () => {
      if (target) target.classList.remove('coach-target');
      target = null;
    };
    return {
      /** Mostra um passo. `actions` = [[rótulo, função, variante]]. */
      show({ step, text, highlight, actions = [] }) {
        clearTarget();
        if (highlight) {
          target = qs(highlight);
          if (target) target.classList.add('coach-target');
        }
        el.innerHTML = '';
        el.append(
          h('span', { class: 'coach__step' }, step),
          h('p', {}, text),
          h(
            'div',
            { class: 'coach__actions' },
            actions.map(([label, fn, variant]) => h('button', { type: 'button', class: `btn ${variant || 'btn--ghost'}`, onClick: fn }, label)),
          ),
        );
        el.hidden = false;
      },
      hide() {
        clearTarget();
        el.hidden = true;
      },
      destroy() {
        clearTarget();
        el.remove();
      },
    };
  }

  function tutorial() {
    const controller = App.controller;
    const guide = coach();
    const cleanups = [];
    let finished = false;
    let moves = 0;

    const players = [
      { name: 'Você', isBot: false, color: '#e5484d', avatar: 'raposa', riskTolerance: 0.3 },
      { name: 'Rita', isBot: true, color: '#2f7df6', avatar: 'coruja', riskTolerance: 0 },
    ];
    const game = new F7.Game({ players, targetScore: 50, deck: stackedDeck(), firstDealer: 1, rng: () => 0.5 }, controller);

    const exit = () => {
      finished = true;
      game.abort();
      App.navigate('/');
    };

    // ---- passos: cada vez que a pessoa precisa jogar, o balão explica ----
    const originalPrompt = controller.promptMove.bind(controller);
    controller.promptMove = (player, g) => {
      moves += 1;
      const promise = originalPrompt(player, g);
      const skip = ['Pular tutorial', exit];
      if (moves === 1) {
        guide.show({
          step: 'Passo 1 de 4', highlight: '#btn-hit',
          text: 'Você tem a carta 5. Na sua vez, toque em VIRAR para comprar mais uma carta e somar pontos.',
          actions: [skip],
        });
      } else if (moves === 2) {
        guide.show({
          step: 'Passo 2 de 4', highlight: '#risk',
          text: 'Este medidor mostra a chance de ESTOURAR: virar um número que você já tem zera sua rodada. Baixo = seguro. Toque em VIRAR de novo.',
          actions: [skip],
        });
        setTimeout(() => guide.show({ step: 'Passo 2 de 4', highlight: '#btn-hit', text: 'Toque em VIRAR de novo: o risco está baixo.', actions: [skip] }), 5200);
      } else if (moves === 3) {
        guide.show({
          step: 'Passo 3 de 4', highlight: '#btn-stay',
          text: 'Você virou um bônus +4: ele soma pontos e nunca estoura você. Já são 16 pontos! Toque em PARAR para guardá-los antes de arriscar.',
          actions: [skip],
        });
      } else {
        guide.show({ step: 'Passo 3 de 4', highlight: '#btn-stay', text: 'Toque em PARAR para guardar seus pontos.', actions: [skip] });
      }
      promise.then(() => guide.hide());
      return promise;
    };
    cleanups.push(() => {
      delete controller.promptMove;
    });

    // A Rita sempre para de primeira: assim as cartas arrumadas chegam todas até você.
    const originalDecide = F7.AI.decideMove;
    F7.AI.decideMove = () => 'stay';
    cleanups.push(() => {
      F7.AI.decideMove = originalDecide;
    });

    // ---- fim da rodada: último balão ----
    const originalRoundEnd = controller.onRoundEnd.bind(controller);
    controller.onRoundEnd = async (payload, g) => {
      await originalRoundEnd(payload, g);
      // Depois do placar, o tutorial termina com o último balão.
      guide.show({
        step: 'Passo 4 de 4',
        text: 'Fim da rodada! Quem parou guarda os pontos; quem estoura marca zero. A cada rodada as cartas voltam ao monte e quem chegar na meta primeiro vence. Pronto para jogar de verdade?',
        actions: [['Concluir', exit, 'btn--primary']],
      });
      game.abort();
    };
    cleanups.push(() => {
      delete controller.onRoundEnd;
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
    controller.attach(game);
    F7.FX.setSpeed(1);

    guide.show({
      step: 'Bem-vindo!',
      text: 'Vamos jogar uma rodada de treino contra a Rita. Eu vou te dizendo o que fazer. Pode pular quando quiser.',
      actions: [['Pular tutorial', exit], ['Começar', () => guide.hide(), 'btn--primary']],
    });

    game.run().catch(() => {
      /* interrompida ao sair */
    });

    return () => {
      finished = true;
      game.abort();
      controller.cancelPending();
      F7.Modals.closeAll();
      cleanups.forEach((fn) => fn());
      guide.destroy();
      qs('#btn-restart').hidden = false;
      App.gameHandlers = null;
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { tutorial });
})(globalThis.F7 = globalThis.F7 || {});
