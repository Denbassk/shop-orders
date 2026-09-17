// ============================================================
// РАЗОВЕ ВІДКРИТТЯ ОВОЧІВ НЕ ПО ГРАФІКУ + ЗАХИСТ ВІД ЗАТИРАННЯ
// v00_setupAll() - єдине, що треба натиснути руками.
// ============================================================

var VEG_Q_COL     = 17;                  // колонка Q Довідника, "Дні овочів"
var VEG_OVR_KEY   = 'veg_days_backup';   // {row: "старе значення Q"}
var VEG_OVR_UNTIL = 'veg_days_until';    // дд.мм.гггг, доки діє відкриття
var VEG_BACKUP_SS = 'veg_backup_ss';     // id окремої таблиці-бекапу
var VEG_PEAK      = 'veg_peak';          // дд.мм.гггг|скільки рядків було
var VEG_ALERT_TO  = 'denbassk@gmail.com';

// --- ОДНА КНОПКА ---
function v00_setupAll() {
  v01_openVegTomorrow();
  v04_installVegGuard();
  v05_vegBackupNow();
  console.log('=== ГОТОВО ===');
}

// Додати "Ср" усім точкам, у яких у графіку стоїть "Вт"
function v01_openVegTomorrow() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(VEG_OVR_KEY)) {
    console.log('Відкриття вже діє. Спершу v02_restoreVegDays().');
    return;
  }

  var t = new Date(); t.setDate(t.getDate() + 1);
  var until = formatDateDMY_(t);
  var wd = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'][t.getDay()];

  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 19).getValues();

  var backup = {}, n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] !== true) continue;          // A - не активна
    if (vals[i][8] !== true) continue;          // I - без овочів
    var q = String(vals[i][16] || '').trim();
    if (!q) continue;                           // порожньо = і так без обмежень
    if (q.indexOf('Вт') < 0) continue;          // не вторникова точка
    if (q.indexOf(wd) >= 0) continue;           // вже може цього дня

    var row = i + 2;
    backup[row] = q;
    sh.getRange(row, VEG_Q_COL).setValue(q + ', ' + wd);
    console.log('   ' + (vals[i][1] || vals[i][2]) + ': "' + q + '" -> "' + q + ', ' + wd + '"');
    n++;
  }

  if (!n) { console.log('Нікого не змінено - перевірте колонку Q.'); return; }

  props.setProperty(VEG_OVR_KEY, JSON.stringify(backup));
  props.setProperty(VEG_OVR_UNTIL, until);
  SpreadsheetApp.flush();
  invalidateAppCache();
  console.log('Відкрито точок: ' + n + ', на ' + until + ' (' + wd + ')');
  console.log('Графік повернеться сам наступного дня.');
}

// Повернути графік як було
function v02_restoreVegDays() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(VEG_OVR_KEY);
  if (!raw) { console.log('Нічого повертати.'); return; }

  var backup = JSON.parse(raw);
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  Object.keys(backup).forEach(function (row) {
    sh.getRange(Number(row), VEG_Q_COL).setValue(backup[row]);
  });
  props.deleteProperty(VEG_OVR_KEY);
  props.deleteProperty(VEG_OVR_UNTIL);
  SpreadsheetApp.flush();
  invalidateAppCache();
  console.log('Графік овочів повернуто: рядків ' + Object.keys(backup).length);
}

// Хто саме зможе замовляти
function v03_showVegToday() {
  var n = 0;
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf('veg') < 0) return;
    if (!dayAllowed_('veg', s)) return;
    console.log('   ' + s.label);
    n++;
  });
  console.log('Сьогодні можуть замовляти овочі: ' + n);
  var u = PropertiesService.getScriptProperties().getProperty(VEG_OVR_UNTIL);
  if (u) console.log('Разове відкриття діє на ' + u);
}

function v04_installVegGuard() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'vegGuard') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('vegGuard').timeBased().everyHours(1).create();
  console.log('Тригер vegGuard: щогодини');
}

// --- Сторож: бекап + сигнал, якщо рядки зникли + авто-повернення графіка ---
function vegGuard() {
  var props = PropertiesService.getScriptProperties();
  var today = formatDateDMY_(new Date());

  var until = props.getProperty(VEG_OVR_UNTIL);
  if (until && until !== today) {
    try { v02_restoreVegDays(); } catch (e) { console.error('restore: ' + e.message); }
  }

  var rows;
  try { rows = vegTodayRows_(); } catch (e) { console.error('rows: ' + e.message); return; }

  var p = String(props.getProperty(VEG_PEAK) || '').split('|');
  var peak = (p[0] === today) ? Number(p[1] || 0) : 0;

  if (rows.length < peak) {
    var msg = 'ОВОЧІ ' + today + ': було ' + peak + ' рядків, стало ' + rows.length +
              '. Бекап: ' + vegBackupUrl_();
    console.error(msg);
    try { MailApp.sendEmail(VEG_ALERT_TO, 'ОВОЧІ: зникли рядки', msg); } catch (e) {}
  }
  if (rows.length > peak) props.setProperty(VEG_PEAK, today + '|' + rows.length);

  try { vegBackupWrite_(rows, today); } catch (e) { console.error('backup: ' + e.message); }
}

function v05_vegBackupNow() {
  var rows = vegTodayRows_();
  vegBackupWrite_(rows, formatDateDMY_(new Date()));
  console.log('Бекап: ' + rows.length + ' рядків -> ' + vegBackupUrl_());
}

