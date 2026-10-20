const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const T = require('../src/admin/tools');
const { createAdminData } = require('../src/admin/data');

const AT = new Date('2026-10-20T10:00:00+03:00');
const DAY = '2026-10-20';
const S = T.HEALTH_STALE_MIN;
const hm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const byKey = (r) => Object.fromEntries(r.dirs.map((d) => [d.key, d]));

function mkEnv(o = {}) {
  const st = { log: [], set: o.set || {} };
  const env = { at: AT, log: () => {},
    data: { settings: async () => o.settings || { app_version: 'v1' },
      orderedToday: async (d) => { st.day = d; if (o.failOrders) throw new Error('x'); return o.ordered || {}; } },
    adm: { reportAts: async () => o.ats || {}, adminLog: async (a, d) => { st.log.push([a, d]); },
      getSetting: async (k) => { if (o.failGet) throw new Error('db'); return k in st.set ? st.set[k] : null; },
      setSetting: async (k, v) => { st.set[k] = v; },
      storeRow: async (id) => (o.rows || {})[id] || null } };
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

test('health: усе гаразд -> ok, «Всё работает», 4 напрямки, без тригерів', async () => {
  const { env, st } = mkEnv();
  const r = await T.admHealth(env);
  assert.equal(r.level, 'ok'); assert.equal(r.summary, 'Всё работает'); assert.equal(r.time, '10:00');
  assert.deepEqual(r.dirs.map((d) => d.key), Object.keys(DIRECTIONS));
  assert.deepEqual(r.dirs[0], { key: 'bread', title: DIRECTIONS.bread.title, level: 'ok', text: 'Отчёт сегодня не собирался · заказали 0' });
  assert.deepEqual(r.triggers, []); assert.equal(r.sys.version, 'v1'); assert.equal(r.sys.test, false);
  assert.equal(st.day, DAY);
});

test('health: є замовлення, звіт не збирався (або вчора) -> bad', async () => {
  const yest = new Date(AT - 86400000).toISOString();
  const { env } = mkEnv({ ordered: { bread: new Set(['s1', 's2']) }, ats: { bread: yest } });
  const r = await T.admHealth(env);
  assert.deepEqual(byKey(r).bread, { key: 'bread', title: DIRECTIONS.bread.title, level: 'bad', text: 'Есть заказы (2 точек), а отчёт сегодня не собирался' });
  assert.equal(r.level, 'bad'); assert.equal(r.summary, 'Требует внимания: 1');
});

test('health: звіт старший за HEALTH_STALE_MIN до дедлайну+60 -> warn; свіжий -> ok', async () => {
  const old = new Date(AT - (S + 5) * 60000), fresh = new Date(AT - 5 * 60000);
  const { env } = mkEnv({ ordered: { bread: new Set(['s1']), nbhz: new Set(['s1']) }, ats: { bread: old.toISOString(), nbhz: fresh.toISOString() } });
  const d = byKey(await T.admHealth(env));
  assert.equal(d.bread.level, 'warn');
  assert.equal(d.bread.text, 'Отчёт собран ' + (S + 5) + ' мин назад, в ' + hm(old) + ' · заказали 1');
  assert.deepEqual([d.nbhz.level, d.nbhz.text], ['ok', 'Отчёт в ' + hm(fresh) + ' · заказали 1']);
});

test('health: вимкнений напрямок -> off, не проблема', async () => {
  const { env } = mkEnv({ settings: { dirs_off: ['veg'] } });
  const r = await T.admHealth(env);
  assert.deepEqual([byKey(r).veg.level, byKey(r).veg.text], ['off', 'Направление выключено']);
  assert.equal(r.level, 'ok');
});

test('health: замовлення не читаються -> усі напрямки bad', async () => {
  const { env } = mkEnv({ failOrders: true });
  const r = await T.admHealth(env);
  r.dirs.forEach((d) => assert.deepEqual([d.level, d.text], ['bad', 'Не читается база заказов']));
  assert.equal(r.summary, 'Требует внимания: ' + r.dirs.length);
});

test('health: помилки сьогодні -> warn, позначка today; test_mode -> bad', async () => {
  const errs = [{ at: '20.10 09:00', where: 'пульт: x', msg: 'm' }, { at: '19.10 09:00', where: 'y', msg: 'n' }];
  let r = await T.admHealth(mkEnv({ settings: { health_err: errs } }).env);
  assert.deepEqual(r.errors.map((e) => e.today), [true, false]);
  assert.equal(r.level, 'warn'); assert.equal(r.summary, 'Требует внимания: 1');
  r = await T.admHealth(mkEnv({ settings: { test_mode: true } }).env);
  assert.equal(r.level, 'bad'); assert.equal(r.sys.test, true);
});

test('noteError: нова першою, не більше 20, текст до 300; збій бази не кидає', async () => {
  const set = { health_err: Array.from({ length: 20 }, (_, i) => ({ at: 'x', where: 'w' + i, msg: '' })) };
  const { env, st } = mkEnv({ set });
  await T.noteError(env.adm, 'пульт: today', 'м'.repeat(400), AT);
  assert.equal(st.set.health_err.length, 20);
  assert.deepEqual({ ...st.set.health_err[0], msg: st.set.health_err[0].msg.length }, { at: '20.10 10:00', where: 'пульт: today', msg: 300 });
  assert.equal(st.set.health_err[1].where, 'w0');
  await T.noteError(mkEnv({ failGet: true }).env.adm, 'a', 'b', AT);
});

test('healthClear: список очищено, журнал дослівно', async () => {
  const { env, st } = mkEnv({ set: { health_err: [{ at: 'x' }] } });
  assert.deepEqual(await T.admHealthClear(env), { ok: true });
  assert.deepEqual(st.set.health_err, []);
  assert.deepEqual(st.log, [['Очищено список помилок', '']]);
});

test('card: поля з бази, дні «Пн, Ср … Вс», напрямки -> прапорці; нема точки -> текст findStore_', async () => {
  const row = { store_id: 's1', active: true, label: ' Магазин 1 ', address: 'вул. А, 1', code: '12', route: 'М1',
    addr_bread: 'аб', addr_bakery: 'ав', addr_veg: 'ао', addr_nbhz: 'ан', route_nbhz: 'Н2', zone: 'Центр', edrpou: '45672783',
    days: { veg: [3, 1], bakery: [0, 6] }, directions: ['bread', 'veg'] };
  const { env } = mkEnv({ rows: { s1: row } });
  const c = await T.admCard({ storeId: 's1' }, env);
  assert.equal(c.id, 's1'); assert.equal(c.row, null); assert.equal(c.label, 'Магазин 1'); assert.equal(c.address, 'вул. А, 1');
  assert.deepEqual(c.addr, { bread: 'аб', bakery: 'ав', veg: 'ао', nbhz: 'ан' });
  assert.deepEqual(c.f, { active: true, label: 'Магазин 1', code: '12', route: 'М1', bread: true, bakery: false, veg: true, note: '',
    nbhz: false, routeNbhz: 'Н2', daysVeg: 'Пн, Ср', daysBakery: 'Сб, Вс', zone: 'Центр', edrpou: '45672783' });
  assert.deepEqual(c.zones, ['Салтовка', 'Новые дома', 'Центр', 'не возится']);
  assert.equal(c.defEdrpou, '44413718');
  await assert.rejects(T.admCard({ storeId: 'nope' }, env), { message: 'Торгову точку не знайдено. Оновіть сторінку.' });
});

test('data.storeRow: за store_id, неактивні теж; нема -> null', async () => {
  const sb = fakeSb([{ data: [{ store_id: 's1' }], error: null }, { data: [], error: null }]);
  const a = createAdminData(sb);
  assert.deepEqual(await a.storeRow('s1'), { store_id: 's1' });
  assert.ok(sb.calls[0].ops.some((o) => o[0] === 'eq' && o[1] === 'store_id' && o[2] === 's1'));
  assert.ok(!sb.calls[0].ops.some((o) => o[0] === 'eq' && o[1] === 'active'));
  assert.equal(await a.storeRow('x'), null);
});

test('runtime: health, healthClear, card підключені; cardSave ні; помилки пульта -> noteError', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  for (const a of ['health:', 'healthClear:', 'card:']) assert.ok(src.includes(a), a);
  assert.ok(!src.includes('cardSave:')); assert.ok(src.includes('noteError'));
});