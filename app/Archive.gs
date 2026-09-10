// ============================================================
// АРХІВУВАННЯ СИРИХ ЗАМОВЛЕНЬ
//
// У робочому листі лишається лише останній тиждень. Усе старше
// переїжджає в лист "_Архів" тієї самої таблиці - нікуди не
// зникає, але застосунок його більше не читає.
//
// Навіщо: кожна відправка рахує getLastRow() і дописує рядки,
// а перевірка "чи вже замовляли сьогодні" читає хвіст листа.
// 18 тисяч рядків - це зайві сотні мілісекунд на кожну операцію,
// і далі тільки гірше.
//
// Тригер: раз на тиждень, ніч з неділі на понеділок -> archiveRawSheets
// ============================================================

var KEEP_DAYS = 7;             // скільки днів лишати в робочому листі
var ARCHIVE_SHEET = '_Архів';
var KEEP_EXPORTS = 14;         // скільки днів тримати листи "Вивантаження ..."

function archiveRawSheets(keepDays) {
  keepDays = keepDays || KEEP_DAYS;
  var cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (keepDays - 1));

  console.log('Лишаємо записи від ' + formatDateDMY_(cutoff) + ' і новіші');
  Object.keys(DIRECTIONS).forEach(function (k) {
    try { archiveOne_(k, cutoff); }
    catch (e) { console.log(dirCfg_(k).title + ': ПОМИЛКА ' + e.message); }
  });
  dropOldExportSheets();
  console.log('Готово');
}

function archiveOne_(dirKey, cutoff) {
  var cfg = dirCfg_(dirKey);
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sh = ss.getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log(cfg.title + ': порожньо'); return; }

  var last = sh.getLastRow();
  var width = Math.max(sh.getLastColumn(), 1);
  var values = sh.getRange(2, 1, last - 1, width).getValues();

  // рядки лежать у порядку додавання, тож старі - це префікс.
  // шукаємо перший рядок, який лишається.
  var firstKeep = -1;
  for (var i = 0; i < values.length; i++) {
    var d = values[i][0];
    var when = (d instanceof Date) ? d : parseDMY_(String(d));
    if (!when) continue;                       // рядок без дати - лишаємо
    if (when >= cutoff) { firstKeep = i; break; }
  }

  if (firstKeep === 0) { console.log(cfg.title + ': архівувати нічого (' + values.length + ' рядків)'); return; }
  if (firstKeep < 0) firstKeep = values.length;   // усе старе

  var oldRows = values.slice(0, firstKeep);

  // перестраховка: чи справді серед "старих" немає свіжих
  var stray = oldRows.filter(function (r) {
    var d = (r[0] instanceof Date) ? r[0] : parseDMY_(String(r[0]));
    return d && d >= cutoff;
  }).length;
  if (stray) {
    console.log(cfg.title + ': дати вперемішку (' + stray + ' свіжих серед старих) - пропускаю, ' +
                'запустіть d05_archiveRebuildHere() з цим напрямком');
    return;
  }

  var tok = dirLockAcquire_(dirKey, 60000);
  if (!tok) { console.log(cfg.title + ': не вдалось взяти замок, спробуйте пізніше'); return; }

  try {
    var arch = ss.getSheetByName(ARCHIVE_SHEET);
    if (!arch) {
      arch = ss.insertSheet(ARCHIVE_SHEET);
      arch.getRange(1, 1, 1, width)
        .setValues([sh.getRange(1, 1, 1, width).getValues()[0]])
        .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
      arch.setFrozenRows(1);
    }
    var at = arch.getLastRow() + 1;
    arch.getRange(at, 1, oldRows.length, width).setValues(oldRows);
    arch.getRange(at, 1, oldRows.length, 1).setNumberFormat('dd.MM.yyyy');
    SpreadsheetApp.flush();

    // видаляємо порціями - інакше на 15 тисячах рядків можна впертись у ліміт часу
    var left = oldRows.length;
    while (left > 0) {
      var chunk = Math.min(left, 2000);
      sh.deleteRows(2, chunk);
      left -= chunk;
    }
    SpreadsheetApp.flush();

    console.log(cfg.title + ': в архів ' + oldRows.length + ' рядків, у роботі лишилось ' +
                (sh.getLastRow() - 1));
  } finally {
    dirLockRelease_(dirKey, tok);
  }

  // Швидкий прохід ріже лише префікс і зупиняється на першому свіжому
  // рядку. Якщо дати лежать не строго по порядку, за ним могли лишитись
  // старі - тоді доганяємо повним перезбиранням.
  if (hasOlderRows_(sh, cutoff)) {
    console.log(cfg.title + ': дати не по порядку, доганяю повним перезбиранням');
    archiveOneRebuild_(dirKey, cutoff);
  }
}

