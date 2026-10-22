#!/usr/bin/env node
// РЕПЕТИЦІЯ НА БОЙОВИХ ТАБЛИЦЯХ (Fly з EXPORT_TARGET=live): тестові точки test-lv-a/b -> submitOrder -> рядки в БОЙОВОМУ сирому листі
// напрямку (формат дати/часу/штрихкоду як у сусідніх рядків) -> бойовий звіт напрямку містить обидві точки (<= 60 с) -> скасування a ->
// скасування b -> рядки зникли, звіт повернувся до стану ДО (значення без часу збирання). Запускати тільки коли заказів не приймають
// (ввечері після дедлайнів). Чистка прибирає лише рядки з адресою «Тест live» (знизу вгору), у кінці кількість рядків листа = було.
//   node scripts/e2e-live.js run <dir>       (потім завжди cleanup <dir>)
//   node scripts/e2e-live.js cleanup <dir>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const jwt = require('jsonwebtoken');
const { supabase } = require('../src/db');
const { DIRECTIONS } = require('../src/directions');
const { getValues, batchUpdate, sheetsClient, sheetIdOf, a1q } = require('../src/google');
const { call } = require('./exec-client');
const R = require('../src/rules');
const { readLive, reportSheets } = require('../src/reports/liveRead');
const { mask } = require('../src/reports/shadow');

const BASE = 'https://shop-orders.fly.dev', API = BASE + '/api';
const sb = supabase();
const TODAY = R.kyivNow(new Date());
const RUN = Date.now().toString(36);
const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-jobs-secret.txt'), 'utf8').trim();
const adminTok = jwt.sign({ role: 'admin' }, process.env.ADMIN_JWT_SECRET, { algorithm: 'HS256', expiresIn: 1800 });
const IDS = ['test-lv-a', 'test-lv-b'];
const addrOf = (id) => 'Тест live ' + id;
const MARK = 'тест live';
const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfgOf = (dir) => DIRECTIONS[dir];
const rawSheet = (dir) => cfgOf(dir).rawSheet;
const SUM = { bakery: 7, bread: 6, nbhz: 6, veg: 6 };           // колонка кількості (0-based) для перевірки

const storeRow = (id, i) => ({ store_id: id, active: true, label: 'ТЕСТ ' + id.slice(8), address: addrOf(id), addr_bread: addrOf(id), addr_bakery: addrOf(id),
  addr_veg: addrOf(id), addr_nbhz: addrOf(id), route: 'Харьков-17', route_nbhz: 'Новые Дома 2', zone: 'Новые дома', code: '', edrpou: '',
  bread: true, nbhz: true, bakery: true, veg: true, sort: 9600 + i });

async function tick() {
  const r = await fetch(BASE + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': secret } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function adminReport(dir) {
  const r = await fetch(BASE + '/admin/api', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'adm=' + adminTok }, body: JSON.stringify({ action: 'report', payload: { dir } }) });
  return r.json().catch(() => ({ ok: false }));
}
// рядки листа (A:J, як бачить людина) з номерами
async function sheetRows(dir) {
  const rows = await getValues(cfgOf(dir).spreadsheetId, a1q(rawSheet(dir), 'A:J'), { formatted: true });
  return rows.map((r, i) => ({ n: i + 1, r }));
}
const mineIn = (rows) => rows.filter((x) => String(x.r[2] || '').toLowerCase().includes(MARK));
async function cellFormats(id, name, row) {
  const res = await sheetsClient().spreadsheets.get({ spreadsheetId: id, ranges: [a1q(name, `A${row}:H${row}`)], includeGridData: true,
    fields: 'sheets.data.rowData.values(effectiveFormat.numberFormat,effectiveValue)' });
  return (res.data.sheets[0].data[0].rowData[0].values || []).map((v) => ({ nf: v.effectiveFormat && v.effectiveFormat.numberFormat, ev: v.effectiveValue && Object.keys(v.effectiveValue)[0] }));
}
const reportText = async (dir) => {
  const live = await readLive(dir, new Date());
  const primary = reportSheets(dir, TODAY.dmy)[0].name;
  return { text: JSON.stringify(live.values[primary] || []).toLowerCase(), values: live.values };
};
const normValues = (values) => JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.map((r) => r.map((c) => (typeof c === 'string' ? mask(c) : c)))])));

