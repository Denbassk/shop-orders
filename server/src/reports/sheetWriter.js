// Запис звітного листа одним batchUpdate. Перенос apiSheetWriter_, apiFmtReq_, gridRange_, rowRuns_, hexRgb_, colIdx_
// (app/SheetsFast.gs) - ті самі JSON-запити Sheets API.
//
// Різниця від .gs лише в розділенні на дві частини (щоб запити можна було звірити з Apps Script без мережі):
//   writerFor(meta, data, width) -> w   - чисте накопичення запитів (fmt/border/rowHeights/colWidths/frozen), w.requests()
//   writeSheet(google, ssId, name, plan) - читає властивості листа, за потреби створює його, шле batchUpdate
// rowsList - номери рядків (1-based), сусідні склеюються; null - усі рядки даних.

function hexRgb(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255,
           blue: parseInt(h.slice(4, 6), 16) / 255 };
}

// A -> 0, Z -> 25, AA -> 26
function colIdx(L) { return String(L).toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; }
// 0 -> A, 26 -> AA
function colLetter(i) { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }

function rowRuns(rows) {
  const s = rows.slice().sort((a, b) => a - b), out = [];
  for (let i = 0; i < s.length; i++) {
    if (out.length && s[i] === out[out.length - 1][1] + 1) out[out.length - 1][1] = s[i];
    else if (!out.length || s[i] > out[out.length - 1][1]) out.push([s[i], s[i]]);
  }
  return out;
}

// repeatCell лише з тими полями формату, що задані в f - решта формату клітинки не чіпається.
function fmtReq(rg, f) {
  const cf = {}, tf = {}, fields = [];
  if (f.bg) { cf.backgroundColor = hexRgb(f.bg); fields.push('backgroundColor'); }
  if (f.halign) { cf.horizontalAlignment = f.halign.toUpperCase(); fields.push('horizontalAlignment'); }
  if (f.valign) { cf.verticalAlignment = f.valign.toUpperCase(); fields.push('verticalAlignment'); }
  if (f.wrap != null) { cf.wrapStrategy = f.wrap ? 'WRAP' : 'OVERFLOW_CELL'; fields.push('wrapStrategy'); }
  if (f.rot != null) { cf.textRotation = { angle: f.rot }; fields.push('textRotation'); }
  if (f.num) {
    cf.numberFormat = f.num === '@' ? { type: 'TEXT', pattern: '@' }
      : f.num === 'dd.mm.yyyy' ? { type: 'DATE', pattern: f.num }
      : f.num === 'HH:mm:ss' ? { type: 'TIME', pattern: f.num }
      : { type: 'NUMBER', pattern: f.num };
    fields.push('numberFormat');
  }
  if (f.color) { tf.foregroundColor = hexRgb(f.color); fields.push('textFormat.foregroundColor'); }
  if (f.bold != null) { tf.bold = !!f.bold; fields.push('textFormat.bold'); }
  if (f.size) { tf.fontSize = f.size; fields.push('textFormat.fontSize'); }
  if (f.font) { tf.fontFamily = f.font; fields.push('textFormat.fontFamily'); }
  if (Object.keys(tf).length) cf.textFormat = tf;
  return { repeatCell: { range: rg, cell: { userEnteredFormat: cf },
    fields: fields.map((x) => 'userEnteredFormat.' + x).join(',') } };
}

// Діапазон для batchUpdate: рядки/колонки 1-based включно
function gridRange(sid, r1, c1, r2, c2) {
  return { sheetId: sid, startRowIndex: r1 - 1, endRowIndex: r2,
           startColumnIndex: c1 - 1, endColumnIndex: c2 };
}

