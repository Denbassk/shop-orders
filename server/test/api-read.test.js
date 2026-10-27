const test = require('node:test');
const assert = require('node:assert/strict');

const { apiBootstrap, apiRefresh, apiProducts } = require('../src/api/read');
const { DIRECTIONS } = require('../src/directions');
const fx = require('./fixtures/read-live.json');

const AT = new Date(fx.capturedAt);            // момент зняття фікстур з бойового /exec (19.10.2026, пн, ~10:19 Київ)
const DAY_NUM = { неділя: 0, понеділок: 1, вівторок: 2, середа: 3, четвер: 4, 'пʼятниця': 5, субота: 6 };

// ---------- джерело даних з фікстури ----------
function storesFromFixture() {
  return fx.bootstrap.data.stores.map((s) => {
    const days = { veg: [], bakery: [] };
    for (const d of ['veg', 'bakery']) {
      const m = s.dayOff[d] && s.dayOff[d].match(/Ваші дні: (.*)\.$/);
      if (m) days[d] = m[1].split(', ').map((n) => DAY_NUM[n]);
    }
    return { id: s.id, label: s.label, code: s.code, edrpou: s.ua ? '45672783' : '', days,
      // wo = колонка H (bakery) Довідника: у фікстурі нічого не вимкнено, тож directions містить bakery
      directions: s.directions.slice() };
  });
}

function orderedFromFixture() {
  const out = {};
  for (const [id, byDir] of Object.entries(fx.refresh.at(-1).response.data.ordered)) {
    for (const [dir, v] of Object.entries(byDir)) if (v) (out[dir] = out[dir] || new Set()).add(id);
  }
  return out;
}

function rowsFromFixture(dir, products, { shuffle = true } = {}) {
  const markup = DIRECTIONS[dir].markup;
  const rows = products.map((p, i) => ({
    dir, id: p.id, barcode: dir === 'bread' || dir === 'bakery' ? p.id : '', name: p.name,
    price: p.price / markup, category: p.category, availability: p.availability, box: p.box,
    status: 'active', sort: i,
  }));
  return shuffle ? rows.slice().reverse() : rows;
}

function makeData(over = {}) {
  const prodByDir = {};
  for (const p of fx.products) if (p.response.ok) prodByDir[p.payload.dir] = p.response.data.products;
  return {
    stores: async () => storesFromFixture(),
    settings: async () => ({ app_version: fx.bootstrap.data.version, test_mode: false, wo_deadline: fx.bootstrap.data.woDeadline, dirs_off: [], late_all: {} }),
    directions: async () => DIRECTIONS,
    products: async (dir) => rowsFromFixture(dir, prodByDir[dir] || []),
    orderedToday: async () => orderedFromFixture(),
    lateRows: async () => [],
    ...over,
  };
}

const passVeg = { resolve: async (rows) => rows.filter((r) => r.price > 0) };
const env = (over = {}, at = AT) => ({ at, data: makeData(over.data), veg: over.veg || passVeg });

// ---------- ключі і значення = бойова відповідь ----------
test('bootstrap: повна відповідь = фікстура з бойового /exec (39 точок)', async () => {
  const got = await apiBootstrap(env());
  const want = fx.bootstrap.data;
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  assert.equal(got.stores.length, 39);
  assert.deepEqual(got.stores, want.stores);
  assert.deepEqual(got.directions, want.directions);
  for (const k of ['version', 'today', 'testMode', 'woDeadline']) assert.deepEqual(got[k], want[k], k);
});

test('bootstrap: типи полів точки і напрямку як у фікстурі', async () => {
  const got = await apiBootstrap(env());
  const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
  const s0 = got.stores[0], w0 = fx.bootstrap.data.stores[0];
  for (const k of Object.keys(w0)) assert.equal(type(s0[k]), type(w0[k]), `store.${k}`);
  const d0 = got.directions.bakery, wd = fx.bootstrap.data.directions.bakery;
  for (const k of Object.keys(wd)) assert.equal(type(d0[k]), type(wd[k]), `directions.bakery.${k}`);
  assert.equal(Object.keys(d0).length, Object.keys(wd).length);
});

