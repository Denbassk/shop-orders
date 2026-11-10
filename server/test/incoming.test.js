// Ціни з приходів (BigQuery incoming_transactions): порівняння з прайсом, перегляд/застосування з пульта, автоперевірка в tick.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/incoming');
const A = require('../src/admin/incoming');
const { flatten } = require('../src/bigquery');

const AT = new Date('2026-11-10T12:00:00+02:00');
const prods = () => [
  { id: '482001', barcode: '482001', name: 'Батон', price: 24.06, status: 'active', sort: 1 },
  { id: '482002', barcode: '482002', name: 'Сушки', price: 32.16, status: 'active', sort: 2 },
  { id: '482003', barcode: '482003', name: 'Лаваш', price: 23.64, status: 'stop', sort: 3 },
  { id: '482004', barcode: '482004', name: 'Без приходу', price: 10, status: 'active', sort: 4 },
  { id: 'nb:x', barcode: '', name: 'Без штрихкоду', price: 5, status: 'active', sort: 5 },
  { id: '482006', barcode: '482006', name: 'Без змін', price: 20, status: 'active', sort: 6 },
];
const inc = () => [
  { barcode: '482001', name: 'Рома Батон', price: 25.26, docDate: '2026-11-08' },
  { barcode: '482002', name: 'Рома Сушки', price: 39.06, docDate: '2026-11-08' },
  { barcode: ' 482003 ', name: 'Рома Лаваш', price: 70, docDate: '2026-10-29' },        // +196% - підозріла зміна
  { barcode: '482006', name: 'Рома Без змін', price: 20, docDate: '2026-11-08' },
  { barcode: '999999', name: 'Чужий', price: 11, docDate: '2026-11-08' },
  { barcode: '482004', name: 'Нульова', price: 0, docDate: '2026-11-08' },
];

test('planIncoming: лише змінені за штрихкодом, було -> стало, % і прапор big (>30%)', () => {
  const r = I.planIncoming(prods(), inc());
  assert.deepEqual(r.rows.map((x) => [x.id, x.old, x.new, x.pct, x.big, x.docDate]), [
    ['482001', 24.06, 25.26, 5, false, '2026-11-08'],
    ['482002', 32.16, 39.06, 21.5, false, '2026-11-08'],
    ['482003', 23.64, 70, 196.1, true, '2026-10-29'],
  ]);
  assert.equal(r.rows[2].stop, true);
});

test('planIncoming: позиції без приходу чи штрихкоду і прихід з ціною 0 не чіпаються; noIncoming рахує позиції з ШК без приходу', () => {
  const r = I.planIncoming(prods(), inc());
  assert.ok(!r.rows.some((x) => x.id === '482004' || x.id === 'nb:x'));
  assert.equal(r.noIncoming, 1);      // 482004 (прихід з ціною 0 не враховується); без штрихкоду - не рахуємо
});

test('planIncoming: ціна з копійками порівнюється точно (24.06 == 24.060000001)', () => {
  const r = I.planIncoming([{ id: 'a', barcode: 'a', name: 'A', price: 24.06, status: 'active', sort: 1 }], [{ barcode: 'a', name: 'A', price: 24.060000001, docDate: '2026-11-01' }]);
  assert.equal(r.rows.length, 0);
});

test('flatten: схема BigQuery -> об\'єкти, FLOAT/INTEGER числами, DATE рядком', () => {
  const data = { schema: { fields: [{ name: 'barcode', type: 'STRING' }, { name: 'price', type: 'FLOAT' }, { name: 'doc_date', type: 'DATE' }, { name: 'n', type: 'INTEGER' }] },
    rows: [{ f: [{ v: '482001' }, { v: '25.26' }, { v: '2026-11-08' }, { v: '3' }] }, { f: [{ v: null }, { v: null }, { v: null }, { v: null }] }] };
  assert.deepEqual(flatten(data), [{ barcode: '482001', price: 25.26, doc_date: '2026-11-08', n: 3 }, { barcode: null, price: null, doc_date: null, n: null }]);
  assert.deepEqual(flatten({ schema: { fields: [] } }), []);
});

test('fetchIncoming: параметри запиту (постачальники, дні) і відображення рядків; запит лише на читання', async () => {
  let got;
  const bq = { query: async (sql, params) => { got = { sql, params }; return [{ barcode: '482001', name: 'Рома Батон', price: 25.26, doc_date: '2026-11-08' }, { barcode: null, name: 'x', price: 1, doc_date: '2026-11-08' }]; } };
  const rows = await I.fetchIncoming(bq, I.INCOMING.bread);
  assert.deepEqual(rows, [{ barcode: '482001', name: 'Рома Батон', price: 25.26, docDate: '2026-11-08' }]);   // без штрихкоду - відкинуто
  assert.deepEqual(got.params.suppliers, ['ТОВ КВФ Рома', 'ТОВ Рома']);
  assert.equal(got.params.days, 45);
  assert.match(got.sql, /incoming_transactions/);
  assert.doesNotMatch(got.sql, /\b(insert|update|delete|drop|merge)\b/i);
});

