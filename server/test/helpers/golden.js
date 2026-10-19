// Золота фікстура звіту напрямку: знімок бойової таблиці (сирі рядки за день + значення і оформлення звітів Apps Script) і
// те, що з цих сирих рядків збирає наш код. Спільне для test/reports-*-golden.test.js і scripts/snapshot-report.js.
const fs = require('node:fs');
const path = require('node:path');
const { compareModels, skipFor, looseFor } = require('../../src/reports/shadow');
const { NORMALIZE } = require('../../src/reports/liveRead');
const bakery = require('../../src/reports/bakery');
const bread = require('../../src/reports/bread');
const veg = require('../../src/reports/veg');
const nbhz = require('../../src/reports/nbhz');
const { DIRECTIONS } = require('../../src/directions');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const loadFixture = (dir, day) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${dir}-${day}.json`), 'utf8'));

// { бойова назва листа: план } з сирих рядків фікстури. stores/products - як їх повертає rowToStore / таблиця products
function plansFor(dir, fx) {
  const rows = NORMALIZE[dir](fx.raw, fx.dmy);
  const now = new Date(fx.takenAt);
  const stores = fx.stores, products = fx.products;
  const id = DIRECTIONS[dir].spreadsheetId, gid = fx.sheetIds || {};
  if (dir === 'bakery') return bakery.buildBakeryReports(rows, { stores, products, now });
  if (dir === 'veg') return veg.buildVegReports(rows, { stores, now });
  if (dir === 'bread') {
    const plans = bread.buildBreadReports(rows, { stores, now });
    plans[bread.BREAD_DOWNLOAD_SHEET] = bread.breadDownloadPlan({ spreadsheetId: id, ordersGid: gid[bread.BREAD_ORDERS_SHEET], summaryGid: gid[bread.BREAD_SUMMARY_SHEET], now });
    return plans;
  }
  const exp = nbhz.buildNbhzExport(rows, { stores, products, now });
  return { [exp.name]: exp.plan, [nbhz.NBHZ_LINK_SHEET]: nbhz.nbhzLinkPlan({ spreadsheetId: id, gid: gid[exp.name], now }) };
}

const { modelOfPlan: modelOf } = require('../../src/reports/planModel');

// Google сам рахує ширину колонок A:B і висоту шапки у вигрузці НБХЗ (autoResize) - у фікстурі вони справжні, у нашій моделі 'auto'
const AUTO_NBHZ = { skip: skipFor('nbhz'), skipDim: (name, i, a, b) => b === 'auto' };

function compareFixture(dir, fx) {
  const plans = plansFor(dir, fx);
  const ours = Object.fromEntries(Object.entries(plans).map(([n, p]) => [n, modelOf(p)]));
  const tally = {};
  const res = compareModels(fx.models, ours, {}, { ...(dir === 'nbhz' ? AUTO_NBHZ : { skip: skipFor(dir) }), liveTextFormat: true, tally, looseFor: looseFor(dir) });
  res.residualTextFormat = tally.residual || 0;
  res.looseCells = tally.loose || 0;
  return res;
}

module.exports = { FIXTURES, loadFixture, plansFor, modelOf, compareFixture };
