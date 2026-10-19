// Тіньовий прогін звітів ВК: бойові сирі рядки ЧИТАЮТЬСЯ (нічого в бойову таблицю не пишемо), з них будуються три звіти
// в ТЕСТОВУ таблицю, потім вони зчитуються назад і порівнюються з бойовими звітами Apps Script комірка в комірку.
// Хвилини «(оновлено …)» у заголовках звітів відрізняються завжди (різний момент збирання) і з порівняння виключені.
//   node src/reports/shadow.js          (на Fly: fly ssh console -C "node src/reports/shadow.js")
const { loadEnv } = require('../env');
const R = require('../rules');
const { DIRECTIONS } = require('../directions');
const { TEST_EXPORT_SPREADSHEET_ID } = require('../export/target');
const googleApi = require('../google');
const { dmyOfSheetCell } = require('../export/raw');
const B = require('./bakery');
const { writeSheet } = require('./sheetWriter');

const SHEETS = [B.BAKERY_ORDERS_SHEET, B.BAKERY_SUMMARY_SHEET, B.BAKERY_ROUTE_SHEET];

// Google віддає рядки без хвостових порожніх клітинок і без порожніх рядків наприкінці
function trimGrid(grid) {
  const out = (grid || []).map((r) => { const x = r.slice(); while (x.length && (x[x.length - 1] === '' || x[x.length - 1] == null)) x.pop(); return x; });
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}
const STAMP = /\(оновлено \d\d:\d\d:\d\d\)/;
const noStamp = (v) => (typeof v === 'string' ? v.replace(STAMP, '(оновлено *)') : v);

// Порівняння двох сіток A:D. Повертає { cells, diffs: [{row, col, live, ours}] }
function diffGrids(live, ours, width = 4) {
  const a = trimGrid(live), b = trimGrid(ours);
  const diffs = [];
  const rows = Math.max(a.length, b.length);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < width; c++) {
      const x = noStamp(a[i] && a[i][c] !== undefined ? a[i][c] : ''), y = noStamp(b[i] && b[i][c] !== undefined ? b[i][c] : '');
      if (x !== y) diffs.push({ row: i + 1, col: 'ABCD'[c], live: x, ours: y });
    }
  }
  return { cells: rows * width, rowsLive: a.length, rowsOurs: b.length, diffs };
}

async function shadowBakery({ at = new Date() } = {}) {
  const cfg = DIRECTIONS.bakery;
  if (TEST_EXPORT_SPREADSHEET_ID === cfg.spreadsheetId) throw new Error('тестова таблиця збігається з бойовою - зупинка');
  const k = R.kyivNow(at);

  // один запит - сирі рядки і бойові звіти з одного моменту
  const ranges = [googleApi.a1q(cfg.rawSheet, 'A:H'), ...SHEETS.map((s) => googleApi.a1q(s, 'A:D'))];
  const res = await googleApi.sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: cfg.spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
  }, { timeout: googleApi.TIMEOUT_MS, retry: false });
  const [rawVr, ...liveVr] = res.data.valueRanges;
  const live = Object.fromEntries(SHEETS.map((n, i) => [n, liveVr[i].values || []]));
  const rawToday = (rawVr.values || []).slice(1).filter((r) => dmyOfSheetCell(r[0]) === k.dmy);
  const rows = B.normalizeRawRows(rawToday, k.dmy);

  const { loadStores, supabase } = require('../db');
  const stores = await loadStores();
  const { data: products, error } = await supabase().from('products').select('barcode,name,category,status').eq('dir', 'bakery').order('sort');
  if (error) throw new Error('products: ' + error.message);

  const plans = B.buildBakeryReports(rows, { stores, products, now: at });
  for (const name of SHEETS) await writeSheet(googleApi, TEST_EXPORT_SPREADSHEET_ID, name, plans[name]);

  // назад з тестової таблиці - те, що справді лежить у Google
  const out = { day: k.dmy, rawRows: rows.length, stores: stores.length, sheets: {} };
  for (const name of SHEETS) {
    const back = await googleApi.getValues(TEST_EXPORT_SPREADSHEET_ID, googleApi.a1q(name, 'A:D'));
    out.sheets[name] = diffGrids(live[name], back);
    out.sheets[name].liveStamp = (JSON.stringify(live[name].slice(0, 2)).match(/оновлено (\d\d:\d\d:\d\d)/) || [])[1] || null;
  }
  out.totalDiffs = SHEETS.reduce((s, n) => s + out.sheets[n].diffs.length, 0);
  out.totalCells = SHEETS.reduce((s, n) => s + out.sheets[n].cells, 0);
  return out;
}

module.exports = { shadowBakery, diffGrids, trimGrid };

if (require.main === module) {
  loadEnv();
  shadowBakery().then((r) => {
    console.log(`день ${r.day}: сирих рядків ВК (прочитано) ${r.rawRows}, точок у базі ${r.stores}`);
    for (const n of SHEETS) {
      const s = r.sheets[n];
      console.log(`  «${n}»: рядків бойовий ${s.rowsLive} / наш ${s.rowsOurs}, комірок ${s.cells}, розбіжностей ${s.diffs.length}, «оновлено» бойового ${s.liveStamp}`);
      s.diffs.slice(0, 15).forEach((d) => console.log(`     ${d.col}${d.row}: бойовий=${JSON.stringify(d.live)} наш=${JSON.stringify(d.ours)}`));
    }
    console.log(`РАЗОМ комірок ${r.totalCells}, розбіжностей ${r.totalDiffs}`);
    process.exitCode = r.totalDiffs ? 1 : 0;
  }).catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 2; });
}
