/**
 * Vira-7 — Pontuação da rodada e condição de vitória.
 *
 * Ordem oficial do cálculo:
 *  1. Jogador que estourou marca 0.
 *  2. Soma as cartas numéricas.
 *  3. Aplica o x2 (dobra SOMENTE a soma dos números).
 *  4. Soma os modificadores +2…+10.
 *  5. Soma o bônus de 15 pontos se virou 7 números diferentes.
 */
((F7) => {
  'use strict';

  const { MODIFIER_OPS: OPS, PLAYER_STATUS: S } = F7;

  /**
   * @param {{ numbers: object[], modifiers: object[], flip7?: boolean, status?: string }} hand
   */
  function compute({ numbers, modifiers, flip7 = false, status }) {
    const numbersSum = F7.utils.sum(numbers.map((card) => card.value));

    let multiplier = 1;
    let modifiersSum = 0;
    modifiers.forEach((card) => {
      if (card.op === OPS.MULTIPLY) multiplier *= card.value;
      else modifiersSum += card.value;
    });

    const numbersTotal = numbersSum * multiplier;
    const flip7Bonus = flip7 ? F7.RULES.FLIP7_BONUS : 0;
    const busted = status === S.BUSTED;
    const total = busted ? 0 : numbersTotal + modifiersSum + flip7Bonus;

    return { numbersSum, multiplier, numbersTotal, modifiersSum, flip7Bonus, total, busted };
  }

  /**
   * A partida termina quando alguém atinge a meta ao fim de uma rodada e há um líder isolado.
   * Se houver empate na liderança, joga-se outra rodada (regra oficial).
   */
  function checkVictory(players, targetScore) {
    const best = Math.max(...players.map((p) => p.total));
    const leaders = players.filter((p) => p.total === best);
    const reached = best >= targetScore;
    return {
      over: reached && leaders.length === 1,
      tie: reached && leaders.length > 1,
      winner: reached && leaders.length === 1 ? leaders[0] : null,
      leaders,
    };
  }

  /** Classificação ordenada por pontuação total (maior primeiro). */
  const standings = (players) => players.slice().sort((a, b) => b.total - a.total || a.id - b.id);

  F7.Scoring = { compute, checkVictory, standings };
})(globalThis.F7 = globalThis.F7 || {});
