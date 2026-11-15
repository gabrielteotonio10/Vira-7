/**
 * Vira-7 — Efeitos sonoros sintetizados com Web Audio API.
 * Nenhum arquivo de áudio é necessário: cada som é gerado em tempo real.
 */
((F7) => {
  'use strict';

  /** Escala pentatônica usada para "subir o tom" a cada número novo na mão. */
  const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

  class SoundEngine {
    constructor() {
      this.enabled = true;
      this.volume = 0.55;
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
    }

    /** O navegador só libera áudio depois de uma interação do usuário. */
    unlock() {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const compressor = this.ctx.createDynamicsCompressor();
        this.master.connect(compressor);
        compressor.connect(this.ctx.destination);
        this.noiseBuffer = this.createNoise();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setEnabled(enabled) {
      this.enabled = !!enabled;
      if (this.enabled) this.unlock();
    }

    get ready() {
      return this.enabled && this.ctx && this.ctx.state === 'running';
    }

    createNoise() {
      const length = this.ctx.sampleRate * 1;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return buffer;
    }

    /** Oscilador com envelope (ataque rápido e decaimento exponencial). */
    tone({ freq = 440, to, type = 'sine', duration = 0.18, volume = 0.3, delay = 0, attack = 0.006 }) {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + duration);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    }

    /** Ruído filtrado: bom para "swish" de cartas e impactos. */
    noise({ duration = 0.15, volume = 0.25, freq = 2000, to, q = 1, type = 'bandpass', delay = 0 }) {
      if (!this.ready) return;
      const t0 = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.Q.value = q;
      filter.frequency.setValueAtTime(freq, t0);
      if (to) filter.frequency.exponentialRampToValueAtTime(to, t0 + duration);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter).connect(gain).connect(this.master);
      src.start(t0);
      src.stop(t0 + duration + 0.05);
    }

    /* ---------------- Sons do jogo ---------------- */

    flip() {
      this.noise({ duration: 0.12, volume: 0.35, freq: 1200, to: 5000, q: 0.8 });
      this.tone({ freq: 1400, type: 'triangle', duration: 0.04, volume: 0.06, delay: 0.09 });
    }

    deal() {
      this.noise({ duration: 0.08, volume: 0.2, freq: 2500, to: 4500, q: 0.7 });
    }

    /** Nota sobe conforme a quantidade de números diferentes na mão. */
    number(step = 0) {
      const freq = PENTATONIC[Math.min(step, PENTATONIC.length - 1)];
      this.tone({ freq, type: 'triangle', duration: 0.22, volume: 0.22 });
      this.tone({ freq: freq * 2, type: 'sine', duration: 0.12, volume: 0.06, delay: 0.01 });
    }

    modifier() {
      this.tone({ freq: 880, type: 'sine', duration: 0.12, volume: 0.18 });
      this.tone({ freq: 1320, type: 'sine', duration: 0.18, volume: 0.16, delay: 0.07 });
      this.tone({ freq: 1760, type: 'sine', duration: 0.22, volume: 0.12, delay: 0.14 });
    }

    bust() {
      this.tone({ freq: 330, to: 70, type: 'sawtooth', duration: 0.65, volume: 0.22 });
      this.tone({ freq: 220, to: 55, type: 'square', duration: 0.5, volume: 0.08, delay: 0.05 });
      this.noise({ duration: 0.35, volume: 0.4, freq: 400, to: 80, type: 'lowpass', q: 0.5 });
    }

    freeze() {
      [2093, 1760, 1568, 1319, 1175].forEach((freq, i) => {
        this.tone({ freq, type: 'sine', duration: 0.35, volume: 0.1, delay: i * 0.05 });
      });
      this.noise({ duration: 0.6, volume: 0.12, freq: 7000, type: 'highpass', q: 0.3 });
    }

    flipThree() {
      [523, 659, 784].forEach((freq, i) => {
        this.tone({ freq, type: 'square', duration: 0.09, volume: 0.09, delay: i * 0.09 });
      });
      this.tone({ freq: 1047, type: 'triangle', duration: 0.3, volume: 0.15, delay: 0.27 });
    }

    secondChance() {
      this.noise({ duration: 0.3, volume: 0.15, freq: 800, to: 4000, q: 0.6 });
      this.tone({ freq: 660, to: 990, type: 'sine', duration: 0.28, volume: 0.18, delay: 0.05 });
      this.tone({ freq: 1320, type: 'sine', duration: 0.35, volume: 0.1, delay: 0.2 });
    }

    shieldBreak() {
      this.noise({ duration: 0.4, volume: 0.35, freq: 3000, to: 300, q: 1.2 });
      this.tone({ freq: 1200, to: 300, type: 'triangle', duration: 0.4, volume: 0.15 });
    }

    stay() {
      this.tone({ freq: 523.25, type: 'triangle', duration: 0.2, volume: 0.16 });
      this.tone({ freq: 659.25, type: 'triangle', duration: 0.25, volume: 0.14, delay: 0.06 });
      this.tone({ freq: 783.99, type: 'triangle', duration: 0.35, volume: 0.14, delay: 0.12 });
    }

    flip7() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      notes.forEach((freq, i) => {
        this.tone({ freq, type: 'square', duration: 0.16, volume: 0.08, delay: i * 0.08 });
        this.tone({ freq, type: 'triangle', duration: 0.2, volume: 0.12, delay: i * 0.08 });
      });
      [1046.5, 1318.51, 1567.98, 2093].forEach((freq) => {
        this.tone({ freq, type: 'triangle', duration: 0.9, volume: 0.09, delay: 0.5 });
      });
    }

    win() {
      const melody = [
        [523.25, 0], [523.25, 0.15], [523.25, 0.3], [659.25, 0.45],
        [783.99, 0.75], [659.25, 0.95], [783.99, 1.1], [1046.5, 1.3],
      ];
      melody.forEach(([freq, delay]) => {
        this.tone({ freq, type: 'square', duration: 0.22, volume: 0.07, delay });
        this.tone({ freq, type: 'triangle', duration: 0.3, volume: 0.12, delay });
      });
      [523.25, 659.25, 783.99, 1046.5].forEach((freq) => {
        this.tone({ freq, type: 'triangle', duration: 1.4, volume: 0.08, delay: 1.3 });
      });
    }

    turn() {
      this.tone({ freq: 988, type: 'sine', duration: 0.25, volume: 0.08 });
      this.tone({ freq: 1319, type: 'sine', duration: 0.3, volume: 0.06, delay: 0.06 });
    }

    reshuffle() {
      for (let i = 0; i < 10; i++) {
        this.noise({ duration: 0.05, volume: 0.15, freq: 3000 + i * 150, q: 2, delay: i * 0.04 });
      }
    }

    click() {
      this.tone({ freq: 1800, type: 'triangle', duration: 0.04, volume: 0.06 });
    }

    roundEnd() {
      [392, 523.25, 659.25].forEach((freq, i) => {
        this.tone({ freq, type: 'triangle', duration: 0.3, volume: 0.12, delay: i * 0.1 });
      });
    }
  }

  F7.Sound = new SoundEngine();
})(globalThis.F7 = globalThis.F7 || {});
