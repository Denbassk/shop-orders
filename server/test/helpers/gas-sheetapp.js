// Еталон для звітів, які Apps Script будує через SpreadsheetApp (хліб, НБХЗ, овочі): справжній app/*.gs у vm з підмінним
// SpreadsheetApp. Мок не відправляє запити - він веде МОДЕЛЬ листа (значення і явно задані властивості кожної комірки,
// ширини, висоти, закріплення), яку потім можна порівняти з моделлю, зібраною з наших batchUpdate-запитів (applyRequests).
//
//   const gas = runGas({ files, stores, products, raw: {'<id>': {'<лист>': [[рядки]]}}, now, run: 'buildBreadReports()' });
//   gas.sheet('<id>', '<лист>')  -> модель листа;   gas.props -> властивості скрипта
//   applyRequests(model, requests)  -> та сама модель з запитів Sheets API;   diffSheets(a, b) -> список розбіжностей
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeKyivDate, KYIV } = require('./bakery-oracle');
const { newSheet, cellOf, each, key, applyBorders, hex, applyRequests, diffSheets } = require('../../src/reports/sheetModel');

const APP = path.join(__dirname, '..', '..', '..', 'app');
// ---------- A1 ----------
const colNum = (L) => L.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function parseA1(a) {
  const m = String(a).match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('A1? ' + a);
  return [+m[2], colNum(m[1]), +(m[4] || m[2]), colNum(m[3] || m[1])];
}

// ---------- розбір введеного як у Google Sheets (локаль ru_RU) ----------
// Спостережено в бойових листах: рядок "19.10.2026" стає датою (число 46314 + формат dd.mm.yyyy на блок колонки від першої дати
// до кінця діапазону), рядок з цифр - числом; setNumberFormat('@') ПІСЛЯ запису перетворює числа на текст ("198").
const DMY = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const serialOfDmy = (s) => { const m = s.match(DMY); return Math.round(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400000) + 25569; };
function userEntered(cell, v) {
  if (typeof v !== 'string' || cell.nf === '@') return v;
  if (DMY.test(v)) return serialOfDmy(v);
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+,\d+$/.test(v)) return Number(v.replace(',', '.'));
  return v;
}
function parseBlock(sh, r1, c1, arr) {
  const dateCols = {};
  arr.forEach((row, i) => row.forEach((v, j) => {
    const cell = cellOf(sh, r1 + i, c1 + j);
    if (v === '' || v == null) { delete cell.v; return; }
    cell.v = userEntered(cell, v);
    if (typeof v === 'string' && DMY.test(v) && typeof cell.v === 'number' && !(j in dateCols)) dateCols[j] = r1 + i;
  }));
  Object.entries(dateCols).forEach(([j, first]) => { for (let r = first; r < r1 + arr.length; r++) { const cell = cellOf(sh, r, c1 + +j); if (cell.nf === undefined) cell.nf = 'dd.mm.yyyy'; } });
}

