const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Carrega o motor de idiomas e os dois dicionários, como o navegador faz. */
function load() {
  globalThis.F7 = {};
  for (const file of ['app/i18n.js', 'i18n/en.js', 'i18n/es.js']) {
    const full = path.resolve(__dirname, '..', 'js', file);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
  }
  return globalThis.F7.i18n;
}

test('em português nada muda', () => {
  const i18n = load();
  assert.equal(i18n.lang, 'pt');
  assert.equal(i18n.t('Estourou!'), 'Estourou!');
});

test('frases exatas são traduzidas e os espaços das pontas ficam', () => {
  const i18n = load();
  i18n.set('en', { reload: false });
  assert.equal(i18n.t('Estourou!'), 'Bust!');
  assert.equal(i18n.t('  Virar '), '  Flip ');
  i18n.set('es', { reload: false });
  assert.equal(i18n.t('Parar'), 'Plantarme');
});

test('frases com nomes e números usam os padrões', () => {
  const i18n = load();
  i18n.set('en', { reload: false });
  assert.equal(i18n.t('Rodada 3'), 'Round 3');
  assert.equal(i18n.t('Ana entrou na sala.'), 'Ana joined the room.');
  assert.equal(i18n.t('E aí, Gabriel!'), 'Hey, Gabriel!');
  i18n.set('es', { reload: false });
  assert.equal(i18n.t('Vez de Rita'), 'Turno de Rita');
  assert.equal(i18n.t('Continua em 5s'), 'Continúa en 5s');
});

test('o histórico da mesa (HTML) é traduzido sem perder as etiquetas', () => {
  const i18n = load();
  i18n.set('en', { reload: false });
  const who = '<b style="color:#e5484d">Ana</b>';
  assert.equal(
    i18n.t(`${who} <b style="color:var(--danger)">estourou</b> com o 7 repetido`),
    `${who} <b style="color:var(--danger)">busted</b> with a repeated 7`,
  );
  assert.equal(i18n.t(`${who} parou com <b>18</b> pontos`), `${who} stayed with <b>18</b> points`);
  assert.equal(
    i18n.t(`${who} virou <b>penalidade −2</b>`),
    `${who} flipped <b>penalty −2</b>`,
    'o nome da carta dentro de <b> também é traduzido',
  );
});

test('frase sem tradução continua em português', () => {
  const i18n = load();
  i18n.set('en', { reload: false });
  assert.equal(i18n.t('Uma frase que ninguém traduziu'), 'Uma frase que ninguém traduziu');
});

test('os dois dicionários têm as mesmas frases', () => {
  const dictionaries = {};
  globalThis.F7 = { i18n: { add: (lang, dict) => { dictionaries[lang] = dict; } } };
  for (const lang of ['en', 'es']) {
    const full = path.resolve(__dirname, '..', 'js', 'i18n', `${lang}.js`);
    vm.runInThisContext(fs.readFileSync(full, 'utf8'), { filename: full });
  }
  assert.deepEqual(Object.keys(dictionaries.en.exact), Object.keys(dictionaries.es.exact));
  assert.equal(dictionaries.en.patterns.length, dictionaries.es.patterns.length);
  assert.ok(Object.keys(dictionaries.en.exact).length > 400);
});

test('substituição de {nome} em t()', () => {
  const i18n = load();
  assert.equal(i18n.t('Olá {name}!', { name: 'Ana' }), 'Olá Ana!');
});
