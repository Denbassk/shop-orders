#!/usr/bin/env node
// Наскрізна перевірка списань на Fly (EXPORT_TARGET=test): тестова точка test-wo-a -> woProducts -> woSubmit -> рядки у вкладці «Списания»
// ТЕСТОВОЇ таблиці -> woMine -> woDelete -> рядки зникли. Тимчасово відкриває прийом (settings.wo_late) і вносить книгу в wo_books -
// після прогону (cleanup) обидва значення повертаються. Бойові таблиці не чіпаються.
//   node scripts/e2e-writeoff.js run | cleanup
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { supabase } = require('../src/db');
const { TEST_EXPORT_SPREADSHEET_ID: TID } = require('../src/export/target');
const { getValues, batchUpdate, sheetIdOf, a1q } = require('../src/google');
const { call } = require('./exec-client');
const R = require('../src/rules');

const BASE = 'https://shop-orders.fly.dev', API = BASE + '/api';
const sb = supabase();
const TODAY = R.kyivNow(new Date());
const ID = 'test-wo-a', EDR = '44413718';
const RUN = Date.now().toString(36);
const secret = fs.readFileSync(path.join(os.homedir(), '.secrets', 'shop-orders-jobs-secret.txt'), 'utf8').trim();
const check = (label, cond, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getSetting = async (k) => { const { data } = await sb.from('settings').select('value').eq('key', k); return data && data[0] ? data[0].value : undefined; };
const setSetting = async (k, v) => { const { error } = await sb.from('settings').upsert({ key: k, value: v }); if (error) throw new Error(error.message); };
const tick = async () => { const t0 = Date.now(); const r = await fetch(BASE + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': secret } }); return { status: r.status, body: await r.json().catch(() => ({})), ms: Date.now() - t0 }; };
const sheetRows = async () => (await getValues(TID, a1q('Списания', 'A2:N'), { formatted: true })).filter((r) => String(r[0] || '').length);
async function waitRows(docId, want, maxMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    const mine = (await sheetRows()).filter((r) => r[0] === docId);
    if (mine.length === want || Date.now() - t0 > maxMs) return { rows: mine, ms: Date.now() - t0 };
    await sleep(500);
  }
}

async function run() {
  console.log(`сервер ${BASE}, run=${RUN}, ${TODAY.dmy} ${TODAY.time}`);
  const saved = { late: await getSetting('wo_late'), books: await getSetting('wo_books') };
  await sb.from('settings').upsert({ key: 'e2e_wo_saved', value: saved });
  await setSetting('wo_late', TODAY.dmy);
  await setSetting('wo_books', { ...(saved.books || {}), [EDR]: { id: 'test-e2e', name: 'тест e2e' } });
  const st = { store_id: ID, active: true, label: 'ТЕСТ wo-a', address: 'Тест списань wo-a', addr_bread: 'Тест списань wo-a', addr_bakery: 'Тест списань wo-a', addr_veg: 'Тест списань wo-a',
    addr_nbhz: 'Тест списань wo-a', route: 'Харьков-17', code: '777', zone: 'Новые дома', edrpou: '', bread: false, nbhz: false, bakery: true, veg: false, sort: 9300 };
  const up = await sb.from('stores').upsert(st, { onConflict: 'store_id' });
  if (up.error) throw new Error(up.error.message);
  await sleep(31000);

  const base = { storeId: ID };
  const p = await call(API, 'woProducts', { ...base, date: TODAY.dmy, seller: 'Тестов Тест' });
  check('woProducts ok', p.body.ok, p.body.error);
  const prods = p.body.data.products.slice(0, 2);
  console.log(`  woProducts: ${p.ms} мс, позицій ${p.body.data.products.length}, категорій ${p.body.data.categories.length}`);
  const docId = 'wo' + RUN + 'aa';
  const items = prods.map((x, i) => ({ id: x.id, qty: i + 2 }));
  const s = await call(API, 'woSubmit', { ...base, docId, date: TODAY.dmy, seller: 'Тестов Тест', items });
  check('woSubmit ok', s.body.ok, s.body.error);
  console.log(`  woSubmit: ${s.ms} мс`, JSON.stringify(s.body.data || {}).slice(0, 200));
  const again = await call(API, 'woSubmit', { ...base, docId, date: TODAY.dmy, seller: 'Тестов Тест', items });
  check('повтор того ж docId -> duplicate', again.body.ok && again.body.data.duplicate === true);

  const got = await waitRows(docId, items.length);
  check(`рядків у «Списания» тестової таблиці = ${items.length}`, got.rows.length === items.length, `${got.rows.length}, ${got.ms} мс`);
  const idx = Math.max(0, prods.findIndex((x) => x.name === (got.rows[0] || [])[7]));      // порядок рядків у листі може відрізнятись від порядку позицій
  const r0 = got.rows[0] || [];
  const costRow = (await sb.from('products').select('cost').eq('dir', 'bakery').eq('id', prods[idx].id)).data[0];      // продавцю ціна не віддається - беремо собівартість з бази
  const exp = { ...prods[idx], price: Number(costRow.cost) }, q0 = items[idx].qty, sum0 = Math.round(exp.price * q0 * 100) / 100;
  const num = (v) => Number(String(v).replace(/\s/g, '').replace(',', '.'));
  check('колонки: ID, точка, № ТТ, товар, кількість, ціна, сума, сума+20%, продавець',
    r0[0] === docId && r0[3] === 'ТЕСТ wo-a' && String(r0[4]) === '777' && r0[7] === exp.name && num(r0[8]) === q0 && num(r0[9]) === exp.price && num(r0[10]) === sum0 && num(r0[11]) === Math.round(sum0 * 1.2 * 100) / 100 && r0[12] === 'Тестов Тест',
    JSON.stringify({ r0, exp: { name: exp.name, price: exp.price, q0, sum0 }, parts: [r0[0] === docId, r0[3] === 'ТЕСТ wo-a', String(r0[4]) === '777', r0[7] === exp.name, num(r0[8]) === q0, num(r0[9]) === exp.price, num(r0[10]) === sum0, num(r0[11]) === Math.round(sum0 * 1.2 * 100) / 100, r0[12] === 'Тестов Тест'] }));
  const mine = await call(API, 'woMine', base);
  check('woMine: подача є, canDelete', mine.body.ok && mine.body.data.docs.some((d) => (d.docId || d.id) === docId && d.canDelete), mine.body.error || JSON.stringify(mine.body.data.docs[0] || {}).slice(0, 300));

  const del = await call(API, 'woDelete', { ...base, docId });
  check('woDelete ok', del.body.ok, del.body.error);
  const gone = await waitRows(docId, 0);
  check('рядки подачі зникли з листа', gone.rows.length === 0, `${gone.ms} мс`);
  const t = await tick();
  check('tick 200 з розділом writeoffs', t.status === 200 && !!t.body.writeoffs, JSON.stringify(t.body.writeoffs));
}

async function cleanup() {
  await sb.from('writeoffs').delete().eq('store_id', ID);
  await sb.from('stores').delete().eq('store_id', ID);
  await sb.from('admin_log').delete().like('details', '%ТЕСТ wo%');
  const saved = await getSetting('e2e_wo_saved');
  if (saved) {
    await setSetting('wo_late', saved.late === undefined ? '' : saved.late);
    await setSetting('wo_books', saved.books === undefined ? {} : saved.books);
    await sb.from('settings').delete().eq('key', 'e2e_wo_saved');
  }
  const sid = await sheetIdOf(TID, 'Списания');
  const colA = await getValues(TID, a1q('Списания', 'A:A'));
  if (colA.length > 1) await batchUpdate(TID, [{ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: colA.length } } }]);
  const left = await sb.from('writeoffs').select('*', { count: 'exact', head: true }).eq('store_id', ID);
  console.log(`прибрано: подач ${left.count}, у «Списания» рядків даних ${(await getValues(TID, a1q('Списания', 'A:A'))).length - 1}; wo_late=${JSON.stringify(await getSetting('wo_late'))}, wo_books ключів ${Object.keys((await getSetting('wo_books')) || {}).length}`);
}

(async () => {
  const ph = process.argv[2];
  if (ph === 'run') await run(); else if (ph === 'cleanup') await cleanup(); else throw new Error('run|cleanup');
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