async function run(dir) {
  console.log(`БОЙОВІ таблиці, напрямок ${dir}, ${TODAY.dmy} ${TODAY.time}`);
  const cfg = cfgOf(dir);
  const before = await readLive(dir, new Date());
  const rowsBefore = (await sheetRows(dir)).length;
  const normBefore = normValues(before.values);
  console.log(`  до: рядків у сирому листі ${rowsBefore}, звіти: ${Object.entries(before.values).map(([k, v]) => k + '=' + v.length).join(', ')}`);

  const up = await sb.from('stores').upsert(IDS.map((id, i) => storeRow(id, i)), { onConflict: 'store_id' });
  if (up.error) throw new Error('stores: ' + up.error.message);
  const lr = IDS.map((id) => ({ dir, store_id: id, req_date: TODAY.day, status: 'approved', requested_at: new Date().toISOString(), approved_at: new Date().toISOString() }));
  const l2 = await sb.from('late_requests').upsert(lr, { onConflict: 'dir,store_id,req_date' });
  if (l2.error) throw new Error(l2.error.message);
  await sleep(31000);

  const lists = {};
  for (const id of IDS) {
    const r = (await call(API, 'products', { dir, storeId: id })).body;
    if (!r.ok) throw new Error('products: ' + r.error);
    lists[id] = r.data.products.filter((p) => p.price > 0 || dir === 'nbhz').slice(0, 2);
  }
  const t1 = Date.now();
  for (const id of IDS) {
    const items = lists[id].map((p, i) => ({ id: p.id, qty: i + 2 }));
    const r = await call(API, 'submitOrder', { dir, storeId: id, orderId: `lv-${RUN}-${id}`, items });
    if (!r.body.ok) throw new Error('submitOrder: ' + r.body.error);
    console.log(`  submit ${id}: ${r.ms} мс`);
  }

  // 1. рядки в бойовому сирому листі
  let rows = [], t = Date.now();
  for (;;) {
    rows = mineIn(await sheetRows(dir));
    const want = IDS.reduce((s, id) => s + lists[id].length, 0);
    if (rows.length >= want || Date.now() - t > 25000) break;
    await sleep(2500);
  }
  check('рядки обох точок у БОЙОВОМУ сирому листі', rows.length === IDS.reduce((s, id) => s + lists[id].length, 0), `${rows.length}, ${Date.now() - t1} мс від відповіді`);

  // 2. формат рядків = формат сусіднього бойового рядка (дата, час, штрихкод)
  const all = await sheetRows(dir);
  const prev = all.filter((x) => !String(x.r[2] || '').toLowerCase().includes(MARK) && x.r[0]).slice(-1)[0];
  if (prev && rows[0]) {
    const [fp, fo] = [await cellFormats(cfg.spreadsheetId, rawSheet(dir), prev.n), await cellFormats(cfg.spreadsheetId, rawSheet(dir), rows[0].n)];
    const cols = dir === 'bakery' || dir === 'veg' ? [0, 1] : [0];
    const diffs = cols.filter((c) => JSON.stringify(fp[c] && fp[c].nf) !== JSON.stringify(fo[c] && fo[c].nf) || (fp[c] && fo[c] && fp[c].ev !== fo[c].ev));
    check('тип і формат дати (і часу) нових рядків = як у сусіднього бойового рядка', diffs.length === 0, diffs.map((c) => `кол.${c + 1}: бойовий ${JSON.stringify(fp[c])} наш ${JSON.stringify(fo[c])}`).join(' | '));
  }

  // 3. звіт напрямку (для НБХЗ: вночі авто-збірка за годинами не йде - примусово через пульт)
  if (dir === 'nbhz') { const a = await adminReport(dir); console.log('  примусова збірка НБХЗ через пульт:', a.ok ? 'ok' : a.error); }
  let rep = null; t = Date.now();
  for (;;) {
    rep = await reportText(dir);
    if (IDS.every((id) => rep.text.includes(addrOf(id).toLowerCase())) || Date.now() - t > 70000) break;
    await sleep(4000);
  }
  check('обидві точки в БОЙОВОМУ звіті напрямку', IDS.every((id) => rep.text.includes(addrOf(id).toLowerCase())), `${Date.now() - t1} мс від відповіді submit`);

  // 4. скасування a, потім b
  for (const id of IDS) {
    const dbo = (await sb.from('orders').select('id').eq('dir', dir).eq('store_id', id).eq('order_date', TODAY.day)).data;
    await sb.from('orders').update({ status: 'cancelled', changed_at: new Date().toISOString() }).eq('id', dbo[0].id);
    const tk = await tick();
    if (dir === 'nbhz') await adminReport(dir);
    await sleep(3000);
    const now = mineIn(await sheetRows(dir));
    const left = IDS.filter((x) => now.some((y) => String(y.r[2]).toLowerCase().includes(addrOf(x).toLowerCase())));
    check(`після скасування ${id}: його рядки зникли з бойового листа, чужі лишились`, !left.includes(id) && (id === IDS[0] ? left.includes(IDS[1]) : left.length === 0), `tick ${tk.status}, лишилось ${JSON.stringify(left)}`);
  }
  await sleep(6000);
  if (dir === 'nbhz') await adminReport(dir);
  else await tick();
  await sleep(5000);
  const after = await readLive(dir, new Date());
  const rowsAfter = (await sheetRows(dir)).length;
  check('рядків у бойовому сирому листі стільки ж, як було', rowsAfter === rowsBefore, `було ${rowsBefore}, стало ${rowsAfter}`);
  check('бойовий звіт повернувся до стану ДО (значення, без часу збирання)', normValues(after.values) === normBefore);
}

async function cleanup(dir) {
  const like = 'test-lv-%';
  await sb.from('orders').delete().like('store_id', like);
  await sb.from('late_requests').delete().like('store_id', like);
  await sb.from('stores').delete().like('store_id', like);
  const rows = mineIn(await sheetRows(dir)).map((x) => x.n).sort((a, b) => b - a);
  if (rows.length) {
    const sid = await sheetIdOf(cfgOf(dir).spreadsheetId, rawSheet(dir));
    await batchUpdate(cfgOf(dir).spreadsheetId, rows.map((n) => ({ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } })));
  }
  const cnt = {};
  for (const t of ['orders', 'late_requests', 'stores']) cnt[t] = (await sb.from(t).select('*', { count: 'exact', head: true }).like('store_id', like)).count;
  console.log(`прибрано (${dir}): у базі ${JSON.stringify(cnt)}; залишкових тестових рядків у бойовому листі було ${rows.length}, тепер ${mineIn(await sheetRows(dir)).length}`);
}

(async () => {
  const [ph, dir] = process.argv.slice(2);
  if (!DIRECTIONS[dir]) throw new Error('використання: e2e-live.js run|cleanup bakery|bread|veg|nbhz');
  if (ph === 'run') { try { await run(dir); } catch (e) { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; } await cleanup(dir); }
  else if (ph === 'cleanup') await cleanup(dir);
  else throw new Error('run|cleanup');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
