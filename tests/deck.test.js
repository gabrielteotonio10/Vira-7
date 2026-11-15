const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore } = require('./helpers/load-core');
const { num, freeze } = require('./helpers/cards');

const F7 = loadCore('constants', 'utils', 'deck');

test('o baralho tem as 94 cartas oficiais', () => {
  const cards = F7.Deck.createCards();
  assert.equal(cards.length, F7.RULES.DECK_SIZE);
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, 'ids devem ser únicos');
});

test('cada número N aparece N vezes, com uma carta 0 e uma carta 1', () => {
  const cards = F7.Deck.createCards().filter((c) => c.type === 'number');
  assert.equal(cards.length, 79);
  for (let value = 0; value <= 12; value++) {
    const expected = value === 0 ? 1 : value;
    assert.equal(cards.filter((c) => c.value === value).length, expected, `cartas ${value}`);
  }
});

test('modificadores: +2, +4, +6, +8, +10 e x2', () => {
  const mods = F7.Deck.createCards().filter((c) => c.type === 'modifier');
  assert.deepEqual(
    mods.filter((c) => c.op === 'add').map((c) => c.value),
    [2, 4, 6, 8, 10],
  );
  assert.equal(mods.filter((c) => c.op === 'multiply').length, 1);
});

test('três cópias de cada carta de ação', () => {
  const actions = F7.Deck.createCards().filter((c) => c.type === 'action');
  for (const action of ['freeze', 'flipThree', 'secondChance']) {
    assert.equal(actions.filter((c) => c.action === action).length, 3, action);
  }
});

test('baralho em ordem fixa compra da primeira para a última carta', () => {
  const a = num(1);
  const b = num(2);
  const deck = new F7.Deck({ cards: [a, b] });
  assert.equal(deck.draw(), a);
  assert.equal(deck.draw(), b);
  assert.equal(deck.draw(), null);
});

test('peek mostra as próximas cartas sem removê-las', () => {
  const cards = [num(3), num(4), num(5)];
  const deck = new F7.Deck({ cards });
  assert.deepEqual(deck.peek(2), [cards[0], cards[1]]);
  assert.equal(deck.size, 3);
});

test('reembaralhar devolve o descarte para o monte', () => {
  const deck = new F7.Deck({ cards: [num(1)], rng: F7.utils.createRng(1) });
  deck.discard(deck.draw(), [num(2), freeze()]);
  assert.equal(deck.needsReshuffle(), true);
  assert.equal(deck.reshuffle(), 3);
  assert.equal(deck.size, 3);
  assert.equal(deck.discardPile.length, 0);
});

test('countRemaining usa o descarte quando o monte está vazio', () => {
  const deck = new F7.Deck({ cards: [] });
  deck.discard(num(7), num(7), num(2));
  assert.deepEqual(deck.countRemaining((c) => c.value === 7), { matches: 2, total: 3 });
});

test('embaralhamento com semente é reproduzível', () => {
  const ids = (seed) => new F7.Deck({ rng: F7.utils.createRng(seed) }).drawPile.map((c) => c.id);
  assert.deepEqual(ids(42), ids(42));
  assert.notDeepEqual(ids(42), ids(43));
});
