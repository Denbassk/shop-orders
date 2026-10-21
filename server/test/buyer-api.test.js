const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../src/buyer/api');
const { DIRECTIONS } = require('../src/directions');

function envOf(o = {}) {
  const calls = { log: [], q: [], cancel: [], set: [] };
  const env = {
    at: new Date('2026-10-19T10:00:00+03:00'),
    data: { stores: async () => [{ id: 's1', label: 'Б-точка' }, { id: 's2', label: 'А-точка' }] },
    adm: {
      dayOrders: async () => o.orders || [],
      dayStoreLines: async () => o.lines || [],
      cancelDay: async (...a) => { calls.cancel.push(a); return o.removed || 0; },
      adminLog: async (a, d) => { calls.log.push([a, d]); },
      dirProducts: async () => o.products || [],
      setProduct: async (dir, id, patch) => { calls.set.push([dir, id, patch]); return true; },
    },
    queueExport: (d) => calls.q.push(d),
  };
  return { env, calls };
}
const ORDERS = [
  { id: 'o1', store_id: 's1', created_at: '2026-10-19T07:05:00Z', lines: [{ id: 1, name: 'Круасан', qty: 2 }, { id: 2, name: 'Булка', qty: 1.5 }] },
  { id: 'o3', store_id: 's2', created_at: '2026-10-19T08:00:00Z', lines: [{ id: 4, name: 'Пиріг', qty: 4 }] },
  { id: 'o2', store_id: 's1', created_at: '2026-10-19T09:40:00Z', lines: [{ id: 3, name: 'Круасан', qty: 1 }] },
];
const PRODUCTS = [
  { id: 'p1', name: 'Круасан', price: 10, status: 'active', availability: 'є', sort: 2 },
  { id: 'p2', name: 'Булка', price: 8, status: 'stop', sort: 1 },
];

test('today ВК: точки за назвою (uk), рядок як delSheetRefresh_, час останнього замовлення (Київ)', async () => {
  const { env } = envOf({ orders: ORDERS });
  const r = await B.buyerToday('bakery', env);
  assert.deepEqual(r.stores.map((s) => s.label), ['А-точка', 'Б-точка']);
  const s1 = r.stores[1];
  assert.equal(s1.n, 3); assert.equal(s1.qty, 4.5); assert.equal(s1.time, '12:40');
  assert.match(s1.sub, /^3 поз\. · 4\.5( \S+)? · 12:40$/);
  assert.deepEqual(s1.lines.map((l) => l.row), [1, 2, 3]);
  assert.equal(r.title, DIRECTIONS.bakery.title);
});

test('today хліб: без часу (hasTime лише ВК і овочі)', async () => {
  const { env } = envOf({ orders: ORDERS });
  const r = await B.buyerToday('bread', env);
  assert.equal(r.stores[1].time, '');
  assert.match(r.stores[1].sub, /^3 поз\. · 4\.5( \S+)?$/);
});

test('remove: тексти і журнал дослівно з DeleteSheet.gs, вигрузка', async () => {
  const { env, calls } = envOf({ removed: 2, lines: [{ id: 1, name: 'Круасан', qty: 2 }, { id: 2, name: 'Булка', qty: 1 }] });
  const r = await B.buyerDelete('bakery', { storeId: 's1' }, env);
  assert.equal(r.message, '✅ Видалено 2 рядків замовлення: Б-точка. ТТ може замовити знову.');
  assert.deepEqual(calls.cancel, [['bakery', 's1', '2026-10-19']]);
  assert.deepEqual(calls.q, ['bakery']);
  assert.deepEqual(calls.log, [['Видалено з таблиці', DIRECTIONS.bakery.title + ' / Б-точка - рядків 2 (Круасан x2; Булка x1)']]);
});

test('remove: нічого не видалено -> текст «не знайдено» з DeleteSheet.gs', async () => {
  const { env } = envOf({ removed: 0 });
  const r = await B.buyerDelete('bakery', { storeId: 's2' }, env);
  assert.equal(r.message, '⚠ Замовлення для "А-точка" не знайдено - можливо, його вже видалили. Позначку "вже замовляли" знято, ТТ може замовити знову.');
});

