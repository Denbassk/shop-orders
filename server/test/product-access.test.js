// Асортимент по точках (20.11.2026): products.access_mode ('all' | 'only' | 'except') + access_stores.
// Позицію «лише для точок» інші точки не бачать (products, «Змінити замовлення») і не можуть замовити (submit) - навіть зі старого екрана.
const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../src/rules');
const { apiSubmitOrder } = require('../src/api/submit');
const { apiProducts, apiCurrentOrder } = require('../src/api/read');
const { DIRECTIONS } = require('../src/directions');
const A = require('../src/admin/assortment');

test('productAllowed: all / only / except; без колонок (стара база) - усім', () => {
  const p = (mode, stores) => ({ access_mode: mode, access_stores: stores });
  assert.equal(R.productAllowed({}, 'a'), true);
  assert.equal(R.productAllowed(p('all', ['b']), 'a'), true);
  assert.equal(R.productAllowed(p('only', ['a', 'b']), 'a'), true);
  assert.equal(R.productAllowed(p('only', ['b']), 'a'), false);
  assert.equal(R.productAllowed(p('only', []), 'a'), false);
  assert.equal(R.productAllowed(p('except', ['a']), 'a'), false);
  assert.equal(R.productAllowed(p('except', ['b']), 'a'), true);
  assert.equal(R.productAllowed(p('except', null), 'a'), true);
});

// ---------- продавець ----------
const AT = new Date('2026-10-19T10:00:00+03:00');             // пн, овочі відкриті
const STORES = [
  { id: 'a', label: 'Точка А', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['veg'] },
  { id: 'b', label: 'Точка Б', code: '', edrpou: '', days: { veg: [], bakery: [] }, directions: ['veg'] },
];
const veg = (id, price, o = {}) => ({ dir: 'veg', id, barcode: '', name: id, price, category: null, availability: null, box: null, status: 'active', sort: 0, ...o });
const PRODUCTS = [veg('Морква', 20), veg('Гранат', 120, { access_mode: 'only', access_stores: ['a'] }), veg('Буряк', 18, { access_mode: 'except', access_stores: ['a'] })];

function env(over = {}) {
  const calls = { tx: [] };
  const data = {
    stores: async () => STORES,
    settings: async () => ({ app_version: 'v', test_mode: false, dirs_off: [], late_all: {} }),
    directions: async () => DIRECTIONS,
    products: async () => PRODUCTS,
    lateRows: async () => [],
    lateToday: async () => [],
    orderedToday: async () => [],
    hasOrderToday: async () => false,
    orderResult: async () => null,
    activeOrderLines: async () => over.lines || [],
    submitOrderTx: async (p) => { calls.tx.push(p); return { ok: true, duplicate: false, order_pk: 'x', is_addon: false, removed: 0, result: { ...p.result, removed: 0 } }; },
  };
  return { env: { at: AT, data, veg: { resolve: async (rows) => rows }, queueExport: () => {} }, calls };
}

test('products: «Гранат» (лише А) бачить тільки А; «Буряк» (усім, крім А) - тільки Б', async () => {
  const names = async (storeId) => (await apiProducts({ dir: 'veg', storeId }, env().env)).products.map((p) => p.name).sort();
  assert.deepEqual(await names('a'), ['Гранат', 'Морква']);
  assert.deepEqual(await names('b'), ['Буряк', 'Морква']);
});

test('submit: недозволена позиція не приймається (старий екран на телефоні), дозволена - так', async () => {
  const items = [{ id: 'Морква', qty: 30 }, { id: 'Гранат', qty: 5 }];
  const b = env();
  await apiSubmitOrder({ dir: 'veg', storeId: 'b', orderId: 'o-b', items }, b.env);
  assert.deepEqual(b.calls.tx[0].lines.map((l) => l.product_id), ['Морква']);
  const a = env();
  await apiSubmitOrder({ dir: 'veg', storeId: 'a', orderId: 'o-a', items }, a.env);
  assert.deepEqual(a.calls.tx[0].lines.map((l) => l.product_id), ['Морква', 'Гранат']);
});

