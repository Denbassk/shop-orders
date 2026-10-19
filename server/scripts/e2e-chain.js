#!/usr/bin/env node
// Наскрізна перевірка ланцюжка на Fly (EXPORT_TARGET=test) для напрямку bakery | bread | veg | nbhz:
// тестова точка -> submitOrder -> вигрузка в сирий лист -> звіт напрямку у тестовій таблиці (<= 40 с) -> скасування -> /jobs/tick ->
// точка зникла зі звіту. Заміри часу кожного кроку. ТІЛЬКИ тестові точки 'test-ch-…', ТІЛЬКИ тестова таблиця; бойові таблиці не чіпаються.
//   node scripts/e2e-chain.js run <dir>       запуск (потім cleanup <dir>)
//   node scripts/e2e-chain.js cleanup <dir>   прибрати тестові точки, замовлення, запити дозволу, рядки сирого листа і вміст звітів напрямку
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
const { reportSheets } = require('../src/reports/liveRead');

const BASE = 'https://shop-orders.fly.dev';
const API = BASE + '/api';
const sb = supabase();
const TODAY = R.kyivNow(new Date());
const RUN = Date.now().toString(36);
const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-jobs-secret.txt'), 'utf8').trim();
const IDS = ['test-ch-a', 'test-ch-b'];
const addrOf = (id) => 'Тест ланцюга ' + id;

const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// у тестовій таблиці лист «Завантаження» НБХЗ має іншу назву (хлібний займає «Завантаження»)
const testName = (dir, name) => (dir === 'nbhz' && name === 'Завантаження' ? 'Завантаження НБХЗ' : name);

const storeRow = (id, i) => ({ store_id: id, active: true, label: 'ТЕСТ ' + id.slice(8), address: addrOf(id), addr_bread: addrOf(id), addr_bakery: addrOf(id),
  addr_veg: addrOf(id), addr_nbhz: addrOf(id), route: 'Харьков-17', route_nbhz: 'Новые Дома 2', zone: 'Новые дома',
  bread: true, nbhz: true, bakery: true, veg: true, sort: 9200 + i });

