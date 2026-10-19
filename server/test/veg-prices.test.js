const test = require('node:test');
const assert = require('node:assert/strict');
const { createVegPrices } = require('../src/vegPrices');

const row = (name, price) => ({ dir: 'veg', id: name, barcode: '', name, price, category: null, availability: null, box: null, status: 'active', sort: 0 });
// прайс-дзеркало: пари "назва | число" у довільних комірках
const SHEET = [['Прайс', ''], ['Картопля', 12.5, 'Морква', '8,40'], ['Буряк', 7]];

function make(over = {}) {
  const calls = { read: 0, saved: [] };
  let clock = 1_000_000;
  const deps = {
    readPriceSheet: async () => { calls.read++; return SHEET; },
    savePrices: async (changes) => { calls.saved.push(changes); },
    now: () => clock,
    ttlMs: 600000, timeoutMs: 50, failTtlMs: 60000,
    log: () => {},
    ...over,
  };
  return { veg: createVegPrices(deps), calls, advance: (ms) => { clock += ms; } };
}

test('гілка 1: Google відповів - беремо ціни з дзеркала, оновлюємо products.price лише змінені', async () => {
  const { veg, calls } = make();
  const out = await veg.resolve([row('Картопля', 10), row('Морква', 8.4), row('Буряк', 5)]);
  assert.deepEqual(out.map((r) => [r.name, r.price]), [['Картопля', 12.5], ['Морква', 8.4], ['Буряк', 7]]);
  assert.equal(calls.read, 1);
  assert.deepEqual(calls.saved, [[{ id: 'Картопля', name: 'Картопля', price: 12.5 }, { id: 'Буряк', name: 'Буряк', price: 7 }]],
    'Морква не змінилась - не пишемо');
});

test('овоч, якого нема в прайсі, не віддається, навіть якщо в базі стара ціна', async () => {
  const { veg } = make();
  const out = await veg.resolve([row('Картопля', 10), row('Диня', 99)]);
  assert.deepEqual(out.map((r) => r.name), ['Картопля']);
});

test('гілка 2: кеш процесу 10 хв - другий виклик Google не чіпає, після TTL читає знову', async () => {
  const { veg, calls, advance } = make();
  await veg.resolve([row('Картопля', 1)]);
  advance(9 * 60000);
  const again = await veg.resolve([row('Картопля', 1)]);
  assert.equal(calls.read, 1);
  assert.equal(again[0].price, 12.5);
  advance(60001);
  await veg.resolve([row('Картопля', 1)]);
  assert.equal(calls.read, 2);
});

test('паралельні запити ділять одне читання', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { veg, calls } = make({ readPriceSheet: async () => { calls.read++; await gate; return SHEET; }, timeoutMs: 1000 });
  const p = [veg.resolve([row('Картопля', 1)]), veg.resolve([row('Морква', 1)]), veg.resolve([row('Буряк', 1)])];
  release();
  await Promise.all(p);
  assert.equal(calls.read, 1);
});

test('гілка 3: Google не відповів за timeout - ціни з бази; без ціни в базі - приховано', async () => {
  const { veg, calls } = make({ readPriceSheet: () => new Promise(() => {}) });      // зависло
  const t0 = Date.now();
  const out = await veg.resolve([row('Картопля', 11), row('Морква', 0), row('Буряк', 6)]);
  assert.ok(Date.now() - t0 < 500);
  assert.deepEqual(out.map((r) => [r.name, r.price]), [['Картопля', 11], ['Буряк', 6]]);
  assert.deepEqual(calls.saved, [], 'при збої нічого не пишемо в базу');
});

test('гілка 3б: Google кинув помилку - те саме; наступні запити одразу з бази, не чекають знову', async () => {
  let n = 0;
  const { veg, advance } = make({ readPriceSheet: async () => { n++; throw new Error('503'); } });
  await veg.resolve([row('Картопля', 11)]);
  const t0 = Date.now();
  const out = await veg.resolve([row('Картопля', 11)]);
  assert.equal(out[0].price, 11);
  assert.equal(n, 1, 'негативний кеш: повторно не ходимо');
  advance(60001);
  await veg.resolve([row('Картопля', 11)]);
  assert.equal(n, 2);
  assert.ok(Date.now() - t0 < 500);
});

test('порожній/неповний прайс (IMPORTRANGE ще вантажиться) - як збій, ціни з бази', async () => {
  const { veg, calls } = make({ readPriceSheet: async () => [['Прайс', ''], ['x', '']] });
  const out = await veg.resolve([row('Картопля', 11)]);
  assert.equal(out[0].price, 11);
  assert.deepEqual(calls.saved, []);
});

test('збій запису в базу не ламає відповідь', async () => {
  const { veg } = make({ savePrices: async () => { throw new Error('db down'); } });
  const out = await veg.resolve([row('Картопля', 1)]);
  assert.equal(out[0].price, 12.5);
});