test('«Змінити замовлення»: позиція, яку забрали в точки, йде в gone, не в кошик', async () => {
  const lines = [{ product_id: 'Гранат', name: 'Гранат', price: 120, qty: 2 }, { product_id: 'Морква', name: 'Морква', price: 20, qty: 30 }];
  const r = await apiCurrentOrder({ dir: 'veg', storeId: 'b' }, env({ lines }).env);
  assert.deepEqual(r.items.map((x) => x.id), ['Морква']);
  assert.deepEqual(r.gone.map((x) => x.name), ['Гранат']);
});

// ---------- пульт ----------
function adm(rows) {
  const st = { rows, set: [], log: [] };
  const e = { at: AT, log: () => {},
    data: { stores: async () => [...STORES, { id: 'c', label: 'Без овочів', directions: ['bread'] }] },
    adm: {
      dirProducts: async () => st.rows.map((r) => ({ ...r })),
      setProduct: async (dir, id, patch) => { st.set.push([dir, id, patch]); const r = st.rows.find((x) => x.id === id); if (r) Object.assign(r, patch); return !!r; },
      adminLog: async (a, d) => { st.log.push([a, d]); },
    } };
  return { e, st };
}
const P = () => [{ id: 'g', name: 'Гранат', price: 120, status: 'active', sort: 1 }, { id: 'm', name: 'Морква', price: 20, status: 'active', sort: 2, access_mode: 'except', access_stores: ['b'] }];

test('пульт assortment: доступ позиції і точки лише цього напрямку', async () => {
  const { e } = adm(P());
  const r = await A.admAssortment({ dir: 'veg' }, e);
  assert.deepEqual(r.products.map((p) => p.access), [{ mode: 'all', stores: [] }, { mode: 'except', stores: ['b'] }]);
  assert.deepEqual(r.stores, [{ id: 'a', label: 'Точка А' }, { id: 'b', label: 'Точка Б' }]);
});

test('пульт assortAccess: «лише для А» пишеться, журнал з назвами точок; повтор - «Змін немає»; all очищує список', async () => {
  const { e, st } = adm(P());
  const r = await A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'only', stores: ['a'] }, e);
  assert.equal(r.changed, 1);
  assert.deepEqual(st.set, [['veg', 'g', { access_mode: 'only', access_stores: ['a'] }]]);
  assert.match(st.log[0][1], /^Овочі і фрукти: доступ - лише точкам 1 ТТ \(Точка А\) - 1 поз\.: Гранат$/);
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'only', stores: ['a'] }, e), { message: 'Змін немає' });
  await A.admAssortAccess({ dir: 'veg', ids: ['g', 'm'], mode: 'all', stores: ['a'] }, e);
  assert.deepEqual(st.rows.map((x) => [x.access_mode, x.access_stores]), [['all', []], ['all', []]]);
});

test('пульт assortAccess: помилки - режим, порожній список, чужа/невідома точка, дубль', async () => {
  const { e, st } = adm(P());
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'x', stores: [] }, e), { message: 'Невірний режим доступу' });
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'only', stores: [] }, e), { message: 'Відмітьте хоча б одну точку' });
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'except', stores: ['c'] }, e), /Точку не знайдено/);
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: ['g'], mode: 'only', stores: ['a', 'a'] }, e), { message: 'Точка вказана двічі' });
  await assert.rejects(A.admAssortAccess({ dir: 'veg', ids: [], mode: 'all' }, e), { message: 'Оберіть позиції' });
  assert.equal(st.set.length, 0);
});

test('пульт: дію assortAccess підключено, екран «Доступ по точкам» зібрано в index.html', () => {
  const fs = require('node:fs'), path = require('node:path');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8').includes('assortAccess: (p) => assort.admAssortAccess(p, env())'));
  const html = require('../scripts/build-admin').build();
  for (const s of ['function openAccess(', "call('assortAccess'", 'Доступ по точкам', 'Только отмеченным точкам', 'Всем, кроме отмеченных', 'Не всем точкам', 'function asAccBadge(']) assert.ok(html.includes(s), s);
  const built = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'index.html'), 'utf8');
  assert.ok(built.includes('function openAccess('), 'public/admin/index.html перезібрано');
});
