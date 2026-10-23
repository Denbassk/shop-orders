// Закупниця: «+ Нова позиція» в асортименті (buyerAddProduct) - валідація, id, дублі, поля випічки, sort, журнал.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buyerAddProduct } = require('../src/buyer/api');

const BASE = [
  { id: '4820000000011', barcode: '4820000000011', name: 'Круасан класичний', price: 30, category: 'Випічка', status: 'active', sort: 0 },
  { id: 'булка гарна', barcode: '', name: 'Булка Гарна', price: 20, category: 'Випічка', status: 'active', sort: 1 },
  { id: 'стоп позиція', barcode: '', name: 'Стоп позиція', price: 5, category: 'Інше', status: 'stop', sort: 1000 },
];
function mkEnv(list = BASE) {
  const st = { rows: list.map((x) => ({ ...x })), added: [], log: [] };
  return { st, env: { at: new Date('2026-10-23T10:00:00+03:00'),
    adm: { dirProducts: async () => st.rows, addProduct: async (r) => { st.added.push(r); st.rows.push(r); }, adminLog: async (a, d) => { st.log.push([a, d]); } } } };
}

test('випічка: id за ключем назви, категорія/собівартість/наявність, sort = після останньої активної (стоп 1000+ не рахується), журнал', async () => {
  const { env, st } = mkEnv();
  const r = await buyerAddProduct('bakery', { name: '  Пончик   з  кремом ', price: '24,5', category: ' Солодке ', cost: '12.3', availability: 'до 12:00' }, env);
  assert.deepEqual(st.added[0], { dir: 'bakery', id: 'пончик з кремом', barcode: '', name: 'Пончик з кремом', price: 24.5, status: 'active',
    category: 'Солодке', availability: 'до 12:00', cost: 12.3, sort: 2 });
  assert.deepEqual([r.id, r.price, r.noCost, r.sort], ['пончик з кремом', 24.5, false, 2]);
  assert.equal(st.log[0][0], 'Додано в асортимент');
  assert.match(st.log[0][1], /Пончик з кремом: 24.5 грн, Солодке, собівартість 12.3/);
});

test('штрихкод стає id; без собівартості на випічці - noCost (продавці не побачать у списаннях); не-випічка не отримує категорію і собівартість', async () => {
  const { env, st } = mkEnv();
  const r = await buyerAddProduct('bakery', { name: 'Еклер', price: 40, barcode: '4820000000099' }, env);
  assert.equal(st.added[0].id, '4820000000099');
  assert.equal(r.noCost, true);
  assert.ok(!('cost' in st.added[0]));
  const b = mkEnv([]);
  await buyerAddProduct('bread', { name: 'Батон', price: 25, box: '12', category: 'ігнор', cost: '1' }, b.env);
  assert.deepEqual(b.st.added[0], { dir: 'bread', id: 'батон', barcode: '', name: 'Батон', price: 25, status: 'active', box: '12', sort: 1 });
  await buyerAddProduct('veg', { name: 'Огірок', price: 60 }, b.env);
  assert.ok(!('box' in b.st.added[1]) && !('category' in b.st.added[1]));
});

test('валідація: назва, ціна, штрихкод, собівартість; нічого не пишеться', async () => {
  const { env, st } = mkEnv();
  const bad = (p, re, dir = 'bakery') => assert.rejects(buyerAddProduct(dir, p, env), re);
  await bad({ price: 1 }, /Вкажіть назву/);
  await bad({ name: 'x'.repeat(121), price: 1 }, /задовга/);
  await bad({ name: 'Ок' }, /Невірна ціна/);
  await bad({ name: 'Ок', price: '' }, /Невірна ціна/);
  await bad({ name: 'Ок', price: 'abc' }, /Невірна ціна/);
  await bad({ name: 'Ок', price: -1 }, /Невірна ціна/);
  await bad({ name: 'Ок', price: 1, barcode: '12ab' }, /Штрихкод/);
  await bad({ name: 'Ок', price: 1, cost: 'x' }, /собівартість/);
  await bad({ name: 'Ок', price: 1 }, /Невідомий напрямок/, 'nope');
  assert.equal(st.added.length, 0);
  await buyerAddProduct('bakery', { name: 'Ок', price: 0 }, env);
});

test('дубль: той самий штрихкод або назва (регістр і пробіли не важливі), стоп-позиція підказує зняти стоп', async () => {
  const { env, st } = mkEnv();
  await assert.rejects(buyerAddProduct('bakery', { name: 'Інша назва', price: 1, barcode: '4820000000011' }, env), /вже є: Круасан класичний/);
  await assert.rejects(buyerAddProduct('bakery', { name: ' булка   ГАРНА ', price: 1 }, env), /вже є: Булка Гарна/);
  await assert.rejects(buyerAddProduct('bakery', { name: 'стоп позиція', price: 1 }, env), /зніміть стоп/);
  assert.equal(st.added.length, 0);
});
