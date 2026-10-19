#!/usr/bin/env node
// Наскрізна перевірка вигрузки на Fly (EXPORT_TARGET=test): ТІЛЬКИ тестові точки 'test-ex-…', ТІЛЬКИ тестова таблиця.
// Бойові таблиці - лише читання (звірка рядків з тим, що записав Apps Script).
//   node scripts/e2e-export.js run       фази 1-4 (відправка -> рядки, скасування + tick, Google вимкнено, звірка з бойовими)
//   node scripts/e2e-export.js cleanup   прибрати тестові точки, замовлення, запити дозволу і рядки тестової таблиці
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
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
const RUN = Date.now().toString(36);
const ALL_DIRS = ['bread', 'nbhz', 'bakery', 'veg'];
const DIRS = ALL_DIRS;
const TODAY = R.kyivNow(new Date());
const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-jobs-secret.txt'), 'utf8').trim();

const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tab = (dir) => DIRECTIONS[dir].rawSheet;

async function tick() {
  const t0 = Date.now();
  const res = await fetch(BASE + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': secret } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body, ms: Date.now() - t0 };
}

async function sheetRows(id, name, formatted) {
  const rows = await getValues(id, a1q(name, 'A2:J'), { formatted });
  return rows.map((r, i) => ({ n: i + 2, r }));
}
const testRows = (dir, formatted = true) => sheetRows(TID, tab(dir), formatted);
const mineIn = (rows, addr) => rows.filter((x) => R.addrKey(String(x.r[2] || '')) === R.addrKey(R.shortenAddress(addr)) || R.addrKey(String(x.r[2] || '')) === R.addrKey(addr));

async function waitRows(dir, addr, want, maxMs = 12000) {
  const t0 = Date.now();
  for (;;) {
    const mine = mineIn(await testRows(dir), addr);
    if (mine.length >= want || Date.now() - t0 > maxMs) return { rows: mine, ms: Date.now() - t0 };
    await sleep(400);
  }
}

function storeRow(id, i, over = {}) {
  return { store_id: id, active: true, label: 'ТЕСТ ' + id.slice(8), address: 'Тест вигрузки ' + id, addr_bread: 'Тест вигрузки ' + id, addr_bakery: 'Тест вигрузки ' + id,
    addr_veg: 'Тест вигрузки ' + id, addr_nbhz: 'Тест вигрузки ' + id, route: 'Харьков-17', route_nbhz: 'Новые Дома 2', zone: 'Новые дома',
    bread: true, nbhz: true, bakery: true, veg: true, sort: 9100 + i, ...over };
}

async function approveAll(storeId, dirs = DIRS) {
  const rows = dirs.map((dir) => ({ dir, store_id: storeId, req_date: TODAY.day, status: 'approved', requested_at: new Date().toISOString(), approved_at: new Date().toISOString() }));
  const { error } = await sb.from('late_requests').upsert(rows, { onConflict: 'dir,store_id,req_date' });
  if (error) throw new Error('late_requests: ' + error.message);
}

async function productsOf(dir, storeId) {
  const r = (await call(API, 'products', { dir, storeId })).body;
  if (!r.ok) throw new Error(`products ${dir}: ${r.error}`);
  return r.data.products;
}

async function submit(dir, storeId, items, tag) {
  const r = await call(API, 'submitOrder', { dir, storeId, orderId: `ex-${RUN}-${tag}`, items });
  if (!r.body.ok) throw new Error(`submitOrder ${dir}/${storeId}: ${r.body.error}`);
  return r;
}

const dbOrder = async (dir, storeId) => (await sb.from('orders').select('*').eq('dir', dir).eq('store_id', storeId).eq('order_date', TODAY.day).order('created_at')).data;

// ---------- фаза 4: найближчі до бойових ----------
async function liveGroups(dir) {
  const cfg = DIRECTIONS[dir];
  const all = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A:J'), { formatted: true });
  const raw = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A:J'));
  const groups = new Map();
  all.forEach((r, i) => {
    if (i === 0 || r[0] !== TODAY.dmy) return;
    const key = [r[1], r[2]].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ n: i + 1, disp: r, raw: raw[i] });
  });
  return [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => a.length - b.length).map((g) => g.slice(0, 3));   // найменше замовлення, перші 2-3 рядки
}

const COLS = { bread: { addr: 2, name: 4, qty: 6 }, nbhz: { addr: 2, name: 4, qty: 6 }, bakery: { addr: 2, name: 5, qty: 7 }, veg: { addr: 2, name: 3, qty: 5 } };

