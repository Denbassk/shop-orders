// Пульт: «Асортимент» напрямку - список, перегляд «було -> стало» і масова зміна цін (admin/assortment.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const A = require('../src/admin/assortment');

const AT = new Date('2026-11-03T11:00:00+02:00');
const NOT_FOUND = 'Товар не знайдено. Оновіть сторінку.';
const base = () => [
  { id: 'p1', barcode: '482001', name: 'Батон нарізний', price: 20, category: null, status: 'active', sort: 2 },
  { id: 'p2', barcode: '482002', name: 'Хліб Дарницький', price: 19.99, category: null, status: 'stop', sort: 1 },
  { id: 'p3', barcode: '', name: 'Багет', price: 33, category: null, status: 'active', sort: 3 },
  { id: 'p4', barcode: '', name: 'Без ціни', price: 0, category: null, status: 'active', sort: 4 },
];

function mk(rows = base(), o = {}) {
  const st = { rows, set: [], log: [] };
  const env = { at: AT, log: () => {}, adm: {
    dirProducts: async () => st.rows.map((r) => ({ ...r })),
    setProduct: async (dir, id, patch) => {
      st.set.push([dir, id, patch]);
      if (o.failOn && st.set.length === o.failOn) return false;
      const r = st.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); return true;
    },
    adminLog: async (a, d) => { st.log.push([a, d]); },
  } };
  return { env, st };
}

test('assortment: список напрямку за sort/назвою, ціна, стоп, ціна продавцю (markup), без замків для хліба', async () => {
  const { env } = mk();
  const r = await A.admAssortment({ dir: 'bread' }, env);
  assert.deepEqual([r.dir, r.title, r.markup, r.priceLocked], ['bread', DIRECTIONS.bread.title, 1, false]);
  assert.deepEqual(r.products.map((p) => p.id), ['p2', 'p1', 'p3', 'p4']);
  assert.deepEqual(r.products[0], { id: 'p2', name: 'Хліб Дарницький', barcode: '482002', price: 19.99, sellerPrice: 19.99, stop: true, category: '' });
});

test('assortment: овочі - ціни з прайсу постачальника, лише перегляд (priceLocked), ціна продавцю = ціна × 1.5', async () => {
  const { env } = mk([{ id: 'v1', barcode: '', name: 'Морква', price: 20, status: 'active', sort: 1 }]);
  const r = await A.admAssortment({ dir: 'veg' }, env);
  assert.equal(r.priceLocked, true); assert.match(r.lockedReason, /прайс/);
  assert.equal(r.markup, 1.5); assert.equal(r.products[0].sellerPrice, 30);
});

test('assortment: випічка/НБХЗ - правка дозволена; невідомий напрямок - помилка', async () => {
  const { env } = mk();
  assert.equal((await A.admAssortment({ dir: 'bakery' }, env)).priceLocked, false);
  assert.equal((await A.admAssortment({ dir: 'nbhz' }, env)).priceLocked, false);
  await assert.rejects(A.admAssortment({ dir: 'xx' }, env), { message: 'Невідомий напрямок: "xx"' });
  await assert.rejects(A.admAssortment({ dir: '__proto__' }, env), /Невідомий напрямок/);
});

test('priceBulkPreview: за вибраними id, було -> стало; нічого не пише; без ціни - у skipped', async () => {
  const { env, st } = mk();
  const r = await A.admPricePreview({ dir: 'bread', ids: ['p1', 'p3', 'p4'], mode: 'pct', value: '5' }, env);
  assert.deepEqual(r.rows, [{ id: 'p1', name: 'Батон нарізний', old: 20, new: 21 }, { id: 'p3', name: 'Багет', old: 33, new: 34.65 }]);
  assert.deepEqual(r.skipped, [{ id: 'p4', name: 'Без ціни', reason: 'без ціни' }]);
  assert.deepEqual([r.n, r.sumOld, r.sumNew], [2, 53, 55.65]);
  assert.equal(st.set.length, 0); assert.equal(st.log.length, 0);
});

test('priceBulkPreview: all=true - усі позиції напрямку (зі стопом теж); сума', async () => {
  const { env } = mk();
  const r = await A.admPricePreview({ dir: 'bread', all: true, mode: 'sum', value: '1' }, env);
  assert.deepEqual(r.rows.map((x) => [x.id, x.new]), [['p2', 20.99], ['p1', 21], ['p3', 34]]);
});

