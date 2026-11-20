/**
 * Vira-7 — Vibração no celular.
 *
 * Cada som importante do jogo ganha um padrão de vibração. Em aparelhos sem suporte
 * (computadores, iPhone) nada acontece. Respeita "reduzir movimento" e a opção Vibração.
 */
((F7) => {
  'use strict';

  /** nome do som -> padrão (ms vibrando / parado / vibrando…) */
  const PATTERNS = {
    flip: [10],
    number: [14],
    modifier: [20, 30, 20],
    bust: [90, 50, 160],
    freeze: [30, 40, 30, 40, 60],
    flipThree: [20, 30, 20, 30, 20],
    secondChance: [30, 40, 60],
    shieldBreak: [60, 30, 60],
    stay: [24],
    flip7: [40, 40, 40, 40, 40, 40, 200],
    win: [60, 40, 60, 40, 60, 40, 260],
    turn: [45],
    roundEnd: [30, 40, 30],
  };

  const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  const Haptics = {
    enabled: true,
    supported,

    setEnabled(value) {
      this.enabled = !!value;
      if (!this.enabled && supported) navigator.vibrate(0);
    },

    buzz(name) {
      if (!supported || !this.enabled) return;
      if (F7.FX && F7.FX.state && F7.FX.state.reduced) return;
      // O navegador só deixa vibrar depois do primeiro toque na página (evita erro no console).
      const activation = navigator.userActivation;
      if (activation && !activation.hasBeenActive) return;
      const pattern = PATTERNS[name];
      if (pattern) navigator.vibrate(pattern);
    },
  };

  // Liga cada som ao seu padrão sem mexer nos pontos de chamada.
  if (F7.Sound) {
    Object.keys(PATTERNS).forEach((name) => {
      const original = F7.Sound[name];
      if (typeof original !== 'function') return;
      F7.Sound[name] = function wrapped(...args) {
        Haptics.buzz(name);
        return original.apply(this, args);
      };
    });
  }

  F7.Haptics = Haptics;
})(globalThis.F7 = globalThis.F7 || {});
