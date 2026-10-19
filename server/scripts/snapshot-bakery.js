#!/usr/bin/env node
// Знімок для золотого тесту звітів ВК. ЛИШЕ ЧИТАННЯ бойової таблиці ВК.
// Сирі рядки за сьогодні + значення трьох звітів Apps Script читаються ОДНИМ запитом values.batchGet
// (один момент часу), довідник точок і категорії - з бази.
//   node scripts/snapshot-bakery.js [вихідний.json]
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('../src/env');
loadEnv();
const { DIRECTIONS } = require('../src/directions');
const { sheetsClient, a1q } = require('../src/google');
const { loadStores, supabase } = require('../src/db');
const R = require('../src/rules');
const { dmyOfSheetCell, hmOfCell } = require('../src/export/raw');

const REPORTS = ['Заказы ВК', 'Сводная ВК', 'Маршрути ВК'];

(async () => {
  const cfg = DIRECTIONS.bakery;
  const now = new Date();
  const today = R.kyivNow(now).dmy;
  const ranges = [a1q(cfg.rawSheet, 'A:H'), ...REPORTS.map((s) => a1q(s, 'A:D'))];
  const t0 = Date.now();
  const res = await sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: cfg.spreadsheetId, ranges,
    valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
  }, { timeout: 30000, retry: false });
  const takenAt = new Date().toISOString();
  const [rawVr, ...repVr] = res.data.valueRanges;

  const raw = [];
  (rawVr.values || []).forEach((r, i) => {
    if (i === 0) return;
    if (dmyOfSheetCell(r[0]) !== today) return;
    const x = []; for (let c = 0; c < 8; c++) x.push(r[c] == null ? '' : r[c]);
    raw.push(x);
  });

  const reports = {};
  REPORTS.forEach((name, i) => { reports[name] = repVr[i].values || []; });

  // позначка «оновлено» у звітах проти часу останнього сирого рядка
  const lastRaw = raw.map((r) => hmOfCell(typeof r[1] === 'number' ? hhmm(r[1]) : r[1])).filter(Boolean).sort().pop();
  const stamps = REPORTS.map((n) => (String((reports[n][n === 'Заказы ВК' ? 1 : 0] || [])[0] || '').match(/\d\d:\d\d:\d\d/) || [''])[0]);

  const stores = await loadStores();
  const { data: prods, error } = await supabase().from('products').select('barcode,name,category,status').eq('dir', 'bakery');
  if (error) throw new Error(error.message);

  const out = {
    day: today, takenAt, readMs: Date.now() - t0,
    note: 'raw = сирі рядки за день (UNFORMATTED); reports = значення комірок A:D звітів Apps Script; stores/products - з бази',
    raw, reports, stores, products: prods,
  };
  const file = process.argv[2] || path.join(__dirname, '..', 'test', 'fixtures', 'bakery-' + now.toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`день ${today}, знімок ${takenAt} (читання ${out.readMs} мс) -> ${file}`);
  console.log(`сирих рядків ${raw.length}; останній сирий рядок ${lastRaw}; «оновлено» у звітах: ${stamps.join(' | ')}`);
  console.log(`точок у базі ${stores.length}, позицій ВК у products ${prods.length}`);
  REPORTS.forEach((n) => console.log(`  ${n}: рядків ${reports[n].length}`));
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });

function hhmm(v) {
  const m = Math.round((v - Math.floor(v)) * 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
