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

  /** Parceiros de `player` (vazio em partida individual). Em duplas, `player.team` é o número da dupla. */
  const teammates = (player, game) =>
    player.team === null || player.team === undefined ? [] : game.players.filter((p) => p !== player && p.team === player.team);

  /** Pontos da partida de quem joga: o próprio ou, em duplas, o da dupla. */
  const teamTotal = (player, game) => player.total + teammates(player, game).reduce((sum, p) => sum + p.total, 0);

  /** Pontos da rodada em jogo: os seus mais os do parceiro (estourou = 0). */
  const teamRoundPoints = (player, game) => roundPoints(player) + teammates(player, game).reduce((sum, p) => sum + roundPoints(p), 0);

  /** Maior pontuação entre os adversários (em duplas, a maior soma de uma dupla rival). */
  function bestOpponentTotal(player, game) {
    if (player.team === null || player.team === undefined) {
      return Math.max(0, ...game.players.filter((p) => p !== player).map((p) => p.total));
    }
    const totals = new Map();
    game.players.filter((p) => p.team !== player.team).forEach((p) => totals.set(p.team, (totals.get(p.team) || 0) + p.total));
    return Math.max(0, ...totals.values());
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
    // Em duplas a conta é da dupla: os pontos do parceiro também valem.
    const projected = teamTotal(player, game) + teamRoundPoints(player, game);

    // Se parar agora garante a vitória (com folga sobre os rivais), para.
    if (projected >= game.targetScore && projected > bestOpponentTotal(player, game)) return 'stay';

    // Segunda Chance protege contra um estouro: dá para arriscar bastante.
    if (player.secondChance) return risk < 0.75 ? 'hit' : 'stay';

    let threshold = player.riskTolerance;

    // Perto do Vira 7 o bônus de 15 pontos vale o risco.
    if (player.uniqueCount() === RULES.FLIP7_UNIQUE_COUNT - 1) threshold += 0.12;

    // Muito atrás na partida: precisa arriscar mais.
    const gap = bestOpponentTotal(player, game) - teamTotal(player, game);
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
    const mates = teammates(player, game);
    const allOthers = candidates.filter((p) => p !== player);
    const includesSelf = candidates.includes(player);
    // Em duplas, parceiro não é rival: só entra na conta quando não há mais ninguém.
    const rivals = allOthers.filter((p) => !mates.includes(p));
    const others = rivals.length ? rivals : allOthers;
    const partners = allOthers.filter((p) => mates.includes(p));

    if (kind === A.SECOND_CHANCE) {
      // Em duplas, a Segunda Chance extra vai para o parceiro; senão, para quem menos ameaça.
      if (partners.length) return partners.slice().sort((a, b) => roundPoints(b) - roundPoints(a))[0];
      return allOthers.slice().sort((a, b) => threat(a) - threat(b))[0] || candidates[0];
    }

    if (kind === A.FREEZE) {
      // Congelar a si mesmo é ótimo quando há muito a perder.
      if (includesSelf && roundPoints(player) >= 20 && game.bustChance(player) >= 0.25) return player;
      // O mesmo vale para o parceiro: guardar os pontos dele é bom para a dupla.
      const saved = partners.find((p) => roundPoints(p) >= 20 && game.bustChance(p) >= 0.25);
      if (saved) return saved;
      if (!allOthers.length) return player;
      // Congela o rival que tem pouco na mesa, mas é forte na partida.
      return others
        .slice()
        .sort((a, b) => b.total - roundPoints(b) * 2 - (a.total - roundPoints(a) * 2))[0];
    }

    // Vira Três: força o rival mais exposto a arriscar.
    if (!allOthers.length) return player;
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
