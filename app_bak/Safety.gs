// ============================================================
// САМОЗАХИСТ. Руками запускається один раз: s01_setupSafety().
// Далі все робиться тригерами.
// ============================================================
var SAFE_ALERT_TO  = 'denbassk@gmail.com';
var SAFE_PEAK_KEY  = 'safe_peak';        // {dir: "дд.мм.гггг|рядків"}
var SAFE_BACKUP_SS = 'safe_backup_ss';

function s01_setupSafety() {
  var bad = { archiveRawSheets:1, archiveRebuild:1, autoMaintenance:1,
              archiveOldOrders:1, generateReportsAsync:1, rebuildReportsTriggered:1,
              nightlyArchive:1, nightlyHealth:1, safeGuard:1, vegGuard:1 };
  var killed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (bad[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); killed++; }
  });

  ScriptApp.newTrigger('nightlyArchive').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  ScriptApp.newTrigger('nightlyHealth').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('safeGuard').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('vegGuard').timeBased().everyHours(1).create();

  console.log('Знято старих тригерів: ' + killed);
  console.log('Поставлено: nightlyArchive (Пн 03:00), nightlyHealth (04:00), ' +
              'safeGuard (щогодини), vegGuard (щогодини)');
  safeBackupAll_();
}

function isBusinessHours_() {
  var h = Number(Utilities.formatDate(new Date(), 'Europe/Kyiv', 'H'));
  return h >= 7 && h < 22;
}

// Архів тільки вночі і тільки після бекапу
function nightlyArchive() {
  if (isBusinessHours_()) { console.log('денний час - архів пропущено'); return; }
  try { safeBackupAll_(); } catch (e) { console.error('бекап: ' + e.message); return; }
  archiveRawSheets();
}

// Щоніч: формат сирих листів, повернення графіка, бекап, перевірка
function nightlyHealth() {
  try { if (typeof v07_fixVegRawFormat === 'function') v07_fixVegRawFormat(); }
  catch (e) { console.error('формат овочів: ' + e.message); }
  try { if (typeof d08_fixRawFormat === 'function') d08_fixRawFormat(); }
  catch (e) { console.error('формат решти: ' + e.message); }

  var props = PropertiesService.getScriptProperties();
  var until = props.getProperty(VEG_OVR_UNTIL);
  if (until && until !== formatDateDMY_(new Date())) {
    try { v02_restoreVegDays(); } catch (e) { console.error('графік: ' + e.message); }
  }
  safeBackupAll_();
  safeCheckDrop_();
}

// Щогодини: бекап + сигнал, якщо рядки зникли. Овочі веде vegGuard.
function safeGuard() {
  safeBackupAll_();
  safeCheckDrop_();
}

function todayRowsOf_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];
  var w = Math.max(sh.getLastColumn(), 1);
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
  var today = formatDateDMY_(new Date());
  return vals.filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
    return d === today;
  });
}

function safeBackupSheet_(name, width) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SAFE_BACKUP_SS), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) { ss = SpreadsheetApp.create('БЕКАП Замовлення (не чіпати)');
             props.setProperty(SAFE_BACKUP_SS, ss.getId()); }
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.setFrozenRows(1);
             sh.getRange(1, 1, 1, 1).setValue('Знято').setFontWeight('bold'); }
  return sh;
}

function safeBackupAll_() {
  var stamp = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy HH:mm');
  Object.keys(DIRECTIONS).forEach(function (k) {
    if (k === 'veg') return;                 // овочі бекапить vegGuard
    try {
      var rows = todayRowsOf_(k);
      if (!rows.length) return;
      var w = rows[0].length;
      var sh = safeBackupSheet_(k, w);
      var out = rows.map(function (r) { return [stamp].concat(r); });
      sh.getRange(sh.getLastRow() + 1, 1, out.length, w + 1).setValues(out);
    } catch (e) { console.error('бекап ' + k + ': ' + e.message); }
  });
  SpreadsheetApp.flush();
}

// Рядків за сьогодні поменшало - лист на пошту
function safeCheckDrop_() {
  var props = PropertiesService.getScriptProperties();
  var today = formatDateDMY_(new Date());
  var peaks = {};
  try { peaks = JSON.parse(props.getProperty(SAFE_PEAK_KEY) || '{}'); } catch (e) {}
  var alerts = [];
  Object.keys(DIRECTIONS).forEach(function (k) {
    var n;
    try { n = todayRowsOf_(k).length; } catch (e) { return; }
    var p = String(peaks[k] || '').split('|');
    var peak = (p[0] === today) ? Number(p[1] || 0) : 0;
    if (n < peak) alerts.push(dirCfg_(k).title + ': було ' + peak + ', стало ' + n);
    if (n > peak) peaks[k] = today + '|' + n;
  });
  props.setProperty(SAFE_PEAK_KEY, JSON.stringify(peaks));
  if (alerts.length) {
    var msg = today + '\n' + alerts.join('\n') + '\nБекап: ' + safeBackupUrl_();
    console.error(msg);
    try { MailApp.sendEmail(SAFE_ALERT_TO, 'ЗАМОВЛЕННЯ: зникли рядки', msg); } catch (e) {}
  }
}

function safeBackupUrl_() {
  var id = PropertiesService.getScriptProperties().getProperty(SAFE_BACKUP_SS);
  return id ? 'https://docs.google.com/spreadsheets/d/' + id : '(бекапу ще нема)';
}

// Ручна перевірка: що зараз стоїть на тригерах
function s02_showTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    console.log(t.getHandlerFunction() + '  |  ' + t.getEventType());
  });
  console.log('Бекап: ' + safeBackupUrl_());
}