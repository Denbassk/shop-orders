// Собівартість в асортименті закупниці ВК: показ у списку, правка в картці товару, нова позиція.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../src/buyer/api');
const { DIRECTIONS } = require('../src/directions');

function envOf(products) {
  const calls = { log: [], set: [], add: [] };
  const env = {
    at: new Date('2026-10-27T10:00:00+02:00'),
    adm: {
      dirProducts: async () => products,
      setProduct: async (dir, id, patch) => { calls.set.push([dir, id, patch]); return true; },
      addProduct: async (row) => { calls.add.push(row); },
      adminLog: async (a, d) => { calls.log.push([a, d]); },
    },
  };
  return { env, calls };
}
const PRODUCTS = [
  { id: 'p1', name: 'Борщ', price: 48, cost: '22.85', status: 'active', category: 'Кулінарія', sort: 1 },
  { id: 'p2', name: 'Салат', price: 62, cost: '0.00', status: 'stop', category: 'Кулінарія', sort: 2 },
  { id: 'p3', name: 'Хліб', price: 30, cost: null, status: 'active', category: 'Випічка', sort: 3 },
];

test('products ВК: собівартість числом (null/0 -> 0), hasCost; інші напрямки без собівартості', async () => {
  const r = await B.buyerProducts('bakery', envOf(PRODUCTS).env);
  assert.equal(r.hasCost, true);
  assert.deepEqual(r.products.map((p) => [p.name, p.cost]), [['Борщ', 22.85], ['Салат', 0], ['Хліб', 0]]);
  const b = await B.buyerProducts('bread', envOf(PRODUCTS).env);
  assert.equal(b.hasCost, false);
  assert.ok(b.products.every((p) => p.cost === 0));
});

test('setProduct: собівартість з комою, журнал; разом із ціною - один запис; без змін - помилка', async () => {
  const { env, calls } = envOf(PRODUCTS);
  const r = await B.buyerSetProduct('bakery', { id: 'p2', cost: '27,5' }, env);
  assert.deepEqual(calls.set[0], ['bakery', 'p2', { cost: 27.5 }]);
  assert.deepEqual(r, { id: 'p2', cost: 27.5 });
  assert.equal(calls.log[0][1], DIRECTIONS.bakery.title + ' / Салат: собівартість 0 → 27.5');
  await B.buyerSetProduct('bakery', { id: 'p1', price: 50, cost: 20 }, env);
  assert.deepEqual(calls.set[1], ['bakery', 'p1', { price: 50, cost: 20 }]);
  assert.equal(calls.log[1][1], DIRECTIONS.bakery.title + ' / Борщ: ціна 48 → 50; собівартість 22.85 → 20');
  await assert.rejects(B.buyerSetProduct('bakery', { id: 'p1', cost: '22,85' }, env), { message: 'Змін немає' });
  assert.equal(calls.set.length, 2);
});

test('setProduct: невірна собівартість і чужий напрямок - помилка до запису', async () => {
  const { env, calls } = envOf(PRODUCTS);
  for (const bad of ['', 'abc', -1, '100001', null]) await assert.rejects(B.buyerSetProduct('bakery', { id: 'p1', cost: bad }, env), /Невірна собівартість: Борщ/, String(bad));
  await assert.rejects(B.buyerSetProduct('bread', { id: 'p1', cost: 5 }, env), { message: 'Собівартість - лише для випічки і кулінарії' });
  assert.equal(calls.set.length, 0);
  await B.buyerSetProduct('bakery', { id: 'p3', cost: 0 }, envOf(PRODUCTS).env).then(
    () => assert.fail('0 при 0 - без змін'), (e) => assert.equal(e.message, 'Змін немає'));
});

test('нова позиція ВК: собівартість зберігається і повертається; без неї або з нулем - noCost', async () => {
  const { env, calls } = envOf([]);
  const a = await B.buyerAddProduct('bakery', { name: 'Пиріг', price: '40', cost: '15,5', category: 'Випічка' }, env);
  assert.equal(calls.add[0].cost, 15.5);
  assert.deepEqual([a.cost, a.noCost], [15.5, false]);
  const b = await B.buyerAddProduct('bakery', { name: 'Тістечко', price: '40' }, env);
  assert.deepEqual([b.cost, b.noCost], [0, true]);
  const c = await B.buyerAddProduct('bakery', { name: 'Кекс', price: '40', cost: '0' }, env);
  assert.equal(c.noCost, true);
});

test('сторінка ВК: у картці товару поле собівартості, у списку - собівартість і мітка «без собівартості»; порожнє поле не міняє значення', () => {
  const H = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const s of ['id="pk"', 'Собівартість, грн (для списань)', 'S.products.hasCost', "body.cost = $('pk').value", "if ('cost' in r) p.cost = r.cost;", 'без собівартості</span>', "' · собівартість ' + money(p.cost)", 'id="npk"'])
    assert.ok(H.includes(s), s);
  assert.ok(H.includes("$('pk').value.trim() !== ''"), 'порожнє поле собівартості не відправляється');
  const rt = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'data.js'), 'utf8');
  assert.ok(rt.includes("select('id,barcode,name,price,category,availability,box,status,sort,cost')"));
});