async function tick() {
  const t0 = Date.now();
  const res = await fetch(BASE + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': secret } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

// Один batchGet на опитування (квота Sheets - 60 читань/хв): сирий лист + листи звітів напрямку у тестовій таблиці.
// Точка "є у звіті", якщо її адреса (без регістру) є в тексті головного листа звіту; точка без замовлення лишається у списку
// «ТТ без замовлень» за назвою (ТЕСТ a), а не за адресою - тож адреса означає саме замовлення.
async function poll(dir) {
  const cfg = DIRECTIONS[dir];
  const sheets = reportSheets(dir, TODAY.dmy);
  const res = await sheetsClient().spreadsheets.values.batchGet({ spreadsheetId: TID,
    ranges: [a1q(cfg.rawSheet, 'A2:J'), a1q(testName(dir, sheets[0].name), 'A:CB')], valueRenderOption: 'FORMATTED_VALUE' });
  const [raw, primary] = res.data.valueRanges.map((v) => v.values || []);
  const text = JSON.stringify(primary).toLowerCase();
  return {
    raw: (id) => raw.filter((r) => R.addrKey(String(r[2] || '')) === R.addrKey(R.shortenAddress(addrOf(id))) || String(r[2] || '').toLowerCase().includes(addrOf(id).toLowerCase())).length,
    inReport: (id) => text.includes(addrOf(id).toLowerCase()),
    primary: sheets[0].name,
  };
}

async function run(dir) {
  console.log(`сервер: ${BASE}, напрямок ${dir}, run=${RUN}, сьогодні ${TODAY.dmy} ${TODAY.time}`);
  const t0 = Date.now();
  const { error } = await sb.from('stores').upsert(IDS.map((id, i) => storeRow(id, i)), { onConflict: 'store_id' });
  if (error) throw new Error('stores: ' + error.message);
  const rows = IDS.map((id) => ({ dir, store_id: id, req_date: TODAY.day, status: 'approved', requested_at: new Date().toISOString(), approved_at: new Date().toISOString() }));
  const up = await sb.from('late_requests').upsert(rows, { onConflict: 'dir,store_id,req_date' });
  if (up.error) throw new Error('late_requests: ' + up.error.message);
  await sleep(31000);                                                   // кеш stores на сервері - 30 с
  console.log(`  підготовка (з очікуванням кешу stores 31 с): ${Date.now() - t0} мс`);

  const lists = {};
  for (const id of IDS) {
    const r = (await call(API, 'products', { dir, storeId: id })).body;
    if (!r.ok) throw new Error('products: ' + r.error);
    lists[id] = r.data.products.filter((p) => p.price > 0 || dir === 'nbhz').slice(0, 2);
  }

  // 1. відправка обох замовлень майже одночасно (перше відкриває вікно дебаунсу, друге входить у ту саму перебудову)
  const subAt = {};
  for (const id of IDS) {
    const items = lists[id].map((p, i) => ({ id: p.id, qty: i + 2 }));
    const s = Date.now();
    const r = await call(API, 'submitOrder', { dir, storeId: id, orderId: `ch-${RUN}-${id}`, items });
    if (!r.body.ok) throw new Error('submitOrder: ' + r.body.error);
    subAt[id] = { start: s, done: Date.now() };
    console.log(`  submit ${id}: ${subAt[id].done - s} мс`);
  }
  const t1 = subAt[IDS[0]].done;

  // 2. рядки в сирому листі; 3. точки у звіті
  const seen = { raw: {}, rep: null };
  let primary = '';
  for (;;) {
    const now = Date.now() - t1;
    const p = await poll(dir);
    primary = p.primary;
    for (const id of IDS) if (seen.raw[id] == null && p.raw(id) >= lists[id].length) seen.raw[id] = now;
    if (seen.rep == null && IDS.every((id) => p.inReport(id))) seen.rep = now;
    if (seen.rep != null || now > 75000) break;
    await sleep(2500);
  }
  for (const id of IDS) {
    console.log(`  ${id}: рядки в сирому листі через ${seen.raw[id]} мс після відповіді submit`);
    check(`${id}: сирі рядки з'явились`, seen.raw[id] != null);
  }
  console.log(`  обидві точки в «${primary}» через ${seen.rep} мс після відповіді першого submit`);
  check(`обидві точки в «${primary}» за <= 40 с після відповіді submit`, seen.rep != null && seen.rep <= 40000, seen.rep == null ? 'не зявились за 75 с' : seen.rep + ' мс');

  // 4. скасування однієї точки -> tick -> зникла зі звіту, друга лишилась
  const dbo = (await sb.from('orders').select('id').eq('dir', dir).eq('store_id', IDS[0]).eq('order_date', TODAY.day)).data;
  const c0 = Date.now();
  const cu = await sb.from('orders').update({ status: 'cancelled', changed_at: new Date().toISOString() }).eq('id', dbo[0].id);
  if (cu.error) throw new Error(cu.error.message);
  const tk = await tick();
  console.log(`  tick після скасування ${IDS[0]}: ${tk.status}, ${tk.ms} мс; export.${dir}=${JSON.stringify(tk.body.export && tk.body.export[dir])}; reports.${dir}=${JSON.stringify(tk.body.reports && tk.body.reports[dir])}`);
  check('tick 200 і звіт напрямку перебудовано', tk.status === 200 && tk.body.ok === true && tk.body.reports && tk.body.reports[dir] && Array.isArray(tk.body.reports[dir].sheets));
  const pp = await poll(dir);
  console.log(`  від скасування до перевірки: ${Date.now() - c0} мс`);
  check(`${IDS[0]} зникла зі звіту «${primary}»`, !pp.inReport(IDS[0]));
  check(`${IDS[0]} зникла із сирого листа`, pp.raw(IDS[0]) === 0);
  check(`${IDS[1]} лишилась у звіті`, pp.inReport(IDS[1]));
  const t2 = await tick();
  check('повторний tick звіт напрямку не переписує (без змін)', t2.body.reports && t2.body.reports[dir] && t2.body.reports[dir].skipped === 'без змін', JSON.stringify(t2.body.reports && t2.body.reports[dir]));
  console.log(`\nпідсумок: tick ${tk.ms} мс`);
}

async function cleanup(dir) {
  const like = 'test-ch-%';
  await sb.from('orders').delete().like('store_id', like).eq('dir', dir);
  await sb.from('late_requests').delete().like('store_id', like).eq('dir', dir);
  const left = await sb.from('orders').select('*', { count: 'exact', head: true }).like('store_id', like);
  if (!left.count) {                                                    // замовлень test-ch більше нема - прибираємо й тестові точки
    await sb.from('late_requests').delete().like('store_id', like);
    await sb.from('stores').delete().like('store_id', like);
  }
  const cnt = {};
  for (const t of ['orders', 'late_requests', 'stores']) cnt[t] = (await sb.from(t).select('*', { count: 'exact', head: true }).like('store_id', like)).count;
  console.log(`після прибирання test-ch у базі (${dir}):`, JSON.stringify(cnt));
  const raw = DIRECTIONS[dir].rawSheet;
  const sid = await sheetIdOf(TID, raw);
  const colA = await getValues(TID, a1q(raw, 'A:A'));
  if (colA.length > 1) await batchUpdate(TID, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: colA.length } } }]);
  for (const s of reportSheets(dir, TODAY.dmy)) {
    try { await sheetsClient().spreadsheets.values.clear({ spreadsheetId: TID, range: a1q(testName(dir, s.name), 'A1:CB') }); } catch (e) { /* листа ще нема */ }
  }
  console.log(`тестова таблиця: «${raw}» рядків з даними ${(await getValues(TID, a1q(raw, 'A:A'))).length - 1}; звіти ${dir} очищені`);
}

(async () => {
  const [phase, dir = 'bakery'] = process.argv.slice(2);
  if (!DIRECTIONS[dir]) throw new Error('напрямок: bakery|bread|veg|nbhz');
  if (phase === 'run') await run(dir);
  else if (phase === 'cleanup') await cleanup(dir);
  else throw new Error('використання: e2e-chain.js run|cleanup <dir>');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
