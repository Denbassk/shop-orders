// Вигрузка НБХЗ для заводу: лист «Вивантаження дд.мм.рррр» (матриця ТТ × асортимент) і лист «Завантаження» з посиланням на xlsx.
// Перенос app/Nbhz.gs (buildNbhzExport, writeExportLinkSheet_, fuzzyKey_) - формат, порядок колонок («Ассортимент» без «стоп»),
// порядок рядків (маршрут, адреса), вирізання порожніх рядків і колонок, позначка ЮА, стилі - дослівно.
// Відмінності від Apps Script (джерела даних і спосіб запису):
//   - рядки замовлень - з бази (reports/rows.js), а не з сирого листа;
//   - ТТ - зі stores (rowToStore), асортимент - з products (dir='nbhz', порядок sort, без status='stop');
//   - запис - batchUpdate; ширини колонок A:B і висоту шапки Google рахує сам (autoResize), друга половина - afterWrite.
const R = require('../rules');
const { hexRgb } = require('./sheetWriter');
const { isUaStore, uaAddrKeys, UA_MARK } = require('./veg');
const { xlsxUrl } = require('./bread');

const NBHZ_EXPORT_SKIP_EMPTY_ROWS = true;
const NBHZ_EXPORT_SKIP_EMPTY_COLS = true;
const NBHZ_LINK_SHEET = 'Завантаження';

const uk = (a, b) => a.localeCompare(b, 'uk');
const cellStr = (v) => String(v == null ? '' : v).trim();

