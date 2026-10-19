// ============================================================
// ШВИДКЕ ЧИТАННЯ ЧЕРЕЗ SHEETS API + ЗАПОБІЖНИК НАПРЯМКУ
//
// 18.10.2026: SpreadsheetApp.openById на таблиці ВК висів хвилинами, а
// Sheets API по тій самій таблиці відповідав за 0,2-0,4 с. Через спільне
// читання статусу і спільний ScriptLock це поклало ВСІ напрямки, зокрема
// НБХЗ, хоча його таблиця була здорова.
//
// Тому шлях продавця (статус, товари, "вже замовляли", запис, видалення)
// читає і пише лише через Sheets API, а не через SpreadsheetApp.
//
// Запобіжник: перед читанням таблиці напрямку ставимо в кеш позначку
// "читаю з <час>", після - знімаємо. Якщо позначка висить довше за
// SICK_AFTER_MS, таблиця напрямку не відповідає: решта викликів не
// стають за нею в чергу, а одразу пропускають цей напрямок (статус)
// або відповідають продавцю зрозумілою помилкою. Позначка живе
// SICK_TTL_S - потім пробуємо знову, тож напрямок оживає сам.
// ============================================================
var SICK_AFTER_MS = 20000;
var SICK_TTL_S = 300;
// Читання тривало довше за SICK_AFTER_MS (навіть якщо зрештою відповіло) -
// напрямок "повільний" SLOW_TTL_S секунд: запити продавців і пульта його не
// чекають. Перевіряє, чи ожив, лише тригер (guardedDir_ з probe=true).
// 18.10.2026: перший читач зависшої ВК чекав 190 с, а щойно відповідь
// приходила, запобіжник знімався - і наступний читач знову висів.
var SLOW_TTL_S = 1800;

// Хтось зараз читає таблицю напрямку довше за SICK_AFTER_MS.
function dirStuck_(dirKey) {
  try {
    var t = Number(CacheService.getScriptCache().get('inflight_' + dirKey) || 0);
    return !!t && (Date.now() - t) > SICK_AFTER_MS;
  } catch (e) { return false; }
}

function dirSick_(dirKey) {
  if (dirStuck_(dirKey)) return true;
  try { return !!CacheService.getScriptCache().get('slow_' + dirKey); } catch (e) { return false; }
}

function assertDirHealthy_(dirKey) {
  if (dirSick_(dirKey))
    throw new Error('Таблиця напрямку "' + dirCfg_(dirKey).title + '" зараз не відповідає. ' +
                    'Спробуйте за 5 хвилин або зателефонуйте закупниці.');
}

// Виконати fn() як читання таблиці напрямку під запобіжником.
// probe=true - для тригерів: ігнорує позначку "повільний" і знімає її, якщо відповіло швидко.
function guardedDir_(dirKey, fn, probe) {
  if (probe) { if (dirStuck_(dirKey)) assertDirHealthy_(dirKey); }
  else assertDirHealthy_(dirKey);
  var c = null, mine = false, k = 'inflight_' + dirKey, t0 = Date.now(), ok = false;
  try {
    c = CacheService.getScriptCache();
    if (!c.get(k)) { c.put(k, String(Date.now()), SICK_TTL_S); mine = true; }
  } catch (e) {}
  try { var res = fn(); ok = true; return res; }
  finally {
    if (mine) { try { c.remove(k); } catch (e) {} }
    try {
      if (c) {
        if (Date.now() - t0 > SICK_AFTER_MS) {
          c.put('slow_' + dirKey, String(Date.now()), SLOW_TTL_S);
          console.error('Таблиця ' + dirKey + ' відповідала ' + (Date.now() - t0) + ' мс - позначено повільною');
        } else if (ok) c.remove('slow_' + dirKey);
      }
    } catch (e) {}
  }
}

