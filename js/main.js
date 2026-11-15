/**
 * Vira-7 — Ponto de entrada: conecta telas, controles da barra superior e partidas.
 */
(() => {
  'use strict';

  const F7 = globalThis.F7;
  const { qs } = F7.dom;
  const { icon } = F7.icons;

  const gameScreen = qs('#game-screen');
  const table = new F7.TableView({
    seatsEl: qs('#seats'),
    deckEl: qs('#deck-pile'),
    discardEl: qs('#discard-pile'),
  });
  const hud = new F7.Hud(gameScreen);
  const controller = new F7.GameController({ table, hud });

  /** Partida em andamento: { game, run, config }. */
  let current = null;

  hud.isBlocked = () => F7.Modals.isOpen();

  /* ------------------------------------------------------------------ */
  /* Partidas                                                            */
  /* ------------------------------------------------------------------ */

  async function startGame(config) {
    await stopGame();
    F7.Sound.unlock();
    F7.FX.setSpeed(config.speed || 1);

    setup.hide();
    gameScreen.hidden = false;
    document.title = 'Vira-7 · Partida';

    const game = new F7.Game(config, controller);
    controller.attach(game);
    const run = game.run();
    current = { game, run, config };

    try {
      await run;
    } catch (error) {
      console.error(error);
      hud.toast('Ops! Algo deu errado. Voltando ao menu…', { variant: 'bust', iconName: 'bolt' });
      await F7.FX.wait(1500);
      showMenu();
      return;
    }

    // A partida foi interrompida e substituída por outra.
    if (!current || current.game !== game) return;

    if (controller.lastChoice === 'again') startGame(config);
    else showMenu();
  }

  /** Interrompe a partida atual e espera o motor encerrar com segurança. */
  async function stopGame() {
    if (!current) return;
    const { game, run } = current;
    current = null;
    game.abort();
    controller.cancelPending();
    try {
      await run;
    } catch (error) {
      /* partida já encerrada */
    }
  }

  async function showMenu() {
    await stopGame();
    hud.toggleLog(false);
    gameScreen.hidden = true;
    document.title = 'Vira-7 · Jogo de cartas';
    setup.show();
  }

  const setup = new F7.SetupScreen({
    root: qs('#setup-screen'),
    onStart: startGame,
    onRules: () => F7.Modals.rules(),
  });

  /* ------------------------------------------------------------------ */
  /* Barra superior                                                      */
  /* ------------------------------------------------------------------ */

  const soundButton = qs('#btn-sound');

  function applySound(enabled) {
    F7.Sound.setEnabled(enabled);
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.setAttribute('aria-label', enabled ? 'Desligar som' : 'Ligar som');
    soundButton.title = enabled ? 'Som ligado' : 'Som desligado';
    soundButton.innerHTML = icon(enabled ? 'soundOn' : 'soundOff');
    F7.storage.save('sound', enabled);
  }

  soundButton.addEventListener('click', () => {
    applySound(!F7.Sound.enabled);
    F7.Sound.click();
  });

  qs('#btn-rules').addEventListener('click', () => F7.Modals.rules());

  qs('#btn-log').addEventListener('click', () => hud.toggleLog());
  qs('#btn-close-log').addEventListener('click', () => hud.toggleLog(false));

  qs('#btn-restart').addEventListener('click', async () => {
    if (!current) return;
    const config = current.config;
    const ok = await F7.Modals.confirm({
      title: 'Reiniciar partida?',
      text: 'A partida atual será perdida e uma nova começará com os mesmos jogadores.',
      confirmLabel: 'Reiniciar',
    });
    if (ok) startGame(config);
  });

  qs('#btn-menu').addEventListener('click', async () => {
    const ok = await F7.Modals.confirm({
      title: 'Voltar ao menu?',
      text: 'A partida atual será encerrada.',
      confirmLabel: 'Sair da partida',
    });
    if (ok) showMenu();
  });

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  applySound(F7.storage.load('sound', true));

  // O áudio só pode começar depois da primeira interação.
  const unlockAudio = () => F7.Sound.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  // Ícones dos botões estáticos
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  });
})();
