// Модель листа: значення і ЯВНО задані властивості кожної комірки, ширини, висоти, закріплення. Три джерела:
//   applyRequests(sheet, requests)   - з наших batchUpdate-запитів (src/reports/sheetWriter.js);
//   modelFromGridData(apiSheet)       - з відповіді spreadsheets.get (includeGridData) - те, що справді лежить у Google;
//   мок SpreadsheetApp (test/helpers/gas-sheetapp.js) - з викликів справжнього Apps Script.
// diffSheets порівнює дві моделі. Використовується тестами, shadow.js і знімком фікстур.
const key = (r, c) => r + ',' + c;

function newSheet(name, id) {
  return { name, id, cells: {}, colW: {}, rowH: {}, frozenRows: 0, frozenCols: 0, filter: null, hidden: false, maxRows: 1000, maxCols: 26, merges: 0 };
}
const cellOf = (sh, r, c) => sh.cells[key(r, c)] || (sh.cells[key(r, c)] = {});
function each(r1, c1, r2, c2, fn) { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn(r, c); }

// ---------- кольори ----------
const hex = (h) => { h = String(h).toLowerCase(); if (h.length === 4) h = '#' + h.slice(1).replace(/(.)/g, '$1$1'); return h; };
const rgbHex = (c) => '#' + ['red', 'green', 'blue'].map((k) => Math.round((c && c[k] || 0) * 255).toString(16).padStart(2, '0')).join('');

// ---------- рамки ----------
function applyBorders(sh, r1, c1, r2, c2, b) {
  // b: { top, bottom, left, right, vertical, horizontal } - опис ('SOLID#000000'), null - прибрати, undefined - не чіпати
  const set = (r, c, side, v) => { if (v === undefined) return; const cell = cellOf(sh, r, c); if (v === null) delete cell[side]; else cell[side] = v; };
  each(r1, c1, r2, c2, (r, c) => {
    if (r === r1) set(r, c, 'bT', b.top);
    if (r === r2) set(r, c, 'bB', b.bottom);
    if (c === c1) set(r, c, 'bL', b.left);
    if (c === c2) set(r, c, 'bR', b.right);
    if (c > c1) set(r, c, 'bL', b.vertical);
    if (c < c2) set(r, c, 'bR', b.vertical);
    if (r > r1) set(r, c, 'bT', b.horizontal);
    if (r < r2) set(r, c, 'bB', b.horizontal);
  });
}

// ---------- модель з запитів Sheets API ----------
function typedValue(uv) {
  if (!uv) return undefined;
  if (uv.numberValue !== undefined) return uv.numberValue;
  if (uv.stringValue !== undefined) return uv.stringValue === '' ? undefined : uv.stringValue;
  if (uv.boolValue !== undefined) return uv.boolValue;
  return undefined;
}

function applyFormat(cell, f, fields) {
  const all = fields === null;
  const has = (name) => all || fields.indexOf(name) >= 0;
  if (!f) f = {};
  if (has('backgroundColor') && f.backgroundColor) cell.bg = rgbHex(f.backgroundColor);
  if (has('horizontalAlignment') && f.horizontalAlignment) cell.ha = f.horizontalAlignment.toLowerCase();
  if (has('verticalAlignment') && f.verticalAlignment) cell.va = f.verticalAlignment.toLowerCase();
  if (has('wrapStrategy') && f.wrapStrategy) cell.wrap = f.wrapStrategy === 'WRAP';
  if (has('numberFormat') && f.numberFormat) cell.nf = f.numberFormat.pattern || (f.numberFormat.type === 'TEXT' ? '@' : '');
  if (has('textRotation') && f.textRotation) cell.rot = f.textRotation.angle;
  const tf = f.textFormat || {};
  if (has('textFormat.foregroundColor') && tf.foregroundColor) cell.color = rgbHex(tf.foregroundColor);
  if (has('textFormat.bold') && tf.bold !== undefined) cell.bold = !!tf.bold;
  if (has('textFormat.fontSize') && tf.fontSize) cell.size = tf.fontSize;
  if (has('textFormat.fontFamily') && tf.fontFamily) cell.font = tf.fontFamily;
}

