/**
 * Vira-7 — Autenticação.
 *
 * Em produção usa o Supabase Auth (cadastro, login, confirmação de e-mail e
 * recuperação de senha). Quando a API está em modo de desenvolvimento local
 * (sem Supabase), usa o login local da própria API — só para testes na máquina.
 */
((F7) => {
  'use strict';

  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const DEV_KEY = 'vira7:dev-session';

  /** Mensagens do Supabase Auth em português. */
  const MESSAGES = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/email not confirmed/i, 'Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.'],
    [/user already registered/i, 'Já existe uma conta com esse e-mail.'],
    [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
    [/rate limit|too many requests|only request this after/i, 'Muitas tentativas. Aguarde um pouco e tente de novo.'],
    [/unable to validate email|invalid email|invalid format/i, 'E-mail inválido.'],
    [/new password should be different/i, 'A nova senha precisa ser diferente da atual.'],
    [/expired|invalid.*(token|link)/i, 'O link expirou ou já foi usado. Peça um novo.'],
    [/network|failed to fetch/i, 'Sem conexão. Verifique sua internet.'],
  ];

  function translate(error) {
    const message = (error && error.message) || '';
    const found = MESSAGES.find(([pattern]) => pattern.test(message));
    return new Error(found ? found[1] : message || 'Não foi possível concluir. Tente novamente.');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Não foi possível carregar o serviço de autenticação.'));
      document.head.appendChild(script);
    });
  }

  const listeners = new Set();
  const state = { mode: 'none', user: null, recovery: false, client: null, devSession: null };

  function emit(event) {
    listeners.forEach((listener) => listener(event, state.user));
  }

  /* ------------------------------------------------------------------ */
  /* Supabase                                                            */
  /* ------------------------------------------------------------------ */

  const supabaseProvider = {
    async init(config) {
      if (!window.supabase) await loadScript(SUPABASE_CDN);
      state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });

      state.client.auth.onAuthStateChange((event, session) => {
        const previous = state.user && state.user.id;
        state.user = session ? { id: session.user.id, email: session.user.email } : null;
        if (event === 'PASSWORD_RECOVERY') {
          state.recovery = true;
          emit('recovery');
        } else if (event === 'SIGNED_OUT') {
          emit('signedOut');
        } else if (state.user && state.user.id !== previous) {
          emit('signedIn');
        }
      });

      const { data } = await state.client.auth.getSession();
      state.user = data.session ? { id: data.session.user.id, email: data.session.user.email } : null;
    },

    async token() {
      const { data } = await state.client.auth.getSession();
      return data.session ? data.session.access_token : null;
    },

    async signUp({ email, password, username, avatar }) {
      const { data, error } = await state.client.auth.signUp({
        email,
        password,
        options: {
          data: { username, avatar },
          emailRedirectTo: window.location.origin + window.location.pathname,
        },
      });
      if (error) throw translate(error);
      // Com confirmação de e-mail ligada, o Supabase não devolve sessão ainda.
      // Para e-mails já cadastrados ele devolve um usuário "vazio" (sem identidades).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Já existe uma conta com esse e-mail.');
      }
      return { needsConfirmation: !data.session };
    },

    async signIn({ email, password }) {
      const { error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw translate(error);
    },

    async signOut() {
      await state.client.auth.signOut();
    },

    async sendRecovery(email) {
      const { error } = await state.client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) throw translate(error);
    },

    async updatePassword(password) {
      const { error } = await state.client.auth.updateUser({ password });
      if (error) throw translate(error);
      state.recovery = false;
    },
  };

  /* ------------------------------------------------------------------ */
  /* Login local (modo de desenvolvimento da API)                        */
  /* ------------------------------------------------------------------ */
  // Usa sessionStorage de propósito: cada aba vira um jogador diferente, o que
  // permite testar uma partida com várias pessoas no mesmo navegador.

  const devProvider = {
    async init() {
      try {
        const saved = JSON.parse(window.sessionStorage.getItem(DEV_KEY) || 'null');
        if (saved && saved.expiresAt * 1000 > Date.now()) {
          state.devSession = saved;
          state.user = saved.user;
        }
      } catch (error) {
        state.devSession = null;
      }
    },

    async token() {
      return state.devSession ? state.devSession.accessToken : null;
    },

    save(session) {
      state.devSession = session;
      state.user = session.user;
      try {
        window.sessionStorage.setItem(DEV_KEY, JSON.stringify(session));
      } catch (error) {
        /* armazenamento indisponível */
      }
      emit('signedIn');
    },

    async signUp(form) {
      this.save(await F7.Api.request('POST', '/dev/signup', form, { auth: false }));
      return { needsConfirmation: false };
    },

    async signIn(form) {
      this.save(await F7.Api.request('POST', '/dev/login', form, { auth: false }));
    },

    async signOut() {
      state.devSession = null;
      state.user = null;
      try {
        window.sessionStorage.removeItem(DEV_KEY);
      } catch (error) {
        /* ignora */
      }
      emit('signedOut');
    },

    async sendRecovery() {
      throw new Error('A recuperação de senha por e-mail só funciona com o Supabase configurado.');
    },

    async updatePassword() {
      throw new Error('A troca de senha só funciona com o Supabase configurado.');
    },
  };

  let provider = null;

  const Auth = {
    state,

    get user() { return state.user; },
    get mode() { return state.mode; },
    get isRecovery() { return state.recovery; },
    /** Cliente do Supabase (usado pelo tempo real), ou null no modo local. */
    get client() { return state.client; },

    async init(config) {
      if (!config) return;
      state.mode = config.devMode ? 'dev' : 'supabase';
      provider = config.devMode ? devProvider : supabaseProvider;
      F7.Api.tokenProvider = () => provider.token();
      await provider.init(config);
    },

    /** `listener(event, user)` com event = signedIn | signedOut | recovery. */
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    signUp: (form) => provider.signUp(form),
    signIn: (form) => provider.signIn(form),
    signOut: () => provider.signOut(),
    sendRecovery: (email) => provider.sendRecovery(email),
    updatePassword: (password) => provider.updatePassword(password),
  };

  F7.Auth = Auth;
})(globalThis.F7 = globalThis.F7 || {});
