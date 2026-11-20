/**
 * Vira-7 — Modo mãos livres.
 *
 * Quando ligado, o jogo narra em voz alta o que acontece na mesa (síntese de voz do
 * navegador) e, na sua vez, escuta "virar" ou "parar" (reconhecimento de voz, onde existir).
 * Sem suporte do navegador, a opção avisa e o jogo segue normal pelos botões.
 */
((F7) => {
  'use strict';

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  const LOCALES = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' };
  /** Palavras que valem como cada jogada, nos três idiomas. */
  const WORDS = {
    hit: /\b(vir[ae]r?|carta|mais|outra|flip|hit|draw|another|voltear|otra|dame|pide|pedir)\b/i,
    stay: /\b(par[ae]r?|chega|guard[ae]r?|stay|stop|hold|enough|plantar?|me planto|basta|quedo|quedarme)\b/i,
  };

  const Voice = {
    enabled: false,
    speechSupported: !!synth,
    listenSupported: !!Recognition,
    listening: null,

    get locale() {
      return LOCALES[(F7.i18n && F7.i18n.lang) || 'pt'] || 'pt-BR';
    },

    setEnabled(value) {
      this.enabled = !!value && !!synth;
      if (!this.enabled) {
        this.stopListening();
        if (synth) synth.cancel();
      }
    },

    /** Fala um texto (sem tags HTML). `urgent` interrompe o que estiver sendo dito. */
    say(text, { urgent = false } = {}) {
      if (!this.enabled || !synth || !text) return;
      const clean = String(text).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      if (urgent) synth.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = this.locale;
      utterance.rate = 1.05;
      synth.speak(utterance);
    },

    /** Escuta uma jogada por alguns segundos. `onMove('hit'|'stay')` é chamado se entender. */
    listen(onMove, { seconds = 12 } = {}) {
      if (!this.enabled || !Recognition) return;
      this.stopListening();
      const recognition = new Recognition();
      recognition.lang = this.locale;
      recognition.continuous = true;
      recognition.interimResults = false;
      const stopAt = Date.now() + seconds * 1000;
      let done = false;

      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const heard = event.results[i][0].transcript;
          const move = Voice.parse(heard);
          if (move && !done) {
            done = true;
            Voice.stopListening();
            onMove(move);
            return;
          }
        }
      };
      // Alguns navegadores encerram sozinhos: recomeça até o tempo acabar.
      recognition.onend = () => {
        if (!done && Voice.listening === recognition && Date.now() < stopAt) {
          try {
            recognition.start();
          } catch (error) {
            /* já estava ouvindo */
          }
        }
      };
      recognition.onerror = () => {};
      this.listening = recognition;
      try {
        recognition.start();
      } catch (error) {
        this.listening = null;
      }
    },

    stopListening() {
      const recognition = this.listening;
      this.listening = null;
      if (recognition) {
        try {
          recognition.abort();
        } catch (error) {
          /* ok */
        }
      }
    },

    /** "vira mais uma" -> hit; "para" -> stay. Ambíguo ou desconhecido -> null. */
    parse(text) {
      const hit = WORDS.hit.test(text);
      const stay = WORDS.stay.test(text);
      if (hit === stay) return null;
      return hit ? 'hit' : 'stay';
    },
  };

  // Narra o histórico da mesa e abre o microfone quando é a sua vez.
  if (F7.Hud) {
    const log = F7.Hud.prototype.log;
    F7.Hud.prototype.log = function narratedLog(html, color) {
      Voice.say(F7.i18n ? F7.i18n.t(String(html)) : html);
      return log.call(this, html, color);
    };

    const waitForMove = F7.Hud.prototype.waitForMove;
    F7.Hud.prototype.waitForMove = function listeningWait() {
      const promise = waitForMove.call(this);
      if (Voice.enabled) {
        Voice.say(F7.i18n ? F7.i18n.t('Sua vez! Diga virar ou parar.') : 'Sua vez! Diga virar ou parar.', { urgent: true });
        const answer = this.pendingMove;
        setTimeout(() => Voice.listen((move) => this.pendingMove === answer && answer(move)), 1800);
      }
      promise.then(() => Voice.stopListening());
      return promise;
    };
  }

  F7.Voice = Voice;
})(globalThis.F7 = globalThis.F7 || {});
