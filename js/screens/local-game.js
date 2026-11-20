/**
 * Vira-7 — Partida local: várias pessoas (e CPUs) na mesma tela, sem servidor.
 * Usa o motor JavaScript (js/core) direto no navegador.
 */
((F7) => {
  'use strict';

  const { qs } = F7.dom;
  const App = F7.App;

  let setup = null;
  /** Partida em andamento: { game, run, config }. */
  let current = null;

  async function stopGame() {
    if (!current) return;
    const { game, run } = current;
    current = null;
    game.abort();
    App.controller.cancelPending();
    F7.Modals.closeAll();
    try {
      await run;
    } catch (error) {
      /* partida já encerrada */
    }
  }

  function showSetup() {
    App.gameHandlers = null;
    document.title = 'Vira-7 · Mesma tela';
    App.show('setup');
    setup.show();
  }

  async function startGame(config) {
    await stopGame();
    F7.Sound.unlock();
    F7.FX.setSpeed(config.speed || 1);

    App.gameHandlers = {
      menu: async () => {
        const ok = await F7.Modals.confirm({
          title: 'Voltar ao menu?',
          text: 'A partida atual será encerrada.',
          confirmLabel: 'Sair da partida',
        });
        if (ok) {
          await stopGame();
          showSetup();
        }
      },
      restart: async () => {
        const ok = await F7.Modals.confirm({
          title: 'Reiniciar partida?',
          text: 'A partida atual será perdida e uma nova começará com os mesmos jogadores.',
          confirmLabel: 'Reiniciar',
        });
        if (ok) startGame(config);
      },
    };
    document.title = 'Vira-7 · Partida';
    App.show('game');

    const game = new F7.Game(config, App.controller);
    // Duas ou mais pessoas no mesmo aparelho: o lugar de quem joga cresce e os outros ficam mais discretos.
    const humans = config.players.filter((p) => !p.isBot).length;
    App.controller.attach(game, { spotlight: humans > 1 });
    const run = game.run();
    current = { game, run, config };

    try {
      await run;
    } catch (error) {
      console.error(error);
      App.toast('Ops! Algo deu errado. Voltando ao menu…', { variant: 'bust' });
      current = null;
      showSetup();
      return;
    }

    // A partida foi interrompida ou substituída por outra.
    if (!current || current.game !== game) return;
    current = null;
    if (App.controller.lastChoice === 'again') startGame(config);
    else showSetup();
  }

  /** Rota #/local. */
  function local() {
    if (!setup) {
      setup = new F7.SetupScreen({
        root: qs('#setup-screen'),
        onStart: startGame,
        onRules: () => F7.Modals.rules(),
      });
    }
    showSetup();
    return () => {
      stopGame();
      App.gameHandlers = null;
    };
  }

  F7.Screens = Object.assign(F7.Screens || {}, { local });
})(globalThis.F7 = globalThis.F7 || {});