// ---------- мок SpreadsheetApp ----------
function createSpreadsheetApp(books, opts) {
  const autoColW = opts.autoColW || 100, autoRowH = opts.autoRowH || 21;
  let nextId = 5000;

  function rangeOf(sh, r1, c1, nr, nc) {
    const r2 = r1 + nr - 1, c2 = c1 + nc - 1;
    const setProp = (prop, v) => each(r1, c1, r2, c2, (r, c) => { const cell = cellOf(sh, r, c); if (v == null) delete cell[prop]; else cell[prop] = v; });
    const rng = {
      setValues(arr) { parseBlock(sh, r1, c1, arr); sh.maxRows = Math.max(sh.maxRows, r1 + arr.length - 1); sh.maxCols = Math.max(sh.maxCols, c1 + (arr[0] || []).length - 1); return rng; },
      setValue(v) { each(r1, c1, r2, c2, (r, c) => { const cell = cellOf(sh, r, c); if (v === '' || v == null) delete cell.v; else cell.v = userEntered(cell, v); }); return rng; },
      getValues() { const out = []; for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) { const x = sh.cells[key(r, c)]; row.push(x && x.v !== undefined ? x.v : ''); } out.push(row); } return out; },
      setFontFamily(v) { setProp('font', v); return rng; },
      setFontSize(v) { setProp('size', v); return rng; },
      setVerticalAlignment(v) { setProp('va', v); return rng; },
      setHorizontalAlignment(v) { setProp('ha', v); return rng; },
      setFontColor(v) { setProp('color', v && hex(v)); return rng; },
      setBackground(v) { setProp('bg', v && hex(v)); return rng; },
      setFontWeight(v) { setProp('bold', v === 'bold'); return rng; },
      // M-B (за бойовими листами хліба): setNumberFormat перечитує значення за новим форматом - '@' робить число текстом ("198"),
      // числовий формат повертає цифровий текст у число (кількість у нижньому блоці зведення лишилась числом після '@' на всю колонку)
      setNumberFormat(v) {
        setProp('nf', v);
        each(r1, c1, r2, c2, (r, c) => {
          const cell = cellOf(sh, r, c);
          if (v === '@' && typeof cell.v === 'number') cell.v = String(cell.v);
          else if (v !== '@' && typeof cell.v === 'string' && /^-?\d+(\.\d+)?$/.test(cell.v) && String(Number(cell.v)) === cell.v) cell.v = Number(cell.v);
        });
        return rng;
      },
      setTextRotation(v) { setProp('rot', v); return rng; },
      setWrap(v) { setProp('wrap', !!v); return rng; },
      setBackgrounds(a) { a.forEach((row, i) => row.forEach((v, j) => { cellOf(sh, r1 + i, c1 + j).bg = hex(v); })); return rng; },
      setFontColors(a) { a.forEach((row, i) => row.forEach((v, j) => { cellOf(sh, r1 + i, c1 + j).color = hex(v); })); return rng; },
      setFontWeights(a) { a.forEach((row, i) => row.forEach((v, j) => { cellOf(sh, r1 + i, c1 + j).bold = v === 'bold'; })); return rng; },
      setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
        const d = (flag) => (flag === true ? (style || 'SOLID') + '#' + (color ? hex(color).slice(1) : '000000') : flag === false ? null : undefined);
        applyBorders(sh, r1, c1, r2, c2, { top: d(top), bottom: d(bottom), left: d(left), right: d(right), vertical: d(vertical), horizontal: d(horizontal) });
        return rng;
      },
      createFilter() { sh.filter = [r1, c1, r2, c2]; return rng; },
      breakApart() { return rng; },
      clearDataValidations() { return rng; },
      setRichTextValue(rt) {
        const cell = cellOf(sh, r1, c1);
        // Google віддає посилання і стиль на рівні формату комірки (textFormat.link/underline/...), не окремими прогонами
        cell.v = rt.text; cell.link = rt.url;
        const st = rt.style || {};
        if (st.size !== undefined) cell.size = st.size;
        if (st.bold !== undefined) cell.bold = st.bold;
        if (st.color !== undefined) cell.color = st.color;
        if (st.underline !== undefined) cell.ul = st.underline;
        return rng;
      },
      setFormula(f) { cellOf(sh, r1, c1).formula = f; return rng; },
    };
    return rng;
  }

  function sheetApi(sh) {
    const api = {
      getName: () => sh.name,
      getSheetId: () => sh.id,
      clear() { sh.cells = {}; sh.edges = {}; sh.filter = null; return api; },
      clearConditionalFormatRules() { return api; },
      getRange(a, b, c, d) {
        if (typeof a === 'string') { const [r1, c1, r2, c2] = parseA1(a); return rangeOf(sh, r1, c1, r2 - r1 + 1, c2 - c1 + 1); }
        return rangeOf(sh, a, b, c || 1, d || 1);
      },
      getRangeList(list) {
        const rs = list.map((a) => api.getRange(a));
        const wrap = {};
        Object.keys(rangeOf(sh, 1, 1, 1, 1)).forEach((m) => { wrap[m] = (...args) => { rs.forEach((x) => x[m](...args)); return wrap; }; });
        return wrap;
      },
      getLastRow() { const rs = Object.keys(sh.cells).filter((k) => sh.cells[k].v !== undefined).map((k) => +k.split(',')[0]); return rs.length ? Math.max(...rs) : 0; },
      getLastColumn() { const cs = Object.keys(sh.cells).filter((k) => sh.cells[k].v !== undefined).map((k) => +k.split(',')[1]); return cs.length ? Math.max(...cs) : 0; },
      getMaxRows: () => sh.maxRows,
      getMaxColumns: () => sh.maxCols,
      deleteColumns(pos, n) { sh.maxCols -= n; },
      deleteRows(pos, n) { sh.maxRows -= n; },
      setColumnWidth(c, w) { sh.colW[c] = w; return api; },
      getColumnWidth(c) { return sh.colW[c] === 'auto' ? autoColW : (sh.colW[c] || 100); },
      setRowHeight(r, h) { sh.rowH[r] = h; return api; },
      getRowHeight(r) { return sh.rowH[r] === 'auto' ? autoRowH : (sh.rowH[r] || 21); },
      setRowHeights(r, n, h) { for (let i = 0; i < n; i++) sh.rowH[r + i] = h; return api; },
      autoResizeColumns(c, n) { for (let i = 0; i < n; i++) sh.colW[c + i] = 'auto'; return api; },
      autoResizeRows(r, n) { for (let i = 0; i < n; i++) sh.rowH[r + i] = 'auto'; return api; },
      setFrozenRows(n) { sh.frozenRows = n; return api; },
      setFrozenColumns(n) { sh.frozenCols = n; return api; },
      setHiddenGridlines(v) { sh.hidden = !!v; return api; },
      getFilter() { return sh.filter ? { remove() { sh.filter = null; } } : null; },
      copyTo() { throw new Error('copyTo: перевіряється окремо'); },
    };
    return api;
  }

  function bookApi(id) {
    const book = books[id] = books[id] || { id, sheets: {}, order: [] };
    const bk = {
      getId: () => id,
      getName: () => 'мок ' + id,
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id + '/edit',
      getSheetByName(name) { return book.sheets[name] ? sheetApi(book.sheets[name]) : null; },
      insertSheet(name, index) {
        if (book.sheets[name]) throw new Error('лист вже є: ' + name);
        const sh = newSheet(name, nextId++);
        book.sheets[name] = sh; book.order.splice(index == null ? book.order.length : index, 0, name);
        return sheetApi(sh);
      },
      getSheets: () => book.order.map((n) => sheetApi(book.sheets[n])),
      deleteSheet(s) { const n = s.getName(); delete book.sheets[n]; book.order = book.order.filter((x) => x !== n); },
    };
    return bk;
  }

  const textStyle = () => { const s = {}; const b = {
    setFontSize(v) { s.size = v; return b; }, setBold(v) { s.bold = v; return b; },
    setForegroundColor(v) { s.color = hex(v); return b; }, setUnderline(v) { s.underline = v; return b; }, build() { return s; } }; return b; };
  const richText = () => { const t = {}; const b = {
    setText(v) { t.text = v; return b; }, setLinkUrl(v) { t.url = v; return b; }, setTextStyle(v) { t.style = v; return b; }, build() { return t; } }; return b; };

  return {
    openById: bookApi,
    newTextStyle: textStyle,
    newRichTextValue: richText,
    flush() {},
    BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', DASHED: 'DASHED' },
  };
}

