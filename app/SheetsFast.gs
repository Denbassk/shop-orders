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

function dirSick_(dirKey) {
  try {
    var t = Number(CacheService.getScriptCache().get('inflight_' + dirKey) || 0);
    return !!t && (Date.now() - t) > SICK_AFTER_MS;
  } catch (e) { return false; }
}

function assertDirHealthy_(dirKey) {
  if (dirSick_(dirKey))
    throw new Error('Таблиця напрямку "' + dirCfg_(dirKey).title + '" зараз не відповідає. ' +
                    'Спробуйте за 5 хвилин або зателефонуйте закупниці.');
}

// Виконати fn() як читання таблиці напрямку під запобіжником.
function guardedDir_(dirKey, fn) {
  assertDirHealthy_(dirKey);
  var c = null, mine = false, k = 'inflight_' + dirKey;
  try {
    c = CacheService.getScriptCache();
    if (!c.get(k)) { c.put(k, String(Date.now()), SICK_TTL_S); mine = true; }
  } catch (e) {}
  try { return fn(); }
  finally { if (mine) { try { c.remove(k); } catch (e) {} } }
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
