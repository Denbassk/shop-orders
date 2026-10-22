#!/usr/bin/env node
// Наскрізна перевірка сторінки закупниці на Fly (EXPORT_TARGET=test), тестова точка test-by-a, напрямок nbhz, лише тестова таблиця:
// запит дозволу від продавця -> закупниця бачить запит -> «Прийом» (дозвіл після дедлайну) -> продавець відправляє -> «Сьогодні» бачить заказ ->
// правка кількості -> видалення (рядки зникають з листа) -> продавець може замовити знову -> «Відкрити всім»/«Закрити» -> чистка.
//   node scripts/e2e-buyer.js
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase } = require('../src/db');
const { DIRECTIONS } = require('../src/directions');
const { TEST_EXPORT_SPREADSHEET_ID: TID } = require('../src/export/target');
const { getValues, batchUpdate, sheetIdOf, a1q } = require('../src/google');
const { buyerKey } = require('../src/buyer/link');
const { call } = require('./exec-client');
const R = require('../src/rules');

const BASE = 'https://shop-orders.fly.dev', API = BASE + '/api';
const sb = supabase();
const TODAY = R.kyivNow(new Date());
const ID = 'test-by-a', DIR = 'nbhz';
const KEY = buyerKey('hlib', process.env.BUYER_LINK_SECRET);
const RUN = Date.now().toString(36);
const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function buy(action, payload = {}) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/buyer/hlib/${KEY}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, payload: { dir: DIR, ...payload } }) });
  const j = await r.json().catch(() => ({ ok: false, error: 'не JSON ' + r.status }));
  return { ...j, ms: Date.now() - t0 };
}
const rawRows = async () => (await getValues(TID, a1q(DIRECTIONS[DIR].rawSheet, 'A2:G'), { formatted: true })).filter((r) => String(r[2]).includes('Тест закупниці'));
async function waitRaw(n, maxMs = 15000) {
  const t0 = Date.now();
  for (;;) { const r = await rawRows(); if (r.length === n || Date.now() - t0 > maxMs) return { rows: r, ms: Date.now() - t0 }; await sleep(700); }
}

async function run() {
  console.log(`${BASE}, закупниця hlib, ${TODAY.dmy} ${TODAY.time}`);
  const st = { store_id: ID, active: true, label: 'ТЕСТ by-a', address: 'Тест закупниці by-a', addr_bread: 'Тест закупниці by-a', addr_bakery: 'Тест закупниці by-a', addr_veg: 'Тест закупниці by-a',
    addr_nbhz: 'Тест закупниці by-a', route: 'Харьков-17', route_nbhz: 'Новые Дома 2', code: '779', zone: 'Новые дома', edrpou: '', bread: false, nbhz: true, bakery: false, veg: false, sort: 9500 };
  const up = await sb.from('stores').upsert(st, { onConflict: 'store_id' });
  if (up.error) throw new Error(up.error.message);
  await sleep(31000);

  const me = await buy('me');
  check('закупниця: me ok, напрямки hlib', me.ok && JSON.stringify(me.data).includes('nbhz'), me.error);

  // 1-2. запит дозволу від продавця після дедлайну
  const prods = (await call(API, 'products', { dir: DIR, storeId: ID }));
  console.log('  products до дозволу:', prods.body.ok ? 'ok' : prods.body.error);
  const rl = await call(API, 'requestLate', { dir: DIR, storeId: ID });
  check('продавець: requestLate ok', rl.body.ok, rl.body.error);
  let late = await buy('late');
  check('закупниця бачить запит (pending)', late.ok && late.data.list.some((x) => x.storeId === ID && x.status === 'pending'), late.error || JSON.stringify(late.data && late.data.list).slice(0, 200));

  // 3. прийом
  const ap = await buy('approve', { storeId: ID });
  check('«Прийом»: дозвіл видано', ap.ok, ap.error);
  late = await buy('late');
  check('статус запиту approved', late.ok && late.data.list.some((x) => x.storeId === ID && x.status === 'approved'));

  // 4. продавець замовляє після дедлайну
  const list = (await call(API, 'products', { dir: DIR, storeId: ID })).body.data.products.slice(0, 2);
  const items = list.map((p, i) => ({ id: p.id, qty: i + 2 }));
  const sub = await call(API, 'submitOrder', { dir: DIR, storeId: ID, orderId: `by-${RUN}-1`, items });
  check('продавець: заказ після дедлайну з дозволом ok', sub.body.ok, sub.body.error);

  // 5. «Сьогодні» закупниці
  const td = await buy('today');
  const mine = td.ok && (td.data.list || td.data.stores || []).find((x) => x.storeId === ID);
  check('закупниця: «Сьогодні» бачить заказ', !!mine && mine.n === 2, td.error || JSON.stringify(td.data).slice(0, 200));
  const got = await waitRaw(2);
  check('рядки в сирому листі тестової таблиці (вигрузка)', got.rows.length === 2, `${got.ms} мс`);

  // 6. правка кількості
  const line = mine.lines[0];
  const ed = await buy('editOrder', { storeId: ID, changes: [{ row: line.row, name: line.name, oldQty: line.qty, qty: line.qty + 5 }] });
  check('закупниця: правка кількості ok', ed.ok, ed.error);
  await sleep(6000);
  const after = await rawRows();
  check('кількість у листі змінилась', after.some((r) => Number(String(r[6]).replace(',', '.')) === line.qty + 5), JSON.stringify(after.map((r) => r[6])));

  // 7. видалення
  const rm = await buy('remove', { storeId: ID });
  check('закупниця: «Видалити» ok', rm.ok && rm.data.removed >= 1, rm.error || rm.data.message);
  const gone = await waitRaw(0);
  check('рядки зникли з листа', gone.rows.length === 0, `${gone.ms} мс`);
  const again = await call(API, 'submitOrder', { dir: DIR, storeId: ID, orderId: `by-${RUN}-2`, items });
  check('продавець може замовити знову після видалення', again.body.ok, again.body.error);

  // 8. відкрити всім / закрити
  const oa = await buy('openAll');
  check('«Відкрити всім до кінця дня» ok', oa.ok, oa.error);
  const ca = await buy('closeAll');
  check('«Закрити» (звичайний режим) ok', ca.ok, ca.error);
}

async function cleanup() {
  await sb.from('orders').delete().eq('store_id', ID);
  await sb.from('late_requests').delete().eq('store_id', ID);
  await sb.from('stores').delete().eq('store_id', ID);
  await sb.from('admin_log').delete().like('details', '%ТЕСТ by-a%');
  const sid = await sheetIdOf(TID, DIRECTIONS[DIR].rawSheet);
  const colA = await getValues(TID, a1q(DIRECTIONS[DIR].rawSheet, 'A:A'));
  if (colA.length > 1) await batchUpdate(TID, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: colA.length } } }]);
  const left = await sb.from('orders').select('*', { count: 'exact', head: true }).eq('store_id', ID);
  console.log(`прибрано: замовлень ${left.count}, рядків у сирому листі НБХЗ тестової таблиці ${(await getValues(TID, a1q(DIRECTIONS[DIR].rawSheet, 'A:A'))).length - 1}`);
}

(async () => {
  try { await run(); } catch (e) { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; }
  await cleanup();
})();