function a1q_(sheetName, range) {
  return "'" + String(sheetName).replace(/'/g, "''") + "'!" + range;
}

// Значення діапазону. За замовчуванням - сирі (дати серійним числом),
// formatted=true - як бачить людина (аналог getDisplayValues).
function apiValues_(spreadsheetId, a1, formatted) {
  var res = Sheets.Spreadsheets.Values.get(spreadsheetId, a1, formatted
    ? { valueRenderOption: 'FORMATTED_VALUE' }
    : { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
  return (res && res.values) || [];
}

// Серійна дата Google -> ДД.ММ.РРРР. +12 год, щоб часовий пояс не зсунув день.
function serialToDMY_(v) {
  return formatDateDMY_(new Date(Math.round((Math.floor(v) - 25569) * 86400000) + 43200000));
}

function dmyApi_(v) {
  if (typeof v === 'number') return serialToDMY_(v);
  return dmyOfCell_(v);
}

function cellStr_(v) {
  return String(v == null ? '' : v).trim();
}

// Хвіст сирого листа: { from: номер першого рядка, rows: [...] }.
// Читаємо з A1, тож номер рядка = індекс + 1.
function rawTailApi_(cfg, lastCol) {
  var all = apiValues_(cfg.spreadsheetId, a1q_(rawSheetName_(cfg), 'A:' + (lastCol || 'C')));
  if (all.length < 2) return { from: 2, rows: [] };
  var take = Math.min(all.length - 1, RAW_TAIL_ROWS);
  return { from: all.length - take + 1, rows: all.slice(all.length - take) };
}

// sheetId листа за назвою, кеш на 6 год (потрібен для batchUpdate).
function sheetIdOf_(spreadsheetId, sheetName) {
  var k = 'sid_' + spreadsheetId + '_' + sheetName;
  var c = null;
  try { c = CacheService.getScriptCache(); var v = c.get(k); if (v) return Number(v); } catch (e) {}
  var meta = Sheets.Spreadsheets.get(spreadsheetId, { fields: 'sheets.properties(sheetId,title)' });
  var hit = (meta.sheets || []).filter(function (s) { return s.properties.title === sheetName; })[0];
  if (!hit) throw new Error('Не знайдено лист "' + sheetName + '"');
  var id = hit.properties.sheetId;
  try { if (c) c.put(k, String(id), 21600); } catch (e) {}
  return id;
}

// Час із сирого листа: серійна частка доби -> "HH:mm", рядок -> перші 5 символів.
function timeApi_(v) {
  if (typeof v === 'number') {
    var m = Math.round((v - Math.floor(v)) * 1440) % 1440;
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  }
  return cellStr_(v).slice(0, 5);
}

// Число з клітинки (у тому числі "1,5").
function numApi_(v) {
  if (typeof v === 'number') return v;
  return Number(cellStr_(v).replace(',', '.')) || 0;
}

// Властивості листа (sheetId, кількість рядків/колонок, умовні формати) або null.
function sheetMetaApi_(spreadsheetId, sheetName) {
  var meta = Sheets.Spreadsheets.get(spreadsheetId,
    { fields: 'sheets(properties(sheetId,title,gridProperties),conditionalFormats)' });
  var hit = (meta.sheets || []).filter(function (s) { return s.properties.title === sheetName; })[0];
  return hit || null;
}

// ============================================================
// ЗАПИС ЗВІТНОГО ЛИСТА ОДНИМ batchUpdate (замість SpreadsheetApp)
//
//   var w = apiSheetWriter_(ssId, 'Заказы ВК', data, 4);   // очищує лист, пише значення
//   w.fmt(rowsList | null, 'A', 'D', { bg:'#1565C0', color:'#FFF', bold:true, size:14 });
//   w.border(rowsList, 'A', 'D'); w.rowHeights(24); w.colWidths([50,420]); w.frozen(4);
//   w.commit();
// rowsList - номери рядків (1-based), сусідні склеюються; null - усі рядки даних.
// ============================================================
function hexRgb_(h) {
  h = String(h).replace('#', '');
  if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
  return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255,
           blue: parseInt(h.slice(4, 6), 16) / 255 };
}

function colIdx_(L) { return String(L).toUpperCase().charCodeAt(0) - 65; }

function rowRuns_(rows) {
  var s = rows.slice().sort(function (a, b) { return a - b; }), out = [];
  for (var i = 0; i < s.length; i++) {
    if (out.length && s[i] === out[out.length - 1][1] + 1) out[out.length - 1][1] = s[i];
    else if (!out.length || s[i] > out[out.length - 1][1]) out.push([s[i], s[i]]);
  }
  return out;
}

// repeatCell лише з тими полями формату, що задані в f - решта формату клітинки не чіпається.
function apiFmtReq_(rg, f) {
  var cf = {}, tf = {}, fields = [];
  if (f.bg) { cf.backgroundColor = hexRgb_(f.bg); fields.push('backgroundColor'); }
  if (f.halign) { cf.horizontalAlignment = f.halign.toUpperCase(); fields.push('horizontalAlignment'); }
  if (f.valign) { cf.verticalAlignment = f.valign.toUpperCase(); fields.push('verticalAlignment'); }
  if (f.wrap) { cf.wrapStrategy = 'WRAP'; fields.push('wrapStrategy'); }
  if (f.num) {
    cf.numberFormat = f.num === '@' ? { type: 'TEXT', pattern: '@' } : { type: 'NUMBER', pattern: f.num };
    fields.push('numberFormat');
  }
  if (f.color) { tf.foregroundColor = hexRgb_(f.color); fields.push('textFormat.foregroundColor'); }
  if (f.bold != null) { tf.bold = !!f.bold; fields.push('textFormat.bold'); }
  if (f.size) { tf.fontSize = f.size; fields.push('textFormat.fontSize'); }
  if (f.font) { tf.fontFamily = f.font; fields.push('textFormat.fontFamily'); }
  if (Object.keys(tf).length) cf.textFormat = tf;
  return { repeatCell: { range: rg, cell: { userEnteredFormat: cf },
    fields: fields.map(function (x) { return 'userEnteredFormat.' + x; }).join(',') } };
}

// Діапазон для batchUpdate: рядки/колонки 1-based включно
function gridRange_(sid, r1, c1, r2, c2) {
  return { sheetId: sid, startRowIndex: r1 - 1, endRowIndex: r2,
           startColumnIndex: c1 - 1, endColumnIndex: c2 };
}

function apiSheetWriter_(spreadsheetId, sheetName, data, width) {
  var meta = sheetMetaApi_(spreadsheetId, sheetName);
  var sid;
  if (!meta) {
    var r = Sheets.Spreadsheets.batchUpdate({ requests: [{ addSheet: { properties: { title: sheetName } } }] },
                                            spreadsheetId);
    sid = r.replies[0].addSheet.properties.sheetId;
    meta = { properties: { sheetId: sid, gridProperties: { rowCount: 1000, columnCount: 26 } } };
  }
  sid = meta.properties.sheetId;
  var gp = meta.properties.gridProperties || {};
  var n = data.length, reqs = [];

  // як sh.clear() + clearConditionalFormatRules() + breakApart()
  (meta.conditionalFormats || []).forEach(function () {
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
    rows: data.map(function (row) {
      var vals = [];
      for (var c = 0; c < width; c++) {
        var v = row[c];
        if (v === '' || v == null) vals.push({});
        else if (typeof v === 'number') vals.push({ userEnteredValue: { numberValue: v } });
        else if (typeof v === 'boolean') vals.push({ userEnteredValue: { boolValue: v } });
        else vals.push({ userEnteredValue: { stringValue: String(v) } });
      }
      return { values: vals };
    })
  } });

  function ranges(rows, c1, c2) {
    var runs = rows ? rowRuns_(rows) : [[1, n]];
    return runs.map(function (r) {
      return { sheetId: sid, startRowIndex: r[0] - 1, endRowIndex: r[1],
               startColumnIndex: colIdx_(c1), endColumnIndex: colIdx_(c2 || c1) + 1 };
    });
  }

  var w = {
    sheetId: sid,
    fmt: function (rows, c1, c2, f) {
      if (rows && !rows.length) return w;
      ranges(rows, c1, c2).forEach(function (rg) { reqs.push(apiFmtReq_(rg, f)); });
      return w;
    },
    border: function (rows, c1, c2) {
      if (rows && !rows.length) return w;
      var b = { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } };
      ranges(rows, c1, c2).forEach(function (rg) {
        reqs.push({ updateBorders: { range: rg, top: b, bottom: b, left: b, right: b,
                                     innerHorizontal: b, innerVertical: b } });
      });
      return w;
    },
    rowHeights: function (px) {
      if (n) reqs.push({ updateDimensionProperties: {
        range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: n },
        properties: { pixelSize: px }, fields: 'pixelSize' } });
      return w;
    },
    colWidths: function (list) {
      list.forEach(function (px, i) {
        reqs.push({ updateDimensionProperties: {
          range: { sheetId: sid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: px }, fields: 'pixelSize' } });
      });
      return w;
    },
    frozen: function (k) {
      reqs.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: k } },
                                           fields: 'gridProperties.frozenRowCount' } });
      return w;
    },
    raw: function (req) { reqs.push(req); return w; },
    commit: function () {
      Sheets.Spreadsheets.batchUpdate({ requests: reqs }, spreadsheetId);
    }
  };
  return w;
}

