// Тіньовий прогін звітів: бойові сирі рядки напрямку ЧИТАЮТЬСЯ (у бойову таблицю нічого не пишемо), з них будуються звіти
// в ТЕСТОВУ таблицю, потім зчитуються назад і порівнюються з бойовими звітами Apps Script комірка в комірку:
// значення (з типом), оформлення (колір, жирність, шрифт, вирівнювання, формат числа, рамки), ширини, висоти, закріплення, фільтр.
// Різниця, яка буває завжди і з порівняння виключена: час збирання («(оновлено 12:56:19)», «Звіт перезібрано о 15:42»),
// id таблиці і gid у посиланнях на xlsx.
//   node src/reports/shadow.js [bakery bread veg nbhz]     (на Fly: fly ssh console -C "node src/reports/shadow.js")
const { loadEnv } = require('../env');
const { DIRECTIONS } = require('../directions');
const { TEST_EXPORT_SPREADSHEET_ID, resolveTarget } = require('../export/target');
const googleApi = require('../google');
const { diffSheets } = require('./sheetModel');
const { modelOfPlan } = require('./planModel');
const { readLive, fetchModels } = require('./liveRead');
const { writeDir, nbhzLinkName, DIRS } = require('./rebuild');

const mask = (s) => s
  .replace(/\(оновлено \d\d:\d\d:\d\d\)/g, '(оновлено *)')
  .replace(/Звіт перезібрано о \d\d:\d\d/g, 'Звіт перезібрано о *')
  .replace(/spreadsheets\/d\/[^/]+\/export\?format=xlsx&gid=\d+/g, 'spreadsheets/d/*/export?format=xlsx&gid=*');

const VALUE_PROPS = new Set(['v', 'formula', 'fv', 'link']);

// Порівняння моделей листів: liveModels/ourModels - { назва листа: модель }, nameMap - { бойова назва: наша назва }
// Закріплення колонок задає лише вигрузка НБХЗ; у звітах ВК/хліба/овочів код колонки не закріплює, а в бойових листах лишилось
// закріплення з давніх версій (frozenCols 5 і 11 у «Заказы ВК» і «Сводная ВК») - воно не результат коду і не порівнюється.
const skipFor = (dir) => new Set(dir === 'nbhz' ? ['grid'] : ['grid', 'frozenCols']);

// Штрихкоди нижнього блоку «Данные Заказов» (колонка A): в бойовому листі то текст, то число - залежно від залишків формату '@'
// від попередніх збірок (за однієї й тієї ж програми). Наш вихід - завжди текст з '@'; цифри мають збігатися.
const looseFor = (dir) => (liveName) => (dir === 'bread' && liveName === 'Данные Заказов'
  ? (k, p, va, vb, ca, cb) => /,1$/.test(k) && ((p === 'v' && String(va) === String(vb)) || (p === 'nf' && String(ca.v) === String(cb.v)))
  : null);

function compareModels(liveModels, ourModels, nameMap = {}, opts = {}) {
  const sheets = {};
  let totalValue = 0, totalFormat = 0, totalCells = 0;
  for (const liveName of Object.keys(liveModels)) {
    const ours = ourModels[nameMap[liveName] || liveName];
    if (!ours) { sheets[liveName] = { missing: true, valueDiffs: [], formatDiffs: [] }; totalValue++; continue; }
    const exp = opts.explicit && opts.explicit[nameMap[liveName] || liveName];
    const pick = (m, keys) => Object.fromEntries(Object.keys(m).filter((k) => keys[k] !== undefined).map((k) => [k, m[k]]));
    const oursX = exp ? { ...ours, colW: pick(ours.colW, exp.colW), rowH: pick(ours.rowH, exp.rowH) } : ours;
    const diffs = diffSheets(liveModels[liveName], oursX, { mask, onlyDimsOf: 'b', skip: new Set(['grid', 'frozenCols']), ...opts,
      loose: opts.looseFor && opts.looseFor(liveName) });
    // наш лист у Google не повинен мати формул з помилкою (#ERROR!, #NAME? ...)
    Object.keys(ours.cells).forEach((k) => { const fv = ours.cells[k].fv; if (typeof fv === 'string' && fv.charAt(0) === '#') diffs.push({ cell: k, prop: 'fv', gas: '(формула без помилки)', ours: fv }); });
    const valueDiffs = diffs.filter((d) => VALUE_PROPS.has(d.prop));
    const formatDiffs = diffs.filter((d) => !VALUE_PROPS.has(d.prop));
    const cells = new Set([...Object.keys(liveModels[liveName].cells), ...Object.keys(ours.cells)]).size;
    sheets[liveName] = { cells, valueDiffs, formatDiffs };
    totalValue += valueDiffs.length; totalFormat += formatDiffs.length; totalCells += cells;
  }
  return { sheets, totalValue, totalFormat, totalCells };
}

