const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const R = require('../src/rules');
const W = require('../src/admin/write');
const { createAdminData } = require('../src/admin/data');

const AT = new Date('2026-10-20T10:00:00+03:00');
const DAY = '2026-10-20';
const STORES = [{ id: 's1', label: 'Магазин 1' }];

function mkEnv() {
  const st = { log: [], q: [], set: {}, cancelled: [], approved: null };
  const env = {
    at: AT, log: () => {},
    data: { stores: async () => STORES, approveLate: async (...a) => { st.approved = a; } },
    adm: {
      adminLog: async (a, d) => { st.log.push([a, d]); },
      cancelDay: async (...a) => { st.cancelled.push(a); return 3; },
      getSetting: async (k) => (k in st.set ? st.set[k] : null),
      setSetting: async (k, v) => { st.set[k] = v; },
    },
    queueExport: (d) => st.q.push(d),
  };
  return { env, st };
}

function fakeSb(responses) {
  const calls = [];
  return { calls, from(table) {
    const c = { table, ops: [] }; calls.push(c);
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') { const r = responses.shift() || { data: [], error: null }; return (ok, bad) => Promise.resolve(r).then(ok, bad); }
      return (...a) => { c.ops.push([k, ...a]); return b; };
    } });
    return b;
  } };
}

test('cancelOrder: активні замовлення дня -> cancelled, вигрузка в черзі, журнал дослівно', async () => {
  const { env, st } = mkEnv();
  assert.deepEqual(await W.admCancelOrder({ storeId: 's1', dir: 'bread' }, env), { removed: 3 });
  assert.deepEqual(st.cancelled, [['bread', 's1', DAY]]);
  assert.deepEqual(st.q, ['bread']);
  assert.deepEqual(st.log, [['Скасовано замовлення', DIRECTIONS.bread.title + ' / Магазин 1 - рядків 3']]);
});

