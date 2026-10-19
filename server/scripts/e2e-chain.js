#!/usr/bin/env node
// Наскрізна перевірка ланцюжка на Fly (EXPORT_TARGET=test): тестова точка з зоною ВК -> submitOrder bakery -> вигрузка в сирий лист
// -> звіти ВК у тестовій таблиці (<= 40 с) -> скасування -> /jobs/tick -> точка зникла зі звітів. Заміри часу кожного кроку.
// ТІЛЬКИ тестові точки 'test-ch-…', ТІЛЬКИ тестова таблиця; бойові таблиці не чіпаються.
//   node scripts/e2e-chain.js run       запуск (потім cleanup)
//   node scripts/e2e-chain.js cleanup   прибрати тестові точки, замовлення, запити дозволу, рядки сирого листа і вміст трьох звітів ВК
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase } = require('../src/db');
const { DIRECTIONS } = require('../src/directions');
const { TEST_EXPORT_SPREADSHEET_ID: TID } = require('../src/export/target');
const { getValues, batchUpdate, sheetsClient, sheetIdOf, a1q } = require('../src/google');
const { call } = require('./exec-client');
const R = require('../src/rules');

const BASE = 'https://shop-orders.fly.dev';
const API = BASE + '/api';
const sb = supabase();
const TODAY = R.kyivNow(new Date());
const RUN = Date.now().toString(36);
const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-jobs-secret.txt'), 'utf8').trim();
const REPORTS = ['Заказы ВК', 'Сводная ВК', 'Маршрути ВК'];
const RAW = DIRECTIONS.bakery.rawSheet;
const IDS = ['test-ch-a', 'test-ch-b'];
const addrOf = (id) => 'Тест ланцюга ' + id;

const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storeRow = (id, i) => ({ store_id: id, active: true, label: 'ТЕСТ ' + id.slice(8), address: addrOf(id), addr_bread: addrOf(id), addr_bakery: addrOf(id),
  addr_veg: addrOf(id), addr_nbhz: addrOf(id), route: 'Харьков-17', route_nbhz: 'Новые Дома 2', zone: 'Новые дома',
  bread: false, nbhz: false, bakery: true, veg: false, sort: 9200 + i });

