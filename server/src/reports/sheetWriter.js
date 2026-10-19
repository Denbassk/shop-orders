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

function colIdx(L) { return String(L).toUpperCase().charCodeAt(0) - 65; }

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
  if (f.wrap) { cf.wrapStrategy = 'WRAP'; fields.push('wrapStrategy'); }
  if (f.num) {
    cf.numberFormat = f.num === '@' ? { type: 'TEXT', pattern: '@' } : { type: 'NUMBER', pattern: f.num };
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
    fmt(rows, c1, c2, f) {
      if (rows && !rows.length) return w;
      ranges(rows, c1, c2).forEach((rg) => { reqs.push(fmtReq(rg, f)); });
      return w;
    },
    border(rows, c1, c2) {
      if (rows && !rows.length) return w;
      const b = { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } };
      ranges(rows, c1, c2).forEach((rg) => {
        reqs.push({ updateBorders: { range: rg, top: b, bottom: b, left: b, right: b,
                                     innerHorizontal: b, innerVertical: b } });
      });
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
    const r = await google.batchUpdate(spreadsheetId, [{ addSheet: { properties: { title: sheetName } } }]);
    meta = { properties: { sheetId: r.replies[0].addSheet.properties.sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } };
  }
  const w = writerFor(meta, plan.data, plan.width);
  plan.apply(w);
  await google.batchUpdate(spreadsheetId, w.requests());
}

module.exports = { hexRgb, colIdx, rowRuns, fmtReq, gridRange, writerFor, writeSheet };
