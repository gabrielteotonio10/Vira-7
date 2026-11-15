/**
 * Carrega os módulos do núcleo (scripts clássicos do navegador) dentro do Node.
 * Cada chamada cria um namespace `F7` novo, isolando os testes entre si.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CORE_DIR = path.resolve(__dirname, '..', '..', 'js', 'core');

function loadCore(...modules) {
  globalThis.F7 = {};
  for (const name of modules) {
    const file = path.join(CORE_DIR, `${name}.js`);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  return globalThis.F7;
}

module.exports = { loadCore };
