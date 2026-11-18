/**
 * Vira-7 — Casca da aplicação: rotas por hash, navegação, avisos e preferências.
 *
 * Rotas (ex.: #/sala/ABC123) são registradas com `App.route`. Cada tela é uma função
 * que recebe os parâmetros e pode devolver uma função de limpeza, chamada ao sair.
 */
((F7) => {
  'use strict';

  const { h, qs, clear } = F7.dom;
  const { icon } = F7.icons;

  const DEFAULT_SETTINGS = {
    volume: 0.6, sound: true, animationSpeed: 1, reducedMotion: false, showRisk: true, confirmStay: false,
  };

  const App = {
    state: { apiOnline: false, me: null, settings: { ...DEFAULT_SETTINGS } },
    routes: [],
    cleanup: null,
    current: null,
    /** HUD da mesa (definido pelo main.js), para aplicar preferências. */
    hud: null,

    /* ---------------------------------------------------------------- rotas */

    route(pattern, handler, { auth = true } = {}) {
      const keys = [];
      const regex = new RegExp(
        `^${pattern.replace(/:([a-z]+)/gi, (_, key) => {
          keys.push(key);
          return '([^/]+)';
        })}$`,
      );
      this.routes.push({ regex, keys, handler, auth });
    },

    get path() {
      const hash = window.location.hash.replace(/^#/, '');
      return hash.startsWith('/') ? hash : '/';
    },

    navigate(path, { replace = false } = {}) {
      const target = `#${path}`;
      if (window.location.hash === target) return this.resolve();
      if (replace) window.location.replace(target);
      else window.location.hash = target;
      return undefined;
    },

    async resolve() {
      const path = this.path;
      const token = (this.current = Symbol(path));

      if (typeof this.cleanup === 'function') {
        try {
          this.cleanup();
        } catch (error) {
          console.error(error);
        }
      }
      this.cleanup = null;

      const match = this.routes
        .map((route) => ({ route, found: path.match(route.regex) }))
        .find((entry) => entry.found);
      if (!match) return this.navigate('/', { replace: true });

      const { route, found } = match;
      const signedIn = !!(F7.Auth && F7.Auth.user);
      if (route.auth && !this.state.apiOnline) return this.navigate('/offline', { replace: true });
      if (route.auth && !signedIn) return this.navigate('/entrar', { replace: true });
      if (route.auth && !this.state.me) {
        try {
          await this.refreshMe();
        } catch (error) {
          // Sessão inválida já é tratada pelo cliente da API (volta para a entrada).
          // Qualquer outra falha mostra uma tela de erro: redirecionar aqui criaria um
          // vai-e-volta sem fim entre o início e a tela de entrada.
          if (token === this.current && error.status !== 401) this.fatal(error);
          return undefined;
        }
        if (token !== this.current) return undefined;
      }

      document.title = 'Vira-7 · Jogo de cartas online';
      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(found[i + 1])]));
      try {
        const cleanup = await route.handler(params);
        if (token === this.current) this.cleanup = cleanup;
        else if (typeof cleanup === 'function') cleanup();
      } catch (error) {
        console.error(error);
        this.toast(error.message || 'Não foi possível abrir a tela.', { variant: 'bust' });
      }
      return undefined;
    },

    start() {
      window.addEventListener('hashchange', () => this.resolve());
      return this.resolve();
    },

    /* ---------------------------------------------------------------- telas */

    /** Mostra uma das três áreas: telas (view), configuração local (setup) ou mesa (game). */
    show(which) {
      qs('#view').hidden = which !== 'view';
      qs('#setup-screen').hidden = which !== 'setup';
      qs('#game-screen').hidden = which !== 'game';
      if (which !== 'game') qs('#log-drawer').classList.remove('is-open');
      window.scrollTo(0, 0);
    },

    /** Desenha uma tela dentro de #view (com a barra de navegação, se logado). */
    render(content, { nav = true, narrow = false, bare = false } = {}) {
      const view = clear(qs('#view'));
      if (nav && this.state.me) view.appendChild(this.navBar());
      // `bare`: a tela ocupa a página inteira (ex.: entrar), sem a coluna central.
      view.appendChild(bare ? content : h('div', { class: `page ${narrow ? 'page--narrow' : ''}` }, content));
      this.show('view');
      return view;
    },

    navBar() {
      const { profile } = this.state.me;
      const link = (path, label, iconName) =>
        h(
          'a',
          { href: `#${path}`, class: `nav__link ${this.path === path ? 'is-active' : ''}` },
          h('span', { html: icon(iconName) }),
          h('span', {}, label),
        );
      return h(
        'header',
        { class: 'nav' },
        h(
          'a',
          { class: 'logo nav__logo', href: '#/', 'aria-label': 'Vira-7: início' },
          h('span', { class: 'logo__word' }, 'VIRA'),
          h('span', { class: 'logo__seven' }, '7'),
        ),
        h(
          'nav',
          { class: 'nav__links', 'aria-label': 'Principal' },
          link('/', 'Jogar', 'play'),
          link('/ranking', 'Ranking', 'trophy'),
          link('/historico', 'Histórico', 'history'),
          link('/config', 'Ajustes', 'menu'),
        ),
        h(
          'a',
          { class: 'nav__user', href: '#/perfil', title: 'Meu perfil' },
          F7.Avatars.create({ avatar: profile.avatar, name: profile.username }),
          h('span', {}, profile.username),
        ),
      );
    },

    /** Tela de erro com as duas saídas possíveis: tentar de novo ou sair da conta. */
    fatal(error) {
      this.render(
        h(
          'div',
          { class: 'fatal' },
          h('span', { class: 'empty__icon', html: icon('bolt') }),
          h('h1', {}, 'Não deu para carregar sua conta'),
          h('p', {}, error.message || 'Tente de novo em instantes.'),
          h(
            'div',
            { class: 'fatal__actions' },
            h('button', { type: 'button', class: 'btn btn--primary', onClick: () => this.resolve() }, 'Tentar de novo'),
            h('button', { type: 'button', class: 'btn', onClick: () => this.signOut() }, 'Sair da conta'),
            h('a', { class: 'btn btn--ghost', href: '#/local' }, 'Jogar na mesma tela'),
          ),
        ),
        { nav: false, narrow: true },
      );
    },

    loading(text = 'Carregando…') {
      return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner' }), text);
    },

    empty(iconName, title, text) {
      return h(
        'div',
        { class: 'empty' },
        h('span', { class: 'empty__icon', html: icon(iconName) }),
        h('strong', {}, title),
        text ? h('p', {}, text) : null,
      );
    },

    /** Desabilita o botão e mostra carregamento enquanto a ação roda. Erros viram aviso. */
    async busy(button, action) {
      if (button.disabled) return undefined;
      button.disabled = true;
      button.classList.add('is-busy');
      try {
        return await action();
      } catch (error) {
        this.toast(error.message || 'Algo deu errado.', { variant: 'bust' });
        return undefined;
      } finally {
        button.disabled = false;
        button.classList.remove('is-busy');
      }
    },

    toast(text, { variant = 'info', iconName, duration = 3200 } = {}) {
      const host = qs('#toasts');
      const icons = { bust: 'bolt', stay: 'shield', info: 'sparkles', freeze: 'snowflake', chance: 'heart' };
      const node = h('div', { class: `toast toast--${variant}`, role: 'status' });
      node.innerHTML = icon(iconName || icons[variant] || 'sparkles');
      node.appendChild(h('span', {}, text));
      host.appendChild(node);
      while (host.children.length > 3) host.firstElementChild.remove();
      setTimeout(() => {
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 280);
      }, duration);
    },

    /* ---------------------------------------------------------------- conta */

    async refreshMe() {
      const me = await F7.Api.get('/me');
      this.state.me = me;
      this.applySettings(me.settings);
      return me;
    },

    applySettings(settings) {
      const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
      this.state.settings = merged;
      F7.Sound.setEnabled(merged.sound);
      F7.Sound.setVolume(merged.volume);
      const system = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      F7.FX.state.reduced = merged.reducedMotion || system;
      document.documentElement.classList.toggle('reduced-motion', merged.reducedMotion);
      if (this.hud) this.hud.showRisk = merged.showRisk;
      return merged;
    },

    async signOut() {
      this.state.me = null;
      await F7.Auth.signOut();
      this.navigate('/entrar');
    },

    /* ---------------------------------------------------------------- utilidades */

    formatDate(iso) {
      if (!iso) return '';
      const date = new Date(iso);
      const minutes = Math.round((Date.now() - date.getTime()) / 60000);
      if (minutes < 1) return 'agora mesmo';
      if (minutes < 60) return `há ${minutes} min`;
      if (minutes < 24 * 60) return `há ${Math.round(minutes / 60)} h`;
      return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    },
  };

  App.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  F7.App = App;
})(globalThis.F7 = globalThis.F7 || {});