test('refresh: усі зняті відповіді збігаються з бойовими', async () => {
  assert.equal(fx.refresh.length, 14);
  for (const r of fx.refresh) {
    assert.ok(r.response.ok);
    assert.deepEqual(await apiRefresh(r.payload, env()), r.response.data, JSON.stringify(r.payload));
  }
});

test('products: усі зняті відповіді збігаються з бойовими (13, з них 1 помилка "не ваш день")', async () => {
  assert.equal(fx.products.length, 13);
  let errors = 0;
  for (const p of fx.products) {
    if (p.response.ok) {
      // Дві навмисні відмінності від Apps Script (27.10.2026): нове поле windowOpen, а запит дозволу (canRequestLate) до
      // дедлайну не пропонується - фікстури зняті о 10:19, до всіх дедлайнів, тож скрізь canRequestLate=false.
      const { windowOpen, ...got } = await apiProducts(p.payload, env());
      assert.equal(windowOpen, true, JSON.stringify(p.payload));
      assert.deepEqual(got, { ...p.response.data, canRequestLate: false }, JSON.stringify(p.payload));
    } else {
      errors++;
      await assert.rejects(apiProducts(p.payload, env()), { message: p.response.error });
    }
  }
  assert.equal(errors, 1);
});

// ---------- вимкнений напрямок ----------
test('вимкнений напрямок зникає з directions і stores[].directions; refresh/products теж', async () => {
  const e = env({ data: { settings: async () => ({ dirs_off: ['veg'], app_version: 'v' }) } });
  const b = await apiBootstrap(e);
  assert.deepEqual(Object.keys(b.directions), ['bread', 'nbhz', 'bakery']);
  assert.ok(b.stores.every((s) => !s.directions.includes('veg') && !('veg' in s.ordered) && !('veg' in s.dayOk)));
  const one = b.stores.find((s) => s.id === 'производство семенка');
  assert.deepEqual(one.directions, []);
  assert.equal(one.wo, false);
  const bak = b.stores.find((s) => s.id === 'м харків вул полевая 83');
  assert.equal(bak.wo, true);

  const r = await apiRefresh({ dir: 'veg', storeId: 'м харків вул амосова 5а' }, e);
  assert.equal('veg' in r.closed, false);
  assert.equal(r.late, 'none'); assert.equal(r.locked, null);
  await assert.rejects(apiProducts({ dir: 'veg', storeId: 'м харків вул амосова 5а' }, e),
    { message: 'Напрямок "Овочі і фрукти" зараз вимкнено.' });
});

test('wo: списання лишається, якщо вимкнено випічку (за колонкою bakery, не за directions)', async () => {
  const e = env({ data: { settings: async () => ({ dirs_off: ['bakery'] }) } });
  const b = await apiBootstrap(e);
  const s = b.stores.find((x) => x.id === 'м харків вул амосова 5а');
  assert.equal(s.directions.includes('bakery'), false);
  assert.equal(s.wo, true);
});

