// Пульт: читання. Перенос admToday_, admDays_, admSchedule_, admStores_ (app/Admin.gs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { admToday, admDays, admSchedule, admStores } = require('../src/admin/read');

const AT = new Date('2026-10-20T10:30:00+03:00');           // вівторок
const DIRS = {                                              // навмисно veg першим: порядок має бути як у DIRECTIONS
  veg: { key: 'veg', title: 'Овочі', color: '#2a2', deadline: '18:00', orderDays: true },
  bread: { key: 'bread', title: 'Хліб', color: '#a52', deadline: '16:00' },
};
const S1 = { id: 's1', label: 'Бучми, 32', address: 'м. Харків вул. Бучми, 32', code: '101', route: 'R1', zone: 'Z1', edrpou: '44413718', directions: ['bread', 'veg'], days: { veg: [2] } };
const S2 = { id: 's2', label: 'Астрономічна, 44', address: 'вул. Астрономічна, 44 Г', code: '202', route: 'R2', zone: '', edrpou: '45672783', directions: ['bread', 'veg'], days: { veg: [3] } };
const S3 = { id: 's3', label: 'Героїв Праці, 7', address: 'пр. Героїв Праці, 7', code: '303', route: '', zone: '', edrpou: '', directions: ['veg'], days: { veg: [] } };
const S4 = { id: 's4', label: 'Тест А', address: 'Тест', code: '', route: '', zone: '', edrpou: '', directions: [], days: {} };

function env({ at = AT, stores = [S1, S2, S3, S4], settings = {}, reportAt } = {}) {
  const ordered = { bread: new Set(['s2']), veg: new Set(['s1']) };
  return { at, reportAt, data: {
    stores: async () => stores, settings: async () => settings,
    directions: async () => DIRS, orderedToday: async (day) => { assert.equal(day, '2026-10-20'); return ordered; },
  } };
}

test('admDays: як admDays_ (каждый день / без ограничений / дні, сьогодні, наступний)', () => {
  const ctx = { at: AT, directions: DIRS };
  const st = (d) => ({ ...S1, days: { veg: d } });
  assert.deepEqual(admDays('bread', S1, ctx), { free: true, label: 'каждый день', today: true, next: '' });
  assert.deepEqual(admDays('veg', st([]), ctx), { free: true, label: 'без ограничений', today: true, next: '' });
  assert.deepEqual(admDays('veg', st([3]), ctx), { free: false, label: 'Ср', today: false, next: 'завтра' });
  assert.deepEqual(admDays('veg', st([0]), ctx), { free: false, label: 'Вс', today: false, next: 'в воскресенье' });
  assert.deepEqual(admDays('veg', st([2]), ctx), { free: false, label: 'Вт', today: true, next: 'в вторник' });
  assert.equal(admDays('veg', st([1, 3]), ctx).label, 'Пн, Ср');
});

test('today: лічильники, waiting, minLeft, дата/час/день; порядок напрямків як у DIRECTIONS', async () => {
  const r = await admToday(env());
  assert.equal(r.today, '20.10.2026'); assert.equal(r.time, '10:30'); assert.equal(r.dow, 'вторник');
  assert.deepEqual(r.dirs.map((d) => d.key), ['bread', 'veg']);
  assert.deepEqual(r.dirs[0], { key: 'bread', title: 'Хліб', color: '#a52', deadline: '16:00',
    closed: false, openedAll: false, enabled: true, total: 2, ordered: 1, waiting: ['Бучми, 32'],
    all: 2, offDay: 0, byDays: false, noDayToday: false, reportAt: '', minLeft: 330 });
  const v = r.dirs[1];
  assert.deepEqual([v.all, v.offDay, v.total, v.ordered, v.waiting, v.byDays, v.minLeft], [3, 1, 2, 1, ['Героїв Праці, 7'], true, 450]);
});

test('today: late_all відкриває, dirs_off вимикає, після дедлайну closed і minLeft < 0, reportAt з env', async () => {
  const a = await admToday(env({ settings: { dirs_off: ['veg'], late_all: { bread: '2026-10-20' } }, reportAt: async (k) => (k === 'bread' ? '15:40' : '') }));
  assert.equal(a.dirs[0].openedAll, true); assert.equal(a.dirs[0].closed, false); assert.equal(a.dirs[0].reportAt, '15:40');
  assert.equal(a.dirs[1].enabled, false);
  const b = await admToday(env({ at: new Date('2026-10-20T16:30:00+03:00') }));
  assert.equal(b.dirs[0].closed, true); assert.equal(b.dirs[0].minLeft, -30);
});