async function cellFormats(id, name, row) {
  const res = await sheetsClient().spreadsheets.get({ spreadsheetId: id, ranges: [a1q(name, `A${row}:H${row}`)], includeGridData: true,
    fields: 'sheets.data.rowData.values(userEnteredFormat.numberFormat,effectiveFormat.numberFormat,effectiveValue)' });
  const vals = res.data.sheets[0].data[0].rowData[0].values || [];
  return vals.map((v) => ({ eff: v.effectiveFormat && v.effectiveFormat.numberFormat, ev: v.effectiveValue && Object.keys(v.effectiveValue)[0] }));
}

async function phase4(prod, only) {
  const DIRS = only && only.length ? only : ALL_DIRS;
  console.log('\n--- фаза 4: звірка з рядками, що Apps Script записав сьогодні в БОЙОВІ листи (лише читання) ---');
  for (const dir of DIRS) {
    const groups = await liveGroups(dir);
    if (!groups.length) { console.log(`(${dir}: сьогодні в бойовому листі немає замовлень з >= 2 рядків - пропущено)`); continue; }
    const g = groups[0], c = COLS[dir];
    const id = `test-ex-cmp-${dir}`;
    // ключові значення точки беремо з бойового рядка: маршрут (bread/nbhz, колонка B), зона (bakery, колонка D)
    const live0 = g[0].disp;
    const over = {};
    if (dir === 'bread') over.route = live0[1];
    if (dir === 'nbhz') over.route_nbhz = live0[1];
    if (dir === 'bakery') over.zone = live0[3];
    const { error } = await sb.from('stores').upsert(storeRow(id, 20 + DIRS.indexOf(dir), over), { onConflict: 'store_id' });
    if (error) throw new Error(error.message);
    prod.cmp.push(id);
  }
  await sleep(31000);                                                    // кеш stores на сервері - 30 с

  for (const dir of DIRS) {
    const groups = await liveGroups(dir);
    if (!groups.length) continue;
    const g = groups[0], c = COLS[dir], id = `test-ex-cmp-${dir}`;
    await approveAll(id, DIRS);
    const list = await productsOf(dir, id);
    const items = g.map((row) => {
      const name = String(row.disp[c.name]).trim().toLowerCase();
      const p = list.find((x) => String(x.name).trim().toLowerCase() === name);
      return p ? { id: p.id, qty: Number(String(row.disp[c.qty]).replace(',', '.')) } : null;
    });
    if (items.some((x) => !x)) { console.log(`(${dir}: не всі товари живого замовлення знайдені в products - пропущено)`); continue; }
    await submit(dir, id, items, 'cmp-' + dir);
    const addr = 'Тест вигрузки ' + id;
    const got = await waitRows(dir, addr, g.length);
    check(`[${dir}] рядків у тестовій таблиці = ${g.length} (як у живого замовлення «${g[0].disp[2]}»)`, got.rows.length === g.length, `${got.rows.length}, ${got.ms} мс`);
    const raw = await sheetRows(TID, tab(dir), false);
    const testRaw = raw.filter((x) => got.rows.some((y) => y.n === x.n));
    // поле за полем: усі колонки, крім адреси (C) і часу (B для bakery/veg)
    const skip = new Set([2]);
    if (dir === 'bakery' || dir === 'veg') skip.add(1);
    const width = Math.max(g[0].disp.length, got.rows[0] ? got.rows[0].r.length : 0, 7);
    for (let i = 0; i < g.length; i++) {
      const L = g[i], T = got.rows.find((x) => String(x.r[c.name]).trim().toLowerCase() === String(L.disp[c.name]).trim().toLowerCase());
      const TR = testRaw.find((x) => T && x.n === T.n);
      if (!T) { check(`[${dir}] рядок «${L.disp[c.name]}» є в тестовій таблиці`, false); continue; }
      const diffs = [];
      for (let col = 0; col < width; col++) {
        if (skip.has(col)) continue;
        const lv = String(L.disp[col] == null ? '' : L.disp[col]), tv = String(T.r[col] == null ? '' : T.r[col]);
        const lr = L.raw[col] == null ? '' : L.raw[col], tr = TR.r[col] == null ? '' : TR.r[col];
        if (lr !== tr) diffs.push(`кол.${col + 1}: бойовий=${JSON.stringify(lr)} (бачить людина ${JSON.stringify(lv)}) тест=${JSON.stringify(tr)} (бачить ${JSON.stringify(tv)})`);
      }
      check(`[${dir}] «${String(L.disp[c.name]).slice(0, 40)}»: значення всіх колонок (крім адреси і часу) збігаються з бойовим`, diffs.length === 0, diffs.join(' | '));
      // формат комірок: дата, час, штрихкод
      const lf = await cellFormats(DIRECTIONS[dir].spreadsheetId, tab(dir), L.n);
      const tf = await cellFormats(TID, tab(dir), T.n);
      const fd = [];
      const dateTime = dir === 'bakery' || dir === 'veg' ? [0, 1] : [0];
      for (const col of dateTime) {
        const a = JSON.stringify(lf[col] && lf[col].eff), b = JSON.stringify(tf[col] && tf[col].eff);
        if (a !== b || (lf[col] && tf[col] && lf[col].ev !== tf[col].ev)) fd.push(`кол.${col + 1}: бойовий ${a} ${lf[col] && lf[col].ev}, тест ${b} ${tf[col] && tf[col].ev}`);
      }
      check(`[${dir}] формат/тип дати${dateTime.length > 1 ? ' і часу' : ''} збігаються з бойовим`, fd.length === 0, fd.join(' | '));
    }
    const typeOfLiveBarcode = DIRECTIONS[dir].hasBarcodes ? (await cellFormats(DIRECTIONS[dir].spreadsheetId, tab(dir), g[0].n)) : null;
    if (typeOfLiveBarcode) {
      const bc = dir === 'bakery' ? 4 : 3;
      const tf = await cellFormats(TID, tab(dir), got.rows[0].n);
      const a = typeOfLiveBarcode[bc] && typeOfLiveBarcode[bc].ev, b = tf[bc] && tf[bc].ev;
      check(`[${dir}] штрихкод у тесті того ж типу, що в бойовому (текст)`, a === b, `${a} / ${b}`);
    }
  }
}

