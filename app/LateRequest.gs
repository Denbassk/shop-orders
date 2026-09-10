// ============================================================
// ЗАПИТ ДОЗВОЛУ НА ЗАМОВЛЕННЯ ПІСЛЯ ДЕДЛАЙНУ
//
// Продавець тисне "Попросити дозвіл" -> рядок у листі "Дозволи".
// Закупниця ставить галочку в колонці F (з телефона, у застосунку
// Google Таблиці) -> кнопка "Відправити" у продавця вмикається сама,
// сторінку оновлювати не треба. Назавтра дозвіл гасне сам.
//
// ДЕ ЛЕЖИТЬ ЛИСТ - керує LATE_TARGET:
//   'direction' - у таблиці свого напрямку (хліб / НБХЗ / ВК / овочі).
//                 Кожна закупниця бачить лише своє, нових таблиць не треба.
//   'central'   - один лист у зведеній таблиці LATE_ID (усі напрямки поруч).
//
// Довідник ТТ не використовується в жодному з варіантів.
// Перехід зі старої схеми: migrateLateFromRegistry(), потім
// перевірити і запустити dropLateSheetFromRegistry().
// ============================================================

var LATE_TARGET = 'direction';   // 'direction' | 'central'
var LATE_ID = '';                // ID зведеної таблиці - лише для 'central'
var LATE_SHEET = 'Дозволи';

var LATE_HEAD = ['Дата', 'Напрямок', 'Торгова точка', 'ID точки',
                 'Час запиту', 'ДОЗВОЛЕНО', 'Коментар'];

function lateSS_(dirKey) {
  if (LATE_TARGET === 'central') {
    if (!LATE_ID)
      throw new Error('Порожній LATE_ID. Вкажіть ID зведеної таблиці "Дозволи" у LateRequest.gs ' +
                      'або поверніть LATE_TARGET = \'direction\'');
    return SpreadsheetApp.openById(LATE_ID);
  }
  return SpreadsheetApp.openById(dirCfg_(dirKey).spreadsheetId);
}

function lateSheet_(dirKey) {
  var ss = lateSS_(dirKey);
  var sh = ss.getSheetByName(LATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LATE_SHEET);
    sh.getRange(1, 1, 1, LATE_HEAD.length).setValues([LATE_HEAD])
      .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 240);
    sh.setColumnWidth(4, 240); sh.setColumnWidth(7, 240);
  }
  return sh;
}

// 'none' | 'pending' | 'approved'
function lateRequestStatus_(dirKey, storeId) {
  if (!dirKey || !storeId) return 'none';
  try {
    var sh = lateSheet_(dirKey);
    if (sh.getLastRow() < 2) return 'none';
    var today = formatDateDMY_(new Date());
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    var st = 'none';
    for (var i = 0; i < rows.length; i++) {
      var d = (rows[i][0] instanceof Date) ? formatDateDMY_(rows[i][0]) : String(rows[i][0]).trim();
      if (d !== today) continue;
      if (String(rows[i][1]).trim() !== dirKey) continue;
      if (String(rows[i][3]).trim() !== String(storeId)) continue;
      if (rows[i][5] === true) return 'approved';
      st = 'pending';
    }
    return st;
  } catch (e) {
    console.error('lateRequestStatus_: ' + e.message);
    return 'none';
  }
}

function apiRequestLate_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  var st = lateRequestStatus_(dirKey, store.id);
  if (st !== 'none') return { status: st };

  var sh = lateSheet_(dirKey);
  var now = new Date();
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 7).setValues([[
    now, dirKey, store.label, store.id, formatTime_(now), false,
    String(payload.note || '').slice(0, 200)
  ]]);
  sh.getRange(row, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(row, 6).insertCheckboxes();
  SpreadsheetApp.flush();

  console.log('Запит дозволу: ' + cfg.title + ' / ' + store.label);
  return { status: 'pending' };
}

// --- Прибрати рядки старші за 30 днів (вішається на щотижневий тригер) ---
function cleanupLateRequests() {
  lateTargets_().forEach(function (dirKey) {
    var sh;
    try { sh = lateSheet_(dirKey); } catch (e) { return; }
    if (sh.getLastRow() < 2) return;
    var keepFrom = new Date(); keepFrom.setDate(keepFrom.getDate() - 30);
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    var killed = 0;
    for (var i = rows.length - 1; i >= 0; i--) {
      var d = rows[i][0];
      if (d instanceof Date && d < keepFrom) { sh.deleteRow(i + 2); killed++; }
    }
    if (killed) console.log(dirCfg_(dirKey).title + ': прибрано ' + killed + ' старих рядків');
  });
  console.log('Готово');
}

// Список напрямків, для яких треба чіпати листи (у 'central' - один раз)
function lateTargets_() {
  var keys = Object.keys(DIRECTIONS).filter(function (k) { return DIRECTIONS[k].lateRequest; });
  if (LATE_TARGET === 'central') return keys.slice(0, 1);
  return keys;
}

// --- Посилання на листи "Дозволи" - надіслати закупницям ---
function lateSheetLinks() {
  lateTargets_().forEach(function (dirKey) {
    var sh = lateSheet_(dirKey);
    console.log(dirCfg_(dirKey).title + ': ' + sh.getParent().getUrl() +
                '#gid=' + sh.getSheetId());
  });
}

// --- Перенести старий лист "Дозволи" з Довідника ТТ ---
function migrateLateFromRegistry() {
  var reg = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(LATE_SHEET);
  if (!reg) { console.log('У Довіднику листа "Дозволи" немає - переносити нічого'); return; }
  if (reg.getLastRow() < 2) { console.log('Лист "Дозволи" у Довіднику порожній'); return; }

  var rows = reg.getRange(2, 1, reg.getLastRow() - 1, 7).getValues()
    .filter(function (r) { return String(r[1] || '').trim(); });

  var byDir = {};
  rows.forEach(function (r) {
    var k = String(r[1]).trim();
    if (!DIRECTIONS[k]) { console.log('Незнайомий напрямок у рядку: ' + k); return; }
    (byDir[k] = byDir[k] || []).push(r);
  });

  Object.keys(byDir).forEach(function (dirKey) {
    var sh = lateSheet_(dirKey);
    var start = sh.getLastRow() + 1;
    var data = byDir[dirKey];
    sh.getRange(start, 1, data.length, 7).setValues(data);
    sh.getRange(start, 1, data.length, 1).setNumberFormat('dd.MM.yyyy');
    sh.getRange(start, 6, data.length, 1).insertCheckboxes();
    sh.getRange(start, 6, data.length, 1).setValues(data.map(function (r) { return [r[5] === true]; }));
    console.log(dirCfg_(dirKey).title + ': перенесено ' + data.length + ' рядків');
  });

  SpreadsheetApp.flush();
  console.log('Перевірте нові листи. Далі: dropLateSheetFromRegistry()');
}

// --- Видалити лист "Дозволи" з Довідника ТТ (запускати після перевірки) ---
function dropLateSheetFromRegistry() {
  var ss = SpreadsheetApp.openById(REGISTRY_ID);
  var sh = ss.getSheetByName(LATE_SHEET);
  if (!sh) { console.log('Листа "Дозволи" у Довіднику вже немає'); return; }
  ss.deleteSheet(sh);
  console.log('Лист "Дозволи" видалено з Довідника ТТ');
}