test('today: noDayToday - напрямок по днях, сьогодні нікому, але точки є; waiting не більше 40', async () => {
  const r = await admToday(env({ stores: [S2] }));
  const v = r.dirs[1];
  assert.deepEqual([v.all, v.offDay, v.total, v.noDayToday], [1, 1, 0, true]);
  const many = Array.from({ length: 45 }, (_, i) => ({ ...S1, id: 'x' + i, label: 'Т' + i }));
  assert.equal((await admToday(env({ stores: many }))).dirs[0].waiting.length, 40);
});

test('schedule: рядки за назвою (uk), клітинки лише напрямків точки, точки без напрямків пропущено', async () => {
  const r = await admSchedule({}, env());
  assert.equal(r.dir, ''); assert.equal(r.dow, 'вторник'); assert.equal(r.today, '20.10.2026');
  assert.deepEqual(r.dirs, [{ key: 'bread', title: 'Хліб', deadline: '16:00', byDays: false }, { key: 'veg', title: 'Овочі', deadline: '18:00', byDays: true }]);
  assert.deepEqual(r.rows.map((x) => x.id), ['s2', 's1', 's3']);
  assert.deepEqual(r.rows[0], { id: 's2', label: 'Астрономічна, 44', ua: true, code: '202', route: 'R2', cells: [
    { dir: 'bread', title: 'Хліб', deadline: '16:00', days: 'каждый день', today: true, next: '', ordered: true },
    { dir: 'veg', title: 'Овочі', deadline: '18:00', days: 'Ср', today: false, next: 'завтра', ordered: false }] });
});

test('schedule {dir}: лише цей напрямок', async () => {
  const r = await admSchedule({ dir: 'veg' }, env());
  assert.equal(r.dir, 'veg');
  assert.deepEqual(r.dirs.map((d) => d.key), ['veg']);
  assert.deepEqual(r.rows.map((x) => x.cells.length), [1, 1, 1]);
  assert.equal(r.rows[2].cells[0].days, 'без ограничений');
});

test('stores: пошук за назвою/адресою/кодом без регістру, фільтр напрямку, ordered лише з dir, максимум 60', async () => {
  assert.deepEqual((await admStores({ q: ' АСТРОНОМ ' }, env())).map((s) => s.id), ['s2']);
  assert.deepEqual((await admStores({ q: '101' }, env())).map((s) => s.id), ['s1']);
  assert.deepEqual((await admStores({ q: 'харків' }, env())).map((s) => s.id), ['s1']);
  const v = await admStores({ dir: 'veg' }, env());
  assert.deepEqual(v.map((s) => [s.id, s.ordered]), [['s1', true], ['s2', false], ['s3', false]]);
  assert.deepEqual(v[1], { id: 's2', label: 'Астрономічна, 44', ua: true, code: '202', route: 'R2', zone: '', directions: ['bread', 'veg'], ordered: false });
  const all = await admStores({}, env());
  assert.equal(all.length, 4); assert.ok(all.every((s) => s.ordered === false));
  const many = Array.from({ length: 70 }, (_, i) => ({ ...S1, id: 'x' + i }));
  assert.equal((await admStores({}, env({ stores: many }))).length, 60);
});