// nameKey_ (Products.gs)
const nameKey = (s) => String(s || '').toLowerCase().replace(/[’'`"()]/g, ' ').replace(/\s+/g, ' ').trim();

// Ключ, стійкий до рос/укр написання адреси (fuzzyKey_)
function fuzzyKey(s) {
  return R.addrKey(s)
    .replace(/ь/g, '')
    .replace(/[иіїы]/g, 'i')
    .replace(/[еєэё]/g, 'e')
    .replace(/[ґг]/g, 'г')
    .replace(/\s+/g, ' ').trim();
}

// Сирий рядок листа НБХЗ (A дата | B маршрут | C адреса | D штрихкод | E назва | F ціна | G кількість) -> робочий рядок:
// дата ДД.ММ.РРРР, кількість числом. Лишає лише рядки за dmy (решту відсіює buildNbhzExport: назви поза асортиментом).
function normalizeRawRows(rawRows, dmy) {
  const { dmyOfSheetCell } = require('../export/raw');
  return rawRows.map((r) => {
    const x = [];
    for (let i = 0; i < 7; i++) x.push(r[i] == null ? '' : r[i]);
    x[0] = dmyOfSheetCell(x[0]).slice(0, 10);
    x[6] = Number(String(x[6]).replace(',', '.')) || 0;
    return x;
  }).filter((r) => r[0] === dmy);
}

// Ширини A:B і висота шапки з урахуванням того, що порахував Google: { col1, col2, row1 } -> ті, що ставить Nbhz.gs
function nbhzAutoDims({ col1, col2, row1 }) {
  return {
    col1: Math.min(Math.max(col1 + 14, 96), 170),
    col2: Math.min(Math.max(col2 + 14, 170), 300),
    row1: row1 < 48 ? 48 : row1,
  };
}

const dimReq = (sid, dimension, start, end, px) => ({ updateDimensionProperties: {
  range: { sheetId: sid, dimension, startIndex: start, endIndex: end }, properties: { pixelSize: px }, fields: 'pixelSize' } });

// rows - робочі рядки; opts: { stores (усі, rowToStore), products (рядки products dir='nbhz', у порядку sort), now }
// Повертає { name, empty, plan, stats } - plan для writeSheet (reports/sheetWriter.js).
function buildNbhzExport(rows, opts = {}) {
  const stores = opts.stores || [];
  const at = opts.now || new Date();
  const k = R.kyivNow(at), today = k.dmy;
  const prods = (opts.products || []).filter((p) => String(p.status || '').trim().toLowerCase() !== 'stop');
  if (!prods.length) throw new Error('Лист "Ассортимент" порожній');
  const colOf = {};
  prods.forEach((p, i) => { colOf[nameKey(p.name)] = i; });

  // 1. Усі точки НБХЗ - навіть ті, що сьогодні не замовляли
  const rowsByStore = {}, order = [];
  stores.forEach((st) => {
    if (st.directions.indexOf('nbhz') < 0) return;
    const addr = st.addrNbhz || st.address;
    const key = fuzzyKey(R.shortenAddress(addr));
    if (rowsByStore[key]) return;
    rowsByStore[key] = { route: st.routeNbhz || '', addr, ua: isUaStore(st), qty: new Array(prods.length).fill(0), got: false };
    order.push(key);
  });

  // 2. Розкладаємо сьогоднішні замовлення
  const uaN = uaAddrKeys(stores, 'addrNbhz');
  rows.forEach((r) => {
    if (cellStr(r[0]) !== today) return;
    const ci = colOf[nameKey(r[4])];
    if (ci === undefined) return;
    const key = fuzzyKey(cellStr(r[2]));
    if (!rowsByStore[key]) {                         // точки немає в Довіднику
      rowsByStore[key] = { route: cellStr(r[1]), addr: cellStr(r[2]), ua: !!uaN[R.addrKey(r[2])], qty: new Array(prods.length).fill(0), got: true };
      order.push(key);
    }
    rowsByStore[key].qty[ci] += Number(r[6]) || 0;
    rowsByStore[key].got = true;
  });

  if (!order.length) throw new Error('Немає жодної точки НБХЗ - запустіть installNbhz()');

  order.sort((a, b) => {
    const A = rowsByStore[a], B = rowsByStore[b];
    return uk(A.route, B.route) || uk(A.addr, B.addr);
  });

  // --- лишаємо лише те, що замовили ---
  const keepCols = [];
  for (let ci = 0; ci < prods.length; ci++) {
    let used = false;
    for (let oi = 0; oi < order.length; oi++) {
      if (rowsByStore[order[oi]].qty[ci] > 0) { used = true; break; }
    }
    if (used || !NBHZ_EXPORT_SKIP_EMPTY_COLS) keepCols.push(ci);
  }
  const keepRows = NBHZ_EXPORT_SKIP_EMPTY_ROWS
    ? order.filter((key) => rowsByStore[key].qty.some((q) => q > 0))
    : order;

  const head = ['Маршрут', 'Адрес Магазина'].concat(keepCols.map((ci) => prods[ci].name));
  const body = keepRows.map((key) => {
    const s = rowsByStore[key];
    return [s.route, s.addr + (s.ua ? UA_MARK : '')].concat(keepCols.map((ci) => s.qty[ci]));
  });

  const name = 'Вивантаження ' + today;
  const nCols = head.length, nRows = body.length, nProd = keepCols.length;

  if (!nRows) {
    const data = [['Замовлень на ' + today + ' немає']];
    const apply = (w) => {
      w.fmt([1], 'A', 'A', { size: 14, bold: true, color: '#b3261e' });
      w.colWidths([420]);
    };
    return { name, empty: true, stats: { nRows: 0, nProd, stores: order.length, prods: prods.length },
      plan: { data, width: 1, apply, info: `На ${today} замовлень немає - лист порожній` } };
  }

  const data = [head].concat(body);
  const lastCol = require('./sheetWriter').colLetter(nCols - 1);
  const bodyRows = Array.from({ length: nRows }, (_, i) => i + 2);

  const apply = (w) => {
    // --- шапка: горизонтальний текст, перенос, по центру ---
    w.fmt([1], 'A', lastCol, { bold: true, size: 10, bg: '#e8eaed', color: '#16181d', rot: 0, wrap: true, valign: 'middle', halign: 'center' });
    w.fmt([1], 'A', 'B', { halign: 'left' });

    // --- тіло ---
    w.fmt(bodyRows, 'A', lastCol, { size: 10, bold: false, wrap: false, valign: 'middle' });
    w.fmt(bodyRows, 'A', 'B', { halign: 'left' });
    if (nProd) w.fmt(bodyRows, 'C', lastCol, { halign: 'center' });

    // смужки через рядок + нулі блідим, замовлене - чорним жирним
    const fmtRows = body.map((row, r) => ({ values: row.map((v, c) => ({ userEnteredFormat: {
      backgroundColor: hexRgb(r % 2 ? '#f6f7f9' : '#ffffff'),
      textFormat: { foregroundColor: hexRgb(c < 2 ? '#16181d' : (v > 0 ? '#16181d' : '#c3c7cd')), bold: c === 0 ? true : (c === 1 ? false : v > 0) },
    } })) }));
    w.raw({ updateCells: { start: { sheetId: w.sheetId, rowIndex: 1, columnIndex: 0 }, rows: fmtRows,
      fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor,userEnteredFormat.textFormat.bold' } });

    // --- сітка ---
    w.border(null, 'A', lastCol, { color: '#9aa0a6', style: 'SOLID' });
    w.border(null, 'A', 'B', { color: '#5f6368', style: 'SOLID_MEDIUM', sides: ['right'] });
    w.border([1], 'A', lastCol, { color: '#5f6368', style: 'SOLID_MEDIUM', sides: ['bottom'] });

    // --- ширини: A:B по вмісту (Google рахує; другий етап - afterWrite), товари однакові ---
    w.raw({ autoResizeDimensions: { dimensions: { sheetId: w.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 2 } } });
    if (nProd) w.raw(dimReq(w.sheetId, 'COLUMNS', 2, 2 + nProd, 92));
    w.raw({ autoResizeDimensions: { dimensions: { sheetId: w.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 } } });

    w.raw({ updateSheetProperties: { properties: { sheetId: w.sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
    w.raw({ setBasicFilter: { filter: { range: { sheetId: w.sheetId, startRowIndex: 0, endRowIndex: nRows + 1, startColumnIndex: 0, endColumnIndex: nCols } } } });

    // прибрати зайві порожні колонки і рядки справа-знизу
    w.trimGrid(nRows + 1, nCols);
  };

  // другий етап: Google вже порахував ширини A:B і висоту шапки - ставимо їх за формулою Nbhz.gs
  const afterWrite = async ({ google, spreadsheetId, sheetId, sheetName }) => {
    const auto = await google.sheetDims(spreadsheetId, sheetName);
    const d = nbhzAutoDims(auto);
    const reqs = [dimReq(sheetId, 'COLUMNS', 0, 1, d.col1), dimReq(sheetId, 'COLUMNS', 1, 2, d.col2)];
    if (auto.row1 < 48) reqs.push(dimReq(sheetId, 'ROWS', 0, 1, 48));
    await google.batchUpdate(spreadsheetId, reqs);
  };

  return { name, empty: false, stats: { nRows, nProd, stores: order.length, prods: prods.length },
    plan: { data, width: nCols, apply, afterWrite,
      info: `${name}: точок із замовленням ${nRows} з ${order.length}, позицій ${nProd} з ${prods.length}` } };
}

// ---------- лист «Завантаження» (writeExportLinkSheet_) ----------
function nbhzLinkPlan({ spreadsheetId, gid, now }) {
  const today = R.kyivNow(now || new Date()).dmy;
  const url = xlsxUrl(spreadsheetId, gid);
  const data = [
    ['ЗАМОВЛЕННЯ ДЛЯ ЗАВОДУ'],
    ['за ' + today],
    [''],
    [''],
    [''],
    ['Файл міститиме ТІЛЬКИ таблицю замовлення - решта листів у нього не потрапляє.'],
    ['Посилання оновлюється щодня само. Можна покласти цей лист у закладки.'],
  ];
  const apply = (w) => {
    w.fmt([1], 'A', 'A', { size: 16, bold: true });
    w.fmt([2], 'A', 'A', { color: '#6b7280' });
    w.raw({ updateCells: { start: { sheetId: w.sheetId, rowIndex: 3, columnIndex: 0 }, fields: 'userEnteredValue',
      rows: [{ values: [{ userEnteredValue: { formulaValue: '=HYPERLINK("' + url + '", "⬇  ЗАВАНТАЖИТИ EXCEL за ' + today + '")' } }] }] } });
    w.fmt([4], 'A', 'A', { size: 14, bold: true, color: '#1a73e8' });
    w.fmt([6, 7], 'A', 'A', { color: '#6b7280', size: 10 });
    w.colWidths([620]);
    w.raw({ updateSheetProperties: { properties: { sheetId: w.sheetId, gridProperties: { hideGridlines: true } },
      fields: 'gridProperties.hideGridlines' } });
  };
  return { data, width: 1, apply, sheetIndex: 0, info: 'Завантаження (НБХЗ): посилання на xlsx ' + gid };
}

module.exports = {
  NBHZ_LINK_SHEET, fuzzyKey, nameKey, normalizeRawRows, nbhzAutoDims, buildNbhzExport, nbhzLinkPlan,
};