// meta - властивості листа як у Sheets API: { properties: { sheetId, gridProperties }, conditionalFormats? }
function writerFor(meta, data, width) {
  const sid = meta.properties.sheetId;
  const gp = meta.properties.gridProperties || {};
  const n = data.length, reqs = [];

  // як sh.clear() + clearConditionalFormatRules() + breakApart()
  (meta.conditionalFormats || []).forEach(() => {
    reqs.push({ deleteConditionalFormatRule: { sheetId: sid, index: 0 } });
  });
  if (meta.basicFilter) reqs.push({ clearBasicFilter: { sheetId: sid } });
  reqs.push({ unmergeCells: { range: { sheetId: sid } } });
  reqs.push({ updateCells: { range: { sheetId: sid }, fields: '*' } });
  if ((gp.rowCount || 0) < n)
    reqs.push({ appendDimension: { sheetId: sid, dimension: 'ROWS', length: n - (gp.rowCount || 0) } });
  if ((gp.columnCount || 0) < width)
    reqs.push({ appendDimension: { sheetId: sid, dimension: 'COLUMNS', length: width - (gp.columnCount || 0) } });

  reqs.push({ updateCells: {
    start: { sheetId: sid, rowIndex: 0, columnIndex: 0 },
    fields: 'userEnteredValue',
    rows: data.map((row) => {
      const vals = [];
      for (let c = 0; c < width; c++) {
        const v = row[c];
        if (v === '' || v == null) vals.push({});
        else if (typeof v === 'number') vals.push({ userEnteredValue: { numberValue: v } });
        else if (typeof v === 'boolean') vals.push({ userEnteredValue: { boolValue: v } });
        else vals.push({ userEnteredValue: { stringValue: String(v) } });
      }
      return { values: vals };
    }),
  } });

  function ranges(rows, c1, c2) {
    const runs = rows ? rowRuns(rows) : [[1, n]];
    return runs.map((r) => ({ sheetId: sid, startRowIndex: r[0] - 1, endRowIndex: r[1],
                              startColumnIndex: colIdx(c1), endColumnIndex: colIdx(c2 || c1) + 1 }));
  }

  const w = {
    sheetId: sid,
    grid: { rows: Math.max(gp.rowCount || 0, n), cols: Math.max(gp.columnCount || 0, width) },
    fmt(rows, c1, c2, f) {
      if (rows && !rows.length) return w;
      ranges(rows, c1, c2).forEach((rg) => { reqs.push(fmtReq(rg, f)); });
      return w;
    },
    // o: { color: '#rrggbb', style: 'SOLID'|'SOLID_MEDIUM', sides: ['top','bottom','left','right','innerHorizontal','innerVertical'] };
    // без o - чорна суцільна рамка навколо і всередині (setBorder(true, true, true, true, true, true))
    border(rows, c1, c2, o) {
      if (rows && !rows.length) return w;
      o = o || {};
      const b = { style: o.style || 'SOLID', color: o.color ? hexRgb(o.color) : { red: 0, green: 0, blue: 0 } };
      const sides = o.sides || ['top', 'bottom', 'left', 'right', 'innerHorizontal', 'innerVertical'];
      ranges(rows, c1, c2).forEach((rg) => {
        const req = { range: rg };
        sides.forEach((sd) => { req[sd] = b; });
        reqs.push({ updateBorders: req });
      });
      return w;
    },
    // grid - поточний розмір сітки листа (після appendDimension); trimGrid прибирає зайві рядки і колонки справа-знизу
    trimGrid(nRows, nCols) {
      if (w.grid.cols > nCols) { reqs.push({ deleteDimension: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: nCols, endIndex: w.grid.cols } } }); w.grid.cols = nCols; }
      if (w.grid.rows > nRows) { reqs.push({ deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: nRows, endIndex: w.grid.rows } } }); w.grid.rows = nRows; }
      return w;
    },
    rowHeights(px) {
      if (n) reqs.push({ updateDimensionProperties: {
        range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: n },
        properties: { pixelSize: px }, fields: 'pixelSize' } });
      return w;
    },
    colWidths(list) {
      list.forEach((px, i) => {
        reqs.push({ updateDimensionProperties: {
          range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: px }, fields: 'pixelSize' } });
      });
      return w;
    },
    frozen(k) {
      reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: k } },
                                           fields: 'gridProperties.frozenRowCount' } });
      return w;
    },
    raw(req) { reqs.push(req); return w; },
    requests() { return reqs; },
  };
  return w;
}

// plan = { data, width, apply(w) } (див. reports/bakery.js). google = { sheetMeta, batchUpdate }.
// Лист без вкладки створюється (addSheet), як в apiSheetWriter_.
async function writeSheet(google, spreadsheetId, sheetName, plan) {
  let meta = await google.sheetMeta(spreadsheetId, sheetName);
  if (!meta) {
    const props = { title: sheetName };
    if (plan.sheetIndex != null) props.index = plan.sheetIndex;
    const r = await google.batchUpdate(spreadsheetId, [{ addSheet: { properties: props } }]);
    meta = { properties: { sheetId: r.replies[0].addSheet.properties.sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } };
  }
  const w = writerFor(meta, plan.data, plan.width);
  plan.apply(w);
  await google.batchUpdate(spreadsheetId, w.requests());
  // другий етап для планів, яким потрібні виміри, обчислені Google (autoResize): див. nbhz.js
  if (plan.afterWrite) await plan.afterWrite({ google, spreadsheetId, sheetId: meta.properties.sheetId, sheetName });
  return { sheetId: meta.properties.sheetId };
}

module.exports = { hexRgb, colIdx, colLetter, rowRuns, fmtReq, gridRange, writerFor, writeSheet };
