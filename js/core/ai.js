/**
 * Vira-7 — Inteligência dos jogadores controlados pelo computador (CPU).
 *
 * As decisões usam a probabilidade real de estourar (as cartas no Flip 7 são públicas),
 * a pontuação em jogo, a distância para a meta e a "personalidade" de cada robô.
 */
((F7) => {
  'use strict';

  const { ACTIONS: A, RULES } = F7;

  const roundPoints = (player) => F7.Scoring.compute(player).total;

  /** Pontuação total da pessoa que está à frente (excluindo `player`). */
  function bestOpponentTotal(player, game) {
    return Math.max(0, ...game.players.filter((p) => p !== player).map((p) => p.total));
  }

  /**
   * Decide entre virar ("hit") ou parar ("stay").
   * @returns {'hit'|'stay'}
   */
  function decideMove(player, game) {
    // Sem números na mesa não há como estourar.
    if (!player.numbers.length) return 'hit';

    const risk = game.bustChance(player);
    const points = roundPoints(player);
    const projected = player.total + points;

    // Se parar agora garante a vitória (com folga sobre os rivais), para.
    if (projected >= game.targetScore && projected > bestOpponentTotal(player, game)) return 'stay';

    // Segunda Chance protege contra um estouro: dá para arriscar bastante.
    if (player.secondChance) return risk < 0.75 ? 'hit' : 'stay';

    let threshold = player.riskTolerance;

    // Perto do Vira 7 o bônus de 15 pontos vale o risco.
    if (player.uniqueCount() === RULES.FLIP7_UNIQUE_COUNT - 1) threshold += 0.12;

    // Muito atrás na partida: precisa arriscar mais.
    const gap = bestOpponentTotal(player, game) - player.total;
    if (gap > 60) threshold += 0.08;

    // Rodada já valiosa: protege o que tem.
    if (points >= 35) threshold -= 0.08;
    if (points >= 50) threshold -= 0.08;

    return risk <= F7.utils.clamp(threshold, 0.05, 0.9) ? 'hit' : 'stay';
  }

  /** Quanto um adversário ameaça: pontuação total + o que tem na mesa. */
  const threat = (p) => p.total + roundPoints(p);

  /**
   * Escolhe o alvo de uma carta de ação.
   * @param {string} kind 'freeze' | 'flipThree' | 'secondChance'
   */
  function chooseTarget(player, kind, candidates, game) {
    const others = candidates.filter((p) => p !== player);
    const includesSelf = candidates.includes(player);

    if (kind === A.SECOND_CHANCE) {
      // Dá a Segunda Chance para quem menos ameaça.
      return others.slice().sort((a, b) => threat(a) - threat(b))[0] || candidates[0];
    }

    if (kind === A.FREEZE) {
      // Congelar a si mesmo é ótimo quando há muito a perder.
      if (includesSelf && roundPoints(player) >= 20 && game.bustChance(player) >= 0.25) return player;
      if (!others.length) return player;
      // Congela o rival que tem pouco na mesa, mas é forte na partida.
      return others
        .slice()
        .sort((a, b) => b.total - roundPoints(b) * 2 - (a.total - roundPoints(a) * 2))[0];
    }

    // Vira Três: força o rival mais exposto a arriscar.
    if (!others.length) return player;
    return others
      .slice()
      .sort((a, b) => {
        const scoreA = game.bustChance(a) * (roundPoints(a) + 10) + threat(a) * 0.05;
        const scoreB = game.bustChance(b) * (roundPoints(b) + 10) + threat(b) * 0.05;
        return scoreB - scoreA;
      })[0];
  }

  /** Personalidade aleatória para cada CPU (entre cautelosa e ousada). */
  const randomRiskTolerance = (rng = Math.random) => 0.2 + rng() * 0.2;

  F7.AI = { decideMove, chooseTarget, randomRiskTolerance };
})(globalThis.F7 = globalThis.F7 || {});