async function shadowDir(dir, { at = new Date() } = {}) {
  const cfg = DIRECTIONS[dir];
  if (TEST_EXPORT_SPREADSHEET_ID === cfg.spreadsheetId) throw new Error('тестова таблиця збігається з бойовою - зупинка');
  const live = await readLive(dir, at);

  const { loadStores, supabase } = require('../db');
  const stores = await loadStores();
  const { data: products, error } = await supabase().from('products').select('barcode,name,category,status').eq('dir', dir).order('sort');
  if (error) throw new Error('products: ' + error.message);

  const env = { google: googleApi, target: resolveTarget('test'), at, archive: { spreadsheetId: '' } };
  const written = await writeDir(dir, env, TEST_EXPORT_SPREADSHEET_ID, live.rows, { stores, products }, live.day);

  // назад з тестової таблиці - те, що справді лежить у Google; однакові межі читання для обох сторін
  const nameMap = dir === 'nbhz' ? { 'Завантаження': nbhzLinkName(env) } : {};
  const ourName = (n) => nameMap[n] || n;
  const extents = Object.keys(live.models).map((name) => {
    const l = live.sizes.find((s) => s.name === name), o = written.sizes[ourName(name)] || { rows: 0, cols: 0 };
    return { name, rows: Math.max(l.rows, o.rows), cols: Math.max(l.cols, o.cols) };
  });
  const liveModels = await fetchModels(cfg.spreadsheetId, extents);
  const ourModels = await fetchModels(TEST_EXPORT_SPREADSHEET_ID, extents.map((e) => ({ ...e, name: ourName(e.name) })));
  const explicit = Object.fromEntries(Object.entries(written.plans).map(([n, p]) => [n, modelOfPlan(p)]));
  const tally = {};
  const cmp = compareModels(liveModels, ourModels, nameMap, { skip: skipFor(dir), explicit, liveTextFormat: true, tally, looseFor: looseFor(dir) });
  cmp.residualTextFormat = tally.residual || 0;
  cmp.looseCells = tally.loose || 0;
  return { dir, day: live.dmy, rawRows: live.raw.length, workRows: live.rows.length, stores: stores.length, missing: live.missing, archive: written.archive, ...cmp };
}

module.exports = { shadowDir, compareModels, mask, skipFor, looseFor };

if (require.main === module) {
  loadEnv();
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DIRS;
  (async () => {
    let bad = 0, cells = 0;
    for (let i = 0; i < dirs.length; i++) {
      if (i) await new Promise((r) => setTimeout(r, 20000));            // квота Sheets: 60 читань на хвилину
      const r = await shadowDir(dirs[i]);
      console.log(`\n[${r.dir}] день ${r.day}: сирих рядків прочитано ${r.rawRows}, робочих ${r.workRows}, точок у базі ${r.stores}` + (r.missing.length ? `, ЛИСТІВ НЕМАЄ в бойовій: ${r.missing.join(', ')}` : ''));
      for (const [name, s] of Object.entries(r.sheets)) {
        if (s.missing) { console.log(`  «${name}»: НЕМАЄ нашого листа`); continue; }
        console.log(`  «${name}»: комірок ${s.cells}, розбіжностей значень ${s.valueDiffs.length}, оформлення ${s.formatDiffs.length}`);
        [...s.valueDiffs, ...s.formatDiffs].slice(0, 12).forEach((d) => console.log(`       ${d.cell} ${d.prop}: бойовий=${d.gas} наш=${d.ours}`));
      }
      console.log(`  разом: комірок ${r.totalCells}, значень ${r.totalValue}, оформлення ${r.totalFormat}` + (r.looseCells ? `; допуск число/текст у штрихкодах зведення: ${r.looseCells} розб.` : '') + (r.residualTextFormat ? ` (окремо не рахується: залишок формату числа в бойовому на ${r.residualTextFormat} порожніх або текстових комірках, де код формату не задає)` : ''));
      bad += r.totalValue + r.totalFormat; cells += r.totalCells;
    }
    console.log(`\nУСЬОГО: комірок ${cells}, розбіжностей ${bad}`);
    process.exitCode = bad ? 1 : 0;
  })().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 2; });
}
