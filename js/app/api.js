/**
 * Vira-7 — Cliente da API.
 * Envia o token de acesso em toda requisição e transforma respostas de erro em ApiError.
 */
((F7) => {
  'use strict';

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }

  const base = ((window.VIRA7_CONFIG && window.VIRA7_CONFIG.apiUrl) || '').replace(/\/$/, '');
  const TIMEOUT_MS = 15000;

  const Api = {
    ApiError,
    base,
    /** Configuração pública devolvida pelo servidor (ou null se a API não respondeu). */
    config: null,
    /** Diferença entre o relógio do servidor e o local, em ms. */
    clockOffset: 0,
    /** Função que devolve o token atual; definida pelo módulo de autenticação. */
    tokenProvider: async () => null,
    /** Chamado quando a API responde 401 (sessão expirada). */
    onUnauthorized: () => {},

    /**
     * Busca a configuração. Retorna false se a API estiver fora do ar.
     * No plano gratuito do Render o servidor dorme e leva de 30 a 60 s para acordar: em vez de
     * desistir em 15 s, tenta de novo por até ~80 s e avisa (`onSlow`) quando passa de 4 s.
     */
    async init({ onSlow } = {}) {
      const startedAt = Date.now();
      let warned = false;
      const slowTimer = onSlow ? setTimeout(() => { warned = true; onSlow(); }, 4000) : null;
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            this.config = await this.request('GET', '/config', undefined, { auth: false, timeout: 25000 });
            this.syncClock(this.config.serverTime);
            return true;
          } catch (error) {
            // Resposta do servidor (mesmo com erro) quer dizer que ele está de pé: não adianta insistir.
            if (error.status > 0 && error.status !== 502 && error.status !== 503 && error.status !== 504) break;
            if (Date.now() - startedAt > 80000) break;
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
        this.config = null;
        return false;
      } finally {
        clearTimeout(slowTimer);
        if (warned && this.onAwake) this.onAwake();
      }
    },

    syncClock(serverTime) {
      if (serverTime) this.clockOffset = new Date(serverTime).getTime() - Date.now();
    },

    /** Converte um instante do servidor (ISO) para o relógio local, em ms. */
    toLocalTime(iso) {
      return iso ? new Date(iso).getTime() - this.clockOffset : null;
    },

    async request(method, path, body, { auth = true, keepalive = false, timeout = TIMEOUT_MS } = {}) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) {
        const token = await this.tokenProvider();
        if (token) headers.Authorization = `Bearer ${token}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let response;
      try {
        response = await fetch(`${base}/api${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          // keepalive: a requisição termina mesmo se a página for fechada (preferências).
          keepalive,
        });
      } catch (error) {
        throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique sua internet.');
      } finally {
        clearTimeout(timer);
      }

      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        /* resposta sem corpo */
      }

      if (!response.ok) {
        const info = (data && data.error) || {};
        if (response.status === 401 && auth) this.onUnauthorized();
        throw new ApiError(response.status, info.code || 'HTTP_ERROR', info.message || 'Algo deu errado. Tente novamente.');
      }
      if (data && data.serverTime) this.syncClock(data.serverTime);
      return data;
    },

    get(path) { return this.request('GET', path); },
    post(path, body = {}) { return this.request('POST', path, body); },
    patch(path, body = {}) { return this.request('PATCH', path, body); },
    put(path, body = {}, options = {}) { return this.request('PUT', path, body, options); },
    del(path) { return this.request('DELETE', path); },
  };

  F7.Api = Api;
})(globalThis.F7 = globalThis.F7 || {});