test('remove: невідома точка -> помилка до скасування', async () => {
  const { env, calls } = envOf({ removed: 1 });
  await assert.rejects(B.buyerDelete('bakery', { storeId: 'zz' }, env), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  assert.equal(calls.cancel.length, 0);
});

test('products: порядок за sort, стоп як прапорець, наявність лише у ВК', async () => {
  const { env } = envOf({ products: PRODUCTS });
  const r = await B.buyerProducts('bakery', env);
  assert.deepEqual(r.products.map((p) => p.id), ['p2', 'p1']);
  assert.equal(r.products[0].stop, true); assert.equal(r.products[1].price, 10);
  assert.equal(r.hasAvailability, true);
  assert.equal((await B.buyerProducts('bread', env)).hasAvailability, false);
});

test('setProduct: ціна з комою, стоп/знято стоп, журнал', async () => {
  const { env, calls } = envOf({ products: PRODUCTS });
  await B.buyerSetProduct('bakery', { id: 'p1', price: '12,5' }, env);
  await B.buyerSetProduct('bakery', { id: 'p1', stop: true }, env);
  await B.buyerSetProduct('bakery', { id: 'p2', stop: false }, env);
  assert.deepEqual(calls.set, [['bakery', 'p1', { price: 12.5 }], ['bakery', 'p1', { status: 'stop' }], ['bakery', 'p2', { status: 'active' }]]);
  const t = DIRECTIONS.bakery.title;
  assert.deepEqual(calls.log.map((x) => x[1]), [t + ' / Круасан: ціна 10 → 12.5', t + ' / Круасан: стоп', t + ' / Булка: знято стоп']);
  assert.ok(calls.log.every((x) => x[0] === 'Змінено асортимент'));
});

test('setProduct: помилки до запису', async () => {
  const { env, calls } = envOf({ products: PRODUCTS });
  await assert.rejects(B.buyerSetProduct('bakery', { id: 'p1', price: -1 }, env), /Невірна ціна/);
  await assert.rejects(B.buyerSetProduct('bakery', { id: 'nope', price: 1 }, env), { message: 'Товар не знайдено. Оновіть сторінку.' });
  await assert.rejects(B.buyerSetProduct('bread', { id: 'p1', availability: 'нема' }, env), { message: 'Наявність - лише для випічки' });
  await assert.rejects(B.buyerSetProduct('bakery', { id: 'p1', price: 10 }, env), { message: 'Змін немає' });
  assert.equal(calls.set.length, 0);
});

const appMod = require('../src/app');
const createApp = appMod.createApp || appMod;
const fakeAuth = () => ({
  login: async (role, pin) => { if (pin !== '1234') throw new Error('Невірний PIN'); return 'tok-' + role.replace(':', '-'); },
  check: (t, role) => { if (t !== 'tok-' + role.replace(':', '-')) throw new Error('AUTH'); return true; },
});
async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); }
  finally { if (srv.closeAllConnections) srv.closeAllConnections(); srv.close(); }
}
const post = (url, body, cookie) => fetch(url, { method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

test('http закупниці: без cookie -> 401 AUTH; невідомий напрямок -> 404', async () => {
  const calls = [];
  await withApp({ adminAuth: fakeAuth(), buyerApi: (dir) => async (a) => { calls.push([dir, a]); return { ok: true, data: {}, ms: 0 }; } }, async (base) => {
    let r = await post(base + '/buyer/bakery/api', { action: 'today' });
    assert.equal(r.status, 401); assert.equal((await r.json()).error, 'AUTH');
    r = await post(base + '/buyer/xxx/api', { action: 'today' });
    assert.equal(r.status, 404);
    assert.equal(calls.length, 0);
  });
});

test('http закупниці: вхід -> cookie лише свого напрямку; чужий токен -> 401', async () => {
  const calls = [];
  await withApp({ adminAuth: fakeAuth(), buyerApi: (dir) => async (a) => { calls.push([dir, a]); return { ok: true, data: { dir }, ms: 0 }; } }, async (base) => {
    let r = await post(base + '/buyer/bakery/api', { action: 'login', payload: { pin: '0000' } });
    assert.equal((await r.json()).error, 'Невірний PIN');
    r = await post(base + '/buyer/bakery/api', { action: 'login', payload: { pin: '1234' } });
    const sc = r.headers.get('set-cookie') || '';
    assert.ok(sc.includes('buy=') && sc.includes('Path=/buyer/bakery') && sc.includes('HttpOnly'), sc);
    r = await post(base + '/buyer/bakery/api', { action: 'today' }, 'buy=tok-buyer-bakery');
    assert.equal(r.status, 200); assert.deepEqual(calls, [['bakery', 'today']]);
    r = await post(base + '/buyer/bread/api', { action: 'today' }, 'buy=tok-buyer-bakery');
    assert.equal(r.status, 401); assert.equal(calls.length, 1);
  });
});

test('runtime: дії закупниці підключені (today, remove, editOrder з dir із cookie, products, setProduct)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  for (const s of ['buyerApi', 'today: () => buyer.buyerToday', 'remove:', "editOrder: (p) => write.admEditOrder({ ...(p || {}), dir }", 'products:', 'setProduct:']) assert.ok(src.includes(s), s);
});