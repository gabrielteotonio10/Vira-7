const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/load-core');
const { num, plus, times2 } = require('./helpers/cards');

const F7 = loadCore('constants', 'utils', 'scoring');
const { compute, checkVictory, standings } = F7.Scoring;

test('soma simples das cartas numéricas', () => {
  const result = compute({ numbers: [num(8), num(6), num(3)], modifiers: [] });
  assert.equal(result.total, 17);
});

test('exemplo oficial: (8 + 6 + 3) x2 + 4 = 38', () => {
  const result = compute({ numbers: [num(8), num(6), num(3)], modifiers: [times2(), plus(4)] });
  assert.equal(result.numbersSum, 17);
  assert.equal(result.numbersTotal, 34);
  assert.equal(result.modifiersSum, 4);
  assert.equal(result.total, 38);
});

test('x2 não dobra os modificadores nem o bônus do Vira 7', () => {
  const numbers = [0, 1, 2, 3, 4, 5, 6].map(num);
  const result = compute({ numbers, modifiers: [times2(), plus(10)], flip7: true });
  assert.equal(result.total, 21 * 2 + 10 + 15);
});

test('somente modificadores também pontuam', () => {
  assert.equal(compute({ numbers: [], modifiers: [plus(6), plus(2)] }).total, 8);
});

test('quem estoura marca zero', () => {
  const result = compute({ numbers: [num(12)], modifiers: [plus(10)], status: 'busted' });
  assert.equal(result.total, 0);
  assert.equal(result.busted, true);
});

test('a partida não termina abaixo da meta', () => {
  const players = [{ id: 0, total: 150 }, { id: 1, total: 199 }];
  assert.equal(checkVictory(players, 200).over, false);
});

test('vence quem atingir a meta com a maior pontuação', () => {
  const players = [{ id: 0, total: 210 }, { id: 1, total: 245 }];
  const result = checkVictory(players, 200);
  assert.equal(result.over, true);
  assert.equal(result.winner, players[1]);
});

test('empate na liderança acima da meta exige outra rodada', () => {
  const players = [{ id: 0, total: 220 }, { id: 1, total: 220 }, { id: 2, total: 90 }];
  const result = checkVictory(players, 200);
  assert.equal(result.over, false);
  assert.equal(result.tie, true);
  assert.equal(result.leaders.length, 2);
});

test('classificação em ordem decrescente', () => {
  const players = [{ id: 0, total: 10 }, { id: 1, total: 30 }, { id: 2, total: 20 }];
  assert.deepEqual(standings(players).map((p) => p.id), [1, 2, 0]);
});
