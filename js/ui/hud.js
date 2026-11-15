/**
 * Vira-7 — HUD: barra superior, doca do jogador da vez, medidor de risco,
 * botões Virar/Parar, avisos (toasts) e histórico de jogadas.
 */
((F7) => {
  'use strict';

  const { h, qs, clear, initial } = F7.dom;
  const { icon } = F7.icons;

  /** Escapa texto para uso seguro dentro de innerHTML. */
  const esc = (text) =>
    String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  /** Nome do jogador destacado com a cor dele (para o histórico). */
  const who = (player) => `<b style="color:${esc(player.color)}">${esc(player.name)}</b>`;

  class Hud {
    constructor(root) {
      this.root = root;
      this.el = {
        round: qs('#hud-round', root),
        target: qs('#hud-target', root),
        deckChip: qs('#hud-deck', root),
        dock: qs('#dock', root),
        turnAvatar: qs('#turn-avatar', root),
        turnLabel: qs('#turn-label', root),
        turnName: qs('#turn-name', root),
        risk: qs('#risk', root),
        riskValue: qs('#risk-value', root),
        riskHint: qs('#risk-hint', root),
        actions: qs('#actions', root),
        hit: qs('#btn-hit', root),
        stay: qs('#btn-stay', root),
        prompt: qs('#dock-prompt', root),
        toasts: qs('#toasts'),
        log: qs('#log'),
        logDrawer: qs('#log-drawer'),
      };
      this.pendingMove = null;
      this.isBlocked = () => false;
      this.bindKeyboard();
    }

    /* ------------------------------------------------------------------ */
    /* Barra superior                                                      */
    /* ------------------------------------------------------------------ */

    setRound(round) {
      this.el.round.textContent = String(round);
      F7.FX.retrigger(this.el.round.parentElement, 'is-shaking', 400);
    }

    setTarget(target) {
      this.el.target.textContent = String(target);
    }

    setDeckCount(count) {
      if (this.el.deckChip) this.el.deckChip.textContent = String(count);
    }

    /* ------------------------------------------------------------------ */
    /* Jogador da vez                                                      */
    /* ------------------------------------------------------------------ */

    setTurn(player, game) {
      const { turnAvatar, turnLabel, turnName, dock } = this.el;
      if (!player) {
        turnLabel.textContent = 'Aguarde';
        turnName.textContent = '—';
        turnAvatar.textContent = '·';
        turnAvatar.style.removeProperty('--avatar-color');
        dock.style.removeProperty('--turn-color');
        this.el.risk.classList.add('is-hidden');
        this.setActionsEnabled(false);
        return;
      }

      turnAvatar.textContent = initial(player.name);
      turnAvatar.style.setProperty('--avatar-color', player.color);
      dock.style.setProperty('--turn-color', player.color);
      turnLabel.textContent = player.isBot ? 'CPU jogando' : 'Sua vez,';
      if (turnName.textContent !== player.name) {
        turnName.textContent = player.name;
        F7.FX.retrigger(turnName, 'is-changing', 360);
      }
      this.updateRisk(player, game);
      this.setActionsEnabled(false);
    }

    updateRisk(player, game) {
      const { risk, riskValue, riskHint } = this.el;
      if (!player || !game) return;
      risk.classList.remove('is-hidden');

      const odds = game.bustOdds(player);
      const chance = player.numbers.length ? odds.chance : 0;
      const percent = Math.round(chance * 100);
      const color = chance < 0.2 ? 'var(--success)' : chance < 0.4 ? 'var(--warning)' : 'var(--danger)';

      risk.style.setProperty('--risk', chance.toFixed(3));
      risk.style.setProperty('--risk-color', color);
      riskValue.textContent = `${percent}%`;

      const protectedBySc = !!player.secondChance;
      risk.classList.toggle('is-protected', protectedBySc);
      if (protectedBySc) {
        riskHint.innerHTML = `${icon('shield')} Protegido pela Segunda Chance`;
      } else if (!player.numbers.length) {
        riskHint.textContent = 'Nenhuma carta pode estourar você agora';
      } else {
        const left = F7.RULES.FLIP7_UNIQUE_COUNT - player.numbers.length;
        riskHint.textContent =
          `${odds.matches} de ${odds.total} cartas repetem um número seu · ` +
          `faltam ${left} para o Vira 7`;
      }
    }

    setActionsEnabled(enabled) {
      this.el.hit.disabled = !enabled;
      this.el.stay.disabled = !enabled;
      this.el.actions.classList.toggle('is-waiting', !enabled);
    }

    /**
     * Espera a pessoa escolher Virar ou Parar (botões ou teclado).
     * @returns {Promise<'hit'|'stay'>}
     */
    waitForMove() {
      this.cancelWait();
      this.setActionsEnabled(true);
      return new Promise((resolve) => {
        const finish = (move) => {
          this.el.hit.removeEventListener('click', onHit);
          this.el.stay.removeEventListener('click', onStay);
          this.pendingMove = null;
          this.setActionsEnabled(false);
          F7.Sound.click();
          resolve(move);
        };
        const onHit = () => finish('hit');
        const onStay = () => finish('stay');
        this.el.hit.addEventListener('click', onHit);
        this.el.stay.addEventListener('click', onStay);
        this.pendingMove = finish;
        this.el.hit.focus({ preventScroll: true });
      });
    }

    cancelWait() {
      if (this.pendingMove) this.pendingMove('stay');
    }

    bindKeyboard() {
      document.addEventListener('keydown', (event) => {
        if (!this.pendingMove || this.isBlocked()) return;
        if (event.target.closest && event.target.closest('input, textarea, select')) return;
        const key = event.key.toLowerCase();
        if (key === 'v' || (key === ' ' && event.target === document.body)) {
          event.preventDefault();
          this.pendingMove('hit');
        } else if (key === 'p' || key === 's') {
          event.preventDefault();
          this.pendingMove('stay');
        }
      });
    }

    /* ------------------------------------------------------------------ */
    /* Mensagem de escolha de alvo                                         */
    /* ------------------------------------------------------------------ */

    showPrompt(text, { iconName = 'target', color = 'var(--brand-3)' } = {}) {
      const { prompt, dock } = this.el;
      prompt.innerHTML = `${icon(iconName)}<span>${esc(text)}</span>`;
      prompt.style.setProperty('--prompt-color', color);
      prompt.hidden = false;
      dock.classList.add('is-prompting');
    }

    hidePrompt() {
      this.el.prompt.hidden = true;
      this.el.dock.classList.remove('is-prompting');
    }

    /* ------------------------------------------------------------------ */
    /* Avisos e histórico                                                  */
    /* ------------------------------------------------------------------ */

    toast(html, { variant = 'info', iconName = 'sparkles', duration = 2600 } = {}) {
      const host = this.el.toasts;
      const node = h('div', { class: `toast toast--${variant}`, role: 'status' });
      node.innerHTML = `${icon(iconName)}<span>${html}</span>`;
      host.appendChild(node);
      while (host.children.length > 3) host.firstElementChild.remove();
      setTimeout(() => {
        node.classList.add('is-leaving');
        setTimeout(() => node.remove(), 280);
      }, F7.FX.dur(duration));
    }

    log(html, color) {
      const item = h('li', { style: color ? { '--log-color': color } : undefined });
      item.innerHTML = `<span>${html}</span>`;
      this.el.log.appendChild(item);
      while (this.el.log.children.length > 200) this.el.log.firstElementChild.remove();
      this.el.log.scrollTop = this.el.log.scrollHeight;
    }

    logRound(round, dealer) {
      const item = h('li', { class: 'log__round' });
      item.innerHTML = `<span>Rodada ${round} · carteador: ${who(dealer)}</span>`;
      this.el.log.appendChild(item);
    }

    clearLog() {
      clear(this.el.log);
      clear(this.el.toasts);
    }

    toggleLog(force) {
      const open = this.el.logDrawer.classList.toggle('is-open', force);
      this.el.logDrawer.setAttribute('aria-hidden', String(!open));
      return open;
    }
  }

  Hud.esc = esc;
  Hud.who = who;
  F7.Hud = Hud;
})(globalThis.F7 = globalThis.F7 || {});