function mk(o = {}) {
  const st = { rows: o.rows || prods(), set: [], log: [], settings: o.settings || {}, fetches: 0 };
  const env = { at: o.at || AT, log: () => {},
    incoming: { fetch: async () => { st.fetches++; if (o.fail) throw new Error('bq лежить'); return (o.inc || inc()).map((x) => ({ ...x })); } },
    adm: {
      dirProducts: async () => st.rows.map((r) => ({ ...r })),
      setProduct: async (dir, id, patch) => { st.set.push([dir, id, patch]); const r = st.rows.find((x) => x.id === id); if (!r) return false; Object.assign(r, patch); return true; },
      adminLog: async (a, d) => { st.log.push([a, d]); },
      getSetting: async (k) => (k in st.settings ? st.settings[k] : null),
      setSetting: async (k, v) => { st.settings[k] = v; },
    } };
  return { env, st };
}

test('incomingPreview: нічого не пише; рядки, суми, кількість big; лише напрямок із приходами', async () => {
  const { env, st } = mk();
  const r = await A.admIncomingPreview({ dir: 'bread' }, env);
  assert.equal(r.n, 3); assert.equal(r.big, 1);
  assert.deepEqual([r.sumOld, r.sumNew], [79.86, 134.32]);
  assert.equal(st.set.length, 0);
  await assert.rejects(A.admIncomingPreview({ dir: 'veg' }, env), /не підтримується/);
  await assert.rejects(A.admIncomingPreview({ dir: '__proto__' }, env), /Невідомий напрямок/);
});

test('incomingApply: пише лише збіжні з прихodом рядки, журнал «за приходами», оновлює підсумок у settings', async () => {
  const { env, st } = mk();
  const r = await A.admIncomingApply({ dir: 'bread', rows: [{ id: '482001', old: 24.06, new: 25.26 }, { id: '482002', old: '32,16', new: '39.06' }] }, env);
  assert.equal(r.changed, 2);
  assert.deepEqual(st.set, [['bread', '482001', { price: 25.26 }], ['bread', '482002', { price: 39.06 }]]);
  assert.equal(st.log.length, 1); assert.equal(st.log[0][0], 'Змінено ціни'); assert.match(st.log[0][1], /за приходами/); assert.match(st.log[0][1], /Батон 24.06 → 25.26/);
  assert.equal(st.settings.incoming_price_changes.dirs.bread.n, 1);       // лишилась тільки підозріла 482003
});

test('incomingApply: ціна з клієнта не збігається з приходом (чи прайс змінився) - помилка ДО запису', async () => {
  const { env, st } = mk();
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [{ id: '482001', old: 24.06, new: 99 }] }, env), /змінивс|Оновіть/);
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [{ id: '482001', old: 20, new: 25.26 }] }, env), /змінивс|Оновіть/);
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [{ id: '482006', old: 20, new: 20 }] }, env), /змінивс|Оновіть/);   // зміни немає
  assert.equal(st.set.length, 0);
});

test('incomingApply: порожній список, дубль, невідомий id - помилка; підозрілу (big) явно обрану - можна', async () => {
  const { env, st } = mk();
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [] }, env), /Оберіть/);
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [{ id: '482001', old: 24.06, new: 25.26 }, { id: '482001', old: 24.06, new: 25.26 }] }, env), /двічі/);
  await assert.rejects(A.admIncomingApply({ dir: 'bread', rows: [{ id: 'nope', old: 1, new: 2 }] }, env), /Оновіть/);
  await A.admIncomingApply({ dir: 'bread', rows: [{ id: '482003', old: 23.64, new: 70 }] }, env);
  assert.equal(st.rows.find((x) => x.id === '482003').price, 70);
});

test('checkIncomingPrices: підсумок у settings, одне повідомлення в журнал на новий набір змін, прайс не міняється', async () => {
  const { env, st } = mk();
  const r1 = await A.checkIncomingPrices(env);
  assert.equal(r1.bread.n, 3); assert.equal(r1.bread.notified, true);
  assert.equal(st.set.length, 0);
  const s = st.settings.incoming_price_changes;
  assert.equal(s.checkedAt, AT.toISOString()); assert.equal(s.dirs.bread.n, 3); assert.equal(s.dirs.bread.big, 1);
  assert.deepEqual(s.dirs.bread.items[0], { name: 'Батон', old: 24.06, new: 25.26 });
  assert.equal(st.log.length, 1); assert.equal(st.log[0][0], 'Змінилась вхідна ціна'); assert.match(st.log[0][1], /Сушки 32.16 → 39.06/);
  // той самий набір - вдруге в журнал не пишемо
  env.at = new Date(AT.getTime() + 4 * 3600 * 1000);
  const r2 = await A.checkIncomingPrices(env);
  assert.equal(r2.bread.notified, false); assert.equal(st.log.length, 1);
});

