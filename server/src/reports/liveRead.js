// ЧИТАННЯ бойової таблиці напрямку (нічого не пишемо): сирі рядки за день, значення і оформлення звітів Apps Script.
// Використовується shadow.js (порівняння з нашою збіркою) і scripts/snapshot-report.js (золоті фікстури).
const R = require('../rules');
const { DIRECTIONS } = require('../directions');
const googleApi = require('../google');
const { modelFromGridData } = require('./sheetModel');
const { colLetter } = require('./sheetWriter');
const bakery = require('./bakery');
const bread = require('./bread');
const veg = require('./veg');
const nbhz = require('./nbhz');

const RAW_RANGE = { bakery: 'A:H', bread: 'A:G', veg: 'A:G', nbhz: 'A:G' };
const NORMALIZE = { bakery: bakery.normalizeRawRows, bread: bread.normalizeRawRows, veg: veg.normalizeRawRows, nbhz: nbhz.normalizeRawRows };

// Листи звітів напрямку в бойовій таблиці: [{ name, cols }] (cols - скільки колонок читати)
function reportSheets(dir, dmy) {
  if (dir === 'bakery') return [[bakery.BAKERY_ORDERS_SHEET, 4], [bakery.BAKERY_SUMMARY_SHEET, 4], [bakery.BAKERY_ROUTE_SHEET, 4]].map(([name, cols]) => ({ name, cols }));
  if (dir === 'bread') return [{ name: bread.BREAD_ORDERS_SHEET, cols: 8 }, { name: bread.BREAD_SUMMARY_SHEET, cols: 5 }, { name: bread.BREAD_DOWNLOAD_SHEET, cols: 1 }];
  if (dir === 'veg') return [{ name: veg.VEG_ORDERS_SHEET, cols: 5 }, { name: veg.VEG_SUMMARY_SHEET, cols: 5 }];
  if (dir === 'nbhz') return [{ name: 'Вивантаження ' + dmy, cols: 80 }, { name: nbhz.NBHZ_LINK_SHEET, cols: 1 }];
  throw new Error('невідомий напрямок ' + dir);
}

const GRID_FIELDS = 'sheets(properties(sheetId,title,gridProperties),basicFilter,data(rowData(values(userEnteredValue,userEnteredFormat,textFormatRuns)),rowMetadata(pixelSize),columnMetadata(pixelSize)))';

// Моделі листів з Google (значення як набрані, формати, ширини, закріплення). sheets: [{ name, rows, cols }]
async function fetchModels(spreadsheetId, sheets) {
  const ranges = sheets.map((s) => googleApi.a1q(s.name, `A1:${colLetter(Math.max(s.cols, 1) - 1)}${Math.max(s.rows, 1)}`));
  const res = await googleApi.sheetsClient().spreadsheets.get({ spreadsheetId, ranges, includeGridData: true, fields: GRID_FIELDS },
    { timeout: googleApi.TIMEOUT_MS, retry: false });
  const out = {};
  for (const s of sheets) {
    const sh = res.data.sheets.find((x) => x.properties.title === s.name);
    if (sh) out[s.name] = modelFromGridData(sh, s.name);
  }
  return out;
}

// Розмір заповненої частини листа за значеннями
const extentOf = (values) => ({ rows: values.length, cols: values.reduce((m, r) => Math.max(m, r.length), 0) });

// dir -> { day, dmy, takenAt, raw (сирі рядки за день, як у листі), rows (робочі), values {лист: [[...]]}, models {лист: модель}, missing [листи] }
async function readLive(dir, at = new Date()) {
  const cfg = DIRECTIONS[dir];
  const k = R.kyivNow(at);
  const have = new Set((await googleApi.sheetList(cfg.spreadsheetId)).map((s) => s.title));
  const wanted = reportSheets(dir, k.dmy);
  const present = wanted.filter((s) => have.has(s.name));
  const ranges = [googleApi.a1q(cfg.rawSheet, RAW_RANGE[dir]), ...present.map((s) => googleApi.a1q(s.name, `A:${colLetter(s.cols - 1)}`))];
  const res = await googleApi.sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: cfg.spreadsheetId, ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
  }, { timeout: googleApi.TIMEOUT_MS, retry: false });
  const takenAt = new Date().toISOString();
  const [rawVr, ...repVr] = res.data.valueRanges;
  const { dmyOfSheetCell } = require('../export/raw');
  const rawToday = (rawVr.values || []).slice(1).filter((r) => dmyOfSheetCell(r[0]) === k.dmy);
  const values = {};
  present.forEach((s, i) => { values[s.name] = repVr[i].values || []; });

  const sizes = present.map((s) => ({ name: s.name, ...extentOf(values[s.name]) }));
  const models = sizes.length ? await fetchModels(cfg.spreadsheetId, sizes.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols }))) : {};
  return { dir, day: k.day, dmy: k.dmy, takenAt, raw: rawToday, rows: NORMALIZE[dir](rawToday, k.dmy), values, models,
    missing: wanted.filter((s) => !have.has(s.name)).map((s) => s.name), sizes };
}

module.exports = { RAW_RANGE, NORMALIZE, reportSheets, fetchModels, readLive, extentOf };