function bordDesc(b) { return b ? b.style + '#' + rgbHex(b.color).slice(1) : undefined; }

// reqs - масив запитів для ОДНОГО листа. Повертає змінену модель sh.
function applyRequests(sh, reqs) {
  const rect = (rg) => [(rg.startRowIndex || 0) + 1, (rg.startColumnIndex || 0) + 1,
    rg.endRowIndex !== undefined ? rg.endRowIndex : sh.maxRows, rg.endColumnIndex !== undefined ? rg.endColumnIndex : sh.maxCols];
  reqs.forEach((q) => {
    const type = Object.keys(q)[0], v = q[type];
    if (type === 'unmergeCells' || type === 'deleteConditionalFormatRule') return;
    if (type === 'updateCells') {
      if (v.range && !v.start) {                       // updateCells range=whole + fields '*' -> clear
        if (v.fields === '*') { sh.cells = {}; return; }
        return;
      }
      const r0 = v.start.rowIndex + 1, c0 = v.start.columnIndex + 1;
      const fields = v.fields.split(',');
      v.rows.forEach((row, i) => (row.values || []).forEach((cv, j) => {
        const cell = cellOf(sh, r0 + i, c0 + j);
        if (fields.indexOf('userEnteredValue') >= 0 || fields.indexOf('*') >= 0) {
          const tv = typedValue(cv.userEnteredValue);
          if (cv.userEnteredValue && cv.userEnteredValue.formulaValue) cell.formula = cv.userEnteredValue.formulaValue;
          else if (tv === undefined) delete cell.v; else cell.v = tv;
        }
        if (cv.userEnteredFormat) {
          const ff = fields.filter((x) => x.indexOf('userEnteredFormat') === 0).map((x) => x.replace('userEnteredFormat.', ''));
          applyFormat(cell, cv.userEnteredFormat, ff.length && ff[0] !== 'userEnteredFormat' ? expand(ff) : null);
        }
        if (cv.textFormatRuns && cv.textFormatRuns.length) {
          const run = cv.textFormatRuns[0].format || {};
          cell.link = run.link && run.link.uri;
          cell.rt = { size: run.fontSize, bold: run.bold, color: run.foregroundColor && rgbHex(run.foregroundColor), underline: run.underline };
        }
      }));
      return;
    }
    if (type === 'repeatCell') {
      const [r1, c1, r2, c2] = rect(v.range);
      const fields = expand(v.fields.split(',').map((x) => x.replace('userEnteredFormat.', '')));
      each(r1, c1, r2, c2, (r, c) => applyFormat(cellOf(sh, r, c), v.cell.userEnteredFormat, fields));
      return;
    }
    if (type === 'updateBorders') {
      const [r1, c1, r2, c2] = rect(v.range);
      applyBorders(sh, r1, c1, r2, c2, { top: bordDesc(v.top), bottom: bordDesc(v.bottom), left: bordDesc(v.left), right: bordDesc(v.right),
        vertical: bordDesc(v.innerVertical), horizontal: bordDesc(v.innerHorizontal) });
      return;
    }
    if (type === 'updateDimensionProperties') {
      const rg = v.range;
      for (let i = rg.startIndex; i < rg.endIndex; i++) {
        if (rg.dimension === 'ROWS') sh.rowH[i + 1] = v.properties.pixelSize; else sh.colW[i + 1] = v.properties.pixelSize;
      }
      return;
    }
    if (type === 'autoResizeDimensions') {
      const rg = v.dimensions;
      for (let i = rg.startIndex; i < rg.endIndex; i++) { if (rg.dimension === 'ROWS') sh.rowH[i + 1] = 'auto'; else sh.colW[i + 1] = 'auto'; }
      return;
    }
    if (type === 'updateSheetProperties') {
      const gp = v.properties.gridProperties || {};
      if (gp.frozenRowCount !== undefined) sh.frozenRows = gp.frozenRowCount;
      if (gp.frozenColumnCount !== undefined) sh.frozenCols = gp.frozenColumnCount;
      if (gp.hideGridlines !== undefined) sh.hidden = !!gp.hideGridlines;
      return;
    }
    if (type === 'appendDimension') {
      if (v.dimension === 'ROWS') sh.maxRows += v.length; else sh.maxCols += v.length;
      return;
    }
    if (type === 'deleteDimension') {
      const n = v.range.endIndex - v.range.startIndex;
      if (v.range.dimension === 'ROWS') sh.maxRows -= n; else sh.maxCols -= n;
      return;
    }
    if (type === 'setBasicFilter') { const [r1, c1, r2, c2] = rect(v.filter.range); sh.filter = [r1, c1, r2, c2]; return; }
    if (type === 'clearBasicFilter') { sh.filter = null; return; }
    throw new Error('applyRequests: невідомий запит ' + type);
  });
  return sh;
}
// 'textFormat.bold' залишається, 'textFormat' -> усі textFormat.*
function expand(list) {
  const out = [];
  list.forEach((f) => { if (f === 'textFormat') out.push('textFormat.foregroundColor', 'textFormat.bold', 'textFormat.fontSize', 'textFormat.fontFamily'); else out.push(f); });
  return out;
}

