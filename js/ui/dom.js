/**
 * Vira-7 — Utilitários de DOM.
 */
((F7) => {
  'use strict';

  /**
   * Cria um elemento de forma declarativa.
   *   h('button', { class: 'btn', onClick: fn, 'aria-label': 'Ok' }, 'Texto', filho)
   * Atributos iniciados por "on" viram listeners; `style` aceita objeto (inclusive variáveis CSS);
   * `html` define innerHTML (use apenas com conteúdo confiável, como os ícones SVG do projeto).
   */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([prop, v]) => {
          if (prop.startsWith('--')) el.style.setProperty(prop, v);
          else el.style[prop] = v;
        });
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    });
    append(el, children);
    return el;
  }

  function append(parent, children) {
    children.flat(Infinity).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return parent;
  }

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** Espera o próximo quadro de renderização (útil antes de medir posições). */
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /** Primeira letra do nome, para os avatares. */
  const initial = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';

  F7.dom = { h, append, qs, qsa, clear, nextFrame, initial };
})(globalThis.F7 = globalThis.F7 || {});