// ---------- помилки products: тексти дослівно ----------
test('products: помилки дослівно', async () => {
  const ok = 'м харків вул амосова 5а';
  await assert.rejects(apiProducts({ dir: 'bread', storeId: 'нема такої' }, env()), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  await assert.rejects(apiProducts({ dir: 'nope', storeId: ok }, env()), /^Error: Невідомий напрямок: "nope"\. Доступні: bread, nbhz, bakery, veg\.$/);
  // точка без напрямку
  await assert.rejects(apiProducts({ dir: 'bread', storeId: 'м харків вул полевая 83' }, env()),
    { message: 'Для цієї ТТ напрямок "Хліб Рома" не передбачений' });
  // чужий день: овочі, вівторок
  await assert.rejects(apiProducts({ dir: 'veg', storeId: 'м харків вул астрономічна 44 г' }, env()),
    { message: 'Вибачте, не ваш день для замовлення. Ваші дні: вівторок.' });
});

test('dayOff у bootstrap: дослівно для двох напрямків (овочі і випічка, субота)', async () => {
  const sat = new Date('2026-10-24T09:00:00+03:00');
  const withDays = async () => storesFromFixture().map((x) => (x.id === 'м харків вул амосова 5а' ? { ...x, days: { veg: [1], bakery: [1, 2, 3, 4, 5] } } : x));
  const b = await apiBootstrap(env({ data: { stores: withDays } }, sat));
  const s = b.stores.find((x) => x.id === 'м харків вул амосова 5а');
  assert.equal(s.dayOk.bakery, false);
  assert.equal(s.dayOff.bakery, 'Кулінарія у суботу та неділю не працює. Ваші дні: понеділок, вівторок, середа, четвер, пʼятниця.');
  assert.equal(s.dayOk.veg, false);
  assert.equal(s.dayOff.veg, 'Вибачте, не ваш день для замовлення. Ваші дні: понеділок.');
});

// ---------- ціни, stop, порядок ----------
test('ціна × markup з округленням до 0,01 (овочі ×1.5; інші ×1)', async () => {
  const rows = [
    { dir: 'veg', id: 'Морква', barcode: '', name: 'Морква', price: 10.333, category: null, availability: null, box: null, status: 'active', sort: 0 },
    { dir: 'veg', id: 'Буряк', barcode: '', name: 'Буряк', price: 7.1, category: null, availability: null, box: null, status: 'active', sort: 1 },
  ];
  const e = env({ data: { products: async () => rows } });
  const r = await apiProducts({ dir: 'veg', storeId: 'м харків вул амосова 5а' }, e);
  assert.deepEqual(r.products.map((p) => [p.name, p.price]), [['Буряк', 10.65], ['Морква', 15.5]]);
  assert.equal(r.minOrder, 750);
});

test('позицій зі status=stop немає; порожні поля -> null', async () => {
  const rows = [
    { dir: 'bread', id: '1', barcode: '1', name: 'Батон', price: 20, category: null, availability: null, box: '', status: 'active', sort: 0 },
    { dir: 'bread', id: '2', barcode: '2', name: 'Багет', price: 30, category: null, availability: null, box: '8', status: 'stop', sort: 1000 },
  ];
  const r = await apiProducts({ dir: 'bread', storeId: 'м харків вул амосова 5а' }, env({ data: { products: async () => rows } }));
  assert.deepEqual(r.products, [{ id: '1', name: 'Батон', price: 20, category: null, availability: null, box: null }]);
});

test('порядок: випічка - категорія, потім назва (uk); НБХЗ - порядок sort; категорії - за появою', async () => {
  const mk = (dir, id, name, category, sort) => ({ dir, id, barcode: id, name, price: 1, category, availability: null, box: null, status: 'active', sort });
  const bak = [mk('bakery', '1', 'Яблучний', 'Кулінарія', 0), mk('bakery', '2', 'Булка', 'Випічка', 1), mk('bakery', '3', 'Арка', 'Кулінарія', 2)];
  const r = await apiProducts({ dir: 'bakery', storeId: 'м харків вул амосова 5а' }, env({ data: { products: async () => bak } }));
  assert.deepEqual(r.products.map((p) => p.name), ['Булка', 'Арка', 'Яблучний']);
  assert.deepEqual(r.categories, ['Випічка', 'Кулінарія']);

  const nb = [mk('nbhz', 'в', 'Я', null, 2), mk('nbhz', 'а', 'Б', null, 0), mk('nbhz', 'б', 'А', null, 1)];
  const n = await apiProducts({ dir: 'nbhz', storeId: 'м харків вул амосова 5а' }, env({ data: { products: async () => nb } }));
  assert.deepEqual(n.products.map((p) => p.name), ['Б', 'А', 'Я']);
  assert.equal(n.hidePrice, true);
  assert.deepEqual(n.categories, []);
});

// ---------- locked / alreadyOrdered / canRequestLate / lateLeftMin ----------
const AFTER_13 = new Date('2026-10-19T14:00:00+03:00');          // ВК закрито
const STORE = 'м харків вул амосова 5а';
const lateRow = (o) => ({ dir: 'bakery', store_id: STORE, requested_at: null, approved_at: null, ...o });

test('locked/alreadyOrdered/canRequestLate/lateLeftMin: відкрито, закрито, вже замовляли', async () => {
  const open = await apiProducts({ dir: 'bakery', storeId: STORE }, env());
  assert.deepEqual([open.closed, open.alreadyOrdered, open.locked, open.canRequestLate, open.lateRequest, open.lateLeftMin],
    [false, false, false, false, 'none', 0]);

  const closed = await apiProducts({ dir: 'bakery', storeId: STORE }, env({}, AFTER_13));
  assert.deepEqual([closed.closed, closed.locked, closed.canRequestLate, closed.lateRequest], [true, true, true, 'none']);

  // вже замовляла, але прийом відкритий: дозвіл не пропонується (windowOpen) - екран дає "Змінити замовлення"
  const already = await apiProducts({ dir: 'bakery', storeId: 'м харків пр т байрона 163 а' }, env());
  assert.deepEqual([already.closed, already.alreadyOrdered, already.locked, already.canRequestLate, already.windowOpen],
    [false, true, true, false, true]);

  // вже замовляла, дедлайн минув, дозволу нема: пропонується запит дозволу, windowOpen=false
  const lateAlready = await apiProducts({ dir: 'bakery', storeId: 'м харків пр т байрона 163 а' }, env({}, AFTER_13));
  assert.deepEqual([lateAlready.closed, lateAlready.alreadyOrdered, lateAlready.canRequestLate, lateAlready.windowOpen], [true, true, true, false]);
});

test('дозвіл знімає обидва замки і мінімалку; lateLeftMin за ceil; pending - лише canRequestLate', async () => {
  const approvedRows = [lateRow({ requested_at: '2026-10-19T13:55:00+03:00', approved_at: '2026-10-19T13:58:00+03:00' })];
  const e = env({ data: { lateRows: async () => approvedRows } }, AFTER_13);        // 14:00, дозвіл діє ще 28 хв
  const b = await apiProducts({ dir: 'bakery', storeId: STORE }, e);
  assert.deepEqual([b.closed, b.locked, b.minOrder, b.lateRequest, b.lateLeftMin, b.canRequestLate], [false, false, 0, 'approved', 28, false]);   // closed=false, бо дозвіл знімає дедлайн -> canRequestLate false

  // закрито + вже замовляли + дозвіл -> не заблоковано
  const e2 = env({ data: { lateRows: async () => approvedRows, orderedToday: async () => ({ bakery: new Set([STORE]) }) } }, AFTER_13);
  const b2 = await apiProducts({ dir: 'bakery', storeId: STORE }, e2);
  assert.deepEqual([b2.alreadyOrdered, b2.locked, b2.canRequestLate, b2.windowOpen, b2.lateRequest], [true, false, true, false, 'approved']);

  // мінімалку знімає лише дозвіл на перше замовлення; заміна відправленого - з мінімалкою (хліб: 400)
  const bread = { dir: 'bread', storeId: STORE };
  const breadRows = [{ dir: 'bread', store_id: STORE, requested_at: '2026-10-19T16:05:00+03:00', approved_at: '2026-10-19T16:10:00+03:00' }];
  const AFTER_16 = new Date('2026-10-19T16:20:00+03:00');
  const first = await apiProducts(bread, env({ data: { lateRows: async () => breadRows } }, AFTER_16));
  assert.deepEqual([first.lateRequest, first.alreadyOrdered, first.minOrder], ['approved', false, 0]);
  const change = await apiProducts(bread, env({ data: { lateRows: async () => breadRows, orderedToday: async () => ({ bread: new Set([STORE]) }) } }, AFTER_16));
  assert.deepEqual([change.lateRequest, change.alreadyOrdered, change.minOrder], ['approved', true, 400]);

  const pending = [lateRow({ requested_at: '2026-10-19T13:50:00+03:00' })];
  const p = await apiProducts({ dir: 'bakery', storeId: STORE }, env({ data: { lateRows: async () => pending } }, AFTER_13));
  assert.deepEqual([p.lateRequest, p.locked, p.canRequestLate, p.lateLeftMin], ['pending', true, true, 0]);
});

test('refresh: late/lateLeft/locked для пари; locked=null без пари', async () => {
  const rows = [lateRow({ approved_at: '2026-10-19T13:58:00+03:00' })];
  const r = await apiRefresh({ dir: 'bakery', storeId: STORE }, env({ data: { lateRows: async () => rows } }, AFTER_13));
  assert.deepEqual([r.late, r.lateLeft, r.locked, r.closed.bakery], ['approved', 28, false, true]);
  const c = await apiRefresh({ dir: 'bakery', storeId: STORE }, env({}, AFTER_13));
  assert.deepEqual([c.late, r.lateLeft && c.lateLeft, c.locked], ['none', 0, true]);
  const none = await apiRefresh({}, env());
  assert.equal(none.locked, null);
  const bad = await apiRefresh({ dir: 'bakery', storeId: 'нема такої' }, env());
  assert.deepEqual([bad.late, bad.locked], ['none', null]);
});

test('late_all відкриває прийом: closed=false у bootstrap/products', async () => {
  const e = env({ data: { settings: async () => ({ late_all: { bakery: '2026-10-19' } }) } }, AFTER_13);
  assert.equal((await apiBootstrap(e)).directions.bakery.closed, false);
  assert.equal((await apiProducts({ dir: 'bakery', storeId: STORE }, e)).closed, false);
});

test('minOrder: з урахуванням minOrderChanges і markup', async () => {
  const b = await apiBootstrap(env());
  assert.equal(b.directions.bread.minOrder, 400);
  const sep = await apiBootstrap(env({}, new Date('2026-09-30T12:00:00+03:00')));
  assert.equal(sep.directions.bread.minOrder, 350);
});

test('овочі: products проходять через veg.resolve (товар без ціни не віддається)', async () => {
  const seen = [];
  const veg = { resolve: async (rows) => { seen.push(rows.length); return rows.filter((r) => r.name !== 'Буряк'); } };
  const rows = [
    { dir: 'veg', id: 'Морква', barcode: '', name: 'Морква', price: 1, category: null, availability: null, box: null, status: 'active', sort: 0 },
    { dir: 'veg', id: 'Буряк', barcode: '', name: 'Буряк', price: 1, category: null, availability: null, box: null, status: 'stop', sort: 1000 },
    { dir: 'veg', id: 'Цибуля', barcode: '', name: 'Цибуля', price: 1, category: null, availability: null, box: null, status: 'active', sort: 1 },
  ];
  const r = await apiProducts({ dir: 'veg', storeId: STORE }, env({ data: { products: async () => rows }, veg }));
  assert.deepEqual(seen, [2], 'stop відсіяно ще до запиту цін');
  assert.deepEqual(r.products.map((p) => p.name), ['Морква', 'Цибуля']);
});

// ---------- currentOrder: підстановка поточного замовлення для "Змінити замовлення" ----------
const { apiCurrentOrder } = require('../src/api/read');
const CUR_LINES = [
  { product_id: '1', name: 'Батон', price: 20, qty: 3 },
  { product_id: '2', name: 'Багет', price: 30, qty: 1.5 },
  { product_id: '9', name: 'Знятий з асортименту', price: 10, qty: 2 },
];
const curRows = [
  { dir: 'bread', id: '1', barcode: '1', name: 'Батон', price: 20, category: null, availability: null, box: null, status: 'active', sort: 0 },
  { dir: 'bread', id: '2', barcode: '2', name: 'Багет', price: 30, category: null, availability: null, box: null, status: 'active', sort: 1 },
  { dir: 'bread', id: '9', barcode: '9', name: 'Знятий з асортименту', price: 10, category: null, availability: null, box: null, status: 'stop', sort: 2 },
];
const curEnv = (over = {}) => env({ data: { products: async () => curRows, activeOrderLines: async () => CUR_LINES, ...over } });

test('currentOrder: позиції для кошика, сума з націнкою, зниклі з асортименту - окремо (gone)', async () => {
  const r = await apiCurrentOrder({ dir: 'bread', storeId: STORE }, curEnv());
  assert.deepEqual(r.items, [{ id: '1', qty: 3 }, { id: '2', qty: 1.5 }]);
  assert.deepEqual(r.gone, [{ name: 'Знятий з асортименту', qty: 2 }]);
  assert.deepEqual([r.positions, r.total, r.hidePrice], [3, 125, false]);          // 20*3 + 30*1.5 + 10*2
});

test('currentOrder: питає саме цю пару і сьогоднішній день (Київ)', async () => {
  const seen = [];
  await apiCurrentOrder({ dir: 'bread', storeId: STORE }, curEnv({ activeOrderLines: async (...a) => { seen.push(a); return CUR_LINES; } }));
  assert.deepEqual(seen, [['bread', STORE, '2026-10-19']]);
});

test('currentOrder: овочі ×1.5 у сумі; позиція без ціни (veg.resolve її прибрав) - у gone', async () => {
  const vegRows = [{ dir: 'veg', id: 'Морква', barcode: '', name: 'Морква', price: 10, category: null, availability: null, box: null, status: 'active', sort: 0 },
    { dir: 'veg', id: 'Буряк', barcode: '', name: 'Буряк', price: 0, category: null, availability: null, box: null, status: 'active', sort: 1 }];
  const e = env({ data: { products: async () => vegRows, activeOrderLines: async () => [
    { product_id: 'Морква', name: 'Морква', price: 10, qty: 10 }, { product_id: 'Буряк', name: 'Буряк', price: 5, qty: 2 }] } });
  const r = await apiCurrentOrder({ dir: 'veg', storeId: STORE }, e);
  assert.deepEqual(r.items, [{ id: 'Морква', qty: 10 }]);
  assert.deepEqual(r.gone.map((g) => g.name), ['Буряк']);
  assert.equal(r.total, 165);                                                   // (100 + 10) * 1.5
});

test('currentOrder: замовлення нема / невідома точка / напрямок вимкнено / не цієї точки - помилки', async () => {
  await assert.rejects(apiCurrentOrder({ dir: 'bread', storeId: STORE }, curEnv({ activeOrderLines: async () => [] })),
    { message: 'Замовлення на сьогодні не знайдено. Оновіть сторінку.' });
  await assert.rejects(apiCurrentOrder({ dir: 'bread', storeId: 'нема такої' }, curEnv()), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  await assert.rejects(apiCurrentOrder({ dir: 'bread', storeId: STORE }, curEnv({ settings: async () => ({ dirs_off: ['bread'] }) })),
    { message: 'Напрямок "Хліб Рома" зараз вимкнено.' });
  await assert.rejects(apiCurrentOrder({ dir: 'bread', storeId: 'м харків вул полевая 83' }, curEnv()),
    { message: 'Для цієї ТТ напрямок "Хліб Рома" не передбачений' });
});

test('currentOrder: доступний через диспетчер /api', async () => {
  const { createApi } = require('../src/api/index');
  const api = createApi(() => curEnv(), () => {});
  const r = await api('currentOrder', { dir: 'bread', storeId: STORE });
  assert.equal(r.ok, true);
  assert.equal(r.data.positions, 3);
});