// ---------- порівняння ----------
const CELL_PROPS = ['v', 'formula', 'link', 'bg', 'color', 'bold', 'size', 'font', 'ha', 'va', 'nf', 'rot', 'wrap', 'bT', 'bB', 'bL', 'bR'];
const fmtVal = (x) => (x === undefined ? '∅' : JSON.stringify(x));
const normFormula = (f) => String(f).replace(/"\s*[;,]\s*"/g, '","');

// opts.skip - множина властивостей, які не порівнюємо (наприклад, ширини, що Google рахує сам)
function diffSheets(a, b, opts = {}) {
  const diffs = [];
  const keys = new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]);
  [...keys].sort((x, y) => { const [r1, c1] = x.split(',').map(Number), [r2, c2] = y.split(',').map(Number); return r1 - r2 || c1 - c2; }).forEach((k) => {
    const ca = a.cells[k] || {}, cb = b.cells[k] || {};
    CELL_PROPS.forEach((p) => {
      if (opts.skip && opts.skip.has(p)) return;
      let va = ca[p], vb = cb[p];
      if (p === 'formula') { if (va !== undefined) va = normFormula(va); if (vb !== undefined) vb = normFormula(vb); }
      // mask - прибирає з порівняння те, що відрізняється завжди (час збирання, id таблиці і gid у посиланнях)
      if (opts.mask && (p === 'v' || p === 'formula' || p === 'link')) { if (typeof va === 'string') va = opts.mask(va); if (typeof vb === 'string') vb = opts.mask(vb); }
      if (p === 'rot' && va === undefined && vb === 0) return;
      // liveTextFormat: у бойовому листі лишається текстовий формат '@' від давніх збірок (clear() у Apps Script його не скидає) там, де код формату не задає
      if (opts.liveTextFormat && p === 'nf' && va === '@' && vb === undefined && !/^-?\d+([.,]\d+)?$/.test(String(cb.v === undefined ? '' : cb.v)) && typeof cb.v !== 'number') { (opts.tally || {}).residual = ((opts.tally || {}).residual || 0) + 1; return; }
      if (JSON.stringify(va) !== JSON.stringify(vb)) {
        // loose - вузький допуск (див. shadow.looseFor): бойовий лист сам непослідовний у типі комірки, залежить від залишків форматів
        if (opts.loose && opts.loose(k, p, va, vb, ca, cb)) { if (opts.tally) opts.tally.loose = (opts.tally.loose || 0) + 1; return; }
        diffs.push({ cell: k, prop: p, gas: fmtVal(va), ours: fmtVal(vb) });
      }
    });
  });
  const dim = (name, ma, mb) => {
    if (opts.skip && opts.skip.has(name)) return;
    // onlyDimsOf: 'b' - Google віддає розміри ВСІХ рядків/колонок (за замовчуванням 21/100), порівнюємо лише ті, що задає модель b
    const ks = opts.onlyDimsOf === 'b' ? Object.keys(mb) : [...new Set([...Object.keys(ma), ...Object.keys(mb)])];
    ks.forEach((i) => {
      if (opts.skipDim && opts.skipDim(name, i, ma[i], mb[i])) return;
      if (ma[i] !== mb[i]) diffs.push({ cell: name + i, prop: name, gas: fmtVal(ma[i]), ours: fmtVal(mb[i]) });
    });
  };
  dim('colW', a.colW, b.colW); dim('rowH', a.rowH, b.rowH);
  ['frozenRows', 'frozenCols', 'hidden'].forEach((p) => { if (opts.skip && opts.skip.has(p)) return; if (a[p] !== b[p]) diffs.push({ cell: p, prop: p, gas: fmtVal(a[p]), ours: fmtVal(b[p]) }); });
  if (!opts.skip || !opts.skip.has('filter')) {
    if (JSON.stringify(a.filter) !== JSON.stringify(b.filter)) diffs.push({ cell: 'filter', prop: 'filter', gas: fmtVal(a.filter), ours: fmtVal(b.filter) });
  }
  if (!opts.skip || !opts.skip.has('grid')) {
    if (a.maxRows !== b.maxRows) diffs.push({ cell: 'maxRows', prop: 'maxRows', gas: fmtVal(a.maxRows), ours: fmtVal(b.maxRows) });
    if (a.maxCols !== b.maxCols) diffs.push({ cell: 'maxCols', prop: 'maxCols', gas: fmtVal(a.maxCols), ours: fmtVal(b.maxCols) });
  }
  return diffs;
}