test('cancelOrder: невідома точка / напрямок -> тексти як в Apps Script, нічого не скасовано', async () => {
  const { env, st } = mkEnv();
  await assert.rejects(W.admCancelOrder({ storeId: 'nope', dir: 'bread' }, env), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
  await assert.rejects(W.admCancelOrder({ storeId: 's1', dir: 'xx' }, env), { message: 'Невідомий напрямок: "xx"' });
  assert.equal(st.cancelled.length, 0); assert.equal(st.q.length, 0); assert.equal(st.log.length, 0);
});

test('openStore: дозвіл на 30 хв (late_requests approved), left, журнал', async () => {
  const { env, st } = mkEnv();
  assert.deepEqual(await W.admOpenStore({ storeId: 's1', dir: 'bakery' }, env), { left: 30 });
  assert.deepEqual(st.approved, ['bakery', 's1', DAY, AT]);
  assert.deepEqual(st.log, [['Відкрито прийом точці', DIRECTIONS.bakery.title + ' / Магазин 1 - на 30 хв']]);
});

test('openAll / closeAll: settings.late_all = { dir: день }, rules.lateAllowed бачить, інші напрямки не чіпаються', async () => {
  const { env, st } = mkEnv();
  st.set.late_all = { veg: '2026-10-19' };
  assert.deepEqual(await W.admOpenAll({ dir: 'bread' }, env), { ok: true });
  assert.deepEqual(st.set.late_all, { veg: '2026-10-19', bread: DAY });
  assert.equal(R.lateAllowed('bread', { at: AT, settings: st.set }), true);
  assert.deepEqual(await W.admCloseAll({ dir: 'bread' }, env), { ok: true });
  assert.deepEqual(st.set.late_all, { veg: '2026-10-19' });
  assert.equal(R.lateAllowed('bread', { at: AT, settings: st.set }), false);
  assert.deepEqual(st.log, [['Відкрито прийом усім', DIRECTIONS.bread.title + ' - до кінця дня'],
    ['Повернуто звичайний режим', DIRECTIONS.bread.title]]);
});

test('setDirEnabled: settings.dirs_off - вимкнути, повтор без дублів, увімкнути; rules.dirEnabled бачить', async () => {
  const { env, st } = mkEnv();
  assert.deepEqual(await W.admSetDirEnabled({ dir: 'veg', on: false }, env), { ok: true, enabled: false });
  await W.admSetDirEnabled({ dir: 'veg', on: false }, env);
  assert.deepEqual(st.set.dirs_off, ['veg']);
  assert.equal(R.dirEnabled('veg', st.set), false);
  assert.deepEqual(await W.admSetDirEnabled({ dir: 'veg', on: true }, env), { ok: true, enabled: true });
  assert.deepEqual(st.set.dirs_off, []);
  assert.deepEqual(st.log[0], ['Вимкнено напрямок', DIRECTIONS.veg.title]);
  assert.deepEqual(st.log[2], ['Увімкнено напрямок', DIRECTIONS.veg.title]);
  await assert.rejects(W.admSetDirEnabled({ dir: 'zz', on: true }, env), { message: 'Невідомий напрямок: "zz"' });
});

test('збій журналу не скасовує дію', async () => {
  const { env, st } = mkEnv();
  env.adm.adminLog = async () => { throw new Error('db down'); };
  assert.deepEqual(await W.admCancelOrder({ storeId: 's1', dir: 'nbhz' }, env), { removed: 3 });
  assert.deepEqual(st.q, ['nbhz']);
});

test('cancelDay: active -> cancelled з changed_at, removed = рядки; нічого -> 0 і один запит', async () => {
  const sb = fakeSb([
    { data: [{ id: 'o1', order_lines: [{ id: 1 }, { id: 2 }] }, { id: 'o2', order_lines: [{ id: 3 }] }], error: null },
    { data: [{ id: 'o1' }, { id: 'o2' }], error: null },
  ]);
  assert.equal(await createAdminData(sb).cancelDay('bread', 's1', DAY), 3);
  const [sel, upd] = sb.calls;
  assert.equal(sel.table, 'orders');
  assert.deepEqual(sel.ops.filter((o) => o[0] === 'eq'),
    [['eq', 'dir', 'bread'], ['eq', 'store_id', 's1'], ['eq', 'order_date', DAY], ['eq', 'status', 'active']]);
  const u = upd.ops.find((o) => o[0] === 'update')[1];
  assert.equal(u.status, 'cancelled'); assert.ok(u.changed_at);
  assert.deepEqual(upd.ops.find((o) => o[0] === 'in'), ['in', 'id', ['o1', 'o2']]);
  assert.ok(upd.ops.some((o) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'active'));
  const sb2 = fakeSb([{ data: [], error: null }]);
  assert.equal(await createAdminData(sb2).cancelDay('bread', 's1', DAY), 0);
  assert.equal(sb2.calls.length, 1);
});

test('cancelDay: паралельне скасування (UPDATE зачепив лише o2) -> рахуються лише його рядки', async () => {
  const sb = fakeSb([
    { data: [{ id: 'o1', order_lines: [{ id: 1 }, { id: 2 }] }, { id: 'o2', order_lines: [{ id: 3 }] }], error: null },
    { data: [{ id: 'o2' }], error: null },
  ]);
  assert.equal(await createAdminData(sb).cancelDay('bread', 's1', DAY), 1);
});

test('getSetting / setSetting: читання без кешу, upsert за ключем, помилка бази', async () => {
  const sb = fakeSb([{ data: [{ value: { bread: 'x' } }], error: null }, { data: null, error: null }]);
  const a = createAdminData(sb);
  assert.deepEqual(await a.getSetting('late_all'), { bread: 'x' });
  assert.ok(sb.calls[0].ops.some((o) => o[0] === 'eq' && o[1] === 'key' && o[2] === 'late_all'));
  await a.setSetting('dirs_off', ['veg']);
  assert.deepEqual(sb.calls[1].ops.find((o) => o[0] === 'upsert')[1], { key: 'dirs_off', value: ['veg'] });
  assert.equal(await createAdminData(fakeSb([{ data: [], error: null }])).getSetting('late_all'), null);
  await assert.rejects(createAdminData(fakeSb([{ data: null, error: { message: 'boom' } }])).getSetting('x'), { message: 'settings: boom' });
});

test('runtime: дії зміни підключені, clearMark не переноситься; app.js передає queueExport', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  for (const a of ['cancelOrder', 'openStore', 'openAll', 'closeAll', 'setDirEnabled']) assert.ok(src.includes(a + ':'), a);
  assert.ok(!src.includes('clearMark:'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8').includes('queueExport'));
});