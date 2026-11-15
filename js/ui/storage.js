/**
 * Vira-7 — Preferências salvas no navegador (localStorage).
 * Toda leitura/escrita é protegida: em modo privado ou com o armazenamento
 * bloqueado, o jogo continua funcionando com os valores padrão.
 */
((F7) => {
  'use strict';

  const PREFIX = 'vira7:';

  function load(key, fallback) {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (error) {
      /* armazenamento indisponível: ignora */
    }
  }

  F7.storage = { load, save };
})(globalThis.F7 = globalThis.F7 || {});