// Окрема таблиця, тільки дозапис. Ніхто інший у неї не пише.
function vegBackupSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(VEG_BACKUP_SS);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('БЕКАП Овочі (не чіпати)');
    props.setProperty(VEG_BACKUP_SS, ss.getId());
  }
  var sh = ss.getSheetByName('log');
  if (!sh) {
    sh = ss.insertSheet('log');
    sh.getRange(1, 1, 1, 9).setValues([['Знято','Дата','Час','Адреса','Товар','Ціна','Кг','Сума','Рядків у знімку']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function vegBackupUrl_() {
  var id = PropertiesService.getScriptProperties().getProperty(VEG_BACKUP_SS);
  return id ? 'https://docs.google.com/spreadsheets/d/' + id : '(бекап ще не створено)';
}

function vegBackupWrite_(rows, today) {
  if (!rows || !rows.length) return;
  var sh = vegBackupSheet_();
  var stamp = today + ' ' + Utilities.formatDate(new Date(), 'Europe/Kyiv', 'HH:mm');
  var out = rows.map(function (r) {
    return [stamp, r[0], r[1], r[2], r[3], r[4], r[5], r[6], rows.length];
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, 9).setValues(out);
  SpreadsheetApp.flush();
}
// ============================================================
// ФОРМАТ СИРОГО ЛИСТА ОВОЧІВ
// Рядок 2 успадкував зелену шапку разом із ЧИСЛОВИМ форматом,
// далі INSERT_ROWS розтягнув це на всі нові рядки. Через це
// getValues() віддавав число, а не Date - і застосунок
// перестав бачити ці замовлення взагалі.
// ============================================================
function v07_fixVegRawFormat() {
  var cfg = dirCfg_('veg');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('Порожньо'); return; }

  var last = sh.getLastRow();
  var n = last - 1;
  var data = sh.getRange(2, 1, n, 7);

  // прибираємо успадковану шапку
  data.setBackground(null).setFontColor('#000000')
      .setFontWeight('normal').setFontSize(9)
      .setHorizontalAlignment('left');

  // повертаємо правильні формати
  sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy').setHorizontalAlignment('center');
  sh.getRange(2, 2, n, 1).setNumberFormat('HH:mm:ss').setHorizontalAlignment('center');
  sh.getRange(2, 5, n, 1).setNumberFormat('0.00').setHorizontalAlignment('center');
  sh.getRange(2, 6, n, 1).setNumberFormat('0.###').setHorizontalAlignment('center');
  sh.getRange(2, 7, n, 1).setNumberFormat('0.00').setHorizontalAlignment('center');

  // шапка лишається зеленою
  sh.getRange(1, 1, 1, 7).setFontWeight('bold')
    .setBackground('#2E7D32').setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();

  // тепер перевіряємо, скільки рядків застосунок БАЧИТЬ за сьогодні
  var today = formatDateDMY_(new Date());
  var vals = sh.getRange(2, 1, n, 3).getValues();
  var seen = 0, addrs = {};
  vals.forEach(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
    if (d !== today) return;
    seen++;
    addrs[String(r[2]).trim()] = 1;
  });

  console.log('Формат виправлено: рядків ' + n);
  console.log('За сьогодні (' + today + ') застосунок бачить: ' + seen +
              ' рядків, точок ' + Object.keys(addrs).length);
  Object.keys(addrs).forEach(function (a) { console.log('   ' + a); });

  // змушуємо звіти перезібратись і кладемо знімок у бекап
  PropertiesService.getScriptProperties().deleteProperty('veg_report_sig');
  invalidateAppCache();
  try { buildVegReports(); } catch (e) { console.error('звіт: ' + e.message); }
  try { v05_vegBackupNow(); } catch (e) { console.error('бекап: ' + e.message); }
}

// Що саме лежить у листі: типи значень по датах
function v08_checkVegTypes() {
  var cfg = dirCfg_('veg');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  var last = sh.getLastRow();
  var take = Math.min(last - 1, 15);
  sh.getRange(last - take + 1, 1, take, 4).getValues().forEach(function (r, i) {
    var kind = (r[0] instanceof Date) ? 'Date' : (typeof r[0]);
    console.log('рядок ' + (last - take + 1 + i) + ' | ' + r[0] +
                ' (' + kind + ') | ' + r[2] + ' | ' + r[3]);
  });
}

// Відкрити овочі СЬОГОДНІ вівторковим точкам (замовлення сьогодні,
// доставка наступного дня). Графік повернеться сам уночі.
function v11_openVegToday() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(VEG_OVR_KEY)) {
    console.log('Відкриття вже діє. Спершу v02_restoreVegDays().');
    return;
  }

  var t = new Date();
  var until = formatDateDMY_(t);
  var wd = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'][t.getDay()];

  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 19).getValues();

  var backup = {}, n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] !== true) continue;          // A - не активна
    if (vals[i][8] !== true) continue;          // I - без овочів
    var q = String(vals[i][16] || '').trim();
    if (!q) continue;                           // порожньо = і так без обмежень
    if (q.indexOf('Вт') < 0) continue;          // не вівторкова точка
    if (q.indexOf(wd) >= 0) continue;           // вже може цього дня

    var row = i + 2;
    backup[row] = q;
    sh.getRange(row, VEG_Q_COL).setValue(q + ', ' + wd);
    console.log('   ' + (vals[i][1] || vals[i][2]) + ': "' + q + '" -> "' + q + ', ' + wd + '"');
    n++;
  }

  if (!n) { console.log('Нікого не змінено - перевірте колонку Q.'); return; }

  props.setProperty(VEG_OVR_KEY, JSON.stringify(backup));
  props.setProperty(VEG_OVR_UNTIL, until);
  SpreadsheetApp.flush();
  invalidateAppCache();
  console.log('Відкрито точок: ' + n + ' на СЬОГОДНІ ' + until + ' (' + wd + ')');
  console.log('Графік повернеться сам уночі.');
}