async function tick() {
  const t0 = Date.now();
  const res = await fetch(BASE + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': secret } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

// один batchGet на опитування (квота Sheets - 60 читань/хв): сирий лист + три звіти.
// «Заказы ВК»: заголовок блоку = адреса точки; «Маршрути ВК»: рядок з підписом точки в колонці A; «Сводная ВК»: ЗАГАЛОМ = сума кількостей.
// Точка без замовлення лишається в списку «ТТ без замовлень» (як в Apps Script) - це не «є в звіті».
async function poll() {
  const res = await sheetsClient().spreadsheets.values.batchGet({ spreadsheetId: TID, ranges: [a1q(RAW, 'A2:J'), ...REPORTS.map((n) => a1q(n, 'A:D'))], valueRenderOption: 'FORMATTED_VALUE' });
  const [raw, orders, summary, route] = res.data.valueRanges.map((v) => v.values || []);
  const total = (summary.find((r) => r[0] === 'ЗАГАЛОМ') || [])[1];
  return {
    raw: (id) => raw.filter((r) => String(r[2] || '').includes(addrOf(id)) || String(r[2] || '') === R.shortenAddress(addrOf(id))).length,
    inOrders: (id) => orders.some((r) => r[0] === addrOf(id)),
    inRoute: (id) => route.some((r) => r[0] === 'ТЕСТ ' + id.slice(8)),
    total: total == null ? null : parseInt(String(total), 10),
    stamp: (summary[0] || [''])[0].match(/оновлено (dd:dd:dd)/)?.[1] || null,
  };
}

async function run() {
  console.log(`сервер: ${BASE}, run=${RUN}, сьогодні ${TODAY.dmy} ${TODAY.time}`);
  const T = {};
  let t0 = Date.now();
  const { error } = await sb.from('stores').upsert(IDS.map((id, i) => storeRow(id, i)), { onConflict: 'store_id' });
  if (error) throw new Error('stores: ' + error.message);
  const rows = IDS.map((id) => ({ dir: 'bakery', store_id: id, req_date: TODAY.day, status: 'approved', requested_at: new Date().toISOString(), approved_at: new Date().toISOString() }));
  const up = await sb.from('late_requests').upsert(rows, { onConflict: 'dir,store_id,req_date' });
  if (up.error) throw new Error('late_requests: ' + up.error.message);
  await sleep(31000);                                                   // кеш stores на сервері - 30 с
  T.setup = Date.now() - t0;

  const lists = {};
  for (const id of IDS) {
    const r = (await call(API, 'products', { dir: 'bakery', storeId: id })).body;
    if (!r.ok) throw new Error('products: ' + r.error);
    lists[id] = r.data.products.filter((p) => p.price > 0).slice(0, 2);
  }

  // 1. відправка обох замовлень майже одночасно (перше відкриває вікно дебаунсу, друге входить у ту саму перебудову)
  const subAt = {};
  for (const id of IDS) {
    const items = lists[id].map((p, i) => ({ id: p.id, qty: i + 2 }));
    const s = Date.now();
    const r = await call(API, 'submitOrder', { dir: 'bakery', storeId: id, orderId: `ch-${RUN}-${id}`, items });
    if (!r.body.ok) throw new Error('submitOrder: ' + r.body.error);
    subAt[id] = { start: s, done: Date.now() };
    console.log(`  submit ${id}: ${subAt[id].done - s} мс`);
  }
  const t1 = subAt[IDS[0]].done;

  // 2. рядки в сирому листі; 3. звіти
  const seen = { raw: {}, rep: null, repStamp: null };
  const expTotal = IDS.reduce((n, id) => n + lists[id].reduce((m, p, i) => m + i + 2, 0), 0);
  for (;;) {
    const now = Date.now() - t1;
    const p = await poll();
    for (const id of IDS) if (seen.raw[id] == null && p.raw(id) >= lists[id].length) seen.raw[id] = now;
    if (seen.rep == null && IDS.every((id) => p.inOrders(id) && p.inRoute(id)) && p.total === expTotal) { seen.rep = now; seen.repStamp = p.stamp; }
    if (seen.rep != null || now > 75000) break;
    await sleep(2500);
  }
  for (const id of IDS) {
    console.log(`  ${id}: рядки в сирому листі через ${seen.raw[id]} мс після відповіді submit`);
    check(`${id}: сирі рядки з'явились`, seen.raw[id] != null);
  }
  console.log(`  звіти ВК (обидві точки, сума ${expTotal}) з'явились через ${seen.rep} мс після відповіді першого submit, «оновлено» ${seen.repStamp}`);
  check('обидві точки в «Заказы ВК» і «Маршрути ВК», сума в «Сводная ВК» — за <= 40 с після відповіді submit', seen.rep != null && seen.rep <= 40000, seen.rep == null ? 'не зявились за 75 с' : seen.rep + ' мс');

  // 4. скасування однієї точки -> tick -> зникла зі звітів, друга лишилась
  const dbo = (await sb.from('orders').select('id').eq('dir', 'bakery').eq('store_id', IDS[0]).eq('order_date', TODAY.day)).data;
  const c0 = Date.now();
  const cu = await sb.from('orders').update({ status: 'cancelled', changed_at: new Date().toISOString() }).eq('id', dbo[0].id);
  if (cu.error) throw new Error(cu.error.message);
  const tk = await tick();
  console.log(`  tick після скасування ${IDS[0]}: ${tk.status}, ${tk.ms} мс; export.bakery=${JSON.stringify(tk.body.export && tk.body.export.bakery)}; reports=${JSON.stringify(tk.body.reports)}`);
  check('tick 200 і reports перебудовані', tk.status === 200 && tk.body.ok === true && tk.body.reports && Array.isArray(tk.body.reports.sheets));
  const pp = await poll();
  console.log(`  від скасування до перевірки: ${Date.now() - c0} мс`);
  check(`${IDS[0]} зникла зі звітів (нема блоку в «Заказы ВК», нема в «Маршрути ВК», сума ${expTotal - lists[IDS[0]].reduce((m, p, i) => m + i + 2, 0)})`, !pp.inOrders(IDS[0]) && !pp.inRoute(IDS[0]) && pp.total === expTotal - lists[IDS[0]].reduce((m, p, i) => m + i + 2, 0), `orders=${pp.inOrders(IDS[0])} route=${pp.inRoute(IDS[0])} total=${pp.total}`);
  check(`${IDS[0]} зникла із сирого листа`, pp.raw(IDS[0]) === 0);
  check(`${IDS[1]} лишилась у звітах`, pp.inOrders(IDS[1]) && pp.inRoute(IDS[1]));
  const t2 = await tick();
  check('повторний tick звіти не переписує (без змін)', t2.body.reports && t2.body.reports.skipped === 'без змін', JSON.stringify(t2.body.reports));
  console.log('\nпідсумок: setup ' + T.setup + ' мс (з очікуванням кешу stores 31 с);', 'tick ' + tk.ms + ' мс');
}

async function cleanup() {
  const like = 'test-ch-%';
  await sb.from('orders').delete().like('store_id', like);
  await sb.from('late_requests').delete().like('store_id', like);
  await sb.from('stores').delete().like('store_id', like);
  const left = {};
  for (const t of ['orders', 'late_requests', 'stores']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).like('store_id', like);
    left[t] = count;
  }
  console.log('після прибирання test-ch у базі:', JSON.stringify(left));
  const sid = await sheetIdOf(TID, RAW);
  const colA = await getValues(TID, a1q(RAW, 'A:A'));
  if (colA.length > 1) await batchUpdate(TID, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: colA.length } } }]);
  for (const n of REPORTS) await sheetsClient().spreadsheets.values.clear({ spreadsheetId: TID, range: a1q(n, 'A1:D') });
  console.log(`тестова таблиця: «${RAW}» рядків з даними ${(await getValues(TID, a1q(RAW, 'A:A'))).length - 1}; звіти ВК очищені`);
}

(async () => {
  const phase = process.argv[2];
  if (phase === 'run') await run();
  else if (phase === 'cleanup') await cleanup();
  else throw new Error('використання: e2e-chain.js run|cleanup');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