test('priceBulkPreview: порожній вибір, чужий id, дубль, надто багато - помилки; овочі закриті', async () => {
  const { env } = mk();
  const go = (p) => A.admPricePreview({ dir: 'bread', mode: 'pct', value: '5', ...p }, env);
  await assert.rejects(go({ ids: [] }), { message: 'Оберіть позиції' });
  await assert.rejects(go({}), { message: 'Оберіть позиції' });
  await assert.rejects(go({ ids: ['nope'] }), { message: NOT_FOUND });
  await assert.rejects(go({ ids: ['p1', 'p1'] }), { message: 'Позиція вказана двічі' });
  await assert.rejects(go({ ids: Array.from({ length: 501 }, (_, i) => 'x' + i) }), /не більше 500/);
  await assert.rejects(A.admPricePreview({ dir: 'veg', all: true, mode: 'pct', value: '5' }, mk().env), /прайс/);
  await assert.rejects(go({ ids: ['p1'], value: '0' }), { message: 'Змін немає' });
});

test('priceBulkApply: пише price кожного рядка, один запис у журнал з перелічком, повертає результат', async () => {
  const { env, st } = mk();
  const rows = [{ id: 'p1', old: 20 }, { id: 'p3', old: 33 }];
  const r = await A.admPriceApply({ dir: 'bread', mode: 'pct', value: '5', rows }, env);
  assert.deepEqual(st.set, [['bread', 'p1', { price: 21 }], ['bread', 'p3', { price: 34.65 }]]);
  assert.deepEqual(r, { changed: 2, rows: [{ id: 'p1', name: 'Батон нарізний', old: 20, new: 21 }, { id: 'p3', name: 'Багет', old: 33, new: 34.65 }] });
  assert.deepEqual(st.log, [['Змінено ціни', DIRECTIONS.bread.title + ': 2 поз., +5%; Батон нарізний 20 → 21; Багет 33 → 34.65']]);
});

test('priceBulkApply: ціна змінилась з моменту перегляду - помилка ДО запису, нічого не змінено', async () => {
  const { env, st } = mk();
  await assert.rejects(A.admPriceApply({ dir: 'bread', mode: 'pct', value: '5', rows: [{ id: 'p1', old: 20 }, { id: 'p3', old: 30 }] }, env),
    { message: 'Ціна «Багет» змінилась з моменту перегляду. Оновіть екран.' });
  assert.equal(st.set.length, 0); assert.equal(st.log.length, 0);
});

test('priceBulkApply: помилки до запису (порожньо, невідомий id, дубль, овочі, значення, межі)', async () => {
  const go = (dir, p) => A.admPriceApply({ dir, mode: 'pct', value: '5', ...p }, mk().env);
  await assert.rejects(go('bread', { rows: [] }), { message: 'Оберіть позиції' });
  await assert.rejects(go('bread', { rows: [{ id: 'nope', old: 1 }] }), { message: NOT_FOUND });
  await assert.rejects(go('bread', { rows: [{ id: 'p1', old: 20 }, { id: 'p1', old: 20 }] }), { message: 'Позиція вказана двічі' });
  await assert.rejects(go('veg', { rows: [{ id: 'p1', old: 20 }] }), /прайс/);
  await assert.rejects(go('bread', { rows: [{ id: 'p1', old: 20 }], value: 'abc' }), { message: 'Невірне значення' });
  await assert.rejects(go('bread', { rows: [{ id: 'p1', old: 20 }], mode: 'sum', value: '-25' }), { message: 'Ціна «Батон нарізний» вийде за межі 0…100000' });
  await assert.rejects(go('bread', { rows: [{ id: 'p1', old: 'x' }] }), /Невірна ціна/);
  await assert.rejects(go('xx', { rows: [{ id: 'p1', old: 20 }] }), /Невідомий напрямок/);
});

test('priceBulkApply: збій посеред запису - у журналі лише змінене, помилка нагору', async () => {
  const { env, st } = mk(base(), { failOn: 2 });
  await assert.rejects(A.admPriceApply({ dir: 'bread', mode: 'pct', value: '5', rows: [{ id: 'p1', old: 20 }, { id: 'p3', old: 33 }] }, env), { message: NOT_FOUND });
  assert.deepEqual(st.log, [['Змінено ціни', DIRECTIONS.bread.title + ': 1 поз., +5% (збій на «Багет», решту не записано); Батон нарізний 20 → 21']]);
});

