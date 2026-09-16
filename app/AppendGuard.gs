// ============================================================
// СТРАХОВКА НАВКОЛО ЗАПИСУ ЗАМОВЛЕННЯ
// Закриває дві причини втрати рядків:
//   1) append під час архівування (якір getLastRow вже недійсний);
//   2) успадкований формат - дата стає числом, і рядок зникає зі звітів.
// ============================================================

function isAppendLost_(e) {
  return String((e && e.message) || e).indexOf('APPEND_LOST') >= 0;
}

// Архівування тримає busy_<dir>. Чекаємо, поки відпустить.
// Це читання ОДНІЄЇ властивості (~20 мс) - appendʼи одне одного не блокують.
function waitWhileArchiving_(dirKey, waitMs) {
  if (!dirKey) return true;
  var props = PropertiesService.getScriptProperties();
  var key = 'busy_' + dirKey;
  var deadline = Date.now() + (waitMs || 45000);
  while (Date.now() < deadline) {
    var cur = null;
    try { cur = JSON.parse(props.getProperty(key) || 'null'); } catch (e) { return true; }
    if (!cur) return true;
    if ((Date.now() - cur.ts) > DIR_LOCK_TTL_MS) return true;   // замок протух
    Utilities.sleep(400);
  }
  console.error('append ' + dirKey + ': архів не відпустив замок, пишемо все одно');
  return false;
}

// Шукаємо у хвості листа ОСТАННІЙ рядок із нашою датою та адресою.
// Якщо append поклав рядки не туди (розрив у листі) - тут це видно.
function findAppendedRow_(sh, first) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var take = Math.min(last - 1, 300);
  var from = last - take + 1;
  var w = Math.max(sh.getLastColumn(), 3);
  var got = sh.getRange(from, 1, take, w).getValues();
  var d0 = String(first[0]).trim();
  var a0 = String(first[2] == null ? '' : first[2]).trim();
  for (var i = got.length - 1; i >= 0; i--) {
    var d = (got[i][0] instanceof Date) ? formatDateDMY_(got[i][0]) : String(got[i][0]).trim();
    if (d !== d0) continue;
    if (String(got[i][2] == null ? '' : got[i][2]).trim() !== a0) continue;
    return from + i;
  }
  return 0;
}

function fixAppendedFormat_(sh, startRow, count, firstRow, bcCol) {
  try {
    sh.getRange(startRow, 1, count, 1).setNumberFormat('dd.MM.yyyy');
    if (/^\d{1,2}:\d{2}/.test(String(firstRow[1] || '')))
      sh.getRange(startRow, 2, count, 1).setNumberFormat('HH:mm:ss');
    if (bcCol) sh.getRange(startRow, bcCol, count, 1).setNumberFormat('@');
    SpreadsheetApp.flush();
  } catch (e) { console.error('формат після append: ' + e.message); }
}

function apiAppend_(spreadsheetId, sheetName, rows, dirKey, bcCol) {
  waitWhileArchiving_(dirKey, 45000);

  var sh = null, anchor = 1;
  try {
    sh = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (sh) anchor = Math.max(sh.getLastRow(), 1);
  } catch (e) {}

  Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A" + anchor,
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );

  if (!sh) return;
  SpreadsheetApp.flush();

  var at = findAppendedRow_(sh, rows[0]);
  if (!at) throw new Error('APPEND_LOST: рядки не знайдено в листі після append');

  var start = Math.max(at - rows.length + 1, 2);
  fixAppendedFormat_(sh, start, rows.length, rows[0], bcCol || 0);
}

// Ручна перевірка: чи стоїть страховка і чи не висить замок
function s03_showAppendGuard() {
  console.log('apiAppend_ параметрів: ' + apiAppend_.length + ' (має бути 5)');
  console.log('старий шлях на місці: ' + (typeof apiAppend_OLD_ === 'function'));
  var props = PropertiesService.getScriptProperties();
  Object.keys(DIRECTIONS).forEach(function (k) {
    var v = props.getProperty('busy_' + k);
    if (v) console.log('ЗАМОК ВИСИТЬ: ' + k + ' -> ' + v);
  });
  console.log('замків більше немає - все вільно');
}