test('runtime пульта: дії today, schedule, stores підключені', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  assert.match(src, /today: \(\) => read\.admToday\(/);
  assert.match(src, /schedule: \(p\) => read\.admSchedule\(p,/);
  assert.match(src, /stores: \(p\) => read\.admStores\(p,/);
});
test('storesTable: усі точки з бази (і неактивні) колонками як у Довіднику, ЮА, посилання на Довідник; сортування за назвою (uk)', async () => {
  const { admStoresTable } = require('../src/admin/read');
  const rows = [
    { store_id: 'b', active: true, label: 'Бучми, 32', address: 'м. Харків вул. Бучми, 32', code: '12', route: 'R1', type: 'Магазин', addr_bread: 'Бучми 32', addr_bakery: 'м. Харків вул. Бучми, 32',
      addr_veg: 'м. Харків вул. Бучми, 32', addr_nbhz: 'Бучми32', route_nbhz: 'Рогань', zone: 'Центр', edrpou: '45672783', bread: true, nbhz: true, bakery: true, veg: false, days_veg: '', days_bakery: 'Пн, Вт', note: 'ключ у охорони', sort: 2 },
    { store_id: 'a', active: false, label: 'Амосова, 5А', address: 'м. Харків вул. Амосова, 5А', code: '', route: '', type: 'Магазин', addr_bread: '', addr_bakery: '', addr_veg: '', addr_nbhz: '', route_nbhz: '', zone: '', edrpou: '', bread: true, nbhz: false, bakery: false, veg: true, days_veg: 'Пн', days_bakery: '', note: '', sort: 1 },
  ];
  const r = await admStoresTable({ adm: { allStores: async () => rows } });
  assert.deepEqual(r.rows.map((x) => x.id), ['a', 'b'], 'за назвою');
  const b = r.rows[1];
  assert.deepEqual([b.label, b.code, b.route, b.zone, b.ua, b.active, b.note], ['Бучми, 32', '12', 'R1', 'Центр', true, true, 'ключ у охорони']);
  assert.deepEqual(b.directions, ['bread', 'nbhz', 'bakery']);
  assert.deepEqual([b.daysVeg, b.daysBakery, b.routeNbhz, b.addrNbhz], ['', 'Пн, Вт', 'Рогань', 'Бучми32']);
  assert.equal(r.rows[0].active, false);
  assert.equal(r.registryUrl, 'https://docs.google.com/spreadsheets/d/1noOXYRRdxIuY6gd9kicI2OxGU0vJ_kfvLbcVTyqXi6o/edit');
  assert.equal(r.total, 2);
});

test('storeCard: реквізити, компанія (ЮА/Фемелі), графік по напрямках (дні масивом), замовлення сьогодні - з бази або з листа Google', async () => {
  const { admStoreCard } = require('../src/admin/read');
  const e = env();
  e.adm = { allStores: async () => [], dayOrders: async (dir) => (dir === 'bread' ? [{ store_id: 's2', created_at: '2026-10-20T07:10:00Z', lines: [{ id: 11, name: 'Хліб', qty: 3 }, { id: 12, name: 'Батон', qty: 2 }] }] : []) };
  e.data.lateRows = async () => [];
  e.gOrders = async () => ({ veg: new Map([['s2', { n: 4, qty: 20.5, time: '09:15' }]]) });
  const c = await admStoreCard({ storeId: 's2' }, e);
  assert.deepEqual([c.store.label, c.store.code, c.store.route, c.store.ua, c.store.company, c.store.active], ['Астрономічна, 44', '202', 'R2', true, 'ЮА маркет', true]);
  assert.deepEqual(c.dirs.map((d) => d.dir), ['bread', 'veg'], 'порядок DIRECTIONS, лише увімкнені напрямки сервера');
  const bread = c.dirs[0], veg = c.dirs[1];
  assert.deepEqual([bread.available, bread.byDays, bread.days], [true, false, []]);
  assert.deepEqual([bread.order.src, bread.order.n, bread.order.qty, bread.order.canEdit], ['db', 2, 5, true]);
  assert.deepEqual(bread.order.rows.map((r) => r.row), [11, 12]);
  assert.deepEqual([veg.order.src, veg.order.n, veg.order.qty, veg.order.time, veg.order.canEdit], ['google', 4, 20.5, '09:15', false], 'замовлення з таблиці Google змінювати з нового пульта не можна');
  assert.equal(veg.byDays, true);
  e.adm.dayOrders = async (dir) => (dir === 'bread' ? [{ order_id: 'import-2026-10-20-bread-s2', store_id: 's2', created_at: '2026-10-20T07:10:00Z', lines: [{ id: 21, name: 'Хліб', qty: 4 }] }] : []);
  const imp = await admStoreCard({ storeId: 's2' }, e);
  assert.deepEqual([imp.dirs[0].order.src, imp.dirs[0].order.canEdit, imp.dirs[0].order.n, imp.dirs[0].order.qty], ['google', false, 1, 4], 'імпортоване з листа = замовлення Apps Script, змінювати не можна');
  const f = await admStoreCard({ storeId: 's1' }, e);
  assert.equal(f.store.company, 'Фемелі');
  assert.equal(f.dirs[0].order, null, 'не замовляла');
});

test('storeCard: неактивна точка береться з allStores; невідома - помилка як у findStore_', async () => {
  const { admStoreCard } = require('../src/admin/read');
  const e = env({ stores: [S1] });
  e.adm = { allStores: async () => [{ store_id: 'x9', active: false, label: 'Стара', address: 'вул. Стара, 1', code: '9', route: '', type: '', zone: '', edrpou: '', bread: true, nbhz: false, bakery: false, veg: false,
    days_veg: '', days_bakery: '', note: 'закрита', addr_bread: '', addr_bakery: '', addr_veg: '', addr_nbhz: '', route_nbhz: '' }], dayOrders: async () => [] };
  e.data.lateRows = async () => [];
  const c = await admStoreCard({ storeId: 'x9' }, e);
  assert.deepEqual([c.store.active, c.store.note, c.dirs.map((d) => d.available)], [false, 'закрита', [true, false]], 'bread є, veg точці не підключено');
  await assert.rejects(admStoreCard({ storeId: 'nope' }, e), /Торгову точку не знайдено/);
});
