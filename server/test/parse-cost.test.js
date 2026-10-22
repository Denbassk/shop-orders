// Собівартість випічки при імпорті: колонка за заголовком /собів|себест/i (WriteOff.gs woProducts_).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/import/parse');
const { DIRECTIONS } = require('../src/directions');

const HEAD = ['Статус', 'Категория', 'Штрихкод', 'Цена', 'Номенклатура', 'Наличие', 'Себестоимость'];

test('costIdxOf: перша колонка з собів/себест; немає -> -1', () => {
  assert.equal(P.costIdxOf(HEAD), 6);
  assert.equal(P.costIdxOf(['A', 'Собівартість, грн', 'Себестоимость']), 1);
  assert.equal(P.costIdxOf(['Статус', 'Цена']), -1);
  assert.equal(P.costIdxOf(null), -1);
});

test('parseSheetProducts bakery з заголовком: cost з коми, порожня -> 0, «стоп» теж з cost', () => {
  const rows = [
    ['', 'Хліб', '482001', '25,50', 'Булка', 'є', '12,3'],
    ['стоп', 'Хліб', '482002', '30', 'Пиріг', '', '15'],
    ['', 'Хліб', '482003', '20', 'Батон', '', ''],
  ];
  const out = P.parseSheetProducts('bakery', DIRECTIONS.bakery, rows, [], HEAD);
  const by = Object.fromEntries(out.map((p) => [p.name, p]));
  assert.equal(by['Булка'].cost, 12.3);
  assert.equal(by['Пиріг'].cost, 15);
  assert.equal(by['Пиріг'].status, 'stop');
  assert.equal(by['Батон'].cost, 0);
});

test('parseSheetProducts без заголовка або не випічка: поля cost немає (старі тести не змінюються)', () => {
  const rows = [['', 'Хліб', '482001', '25', 'Булка', 'є', '12']];
  assert.equal('cost' in P.parseSheetProducts('bakery', DIRECTIONS.bakery, rows)[0], false);
  assert.equal('cost' in P.parseSheetProducts('bread', DIRECTIONS.bread, rows, [], HEAD)[0], false);
});