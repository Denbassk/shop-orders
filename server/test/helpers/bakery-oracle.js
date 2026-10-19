// Еталон: справжній код Apps Script (app/*.gs), виконаний у vm з підмінним Sheets API. Збирає звіти ВК з тих самих
// вхідних даних і віддає batchUpdate-запити, які Apps Script надіслав би в Google.
//   runBakeryGas({ rows, stores, products, nowBy })  -> { [назва листа]: [запити] }
//   rows - робочі рядки (8 колонок, як bakeryTodayRows_), stores - у формі loadStores_(), products - рядки products ВК.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KYIV = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Date, у якого "локальні" getDate/getHours... - київські (як у скрипті з часовим поясом Europe/Kyiv)
function makeKyivDate(getNow) {
  const parts = (d) => { const p = {}; KYIV.formatToParts(d).forEach((x) => { p[x.type] = x.value; }); return p; };
  return class KDate extends Date {
    constructor(...a) { if (a.length === 0) super(getNow().getTime()); else super(...a); }
    static now() { return getNow().getTime(); }
    getFullYear() { return +parts(this).year; }
    getMonth() { return +parts(this).month - 1; }
    getDate() { return +parts(this).day; }
    getHours() { return +parts(this).hour; }
    getMinutes() { return +parts(this).minute; }
    getSeconds() { return +parts(this).second; }
    getDay() { return WD[parts(this).weekday]; }
  };
}

function runBakeryGas({ rows, stores, products, nowBy, now }) {
  let cur = now || new Date();
  const captured = {};
  const sheetIds = { 'Заказы ВК': 101, 'Сводная ВК': 102, 'Маршрути ВК': 103 };
  const byId = Object.fromEntries(Object.entries(sheetIds).map(([k, v]) => [v, k]));

  const sandbox = {
    console: { log() {}, error() {}, warn() {} }, Math, JSON, Object, String, Number, Array, RegExp, Intl, Date: makeKyivDate(() => cur),
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, removeAll() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, setProperties() {}, getProperties: () => ({}) }) },
    Utilities: { formatDate: (d, tz, fmt) => {
      const p = {}; KYIV.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
      return fmt === 'yyyy/MM/dd' ? `${p.year}/${p.month}/${p.day}` : `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
    } },
    Sheets: {
      Spreadsheets: {
        get: (id, o) => ({ sheets: Object.entries(sheetIds).map(([title, sheetId]) => ({
          properties: { sheetId, title, gridProperties: { rowCount: 1000, columnCount: 26 } }, conditionalFormats: [] })) }),
        batchUpdate: (body) => {
          const sid = body.requests.map((r) => Object.values(r)[0]).map((v) => v.sheetId || (v.range && v.range.sheetId) || (v.start && v.start.sheetId)).find(Boolean);
          captured[byId[sid]] = body.requests;
          return {};
        },
        Values: {
          get: () => ({ values: products.map((p) => [p.status || 'active', p.category, p.barcode, '', p.name]) }),
          batchGet: () => ({ valueRanges: [] }),
        },
      },
    },
  };
  const ctx = vm.createContext(sandbox);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', f), 'utf8'), ctx, { filename: f });
  ['Config.gs', 'Address.gs', 'Registry.gs', 'VegDays.gs', 'Products.gs', 'SheetsFast.gs', 'BakeryReport.gs', 'BakeryZones.gs'].forEach(load);

  // що в Apps Script читається з Google/Довідника або пише у властивості - підміна на дані тесту
  ctx.__stores = stores; ctx.__nowBy = nowBy || {}; ctx.__setNow = (d) => { cur = d; };
  vm.runInContext(`
    loadStores_ = function () { return __stores; };
    markReport_ = function () {};
    var __wrap = function (fn, sheet) { return function (rows) { if (__nowBy[sheet]) __setNow(__nowBy[sheet]); return fn(rows); }; };
    buildBakeryOrdersSheet_ = __wrap(buildBakeryOrdersSheet_, 'Заказы ВК');
    buildBakerySummarySheet_ = __wrap(buildBakerySummarySheet_, 'Сводная ВК');
    buildBakeryRouteSheet_ = __wrap(buildBakeryRouteSheet_, 'Маршрути ВК');
  `, ctx);
  ctx.__rows = rows;
  vm.runInContext('buildBakeryReports(__rows)', ctx);
  return captured;
}

// значення комірок з updateCells-запиту (rows -> масив рядків A:D), як їх запише Google
function valuesOfRequests(reqs) {
  const u = reqs.find((r) => r.updateCells && r.updateCells.start);
  return u.updateCells.rows.map((row) => row.values.map((c) => {
    const v = c.userEnteredValue;
    return v ? (v.numberValue !== undefined ? v.numberValue : v.stringValue !== undefined ? v.stringValue : v.boolValue) : '';
  }));
}

module.exports = { runBakeryGas, valuesOfRequests, makeKyivDate, KYIV };
