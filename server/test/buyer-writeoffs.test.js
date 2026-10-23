const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../src/buyer/writeoffs');
const ser = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 864e5 + 25569;
const ROWS = [
  ['a1', ser(2026, 10, 22, 10, 5), ser(2026, 10, 22), 'Амосова, 5А', '1', 'Випічка', '29', 'Сосиска в тісті', 3, 20, 60, 72, 'Іваненко', 's1'],
  ['a1', ser(2026, 10, 22, 10, 5), ser(2026, 10, 22), 'Амосова, 5А', '1', 'Кулінарія', '30', 'Окрошка', 1, 50, 50, 60, 'Іваненко', 's1'],
  ['b2', ser(2026, 10, 20, 9, 0), ser(2026, 10, 20), 'Бучми, 32', '7', 'Випічка', '29', 'Сосиска в тісті', 5, 20, 100, 120, 'Петренко', 's2'],
  ['c3', ser(2026, 9, 1, 9, 0), ser(2026, 9, 1), 'Бучми, 32', '7', 'Випічка', '29', 'Старе', 9, 20, 180, 216, 'Петренко', 's2'],
];
const BOOK = 'A'.repeat(30) + '1';
const fake = { TIMEOUT_MS: 1, a1q: (s, r) => s + '!' + r, loadCredentials: () => ({ client_email: 'sa@x' }),
  sheetsClient: () => ({ spreadsheets: {
    values: { get: async () => ({ data: { values: [['Юрособа', 'Таблиця'], ['Фемели', '=HYPERLINK("https://docs.google.com/spreadsheets/d/' + BOOK + '/edit";"відкрити")']] } }) },
    get: async () => ({ data: { properties: { title: 'Списания ВК · Фемели Маркет' } } }) } }),
  getValues: async () => ROWS };
const at = new Date('2026-10-22T09:00:00Z');
test('списання: ID таблиць зі змісту, назва юрособи', () => {
  assert.deepEqual(W.bookIds([['=HYPERLINK("https://docs.google.com/spreadsheets/d/' + BOOK + '/edit";"x")']], 'own'), [BOOK]);
  assert.equal(W.entityOf('Списания ВК · ЮА Маркет'), 'ЮА Маркет');
  assert.equal(W.dayOf('05.10.2026'), '2026-10-05');
});
test('списання: топи за 7 днів, фільтр категорії, лише bakery', async () => {
  delete process.env.WO_BOOKS; W._reset();
  const d = await W.stats('bakery', { days: 7 }, { google: fake, at });
  assert.equal(d.total.sum, 210); assert.equal(d.total.docs, 2); assert.equal(d.todayStores, 1);
  assert.equal(d.stores[0].name, 'Амосова, 5А · №1'); assert.equal(d.products[0].name, 'Сосиска в тісті'); assert.equal(d.products[0].sum, 160);
  assert.deepEqual(d.entities, ['Фемели Маркет']); assert.equal(d.days.length, 2);
  const k = await W.stats('bakery', { days: 7, cat: 'Кулінарія' }, { google: fake, at });
  assert.equal(k.total.sum, 50);
  await assert.rejects(W.stats('bread', {}, { google: fake, at }));
});
test('списання: підключено в runtime і на сторінці', () => {
  const rt = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  const H = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  assert.ok(rt.includes("writeoffs: (p) => require('../buyer/writeoffs').stats(dir, p || {})"));
  for (const s of ['wo: showWo', 'function woNav()', "call('writeoffs'", 'class="wogrid"']) assert.ok(H.includes(s), s);
});