function hasOlderRows_(sh, cutoff) {
  if (sh.getLastRow() < 2) return false;
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    var d = (col[i][0] instanceof Date) ? col[i][0] : parseDMY_(String(col[i][0]));
    if (d && d < cutoff) return true;
  }
  return false;
}

// Повне перезбирання листа - на випадок, якщо дати лежать не по порядку
function archiveRebuild(dirKey, keepDays) {
  var cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - ((keepDays || KEEP_DAYS) - 1));
  archiveOneRebuild_(dirKey, cutoff);
}

function archiveOneRebuild_(dirKey, cutoff) {
  var cfg = dirCfg_(dirKey);
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sh = ss.getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('порожньо'); return; }

  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, width).getValues()[0];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();

  var keep = [], old = [];
  values.forEach(function (r) {
    var d = (r[0] instanceof Date) ? r[0] : parseDMY_(String(r[0]));
    (!d || d >= cutoff ? keep : old).push(r);
  });
  if (!old.length) { console.log('архівувати нічого'); return; }

  var tok = dirLockAcquire_(dirKey, 60000);
  if (!tok) { console.log('не вдалось взяти замок'); return; }
  try {
    var arch = ss.getSheetByName(ARCHIVE_SHEET);
    if (!arch) {
      arch = ss.insertSheet(ARCHIVE_SHEET);
      arch.getRange(1, 1, 1, width).setValues([head])
        .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
      arch.setFrozenRows(1);
    }
    var at = arch.getLastRow() + 1;
    arch.getRange(at, 1, old.length, width).setValues(old);
    arch.getRange(at, 1, old.length, 1).setNumberFormat('dd.MM.yyyy');

    sh.getRange(2, 1, values.length, width).clearContent();
    if (keep.length) {
      sh.getRange(2, 1, keep.length, width).setValues(keep);
      sh.getRange(2, 1, keep.length, 1).setNumberFormat('dd.MM.yyyy');
    }
    SpreadsheetApp.flush();
    console.log(cfg.title + ': в архів ' + old.length + ', лишилось ' + keep.length);
  } finally {
    dirLockRelease_(dirKey, tok);
  }
}

// "10.09.2026" -> Date. Повертає null, якщо не схоже на дату.
function parseDMY_(s) {
  var m = String(s || '').trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return null;
  var d = new Date(+m[3], +m[2] - 1, +m[1]);
  d.setHours(0, 0, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

// --- листи "Вивантаження ДД.ММ.РРРР" накопичуються по одному на день ---
function dropOldExportSheets() {
  var cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - KEEP_EXPORTS);

  var seen = {};
  Object.keys(DIRECTIONS).forEach(function (k) { seen[DIRECTIONS[k].spreadsheetId] = true; });
  Object.keys(seen).forEach(function (id) {
    try {
      var ss = SpreadsheetApp.openById(id);
      ss.getSheets().forEach(function (sh) {
        var m = sh.getName().match(/^Вивантаження\s+(\d{1,2}\.\d{1,2}\.\d{4})$/);
        if (!m) return;
        var d = parseDMY_(m[1]);
        if (d && d < cutoff) { ss.deleteSheet(sh); console.log('Прибрано лист "' + sh.getName() + '"'); }
      });
    } catch (e) {}
  });
}

// --- скільки де рядків ---
function showRawSizes() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = dirCfg_(k);
    try {
      var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
      var sh = ss.getSheetByName(rawSheetName_(cfg));
      var arch = ss.getSheetByName(ARCHIVE_SHEET);
      console.log(cfg.title + ': у роботі ' + (sh ? sh.getLastRow() - 1 : 0) +
                  ', в архіві ' + (arch ? arch.getLastRow() - 1 : 0));
    } catch (e) { console.log(cfg.title + ': ' + e.message); }
  });
}
