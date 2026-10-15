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
    catch (e) { archiveLog_(dirCfg_(k).title + ': ' + e.message); }
  });
  dropOldExportSheets();
  console.log('Готово');
}

function archiveOne_(dirKey, cutoff) {
  var cfg = dirCfg_(dirKey);
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sh = ss.getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log(cfg.title + ': порожньо'); return; }
  var width = Math.max(sh.getLastColumn(), 1);

  // Що вже лежить в архіві - читаємо ДО замка: "_Архів" пише лише
  // архівування, а замок напрямку живе тільки DIR_LOCK_TTL_MS.
  var arch = archiveSheet_(ss, sh, width);
  var inArch = archivedCounts_(arch, width);

  var tok = dirLockAcquire_(dirKey, 60000);
  if (!tok) { archiveLog_(cfg.title + ': не вдалось взяти замок, спробуйте пізніше'); return; }

  try {
    // Читаємо ПІД замком: між читанням і видаленням номери рядків не мають зсунутись.
    var last = sh.getLastRow();
    if (last < 2) return;
    var values = sh.getRange(2, 1, last - 1, width).getValues();

    // рядки лежать по даті (append у кінець, сортування - дата першим ключем),
    // тож старі - це префікс. Шукаємо перший рядок, який лишається.
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
    var copied = copyToArchive_(arch, oldRows, inArch, width);

    // Видаляємо через Sheets API, як і решта видалень у застосунку.
    // sh.deleteRows для ВК не спрацьовував: з 12.09 по 15.10.2026 рядки
    // щопонеділка копіювались в архів (і не раз), а з робочого листа не зникали.
    try {
      Sheets.Spreadsheets.batchUpdate({ requests: [{ deleteDimension: { range: {
        sheetId: sh.getSheetId(), dimension: 'ROWS', startIndex: 1, endIndex: 1 + oldRows.length } } }]
      }, cfg.spreadsheetId);
    } catch (e) {
      archiveLog_(cfg.title + ': НЕ видалено з робочого листа ' + oldRows.length + ' рядків (' +
                  e.message + '). В архів дописано ' + copied + ' - повторний запуск їх не задвоїть.');
      return;
    }

    archiveLog_(cfg.title + ': в архів ' + oldRows.length + ' рядків (нових в архіві ' + copied +
                '), у роботі лишилось ' + (values.length - oldRows.length), true);
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

// Лист "_Архів" (створює, якщо нема)
function archiveSheet_(ss, sh, width) {
  var arch = ss.getSheetByName(ARCHIVE_SHEET);
  if (!arch) {
    arch = ss.insertSheet(ARCHIVE_SHEET);
    arch.getRange(1, 1, 1, width)
      .setValues([sh.getRange(1, 1, 1, width).getValues()[0]])
      .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    arch.setFrozenRows(1);
  }
  return arch;
}

// Рядок -> текстовий ключ: дата дд.мм.рррр, час гг:хх:сс, решта як є.
// Однаковий для робочого листа і архіву, хоч би який там стояв формат.
function archiveKey_(r, width) {
  var out = [];
  for (var c = 0; c < width; c++) {
    var v = r[c];
    if (v instanceof Date) {
      v = v.getFullYear() < 1900
        ? ('0' + v.getHours()).slice(-2) + ':' + ('0' + v.getMinutes()).slice(-2) + ':' +
          ('0' + v.getSeconds()).slice(-2)
        : formatDateDMY_(v);
    }
    out.push(String(v == null ? '' : v).trim());
  }
  return out.join('|');
}

// Скільки разів кожен рядок уже є в архіві (мультимножина)
function archivedCounts_(arch, width) {
  var counts = {};
  var last = arch.getLastRow();
  if (last < 2) return counts;
  arch.getRange(2, 1, last - 1, width).getValues().forEach(function (r) {
    var k = archiveKey_(r, width);
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

// Дописати в архів лише ті рядки, яких там ще немає (мультимножина: однакові
// рядки хліба-добавки рахуються поштучно). Повторний або подвійний запуск -
// два тригери nightlyArchive - більше не задвоює архів. counts оновлюється.
function copyToArchive_(arch, rows, counts, width) {
  var used = {}, toCopy = [];
  rows.forEach(function (r) {
    var k = archiveKey_(r, width);
    used[k] = (used[k] || 0) + 1;
    if (used[k] > (counts[k] || 0)) toCopy.push(r);
  });
  if (!toCopy.length) return 0;
  var at = arch.getLastRow() + 1;
  arch.getRange(at, 1, toCopy.length, width).setValues(toCopy);
  arch.getRange(at, 1, toCopy.length, 1).setNumberFormat('dd.MM.yyyy');
  SpreadsheetApp.flush();
  toCopy.forEach(function (r) {
    var k = archiveKey_(r, width);
    counts[k] = (counts[k] || 0) + 1;
  });
  return toCopy.length;
}

// Архів працює вночі - без запису в "Журнал дій" його збої ніхто не бачить.
function archiveLog_(msg, ok) {
  if (ok) console.log(msg); else console.error('АРХІВ: ' + msg);
  try { if (typeof adminLog_ === 'function') adminLog_(ok ? 'Архів' : 'Архів: помилка', msg); } catch (e) {}
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
  var arch = archiveSheet_(ss, sh, width);
  var inArch = archivedCounts_(arch, width);

  var tok = dirLockAcquire_(dirKey, 60000);
  if (!tok) { archiveLog_(cfg.title + ' (повне перезбирання): не вдалось взяти замок'); return; }
  try {
    // читаємо ПІД замком - номери рядків до видалення не зсуваються
    var values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    var old = [], hits = [];
    values.forEach(function (r, i) {
      var d = (r[0] instanceof Date) ? r[0] : parseDMY_(String(r[0]));
      if (d && d < cutoff) { old.push(r); hits.push(i + 2); }
    });
    if (!old.length) { console.log('архівувати нічого'); return; }

    var copied = copyToArchive_(arch, old, inArch, width);

    // Старі рядки ВИДАЛЯЄМО (Sheets API - deleteRowNums_ з AppendGuard.gs),
    // а не перезаписуємо лист цілком: перезапис затирав би замовлення,
    // яке прийде саме в цю мить - apiAppend_ замка не бере.
    try { deleteRowNums_(cfg, sh, hits); }
    catch (e) {
      archiveLog_(cfg.title + ' (повне перезбирання): НЕ видалено ' + hits.length + ' рядків (' +
                  e.message + '). В архів дописано ' + copied + '.');
      return;
    }
    archiveLog_(cfg.title + ' (повне перезбирання): в архів ' + old.length + ' (нових в архіві ' +
                copied + '), лишилось ' + (values.length - old.length), true);
  } finally {
    dirLockRelease_(dirKey, tok);
  }
}

// ------------------------------------------------------------
// ДУБЛІ В "_Архів" (ВК, 15.10.2026)
//
// Поки архів ВК не міг видалити рядки з робочого листа, щопонеділка
// (і не раз - два тригери nightlyArchive) ті самі дні копіювались в
// архів знову. Дубль = рядок, що збігається повністю, включно з часом
// до секунди. Беремо лише рядки з датою в A і ненульовим часом у B
// (випічка, овочі): у хліба в B маршрут, там однакові рядки бувають законно.
// Перший рядок групи лишається.
// ------------------------------------------------------------
function archiveDupScan_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var arch = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(ARCHIVE_SHEET);
  var out = { title: cfg.title, rows: 0, extra: [], byDate: {} };
  if (!arch || arch.getLastRow() < 2) return out;
  var width = Math.max(arch.getLastColumn(), 1);
  var vals = arch.getRange(2, 1, arch.getLastRow() - 1, width).getValues();
  out.rows = vals.length;
  var seen = {};
  vals.forEach(function (r, i) {
    var d = (r[0] instanceof Date) ? r[0] : parseDMY_(String(r[0]));
    if (!d) return;
    var k = archiveKey_(r, width);
    var t = k.split('|')[1];
    if (!/^\d{1,2}:\d{2}:\d{2}$/.test(t) || /^0?0:00:00$/.test(t)) return;
    if (!seen[k]) { seen[k] = true; return; }
    out.extra.push(i + 2);
    var dd = formatDateDMY_(d);
    out.byDate[dd] = (out.byDate[dd] || 0) + 1;
  });
  return out;
}

function archiveDupShow_(dirKey) {
  var s = archiveDupScan_(dirKey);
  console.log(s.title + ', "_Архів": рядків ' + s.rows + ', зайвих копій ' + s.extra.length);
  Object.keys(s.byDate).sort(function (a, b) { return parseDMY_(a) - parseDMY_(b); })
    .forEach(function (d) { console.log('   ' + d + ': ' + s.byDate[d]); });
  if (s.extra.length) console.log('Прибрати: g20_removeBakeryArchiveDups(). Нічого не видалено.');
}

function archiveDupRemove_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var arch = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(ARCHIVE_SHEET);
  var s = archiveDupScan_(dirKey);
  if (!s.extra.length) { console.log('Зайвих копій немає'); return; }
  deleteRowNums_(cfg, arch, s.extra);
  archiveLog_(cfg.title + ': з "_Архів" прибрано зайвих копій ' + s.extra.length +
              ', лишилось ' + (s.rows - s.extra.length), true);
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