// ---------- модель з відповіді Google (spreadsheets.get з includeGridData) ----------
// Поля запиту: sheets(properties(gridProperties),basicFilter,data(rowData(values(userEnteredValue,userEnteredFormat,textFormatRuns)),
//                    rowMetadata(pixelSize),columnMetadata(pixelSize))). Діапазон має починатися з A1.
function modelFromGridData(sh, name) {
  const m = newSheet(name || (sh.properties && sh.properties.title) || 'live', sh.properties && sh.properties.sheetId);
  const gp = (sh.properties && sh.properties.gridProperties) || {};
  m.maxRows = gp.rowCount || m.maxRows; m.maxCols = gp.columnCount || m.maxCols;
  m.frozenRows = gp.frozenRowCount || 0; m.frozenCols = gp.frozenColumnCount || 0; m.hidden = !!gp.hideGridlines;
  if (sh.basicFilter && sh.basicFilter.range) {
    const r = sh.basicFilter.range;
    m.filter = [(r.startRowIndex || 0) + 1, (r.startColumnIndex || 0) + 1, r.endRowIndex, r.endColumnIndex];
  }
  const d = (sh.data && sh.data[0]) || {};
  (d.rowData || []).forEach((row, i) => (row.values || []).forEach((cv, j) => {
    const cell = {};
    const uv = cv.userEnteredValue;
    if (uv) {
      if (uv.formulaValue !== undefined) cell.formula = uv.formulaValue;
      else { const tv = typedValue(uv); if (tv !== undefined) cell.v = tv; }
    }
    const f = cv.userEnteredFormat;
    if (f) {
      applyFormat(cell, f, null);
      const b = f.borders || {};
      [['top', 'bT'], ['bottom', 'bB'], ['left', 'bL'], ['right', 'bR']].forEach(([side, p]) => { if (b[side] && b[side].style && b[side].style !== 'NONE') cell[p] = bordDesc(b[side]); });
    }
    if (cv.textFormatRuns && cv.textFormatRuns.length) {
      const run = cv.textFormatRuns[0].format || {};
      if (run.link) { cell.link = run.link.uri; cell.rt = { size: run.fontSize, bold: run.bold, color: run.foregroundColor && rgbHex(run.foregroundColor), underline: run.underline }; }
    }
    if (Object.keys(cell).length) m.cells[key(i + 1, j + 1)] = cell;
  }));
  (d.columnMetadata || []).forEach((c, i) => { if (c.pixelSize) m.colW[i + 1] = c.pixelSize; });
  (d.rowMetadata || []).forEach((r, i) => { if (r.pixelSize) m.rowH[i + 1] = r.pixelSize; });
  return m;
}

module.exports = { newSheet, cellOf, each, key, applyBorders, rgbHex, hex, applyRequests, modelFromGridData, diffSheets, typedValue };
