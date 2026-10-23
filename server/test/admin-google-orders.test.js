// Пульт: хто замовив сьогодні за сирими листами Google (до переключення замовлення пише Apps Script, у базі їх нема). Лише читання.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleOrders } = require('../src/admin/googleOrders');
const { admToday, admDirStores } = require('../src/admin/read');

const AT = new Date('2026-10-22T16:00:00+03:00');
const serial = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const TODAY = serial(2026, 10, 22), YDAY = serial(2026, 10, 21);
const hm = (h, m) => (h * 60 + m) / 1440;

const st = (id, label, over = {}) => ({ id, label, address: 'м. Харків вул. ' + label, addrBread: 'м. Харків вул. ' + label, addrBakery: 'м. Харків вул. ' + label,
  addrVeg: 'м. Харків вул. ' + label, addrNbhz: '', code: id, route: '', zone: '', edrpou: '', directions: ['bread', 'bakery', 'veg', 'nbhz'], days: { veg: [], bakery: [] }, ...over });
const STORES = [st('a', 'Амосова, 5А'), st('b', 'Байрона, 156'), st('c', 'Зубенка, 23'), st('n', 'Роганська, 130/4', { addrNbhz: 'Роганская130' }), st('q', 'Нескорених, 33', { addrNbhz: 'Нескореных 33' })];

// сирі листи: bread/nbhz [дата, маршрут, коротка адреса, штрихкод, назва, ціна, к-ть]; bakery [дата, час, адреса, зона, штрихкод, назва, ціна, к-ть]; veg [дата, час, адреса, назва, ціна, к-ть, сума]
const SHEETS = {
  _Сырые_Заказы: [['Дата'], [TODAY, 'M', 'Амосова, 5а', '1', 'Хліб', 20, 5], [TODAY, 'M', 'Амосова, 5а', '2', 'Батон', 20, 3], [YDAY, 'M', 'Байрона, 156', '1', 'Хліб', 20, 9]],
  _Сырые_Заказы_ВК: [['Дата'], [TODAY, hm(9, 5), 'м. Харків вул. Байрона, 156', 'Z', '1', 'Пампушка', 10, 2], [TODAY, hm(10, 40), 'м. Харків вул. Байрона, 156', 'Z', '2', 'Піца', 10, 1.5]],
  _Сырые_Заказы_Овочі: [['Дата'], [TODAY, hm(12, 0), 'м. Харків вул. Зубенка, 23', 'Картопля', 14, 20, 280], [TODAY, hm(12, 0), 'вул. Невідома, 1', 'Морква', 18, 1, 18]],
  _Сырые_Заказы_НБХЗ: [['Дата'], [TODAY, 'Рогань', 'Роганская130', '', 'Батон', 0, 4], [TODAY, 'Рогань', 'Нескорених 33', '', 'Хліб', 0, 6]],
};
const DIRS = { bread: { rawSheet: '_Сырые_Заказы', spreadsheetId: 'sb' }, bakery: { rawSheet: '_Сырые_Заказы_ВК', spreadsheetId: 'sk' },
  veg: { rawSheet: '_Сырые_Заказы_Овочі', spreadsheetId: 'sv' }, nbhz: { rawSheet: '_Сырые_Заказы_НБХЗ', spreadsheetId: 'sn' } };

function make(over = {}) {
  const calls = [];
  let now = AT.getTime();
  const go = createGoogleOrders({
    directions: DIRS, now: () => now, ttlMs: 60000,
    getValues: async (id, range) => { calls.push([id, range]); if (over.fail) throw new Error('Google лежить'); const name = range.match(/^'(.*)'!/)[1]; return SHEETS[name]; },
    a1q: (s, r) => `'${s}'!${r}`,
  });
  return { go, calls, tick: (ms) => { now += ms; } };
}

test('хто замовив: рядки за сьогодні, точка за адресою (коротка і повна), n/qty/час останнього рядка; вчорашні і невідомі адреси - ні', async () => {
  const { go } = make();
  const r = await go.byDir('2026-10-22', STORES);
  assert.deepEqual(Object.fromEntries(r.bread), { a: { n: 2, qty: 8, time: '' } });
  assert.deepEqual(Object.fromEntries(r.bakery), { b: { n: 2, qty: 3.5, time: '10:40' } });
  assert.deepEqual(Object.fromEntries(r.veg), { c: { n: 1, qty: 20, time: '12:00' } });
  assert.deepEqual(Object.fromEntries(r.nbhz), { n: { n: 1, qty: 4, time: '' }, q: { n: 1, qty: 6, time: '' } }, 'НБХЗ: адреса заводу = addrNbhz точно або нечітко (и/і/ы)');
  assert.deepEqual(r.unmatched.veg, ['вул. Невідома, 1']);
});

test('кеш 60 с: другий виклик не читає Google; після 60 с - читає знову', async () => {
  const { go, calls, tick } = make();
  await go.byDir('2026-10-22', STORES);
  const n = calls.length;
  await go.byDir('2026-10-22', STORES);
  assert.equal(calls.length, n);
  tick(61000);
  await go.byDir('2026-10-22', STORES);
  assert.equal(calls.length, 2 * n);
});

test('збій Google: порожній результат і пояснення, виняток не летить (пульт працює з бази)', async () => {
  const { go } = make({ fail: true });
  const r = await go.byDir('2026-10-22', STORES);
  assert.equal(r.bread.size, 0);
  assert.match(r.error, /Google лежить/);
});

test('admToday: «замовила» = база АБО лист Google (одна точка двічі не рахується)', async () => {
  const DIRSCFG = { bread: { key: 'bread', title: 'Хліб', color: '#a52', deadline: '16:00' } };
  const stores = STORES.slice(0, 3);
  const env = { at: AT, data: { stores: async () => stores, settings: async () => ({}), directions: async () => DIRSCFG,
    orderedToday: async () => ({ bread: new Set(['a']) }) },
  gOrders: async () => ({ bread: new Map([['a', { n: 2, qty: 8, time: '' }], ['b', { n: 1, qty: 1, time: '' }]]) }) };
  const r = await admToday(env);
  assert.deepEqual([r.dirs[0].total, r.dirs[0].ordered, r.dirs[0].waiting], [3, 2, ['Зубенка, 23']]);
});

test('admDirStores: точки з листа Google - у «Зроблено» з n/qty/часом з листа; база має пріоритет', async () => {
  const DIRSCFG = { bakery: { key: 'bakery', title: 'ВК', color: '#e65', deadline: '13:00', unit: 'шт' } };
  const env = { at: AT, data: { stores: async () => STORES.slice(0, 3), settings: async () => ({}), directions: async () => DIRSCFG, orderedToday: async () => ({}) },
    adm: { dayOrders: async () => [{ store_id: 'a', created_at: '2026-10-22T08:00:00+03:00', lines: [{ qty: 4 }] }] },
    gOrders: async () => ({ bakery: new Map([['a', { n: 9, qty: 9, time: '09:00' }], ['b', { n: 2, qty: 3.5, time: '10:40' }]]) }) };
  const r = await admDirStores({ dir: 'bakery' }, env);
  const by = Object.fromEntries(r.done.map((x) => [x.id, x]));
  assert.deepEqual([by.a.n, by.a.qty, by.a.time], [1, 4, '08:00'], 'база важливіша');
  assert.deepEqual([by.b.n, by.b.qty, by.b.time], [2, 3.5, '10:40']);
  assert.deepEqual(r.wait.map((x) => x.id), ['c']);
});
