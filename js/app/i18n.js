/**
 * Vira-7 — Idiomas (português, inglês e espanhol).
 *
 * O texto-fonte do jogo é o português. Os dicionários (js/i18n/en.js e es.js) trazem:
 *   - `exact`:    frase em português -> tradução;
 *   - `patterns`: [expressão regular, modelo] para frases com partes variáveis
 *                 (nomes, números). O modelo usa $1, $2…
 *
 * Em vez de espalhar chamadas por todas as telas, um observador traduz o texto que
 * aparece na página (e os atributos aria-label, title e placeholder). Frases que
 * não estão no dicionário continuam em português: nunca aparece texto quebrado.
 * Trocar de idioma recarrega a página.
 */
((F7) => {
  'use strict';

  const SUPPORTED = ['pt', 'en', 'es'];
  const STORAGE_KEY = 'vira7:lang';
  const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);

  const dicts = {};

  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.includes(saved)) return saved;
    } catch (error) {
      /* sem armazenamento */
    }
    const browser = String((typeof navigator !== 'undefined' && navigator.language) || 'pt').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(browser) ? browser : 'pt';
  }

  const state = { lang: detect(), observer: null };

  /** Traduz uma frase. Espaços nas pontas são preservados. */
  function translate(text, lang = state.lang) {
    if (lang === 'pt' || typeof text !== 'string' || !text) return text;
    const dict = dicts[lang];
    if (!dict) return text;
    const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    const core = parts[2];
    if (!core) return text;

    let out = dict.exact.get(core);
    if (out === undefined) {
      for (const [regex, template] of dict.patterns) {
        if (regex.test(core)) {
          out = core.replace(regex, template);
          break;
        }
      }
    }
    if (out === undefined && core.includes(' · ')) {
      // "há 4 min · meta 200 · 5 rodadas": traduz cada pedaço separadamente.
      const segments = core.split(' · ');
      const done = segments.map((segment) => translate(segment, lang));
      if (done.some((segment, i) => segment !== segments[i])) out = done.join(' · ');
    }
    if (out === undefined) return text;
    // Nomes de carta dentro de <b>…</b> também são traduzidos ("carta 7", "Congelar").
    if (out.includes('<b>')) out = out.replace(/<b>([^<]*)<\/b>/g, (_, inner) => `<b>${translate(inner, lang)}</b>`);
    return parts[1] + out + parts[3];
  }

  function shouldSkip(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    return !!(el.closest && el.closest('[translate="no"]'));
  }

  function translateTextNode(node) {
    if (state.lang === 'pt' || shouldSkip(node)) return;
    const value = node.nodeValue;
    if (!value || !/[A-Za-zÀ-ú]/.test(value)) return;
    const next = translate(value);
    if (next !== value) node.nodeValue = next;
  }

  function translateAttributes(el) {
    if (state.lang === 'pt' || shouldSkip(el)) return;
    ATTRIBUTES.forEach((name) => {
      const value = el.getAttribute(name);
      if (!value) return;
      const next = translate(value);
      if (next !== value) el.setAttribute(name, next);
    });
  }

  function translateTree(root) {
    if (state.lang === 'pt') return;
    if (root.nodeType === 3) return translateTextNode(root);
    if (root.nodeType !== 1 || shouldSkip(root)) return undefined;
    translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === 3) translateTextNode(node);
      else translateAttributes(node);
      node = walker.nextNode();
    }
    return undefined;
  }

  const i18n = {
    SUPPORTED,
    get lang() {
      return state.lang;
    },

    /** Código de região para datas e números (pt-BR, en-US, es-ES). */
    get locale() {
      return { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[state.lang];
    },

    /** Registra o dicionário de um idioma. */
    add(lang, { exact = {}, patterns = [] }) {
      // As pontas de cada frase são ignoradas: o espaço original do texto é preservado ao traduzir.
      dicts[lang] = {
        exact: new Map(Object.entries(exact).map(([key, value]) => [key.trim(), value.trim()])),
        patterns: patterns.map(([source, template]) => [new RegExp(source), template]),
      };
    },

    /** Traduz uma frase em português (ou devolve a própria frase). */
    t(text, params) {
      const out = translate(text);
      return params ? out.replace(/\{(\w+)\}/g, (_, key) => (key in params ? params[key] : `{${key}}`)) : out;
    },

    /** Escolhe o idioma, grava a preferência e recarrega a página. */
    set(lang, { reload = true } = {}) {
      if (!SUPPORTED.includes(lang) || lang === state.lang) return;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (error) {
        /* sem armazenamento */
      }
      state.lang = lang;
      if (reload) window.location.reload();
    },

    /** Começa a traduzir a página e tudo o que for aparecendo nela. */
    start() {
      document.documentElement.lang = { pt: 'pt-BR', en: 'en', es: 'es' }[state.lang];
      if (state.lang === 'pt' || state.observer) return;
      translateTree(document.documentElement);
      state.observer = new MutationObserver((records) => {
        records.forEach((record) => {
          if (record.type === 'characterData') translateTextNode(record.target);
          else if (record.type === 'attributes') translateAttributes(record.target);
          else record.addedNodes.forEach((node) => translateTree(node));
        });
      });
      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRIBUTES,
      });
    },

    translateTree,
  };

  // O histórico da mesa entra como HTML, em pedaços: traduz a frase inteira antes de desenhar.
  if (F7.Hud) {
    const { log, toast, logRound } = F7.Hud.prototype;
    F7.Hud.prototype.log = function translatedLog(html, color) {
      return log.call(this, translate(html), color);
    };
    F7.Hud.prototype.toast = function translatedToast(html, options) {
      return toast.call(this, translate(html), options);
    };
    F7.Hud.prototype.logRound = function translatedRound(round, dealer) {
      logRound.call(this, round, dealer);
      const item = this.el.log.lastElementChild;
      if (item) item.innerHTML = translate(item.innerHTML);
    };
  }

  F7.i18n = i18n;
})(globalThis.F7 = globalThis.F7 || {});
