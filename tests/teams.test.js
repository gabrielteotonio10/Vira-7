const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/load-core');
const { num, freeze, flipThree, secondChance } = require('./helpers/cards');

const F7 = loadCore('constants', 'utils', 'deck', 'player', 'scoring', 'game', 'ai');

const bots = (count, extra = {}) =>
  Array.from({ length: count }, (_, i) => ({ name: `J${i}`, isBot: true, riskTolerance: 0.2 + 0.05 * i, ...extra }));

test('duplas ficam em lugares opostos e só existem com 4, 6 ou 8 jogadores', () => {
  assert.deepEqual(F7.Scoring.teamGroups(4), [[0, 2], [1, 3]]);
  assert.deepEqual(F7.Scoring.teamGroups(6), [[0, 3], [1, 4], [2, 5]]);
  for (const count of [2, 3, 5]) {
    assert.throws(() => new F7.Game({ players: bots(count), teams: true }, {}), RangeError);
  }
  const game = new F7.Game({ players: bots(4), teams: true }, {});
  assert.deepEqual(game.players.map((p) => p.team), [0, 1, 0, 1]);
});

test('partidas em duplas terminam pelo total da dupla e conservam as cartas', async () => {
  for (let seed = 1; seed <= 15; seed++) {
    const game = new F7.Game({ players: bots(4), teams: true, targetScore: 100, rng: F7.utils.createRng(seed), firstDealer: seed % 4 }, {});
    const winner = await game.run();
    const teams = game.teams;
    assert.ok(Math.max(...teams.map((t) => t.total)) >= 100, `semente ${seed}: terminou sem meta`);
    const cards = game.deck.totalAvailable + game.players.reduce((sum, p) => sum + p.cardCount(), 0);
    assert.equal(cards, 99);
    const winnerTeam = teams.find((t) => t.seats.includes(winner.id));
    assert.equal(winnerTeam.total, Math.max(...teams.map((t) => t.total)), 'quem fecha a partida é da dupla que tem mais pontos');
  }
});

test('baralho clássico tem 94 cartas, sem penalidades', () => {
  const game = new F7.Game({ players: bots(2), deckVersion: 1, rng: F7.utils.createRng(1) }, {});
  assert.equal(game.deck.totalAvailable, 94);
  assert.equal(game.deck.drawPile.some((card) => card.type === 'modifier' && card.value < 0), false);
});

test('a CPU nunca congela nem vira três no próprio parceiro', () => {
  const game = new F7.Game({ players: bots(4), teams: true, rng: F7.utils.createRng(2) }, {});
  const [a, b, c, d] = game.players;
  for (const kind of ['freeze', 'flipThree']) {
    const target = F7.AI.chooseTarget(c, kind, [a, b, c, d], game);
    assert.notEqual(target, a, `${kind}: a é parceira de c`);
  }
  assert.equal(F7.AI.chooseTarget(c, 'secondChance', [a, b, d], game), a, 'a Segunda Chance extra vai para o parceiro');
});

test('em duplas a CPU para quando a dupla já passou da meta', () => {
  const game = new F7.Game({ players: bots(4), teams: true, targetScore: 50, rng: F7.utils.createRng(3) }, {});
  const [a, , c] = game.players;
  c.numbers.push(num(3));
  a.total = 60;
  assert.equal(F7.AI.decideMove(c, game), 'stay');
});

test('Segunda Chance doada na distribuição não tira a carta inicial de ninguém', async () => {
  // A vira Vira Três em si, vira duas Segundas Chances (a 2ª vai para C) e um 5.
  const cards = [flipThree(), secondChance(), secondChance(), num(5), num(3), num(4), num(9), num(8), num(7), num(6)];
  const seen = { c: null };
  const agent = {
    chooseTarget: async (player, kind, candidates) => (kind === 'secondChance' ? candidates.find((p) => p.id === 2) : candidates[0]),
    chooseMove: async () => 'stay',
    onEvent: async (type, payload, game) => {
      if (type === 'roundStart' && !seen.c) seen.c = game.players[2];
    },
  };
  const players = ['A', 'B', 'C'].map((name) => ({ name, isBot: false }));
  const game = new F7.Game({ players, targetScore: 20, deck: new F7.Deck({ cards }), firstDealer: 2, rng: () => 0.5 }, agent);
  game.dealt = new Set();
  await game.emit('gameStart', { players: game.players, targetScore: 20 });
  game.round = 1;
  game.dealerIndex = 2;
  await game.dealInitialCards();
  const [, b, c] = game.players;
  assert.ok(b.numbers.length >= 1, 'B recebeu a carta inicial');
  assert.ok(c.secondChance, 'C ficou com a Segunda Chance doada');
  assert.ok(c.numbers.length >= 1, 'e ainda recebeu a carta inicial');
});