test('priceBulkApply: у журналі більше 8 рядків - перші 8 і «…ще N»; запис не довший за 900 символів', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: 'q' + i, barcode: '', name: 'Дуже довга назва позиції номер ' + i, price: 10 + i, status: 'active', sort: i }));
  const { env, st } = mk(rows);
  await A.admPriceApply({ dir: 'bread', mode: 'sum', value: '1', rows: rows.map((r) => ({ id: r.id, old: r.price })) }, env);
  assert.equal(st.set.length, 30);
  assert.match(st.log[0][1], /^.*: 30 поз\., \+1 грн; /);
  assert.match(st.log[0][1], /…ще 22$/);
  assert.ok(st.log[0][1].length <= 900);
});

test('runtime: assortment / priceBulkPreview / priceBulkApply підключено до пульту', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  for (const s of ['assortment: (p) => assort.admAssortment(p, env())', 'priceBulkPreview: (p) => assort.admPricePreview(p, env())', 'priceBulkApply: (p) => assort.admPriceApply(p, env())']) assert.ok(src.includes(s), s);
});

test('закупниця: ціна/собівартість через спільний parseMoney - поведінка setProduct/addProduct не змінилась', async () => {
  const B = require('../src/buyer/api');
  const { env, st } = mk([{ id: 'b1', barcode: '', name: 'Борщ', price: 48, status: 'active', sort: 1, cost: 22.85 }]);
  env.adm.addProduct = async () => {}; env.queueExport = () => {};
  await B.buyerSetProduct('bakery', { id: 'b1', price: '50,5', cost: '20' }, env);
  assert.deepEqual(st.set[0], ['bakery', 'b1', { price: 50.5, cost: 20 }]);
  for (const bad of ['', 'abc', -1, '100001']) await assert.rejects(B.buyerSetProduct('bakery', { id: 'b1', price: bad }, env), /Невірна ціна: Борщ/, String(bad));
  for (const bad of ['', 'abc', -1, '100001', null]) await assert.rejects(B.buyerSetProduct('bakery', { id: 'b1', cost: bad }, env), /Невірна собівартість: Борщ/, String(bad));
  await assert.rejects(B.buyerAddProduct('bakery', { name: 'Новий', price: '100001' }, env), /Невірна ціна/);
});

test('пульт: пункт «Ассортимент и цены» у меню напрямка, екран assort з пошуком, вибором, перегляд «було -> стало» і підтвердження', () => {
  const html = require('../scripts/build-admin').build();
  const dir = html.slice(html.indexOf('function loadDir(k)'), html.indexOf('// ================= ГРАФИК ПО ТОЧКАМ'));
  assert.ok(dir.includes("item('Ассортимент и цены'"), 'пункт меню');
  assert.ok(dir.includes("go(\\'assort\\',{dir:\\'' + k + '\\'})"));
  const tail = html.slice(html.indexOf('shop-orders: ассортимент и цены'));
  for (const s of ['function loadAssort(', 'function previewAssort(', 'function askAssortApply(', "call('assortment'", "call('priceBulkPreview'", "call('priceBulkApply'",
    'confirmSheet({', 'На %', 'На сумму', 'Выбрать все найденные', 'Было', 'Стало', 'Посмотреть изменения', 'priceLocked', "S.screen === 'assort'"]) assert.ok(tail.includes(s), s);
  assert.ok(!tail.includes('google.script'));
});

test('priceBulkApply: шум float у збереженої ціни (24.740000000000002) не вважається «змінилась з моменту перегляду»', async () => {
  const rows = [{ id: 'f1', barcode: '', name: 'Хліб', price: 24.740000000000002, status: 'active', sort: 1 }];
  const { env, st } = mk(rows);
  const prev = await A.admPricePreview({ dir: 'bread', ids: ['f1'], mode: 'pct', value: '5' }, env);
  const r = await A.admPriceApply({ dir: 'bread', mode: 'pct', value: '5', rows: prev.rows.map((x) => ({ id: x.id, old: x.old })) }, env);
  assert.equal(r.changed, 1);
  assert.deepEqual(st.set, [['bread', 'f1', { price: 25.98 }]]);
});
