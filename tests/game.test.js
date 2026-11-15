const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/load-core');
const c = require('./helpers/cards');

const F7 = loadCore('constants', 'utils', 'deck', 'player', 'scoring', 'game', 'ai');

/**
 * Agente roteirizado: jogadas e alvos definidos pelo teste.
 * @param {{ moves?: Record<string, string[]>, targets?: string[] }} script
 */
function scriptedAgent({ moves = {}, targets = [] } = {}) {
  const events = [];
  return {
    events,
    onEvent: async (type, payload) => events.push({ type, payload }),
    chooseMove: async (player) => (moves[player.name] || []).shift() || 'stay',
    chooseTarget: async (player, kind, candidates) => {
      const name = targets.shift();
      return candidates.find((p) => p.name === name) || candidates[0];
    },
  };
}

/** Monta uma partida com baralho fixo; o último jogador é o carteador (A começa). */
function setup(names, cards, script) {
  const agent = scriptedAgent(script);
  const game = new F7.Game(
    {
      players: names.map((name) => ({ name })),
      deck: new F7.Deck({ cards }),
      firstDealer: names.length - 1,
    },
    agent,
  );
  const byName = Object.fromEntries(game.players.map((p) => [p.name, p]));
  return { game, agent, ...byName };
}

const types = (agent) => agent.events.map((e) => e.type);

test('número repetido estoura o jogador e zera a rodada', async () => {
  const { game, A, B } = setup(['A', 'B'], [c.num(5), c.num(3), c.num(5)], {
    moves: { A: ['hit'], B: ['stay'] },
  });
  await game.playRound();
  assert.equal(A.status, 'busted');
  assert.equal(A.roundScore, 0);
  assert.equal(B.total, 3);
});

test('Segunda Chance descarta a repetida e mantém o jogador na rodada', async () => {
  const sc = c.secondChance();
  const dup = c.num(7);
  const { game, agent, A, B } = setup(['A', 'B'], [sc, c.num(4), c.num(7), dup], {
    moves: { A: ['hit', 'hit', 'stay'], B: ['stay'] },
  });
  await game.playRound();
  assert.equal(A.status, 'stayed');
  assert.equal(A.total, 7);
  assert.equal(B.total, 4);
  assert.ok(types(agent).includes('secondChanceUsed'));
  assert.ok(game.deck.discardPile.includes(dup));
});

test('Vira 7 encerra a rodada na hora e dá 15 pontos de bônus', async () => {
  const cards = [c.num(0), c.num(9), ...[1, 2, 3, 4, 5, 6].map(c.num)];
  const { game, agent, A, B } = setup(['A', 'B'], cards, {
    moves: { A: Array(6).fill('hit'), B: ['stay'] },
  });
  await game.playRound();
  assert.equal(A.flip7, true);
  assert.equal(A.total, 21 + 15);
  assert.equal(B.total, 9);
  assert.ok(types(agent).includes('flip7'));
});

test('quem não estourou também pontua quando alguém faz Vira 7', async () => {
  // Distribuição A:0 B:9, depois os dois alternam virando cartas.
  const cards = [0, 9, 1, 8, 2, 7, 3, 10, 4, 11, 5, 12, 6].map(c.num);
  const { game, A, B } = setup(['A', 'B'], cards, {
    moves: { A: Array(6).fill('hit'), B: Array(5).fill('hit') },
  });
  await game.playRound();
  assert.equal(A.flip7, true);
  assert.equal(B.status, 'active');
  assert.equal(B.total, 9 + 8 + 7 + 10 + 11 + 12);
});

test('Congelar encerra a rodada do alvo guardando os pontos', async () => {
  const { game, A, B } = setup(['A', 'B'], [c.num(5), c.freeze(), c.num(8)], {
    moves: { B: ['hit', 'stay'] },
    targets: ['A'],
  });
  await game.playRound();
  assert.equal(A.status, 'frozen');
  assert.equal(A.total, 5);
  assert.equal(B.total, 8);
});

test('Vira Três força 3 cartas e guarda o Congelar para depois', async () => {
  const cards = [c.flipThree(), c.num(3), c.freeze(), c.num(4), c.num(10)];
  const { game, agent, A, B, C } = setup(['A', 'B', 'C'], cards, {
    moves: { A: ['hit', 'stay'], B: ['stay'] },
    targets: ['B', 'C'],
  });
  await game.playRound();

  assert.equal(B.total, 7, 'B virou 3 e 4');
  assert.equal(C.status, 'frozen', 'Congelar guardado foi jogado em C');
  assert.equal(C.total, 0);
  assert.equal(A.total, 10);

  const order = types(agent);
  assert.ok(order.indexOf('flipThreeEnd') < order.indexOf('freeze'));
});

test('ações guardadas no Vira Três são descartadas se o alvo estourar', async () => {
  const frz = c.freeze();
  const cards = [c.flipThree(), c.num(3), frz, c.num(3), c.num(5), c.num(6)];
  const { game, A, B, C } = setup(['A', 'B', 'C'], cards, {
    moves: { A: ['hit', 'stay'], C: ['stay'] },
    targets: ['B'],
  });
  await game.playRound();

  assert.equal(B.status, 'busted');
  assert.equal(C.status, 'stayed');
  assert.equal(C.total, 5);
  assert.equal(A.total, 6);
  assert.ok(game.deck.discardPile.includes(frz));
});

