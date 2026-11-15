/**
 * Fábrica de cartas para montar baralhos em ordem fixa nos testes.
 */
let nextId = 1;
const id = () => `t${nextId++}`;

const num = (value) => ({ id: id(), type: 'number', value });
const plus = (value) => ({ id: id(), type: 'modifier', op: 'add', value });
const times2 = () => ({ id: id(), type: 'modifier', op: 'multiply', value: 2 });
const freeze = () => ({ id: id(), type: 'action', action: 'freeze' });
const flipThree = () => ({ id: id(), type: 'action', action: 'flipThree' });
const secondChance = () => ({ id: id(), type: 'action', action: 'secondChance' });

module.exports = { num, plus, times2, freeze, flipThree, secondChance };