// ---------- vm ----------
function runGas({ files, stores, products, raw, props, now, run, nowTimes }) {
  let cur = now || new Date();
  const books = {};
  const propStore = Object.assign({}, props || {});
  const SA = createSpreadsheetApp(books, {});
  const sandbox = {
    console: { log() {}, error() {}, warn() {} }, Math, JSON, Object, String, Number, Array, RegExp, Intl, Boolean, parseFloat, isNaN, Date: makeKyivDate(() => cur),
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {}, removeAll() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in propStore ? propStore[k] : null), setProperty: (k, v) => { propStore[k] = String(v); },
      deleteProperty: (k) => { delete propStore[k]; }, setProperties: (m) => Object.assign(propStore, m), getProperties: () => ({ ...propStore }) }) },
    Utilities: { formatDate: (d, tz, fmt) => {
      const p = {}; KYIV.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
      return String(fmt).replace('yyyy', p.year).replace('dd', p.day).replace('MM', p.month).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
    } },
    SpreadsheetApp: SA,
    ScriptApp: { getProjectTriggers: () => [] },
  };
  const ctx = vm.createContext(sandbox);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });

  // сирі листи: { '<id>': { '<лист>': [[рядки з шапкою]] } }
  Object.entries(raw || {}).forEach(([id, sheets]) => {
    const bk = SA.openById(id);
    Object.entries(sheets).forEach(([name, rows]) => {
      bk.insertSheet(name);
      const model = books[id].sheets[name];              // сирі значення кладемо як є: у бойовому листі вони вже набрані
      rows.forEach((r, i) => r.forEach((v, j) => { if (v !== '' && v != null) cellOf(model, i + 1, j + 1).v = v; }));
    });
  });

  files.forEach(load);
  ctx.__stores = stores; ctx.__products = products || [];
  vm.runInContext(`
    loadStores_ = function () { return __stores; };
    loadProducts_ = function () { return __products; };
    markReport_ = function () {};
  `, ctx);
  if (nowTimes) {                                        // різний «зараз» для різних функцій (як окремі запуски тригерів)
    ctx.__setNow = (d) => { cur = d; };
  }
  const result = vm.runInContext(run, ctx);
  return {
    books, props: propStore, result,
    sheet: (id, name) => (books[id] && books[id].sheets[name]) || null,
    sheetNames: (id) => (books[id] ? books[id].order.slice() : []),
  };
}

module.exports = { runGas, newSheet, applyRequests, diffSheets, APP };