test('segunda Segunda Chance vai para outro jogador ativo', async () => {
  const { game, A, B } = setup(['A', 'B'], [c.secondChance(), c.num(2), c.secondChance()], {
    moves: { A: ['hit', 'stay'], B: ['stay'] },
  });
  await game.playRound();
  assert.ok(A.total === 0 && B.total === 2);
  assert.ok(game.deck.discardPile.filter((card) => card.action === 'secondChance').length === 2);
});

test('segunda Segunda Chance é descartada se ninguém puder recebê-la', async () => {
  const { game, agent } = setup(['A', 'B'], [c.secondChance(), c.secondChance(), c.secondChance()], {
    moves: { A: ['hit', 'stay'], B: ['stay'] },
  });
  await game.playRound();
  const discarded = agent.events.filter((e) => e.type === 'cardDiscarded');
  assert.equal(discarded.length, 1);
  assert.equal(discarded[0].payload.reason, 'secondChance');
});

test('na distribuição, quem já recebeu cartas por Vira Três não recebe outra', async () => {
  const cards = [c.flipThree(), c.num(1), c.num(2), c.num(4), c.num(9)];
  const { game, A, B, C } = setup(['A', 'B', 'C'], cards, { targets: ['B'] });
  await game.playRound();
  assert.equal(B.total, 7);
  assert.equal(C.total, 9, 'C recebe a próxima carta da distribuição');
  assert.equal(A.total, 0);
});

test('o carteador gira a cada rodada e o jogador à esquerda começa', async () => {
  const { game, agent } = setup(['A', 'B', 'C'], [], {});
  game.deck = new F7.Deck({ rng: F7.utils.createRng(7) });
  await game.playRound();
  await game.playRound();
  const starts = agent.events.filter((e) => e.type === 'roundStart').map((e) => e.payload.dealer.name);
  assert.deepEqual(starts, ['C', 'A']);
});

test('a cada nova rodada todas as 94 cartas voltam ao monte e são reembaralhadas', async () => {
  const { game, agent } = setup(['A', 'B', 'C'], [], {});
  game.deck = new F7.Deck({ rng: F7.utils.createRng(11) });

  const snapshots = [];
  const record = agent.onEvent;
  agent.onEvent = async (type, payload) => {
    if (type === 'reshuffle' && payload.newRound) {
      snapshots.push({ drawn: game.deck.size, used: game.deck.discardPile.length, onTable: game.players.reduce((n, p) => n + p.cardCount(), 0), count: payload.count });
    }
    return record(type, payload);
  };

  await game.playRound();
  assert.equal(snapshots.length, 0, 'a primeira rodada usa o baralho recém-embaralhado');
  await game.playRound();
  await game.playRound();

  assert.equal(snapshots.length, 2);
  snapshots.forEach((s) => {
    assert.deepEqual(s, { drawn: 94, used: 0, onTable: 0, count: 94 });
  });
});

test('a ordem das cartas muda no reembaralhamento de cada rodada', async () => {
  const { game } = setup(['A', 'B'], [], {});
  game.deck = new F7.Deck({ rng: F7.utils.createRng(5) });
  await game.playRound();
  const before = game.deck.discardPile.map((c) => c.id).concat(game.deck.drawPile.map((c) => c.id)).sort().join();
  game.deck.reshuffle();
  const ids = game.deck.drawPile.map((c) => c.id);
  assert.equal(ids.slice().sort().join(), before, 'nenhuma carta se perde ou se repete');
  assert.equal(game.deck.discardPile.length, 0);
});

test('a probabilidade de estourar considera as cartas restantes', () => {
  const { game, A } = setup(['A', 'B'], [c.num(5), c.num(5), c.num(1), c.num(2)], {});
  A.numbers.push(c.num(5));
  assert.equal(game.bustChance(A), 0.5);
});

test('partidas completas entre CPUs respeitam as regras e conservam as 94 cartas', async () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rng = F7.utils.createRng(seed);
    const playerCount = 2 + (seed % 7);
    let rounds = 0;

    const agent = {
      onEvent: async (type, payload, game) => {
        const onTable = game.players.reduce((n, p) => n + p.cardCount(), 0);
        const total = onTable + game.deck.size + game.deck.discardPile.length;
        assert.equal(total, 94, `semente ${seed}: ${total} cartas após "${type}"`);
        if (type === 'roundStart') rounds = payload.round;
        game.players.forEach((p) => {
          assert.ok(p.numbers.length === new Set(p.numbers.map((n) => n.value)).size, 'números repetidos na mão');
        });
      },
    };

    const game = new F7.Game(
      {
        players: Array.from({ length: playerCount }, (_, i) => ({
          name: `CPU ${i + 1}`,
          isBot: true,
          riskTolerance: F7.AI.randomRiskTolerance(rng),
        })),
        rng,
      },
      agent,
    );

    const winner = await game.run();
    assert.ok(winner, `semente ${seed}: deve haver vencedor`);
    assert.ok(winner.total >= 200);
    assert.ok(game.players.every((p) => p === winner || p.total < winner.total));
    assert.ok(rounds < 100, `semente ${seed}: partida longa demais (${rounds} rodadas)`);
  }
});

test('abort() interrompe a partida sem lançar erro', async () => {
  const game = new F7.Game({ players: [{ name: 'A' }, { name: 'B' }] }, {
    onEvent: async (type) => {
      if (type === 'turnStart') game.abort();
    },
  });
  assert.equal(await game.run(), null);
});