// Зняти позначки "висить/повільна" з усіх напрямків (запуск з редактора).
// Потрібно після переключення напрямку на іншу таблицю: позначки старої
// таблиці інакше живуть до 30 хв.
function z_resetSick() {
  var c = CacheService.getScriptCache();
  Object.keys(DIRECTIONS).forEach(function (k) { c.remove('inflight_' + k); c.remove('slow_' + k); });
  console.log('Позначки знято: ' + Object.keys(DIRECTIONS).join(', '));
}

// Перевірка таблиці ВК з редактора: позначки, асортимент, сирий лист - з точним текстом помилки
function z_checkVk() {
  var cfg = dirCfg_('bakery');
  console.log('таблиця ' + cfg.spreadsheetId + ' | висить: ' + dirStuck_('bakery') + ' | повільна: ' + dirSick_('bakery'));
  [[cfg.productsSheet, 'A2:F'], [rawSheetName_(cfg), 'A1:C3']].forEach(function (x) {
    var t = Date.now();
    try { var v = apiValues_(cfg.spreadsheetId, a1q_(x[0], x[1]));
          console.log('OK "' + x[0] + '" рядків ' + v.length + ' за ' + (Date.now() - t) + ' мс'); }
    catch (e) { console.error('ПОМИЛКА "' + x[0] + '" за ' + (Date.now() - t) + ' мс: ' + e.message); }
  });
  try { CacheService.getScriptCache().remove('prod2_bakery'); var p = loadProducts_('bakery');
        console.log('асортимент для продавця: ' + p.length + ' позицій'); }
  catch (e) { console.error('асортимент: ' + e.message); }
}