async function run() {
  console.log(`сервер: ${BASE}, run=${RUN}, сьогодні ${TODAY.dmy} ${TODAY.time}`);
  const prod = { cmp: [] };
  const ids = ['test-ex-a', 'test-ex-b'];
  const { error } = await sb.from('stores').upsert(ids.map((id, i) => storeRow(id, i)), { onConflict: 'store_id' });
  if (error) throw new Error('stores: ' + error.message);
  await sleep(31000);

  // ---- фаза 1: відправка -> рядки у всіх 4 вкладках за <= 5 с ----
  console.log('\n--- фаза 1: submitOrder -> рядки в тестовій таблиці ---');
  await approveAll('test-ex-a');
  const expect = {};
  for (const dir of DIRS) {
    const list = await productsOf(dir, 'test-ex-a');
    const pick = list.filter((p) => p.price > 0 || dir === 'nbhz').slice(0, 2);
    const items = pick.map((p, i) => ({ id: p.id, qty: i + 2 }));
    expect[dir] = { pick, items };
    const t0 = Date.now();
    const r = await submit(dir, 'test-ex-a', items, 'p1-' + dir);
    const got = await waitRows(dir, 'Тест вигрузки test-ex-a', items.length);
    const total = Date.now() - t0;
    console.log(`  [${dir}] submit ${r.ms} мс; рядки з'явились через ${got.ms} мс після відповіді (всього ${total} мс)`);
    check(`[${dir}] рядків ${items.length} за <= 5 с після відповіді`, got.rows.length === items.length && got.ms <= 5000, `${got.rows.length}, ${got.ms} мс`);
    let o = (await dbOrder(dir, 'test-ex-a'))[0];
    for (let i = 0; i < 10 && !o.exported_at; i++) { await sleep(300); o = (await dbOrder(dir, 'test-ex-a'))[0]; }   // позначка ставиться вже після рядків
    check(`[${dir}] orders.exported_at поставлено`, !!o.exported_at && Date.parse(o.exported_at) >= Date.parse(o.changed_at));
    const first = got.rows[0] && got.rows[0].r;
    if (first) console.log('     перший рядок:', JSON.stringify(first));
    check(`[${dir}] дата ${TODAY.dmy}`, first && first[0] === TODAY.dmy);
  }

  // ---- фаза 2: скасування -> tick -> рядки зникли ----
  console.log('\n--- фаза 2: скасування (як admin_cancel_day) -> /jobs/tick ---');
  const before = (await testRows('bread')).length;
  const o = (await dbOrder('bread', 'test-ex-a'))[0];
  const up = await sb.from('orders').update({ status: 'cancelled', changed_at: new Date().toISOString() }).eq('id', o.id);
  if (up.error) throw new Error(up.error.message);
  const t = await tick();
  console.log('  tick:', t.status, JSON.stringify(t.body), t.ms + ' мс');
  check('tick 200', t.status === 200 && t.body.ok === true);
  const after = (await testRows('bread')).length;
  check('рядки bread точки test-ex-a зникли', mineIn(await testRows('bread'), 'Тест вигрузки test-ex-a').length === 0, `було ${before}, стало ${after}`);
  check('рядки інших напрямків лишились', mineIn(await testRows('veg'), 'Тест вигрузки test-ex-a').length === expect.veg.items.length);
  const o2 = (await dbOrder('bread', 'test-ex-a'))[0];
  check('exported_at >= changed_at після скасування', Date.parse(o2.exported_at) >= Date.parse(o2.changed_at));

  // ---- фаза 3: Google «вимкнено» ----
  console.log('\n--- фаза 3: EXPORT_GOOGLE_OFF=1 -> замовлення не вигружається -> tick після увімкнення дописує ---');
  await approveAll('test-ex-b');
  execFileSync('fly', ['secrets', 'set', '-a', 'shop-orders', 'EXPORT_GOOGLE_OFF=1'], { stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { const h = await fetch(BASE + '/health'); if (h.ok) break; } catch (e) { /* стартує */ } await sleep(2000); }
  const lst = await productsOf('nbhz', 'test-ex-b');
  const items3 = [{ id: lst[0].id, qty: 3 }];
  const r3 = await submit('nbhz', 'test-ex-b', items3, 'p3');
  console.log('  submit при вимкненому Google:', r3.ms, 'мс, ok');
  await sleep(6000);
  const rowsOff = mineIn(await testRows('nbhz'), 'Тест вигрузки test-ex-b');
  const ob = (await dbOrder('nbhz', 'test-ex-b'))[0];
  check('при вимкненому Google рядків у листі немає, exported_at порожній', rowsOff.length === 0 && ob.exported_at === null, `рядків ${rowsOff.length}, exported_at=${ob.exported_at}`);
  const tOff = await tick();
  console.log('  tick (Google вимкнено):', tOff.status, JSON.stringify(tOff.body.export && tOff.body.export.nbhz));
  check('tick повідомляє помилку nbhz, але відповідає 200', tOff.status === 200 && tOff.body.export.nbhz && !!tOff.body.export.nbhz.error);
  execFileSync('fly', ['secrets', 'unset', '-a', 'shop-orders', 'EXPORT_GOOGLE_OFF'], { stdio: 'ignore' });
  for (let i = 0; i < 30; i++) { try { const h = await fetch(BASE + '/health'); if (h.ok) break; } catch (e) { /* стартує */ } await sleep(2000); }
  const tOn = await tick();
  console.log('  tick (Google увімкнено):', tOn.status, JSON.stringify(tOn.body.export && tOn.body.export.nbhz), tOn.ms + ' мс');
  const rowsOn = mineIn(await testRows('nbhz'), 'Тест вигрузки test-ex-b');
  const ob2 = (await dbOrder('nbhz', 'test-ex-b'))[0];
  check('наступний tick дописав рядки, exported_at поставлено', rowsOn.length === 1 && !!ob2.exported_at, `рядків ${rowsOn.length}`);
  const tAgain = await tick();
  check('ще один tick нічого не дублює', mineIn(await testRows('nbhz'), 'Тест вигрузки test-ex-b').length === 1 && tAgain.body.export.nbhz.written === 0);

  await phase4(prod);
}

async function cleanup() {
  const like = 'test-ex-%';
  await sb.from('orders').delete().like('store_id', like);
  await sb.from('late_requests').delete().like('store_id', like);
  await sb.from('stores').delete().like('store_id', like);
  const left = {};
  for (const t of ['orders', 'late_requests', 'stores']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).like('store_id', like);
    left[t] = count;
  }
  console.log('після прибирання test-ex у базі:', JSON.stringify(left));
  // тестова таблиця: лишається лише шапка
  for (const dir of DIRS) {
    const sid = await sheetIdOf(TID, tab(dir));
    const colA = await getValues(TID, a1q(tab(dir), 'A:A'));
    if (colA.length > 1) await batchUpdate(TID, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: Math.max(colA.length, 2) } } }]);
    console.log(`тестова таблиця ${tab(dir)}: рядків з даними після прибирання ${(await getValues(TID, a1q(tab(dir), 'A:A'))).length - 1}`);
  }
}

(async () => {
  const phase = process.argv[2];
  if (phase === 'run') await run();
  else if (phase === 'cmp') await phase4({ cmp: [] }, process.argv.slice(3));     // лише фаза 4 для вказаних напрямків
  else if (phase === 'cleanup') await cleanup();
  else throw new Error('використання: e2e-export.js run|cleanup');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
void batchUpdate;
