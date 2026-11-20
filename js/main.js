/**
 * Vira-7 — Ponto de entrada.
 * Monta a mesa, liga os botões da barra superior, registra as rotas e inicia
 * a conexão com a API e a autenticação.
 */
(async () => {
  'use strict';

  const F7 = globalThis.F7;
  const { qs } = F7.dom;
  const { icon } = F7.icons;
  const { App, Api, Auth, Screens } = F7;

  /* ------------------------------------------------------------------ */
  /* Mesa de jogo (compartilhada pelos modos local e online)             */
  /* ------------------------------------------------------------------ */

  const gameScreen = qs('#game-screen');
  App.table = new F7.TableView({ seatsEl: qs('#seats'), deckEl: qs('#deck-pile') });
  App.hud = new F7.Hud(gameScreen);
  App.controller = new F7.GameController({ table: App.table, hud: App.hud });
  App.hud.isBlocked = () => F7.Modals.isOpen();
  /** Ações dos botões "menu" e "reiniciar", definidas pelo modo de jogo ativo. */
  App.gameHandlers = null;

  const soundButton = qs('#btn-sound');
  function paintSound() {
    const enabled = F7.Sound.enabled;
    soundButton.setAttribute('aria-pressed', String(enabled));
    soundButton.setAttribute('aria-label', enabled ? 'Desligar som' : 'Ligar som');
    soundButton.title = enabled ? 'Som ligado' : 'Som desligado';
    soundButton.innerHTML = icon(enabled ? 'soundOn' : 'soundOff');
  }

  soundButton.addEventListener('click', () => {
    const enabled = !F7.Sound.enabled;
    F7.storage.save('sound', enabled);
    // Com conta, a preferência acompanha o jogador em outros dispositivos.
    if (App.state.me) App.saveSettings({ ...App.state.settings, sound: enabled });
    else App.applySettings({ ...App.state.settings, sound: enabled });
    F7.Sound.click();
    paintSound();
  });

  qs('#btn-rules').addEventListener('click', () => F7.Modals.rules());
  qs('#btn-log').addEventListener('click', () => App.hud.toggleLog());
  qs('#btn-close-log').addEventListener('click', () => App.hud.toggleLog(false));
  qs('#btn-restart').addEventListener('click', () => App.gameHandlers && App.gameHandlers.restart && App.gameHandlers.restart());
  qs('#setup-back').addEventListener('click', () => App.navigate('/'));
  qs('#btn-menu').addEventListener('click', () => App.gameHandlers && App.gameHandlers.menu && App.gameHandlers.menu());

  // Ícones dos botões estáticos do HTML
  document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

  // O áudio só pode começar depois da primeira interação.
  const unlockAudio = () => F7.Sound.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  F7.i18n.start();
  App.applySettings({
    ...App.DEFAULT_SETTINGS,
    ...F7.storage.load('settings', {}),
    ...F7.Theme.cached(),
    language: F7.i18n.lang,
    sound: F7.storage.load('sound', true),
  });
  // Fechou a aba logo depois de mudar algo: a gravação pendente ainda é enviada.
  window.addEventListener('pagehide', () => App.flushSettings({ keepalive: true }));
  paintSound();

  /* ------------------------------------------------------------------ */
  /* Rotas                                                               */
  /* ------------------------------------------------------------------ */

  /** Telas de quem ainda não entrou: quem já está logado vai direto para o início. */
  const guest = (screen) => () => {
    if (!App.state.apiOnline) return App.navigate('/offline', { replace: true });
    if (Auth.user && !Auth.isRecovery) return App.navigate('/', { replace: true });
    return screen();
  };

  App.route('/', Screens.home);
  App.route('/sala/:code', Screens.room);
  App.route('/perfil', Screens.profile);
  App.route('/perfil/:username', Screens.profile);
  App.route('/historico', Screens.history);
  App.route('/ranking', () => Screens.ranking());
  App.route('/amigos', Screens.friends);
  App.route('/tutorial', Screens.tutorial, { auth: false });
  App.route('/config', async () => {
    const cleanup = await Screens.settings();
    return () => {
      cleanup();
      paintSound();
    };
  });
  App.route('/entrar', guest(Screens.login), { auth: false });
  App.route('/cadastro', guest(Screens.signup), { auth: false });
  App.route('/recuperar', guest(Screens.forgot), { auth: false });
  App.route('/nova-senha', () => (Auth.user ? Screens.reset() : App.navigate('/entrar', { replace: true })), { auth: false });
  App.route('/local', Screens.local, { auth: false });
  App.route('/offline', () => (App.state.apiOnline ? App.navigate('/', { replace: true }) : Screens.offline()), { auth: false });

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                       */
  /* ------------------------------------------------------------------ */

  App.render(App.loading('Conectando…'), { nav: false });

  // Links de confirmação e de recuperação do Supabase chegam com dados no hash.
  const arrivedFromEmail = /access_token=|error_description=|type=recovery/.test(window.location.hash);
  const emailError = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error_description');

  App.state.apiOnline = await Api.init();
  if (App.state.apiOnline) {
    try {
      await Auth.init(Api.config);
    } catch (error) {
      console.error(error);
      App.state.apiOnline = false;
      App.toast(error.message, { variant: 'bust' });
    }
  }

  Auth.onChange((event) => {
    App.state.me = null;
    if (event === 'recovery') return App.navigate('/nova-senha');
    if (event === 'signedOut') return App.navigate('/entrar');
    // signedIn: sai das telas de conta; nas demais, só recarrega a tela atual.
    if (['/entrar', '/cadastro', '/recuperar'].includes(App.path)) return App.navigate('/');
    return App.resolve();
  });

  // Sessão expirada ou inválida: volta para a tela de entrada.
  let signingOut = false;
  Api.onUnauthorized = async () => {
    if (signingOut || !Auth.user) return;
    signingOut = true;
    App.toast('Sua sessão expirou. Entre novamente.', { variant: 'bust' });
    await Auth.signOut().catch(() => {});
    App.state.me = null;
    App.navigate('/entrar');
    signingOut = false;
  };

  if (arrivedFromEmail) {
    if (emailError) App.toast(emailError.replace(/\+/g, ' '), { variant: 'bust' });
    window.history.replaceState(null, '', window.location.pathname + (Auth.isRecovery ? '#/nova-senha' : '#/'));
  }

  // Aviso de volta da conexão com a internet.
  window.addEventListener('offline', () => App.toast('Você está sem internet.', { variant: 'bust' }));
  window.addEventListener('online', () => App.toast('Conexão restabelecida.', { variant: 'stay' }));

  // App instalável (PWA): service worker só em https ou localhost.
  F7.Pwa.register();

  App.start();
})();