// 19.10.2026: ВК повернули з копії 1a94… на оригінал. Сьогоднішні рядки, що встигли
// лягти в копію, переносимо в оригінал. Дублі не пишемо: ключ = дата+час+адреса+назва+кількість.
var VK_COPY_ID = '1a94srF34gowBQ71U1sLDgiDnJgvTEvW32l2gLtJk3FY';
function vkCopyMissing_() {
  var cfg = dirCfg_('bakery'), sheet = rawSheetName_(cfg), today = formatDateDMY_(new Date());
  var key = function (r) {
    return [dmyApi_(r[0]), timeApi_(r[1]), cellStr_(r[2]).toLowerCase(), cellStr_(r[5]).toLowerCase(), numApi_(r[7])].join('|');
  };
  var t = Date.now();
  var copy = apiValues_(VK_COPY_ID, a1q_(sheet, 'A2:H')).filter(function (r) { return dmyApi_(r[0]) === today; });
  console.log('копія: сьогоднішніх рядків ' + copy.length + ' (читання ' + (Date.now() - t) + ' мс)');
  var have = {};
  rawTailApi_(cfg, 'H').rows.forEach(function (r) { if (dmyApi_(r[0]) === today) { var k = key(r); have[k] = (have[k] || 0) + 1; } });
  var miss = [];
  copy.forEach(function (r) { var k = key(r); if (have[k]) have[k]--; else miss.push(r); });
  var stores = {};
  miss.forEach(function (r) { stores[cellStr_(r[2])] = (stores[cellStr_(r[2])] || 0) + 1; });
  console.log('немає в оригіналі: ' + miss.length + ' рядків; точки: ' + JSON.stringify(stores));
  return miss;
}
function z_vkCopyDry() { vkCopyMissing_(); }
function z_vkCopyApply() {
  var cfg = dirCfg_('bakery'), miss = vkCopyMissing_();
  if (!miss.length) return;
  var rows = miss.map(function (r) {
    var o = r.slice(0, 8); while (o.length < 8) o.push('');
    o[0] = dmyApi_(o[0]); o[1] = timeApi_(o[1]) + ':00';
    if (o[4] !== '' && o[4] != null) o[4] = "'" + String(o[4]);
    return o;
  });
  Sheets.Spreadsheets.Values.append({ values: rows }, cfg.spreadsheetId, a1q_(rawSheetName_(cfg), 'A1'),
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
  try { CacheService.getScriptCache().remove('status_v4'); } catch (e) {}
  console.log('дописано в оригінал: ' + rows.length + ' рядків');
}