test('checkIncomingPrices: свіжа перевірка (<3 год) - пропуск без запиту; force обходить', async () => {
  const { env, st } = mk();
  await A.checkIncomingPrices(env);
  env.at = new Date(AT.getTime() + 60 * 60000);
  assert.deepEqual(await A.checkIncomingPrices(env), { skipped: 'перевірка свіжа' });
  assert.equal(st.fetches, 1);
  await A.checkIncomingPrices(env, { force: true });
  assert.equal(st.fetches, 2);
});

test('checkIncomingPrices: збій BigQuery - виняток, старий підсумок не затирається', async () => {
  const { env, st } = mk({ fail: true, settings: { incoming_price_changes: { checkedAt: '2026-11-09T10:00:00.000Z', dirs: { bread: { n: 2, big: 0, sig: 'x', items: [] } } } } });
  await assert.rejects(A.checkIncomingPrices(env), /bq лежить/);
  assert.equal(st.settings.incoming_price_changes.dirs.bread.n, 2);
});

test('checkIncomingPrices: змін нема - n = 0, у журнал нічого; після змін підсумок обнуляється', async () => {
  const { env, st } = mk({ inc: [{ barcode: '482006', name: 'Без змін', price: 20, docDate: '2026-11-08' }] });
  const r = await A.checkIncomingPrices(env);
  assert.equal(r.bread.n, 0); assert.equal(st.log.length, 0);
  assert.equal(st.settings.incoming_price_changes.dirs.bread.n, 0);
});

test('incomingBanner: з settings -> { dir: { n, big, checkedAt } } лише де n > 0', () => {
  const s = { incoming_price_changes: { checkedAt: 'T', dirs: { bread: { n: 3, big: 1, sig: 's', items: [] }, nbhz: { n: 0, big: 0, sig: '', items: [] } } } };
  assert.deepEqual(A.incomingBanner(s), { bread: { n: 3, big: 1, checkedAt: 'T' } });
  assert.deepEqual(A.incomingBanner({}), {});
  assert.deepEqual(A.incomingBanner({ incoming_price_changes: 'мусор' }), {});
});

// ---- проводка: tick, «Здоров'я», пульт ----
const fs = require('node:fs');
const path = require('node:path');
const { tick } = require('../src/jobs');
const { collectTickErrors } = require('../src/errors');
const tickEnv = (extra) => ({ at: AT, data: { unmailedLate: async () => [] }, mailer: { recipient: () => '' }, ...extra });

test('tick: автоперевірка цін з приходів, результат у out.incoming; збій не ламає решту', async () => {
  const ok = await tick(tickEnv({ checkIncoming: async () => ({ bread: { n: 2 } }) }), async () => ({ bread: 'ok' }));
  assert.deepEqual(ok.incoming, { bread: { n: 2 } });
  const bad = await tick(tickEnv({ checkIncoming: async () => { throw new Error('bq лежить'); } }), async () => ({ bread: 'ok' }));
  assert.deepEqual(bad.incoming, { error: 'bq лежить' });
  assert.deepEqual(bad.export, { bread: 'ok' });
  assert.equal('incoming' in (await tick(tickEnv({}), async () => ({}))), false);
});

test('collectTickErrors: збій цін з приходів -> «Здоров\'я»; «skipped» - не помилка', () => {
  assert.deepEqual(collectTickErrors({ incoming: { error: 'bq лежить' } }), [{ where: 'ціни з приходів', msg: 'bq лежить' }]);
  assert.deepEqual(collectTickErrors({ incoming: { skipped: 'перевірка свіжа' } }), []);
});

test('runtime: checkIncoming у tick, клієнт BigQuery лише через bigquery.js; пульт: дії incomingPreview/incomingApply', () => {
  const rt = fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8');
  assert.match(rt, /checkIncoming/);
  const ar = fs.readFileSync(path.join(__dirname, '../src/admin/runtime.js'), 'utf8');
  assert.match(ar, /incomingPreview: \(p\) => incoming\.admIncomingPreview\(p, env\(\)\)/);
  assert.match(ar, /incomingApply: \(p\) => incoming\.admIncomingApply\(p, env\(\)\)/);
  assert.match(ar, /incoming: \{ fetch:/);
});

test('admToday і admAssortment віддають блок incoming', async () => {
  const { admAssortment } = require('../src/admin/assortment');
  const { env } = mk({ settings: { incoming_price_changes: { checkedAt: 'T', dirs: { bread: { n: 3, big: 1, sig: 's', items: [] } } } } });
  const r = await admAssortment({ dir: 'bread' }, env);
  assert.deepEqual(r.incoming, { enabled: true, n: 3, big: 1, checkedAt: 'T' });
  assert.equal((await admAssortment({ dir: 'veg' }, env)).incoming, null);
  const read = fs.readFileSync(path.join(__dirname, '../src/admin/read.js'), 'utf8');
  assert.match(read, /incoming: incomingBanner\(settings\)/);
});
