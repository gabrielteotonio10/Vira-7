/**
 * Vira-7 — Renderização das cartas (frente e verso) e textos descritivos.
 */
((F7) => {
  'use strict';

  const { h } = F7.dom;
  const { icon } = F7.icons;
  const { CARD_TYPES: T, ACTIONS: A, MODIFIER_OPS: OPS } = F7;

  const ACTION_INFO = {
    [A.FREEZE]: { name: 'Congelar', short: 'Congelar', icon: 'snowflake', color: '#7fd8ff' },
    [A.FLIP_THREE]: { name: 'Vira Três', short: 'Vira 3', icon: 'flipThree', color: '#c77dff' },
    [A.SECOND_CHANCE]: { name: 'Segunda Chance', short: '2ª Chance', icon: 'heart', color: '#5ef2b0' },
  };

  /** "+4" ou "−6" (sinal de menos de verdade, mais legível que o hífen). */
  const signed = (value) => (value < 0 ? `−${Math.abs(value)}` : `+${value}`);

  /** Texto curto exibido na carta (ex.: "7", "+4", "×2"). */
  function cardText(card) {
    if (card.type === T.NUMBER) return String(card.value);
    if (card.type === T.MODIFIER) return card.op === OPS.MULTIPLY ? `×${card.value}` : signed(card.value);
    return ACTION_INFO[card.action].short;
  }

  /** Nome completo, usado em avisos, histórico e leitores de tela. */
  function cardName(card) {
    if (card.type === T.NUMBER) return `carta ${card.value}`;
    if (card.type === T.MODIFIER) {
      return card.op === OPS.MULTIPLY ? 'modificador ×2' : card.value < 0 ? `penalidade ${signed(card.value)}` : `modificador ${signed(card.value)}`;
    }
    return ACTION_INFO[card.action].name;
  }

  /** Cor de destaque da carta (para partículas, textos flutuantes etc.). */
  function cardColor(card) {
    if (card.type === T.NUMBER) {
      return getComputedStyle(document.documentElement).getPropertyValue(`--n${card.value}`).trim() || '#fff';
    }
    if (card.type === T.MODIFIER) {
      if (card.op === OPS.MULTIPLY) return '#ff7a59';
      return card.value < 0 ? '#dc3a32' : '#ffd166';
    }
    return ACTION_INFO[card.action].color;
  }

  function classesFor(card) {
    const classes = ['card', `card--${card.type}`];
    if (card.type === T.MODIFIER) classes.push(card.op === OPS.MULTIPLY ? 'card--multiply' : card.value < 0 ? 'card--minus' : 'card--add');
    if (card.type === T.ACTION) classes.push('card--action', `card--${card.action}`);
    return classes;
  }

  function frontFace(card) {
    const text = cardText(card);

    if (card.type === T.ACTION) {
      const info = ACTION_INFO[card.action];
      return h(
        'div',
        { class: 'card__face card__front' },
        h('span', { class: 'card__icon', html: icon(info.icon) }),
        h('span', { class: 'card__label' }, info.name),
      );
    }

    if (card.type === T.MODIFIER) {
      return h(
        'div',
        { class: 'card__face card__front' },
        h('span', { class: 'card__corner card__corner--tl' }, text),
        h('span', { class: 'card__value' }, text),
        h('span', { class: 'card__label' }, card.op === OPS.MULTIPLY ? 'Dobro' : card.value < 0 ? 'Penalidade' : 'Bônus'),
        h('span', { class: 'card__corner card__corner--br' }, text),
      );
    }

    return h(
      'div',
      { class: 'card__face card__front' },
      h('span', { class: 'card__corner card__corner--tl' }, text),
      h('span', { class: 'card__center' }, h('span', { class: 'card__value' }, text)),
      h('span', { class: 'card__corner card__corner--br' }, text),
    );
  }

  function backFace() {
    return h('div', { class: 'card__face card__back' }, h('span', { class: 'card__back-logo' }, 'V7'));
  }

  /**
   * Cria o elemento de uma carta.
   * @param {object|null} card carta do motor (ou `null` para uma carta só de verso)
   * @param {{ size?: 'xs'|'sm'|'md'|'lg'|'xl', faceDown?: boolean, className?: string }} [options]
   */
  function create(card, { size = 'md', faceDown = false, className = '' } = {}) {
    const classes = card ? classesFor(card) : ['card', 'card--back-only'];
    classes.push(`card--${size}`);
    if (faceDown || !card) classes.push('is-face-down');
    if (className) classes.push(className);

    const dataset = {};
    if (card) dataset.cardId = card.id;
    if (card && card.type === T.NUMBER) dataset.value = card.value;

    return h(
      'div',
      {
        class: classes.join(' '),
        dataset,
        role: 'img',
        'aria-label': card ? cardName(card) : 'carta virada para baixo',
      },
      h('div', { class: 'card__inner' }, card ? frontFace(card) : null, backFace()),
    );
  }

  F7.CardView = { create, cardText, cardName, cardColor, ACTION_INFO };
})(globalThis.F7 = globalThis.F7 || {});
