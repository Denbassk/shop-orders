// ============================================================
// ВИДАЛЕННЯ ЗАМОВЛЕННЯ ПРЯМО З ТАБЛИЦІ
//
// У таблиці випічки і кулінарії є вкладка "Видалення замовлення":
//   1) закупниця обирає ТТ у списку (лише ті, що сьогодні замовляли);
//   2) ставить галочку "Видалити замовлення".
// Далі працює ОСНОВНИЙ застосунок (інстальований onEdit-тригер): видаляє
// рядки замовлення за сьогодні, знімає позначку "вже замовляли" (ТТ може
// замовити знову), пересобирає звіт і пише результат у клітинку B7.
//
// Чому не меню, як було у legacy: меню жило у скрипті, привʼязаному до таблиці.
// Той скрипт не бачить властивостей застосунку (позначки "вже замовляли") і сам
// перезаписував звіти - через це видалення вимкнули. Тригер ж виконується в
// основному проєкті: ті самі замки, та сама позначка, той самий звіт.
//
// Закупниця пульта не бачить, тож усе - у самій таблиці. Ставиться ОДИН раз:
// d09_installDeleteSheets() у Actions.gs. Для інших напрямків (хліб, овочі) -
// додати ключ у DEL_DIRS і запустити d09 ще раз: код уже загальний.
// ============================================================

var DEL_SHEET   = 'Видалення замовлення';
var DEL_PICK    = 'B4';          // випадаючий список ТТ
var DEL_TICK    = 'B5';          // галочка "Видалити"
var DEL_MSG     = 'B7';          // результат
var DEL_LIST_ROW = 11;           // з цього рядка - список ТТ із замовленнями
var DEL_LIST_MAX = 90;
var DEL_HANDLER = 'onDeleteSheetEdit';
var DEL_DIRS    = ['bakery'];    // де ставимо вкладку і тригер (bread | nbhz | veg - за потреби)

// Напрямок за ID таблиці (кожен напрямок - окрема таблиця)
function delDirBySpreadsheet_(spreadsheetId) {
  var keys = Object.keys(DIRECTIONS);
  for (var i = 0; i < keys.length; i++)
    if (DIRECTIONS[keys[i]].spreadsheetId === spreadsheetId) return keys[i];
  return '';
}

function delTimeOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Kyiv', 'HH:mm');
  return String(v || '').trim().slice(0, 5);
}

// Хто сьогодні замовляв: [{key, addr, n, qty, time}] за адресою з сирого листа
function delTodayOrders_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;

  var today = formatDateDMY_(new Date());
  var c = rawCols_(dirKey);
  var hasTime = (dirKey === 'bakery' || dirKey === 'veg');
  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var w = Math.max(sh.getLastColumn(), 7);

  var agg = {};
  sh.getRange(last - take + 1, 1, take, w).getValues().forEach(function (r) {
    if (rawDate_(r[0]) !== today) return;
    var addr = String(r[2] || '').trim();
    var key = addrKey_(addr);
    if (!key) return;
    var a = agg[key] || (agg[key] = { key: key, addr: addr, n: 0, qty: 0, time: '' });
    a.n++;
    a.qty += Number(String(r[c.qty] == null ? '' : r[c.qty]).replace(',', '.')) || 0;
    if (hasTime) { var t = delTimeOf_(r[1]); if (t) a.time = t; }
  });

  Object.keys(agg).forEach(function (k) { out.push(agg[k]); });
  out.sort(function (a, b) { return a.addr.localeCompare(b.addr, 'uk'); });
  return out;
}

// --- створити/оформити вкладку (разово, ідемпотентно) ---
function delSheetEnsure_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
  var sh = ss.getSheetByName(DEL_SHEET);
  var isNew = !sh;
  if (!sh) sh = ss.insertSheet(DEL_SHEET);

  sh.getRange('A1').setValue('Видалення замовлення ТТ')
    .setFontSize(15).setFontWeight('bold');
  sh.getRange('A2').setValue('Оберіть ТТ у списку і поставте галочку. Замовлення за сьогодні буде видалено, ' +
                             'а ТТ зможе замовити знову.')
    .setFontColor('#5f6368');
  sh.getRange('A4').setValue('Торгова точка:').setFontWeight('bold');
  sh.getRange('A5').setValue('Видалити замовлення:').setFontWeight('bold');
  sh.getRange('A7').setValue('Результат:').setFontWeight('bold');
  sh.getRange('A9').setValue('Замовили сьогодні (оновлюється разом зі звітом):')
    .setFontWeight('bold').setFontColor('#1565C0');
  sh.getRange('A10:B10').setValues([['Торгова точка', 'Позицій · кількість · час']])
    .setFontWeight('bold').setBackground('#E3F2FD');

  sh.getRange(DEL_PICK).setBackground('#FFF8E1').setFontWeight('bold');
  sh.getRange(DEL_TICK).insertCheckboxes();
  sh.getRange(DEL_TICK).setHorizontalAlignment('left');
  sh.getRange(DEL_MSG).setWrap(true).setVerticalAlignment('top');

  sh.setColumnWidth(1, 330);
  sh.setColumnWidth(2, 430);
  sh.setTabColor('#D32F2F');
  sh.getRange(1, 1, DEL_LIST_ROW + DEL_LIST_MAX, 2).setFontFamily('Arial');
  if (isNew) sh.getRange(DEL_MSG).setValue('Готово до роботи.');

  var list = sh.getRange(DEL_LIST_ROW, 1, DEL_LIST_MAX, 1);
  sh.getRange(DEL_PICK).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(list, true)
      .setAllowInvalid(false).setHelpText('Оберіть ТТ зі списку нижче').build());
  return sh;
}

// --- оновити список "Замовили сьогодні" (і випадаючий список) ---
// Викликається з markReport_ після кожної збірки звіту. Якщо вкладки немає -
// нічого не робить (функція ще не встановлена).
function delSheetRefresh_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(DEL_SHEET);
  if (!sh) return;

  var list = delTodayOrders_(dirKey).slice(0, DEL_LIST_MAX);
  sh.getRange(DEL_LIST_ROW, 1, DEL_LIST_MAX, 2).clearContent();
  if (list.length) {
    sh.getRange(DEL_LIST_ROW, 1, list.length, 2).setValues(list.map(function (o) {
      return [o.addr, o.n + ' поз. · ' + (Math.round(o.qty * 1000) / 1000) + ' ' + cfg.unit +
                      (o.time ? ' · ' + o.time : '')];
    }));
  }

  // вибрана ТТ більше не серед тих, що замовляли - прибираємо вибір
  var pick = String(sh.getRange(DEL_PICK).getValue() || '').trim();
  if (pick) {
    var k = addrKey_(pick), still = false;
    list.forEach(function (o) { if (o.key === k) still = true; });
    if (!still) sh.getRange(DEL_PICK).clearContent();
  }
}

// --- рядки замовлення для журналу (до видалення) ---
function delRowsSummary_(cfg, dirKey, target) {
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  var out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  var today = formatDateDMY_(new Date());
  var c = rawCols_(dirKey);
  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var w = Math.max(sh.getLastColumn(), 7);
  sh.getRange(last - take + 1, 1, take, w).getValues().forEach(function (r) {
    if (rawDate_(r[0]) !== today || addrKey_(String(r[2] || '').trim()) !== target) return;
    out.push(String(r[c.name] || '').trim() + ' x' + (Number(String(r[c.qty]).replace(',', '.')) || 0));
  });
  return out;
}

// --- саме видалення. Під замком напрямку (його чекають сортування і append) ---
function delCancelOrder_(dirKey, addr) {
  var cfg = dirCfg_(dirKey);
  var target = addrKey_(addr);
  if (!target) throw new Error('Порожня адреса');

  var removed = 0, items = [];
  var tok = dirLockAcquire_(dirKey, 30000);
  if (!tok) throw new Error('Лист зайнятий (іде запис замовлень). Спробуйте ще раз за хвилину.');
  try {
    var g = LockService.getScriptLock();
    if (!g.tryLock(30000)) throw new Error('Сервер зайнятий. Спробуйте ще раз за хвилину.');
    try {
      items = delRowsSummary_(cfg, dirKey, target);
      removed = deleteTodayRowsByKey_(cfg, dirKey, target);
    } finally { try { g.releaseLock(); } catch (e) {} }
  } finally { dirLockRelease_(dirKey, tok); }

  // Позначка "ТТ сьогодні вже замовляла" (ScriptProperties застосунку). Саме її
  // не знімало старе меню, тому ТТ не могла замовити знову. Знімаємо обидва
  // варіанти ключа: за адресою з листа і за ключем точки з Довідника.
  var props = PropertiesService.getScriptProperties();
  var marks = {};
  marks['sub_' + dirKey + '_' + target] = 1;
  try {
    loadStores_().forEach(function (s) {
      if (s.directions.indexOf(dirKey) >= 0 && statusKey_(dirKey, s) === target)
        marks[orderMarkKey_(dirKey, s)] = 1;
    });
  } catch (e) {}
  Object.keys(marks).forEach(function (k) { props.deleteProperty(k); });

  if (dirKey === 'nbhz') props.setProperty('nbhz_export_dirty', formatDateDMY_(new Date()));
  invalidateAppCache();
  if (removed) safeNoteDeleted_(dirKey);
  adminLog_('Видалено з таблиці', cfg.title + ' / ' + addr + ' - рядків ' + removed +
            (items.length ? ' (' + items.join('; ') + ')' : ''));
  return { removed: removed, items: items };
}

function delBuildReport_(dirKey) {
  if (dirKey === 'bread') buildBreadReports();
  else if (dirKey === 'bakery') buildBakeryReports();
  else if (dirKey === 'veg') buildVegReports();
  else if (dirKey === 'nbhz') buildNbhzExport();
}

function delNow_() { return Utilities.formatDate(new Date(), 'Europe/Kyiv', 'HH:mm:ss'); }

function delSay_(sh, text) {
  sh.getRange(DEL_MSG).setValue(delNow_() + '  ' + text);
  SpreadsheetApp.flush();
}

// ============================================================
// ОБРОБНИК ГАЛОЧКИ. Це ІНСТАЛЬОВАНИЙ тригер (d09_installDeleteSheets), а не
// простий onEdit: простий не вміє ні замків, ні властивостей застосунку.
// Реагує ЛИШЕ на галочку на вкладці "Видалення замовлення"; усе інше -
// миттєвий вихід, тож звичайна робота в таблиці його не помічає.
// ============================================================
function onDeleteSheetEdit(e) {
  var sh = null;
  try {
    if (!e || !e.range) return;
    sh = e.range.getSheet();
    if (sh.getName() !== DEL_SHEET) return;
    if (e.range.getA1Notation() !== DEL_TICK) return;
    if (e.range.getValue() !== true) return;

    var dirKey = delDirBySpreadsheet_(sh.getParent().getId());
    if (!dirKey) { delSay_(sh, '⚠ Ця таблиця не належить жодному напрямку застосунку.'); return; }

    var pick = String(sh.getRange(DEL_PICK).getValue() || '').trim();
    // галочку знімаємо одразу: поки йде видалення (збірка звіту може тривати
    // хвилину), її не можна сплутати з "ще не спрацювало"
    sh.getRange(DEL_TICK).setValue(false);
    if (!pick) { delSay_(sh, '⚠ Спершу оберіть ТТ у списку (клітинка B4), потім ставте галочку.'); return; }

    delSay_(sh, '⏳ Видаляю замовлення: ' + pick + ' …');
    var res = delCancelOrder_(dirKey, pick);

    sh.getRange(DEL_PICK).clearContent();
    if (res.removed) {
      delSay_(sh, '✅ Видалено ' + res.removed + ' рядків замовлення: ' + pick +
                  '. ТТ може замовити знову. Оновлюю звіт…');
    } else {
      delSay_(sh, '⚠ Замовлення для "' + pick + '" не знайдено - можливо, його вже видалили. ' +
                  'Позначку "вже замовляли" знято, ТТ може замовити знову.');
    }

    // звіт перезбирається одразу (як робило старе меню). Збірка може тривати
    // до хвилини-двох; якщо впаде - звіт все одно оновиться сам за 5 хвилин.
    try {
      delBuildReport_(dirKey);
      sh.getRange(DEL_MSG).setValue(sh.getRange(DEL_MSG).getValue().replace(' Оновлюю звіт…', ' Звіт оновлено.'));
    } catch (er) {
      console.error('Видалення: звіт не зібрався: ' + er.message);
      sh.getRange(DEL_MSG).setValue(sh.getRange(DEL_MSG).getValue().replace(' Оновлюю звіт…',
        ' Звіт оновиться сам протягом 5 хвилин.'));
    }
    try { delSheetRefresh_(dirKey); } catch (er2) {}
  } catch (err) {
    console.error('onDeleteSheetEdit: ' + ((err && err.stack) || err));
    try { if (sh) delSay_(sh, '❌ Не вдалось видалити: ' + ((err && err.message) || err)); } catch (e2) {}
  } finally {
    // галочку завжди знімаємо - щоб наступне видалення було новим кліком
    try { if (sh && sh.getName() === DEL_SHEET && e && e.range && e.range.getA1Notation() === DEL_TICK)
            sh.getRange(DEL_TICK).setValue(false); } catch (e3) {}
  }
}

// ============================================================
// УСТАНОВКА (разово) і ДІАГНОСТИКА
// ============================================================

// Створити вкладку у таблицях з DEL_DIRS і поставити тригер.
// Повторний запуск безпечний: вкладки оновляться, тригери не задвояться.
function installDeleteSheets_() {
  DEL_DIRS.forEach(function (k) {
    var cfg = DIRECTIONS[k];
    try {
      delSheetEnsure_(k);
      delSheetRefresh_(k);

      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === DEL_HANDLER && t.getTriggerSourceId() === cfg.spreadsheetId)
          ScriptApp.deleteTrigger(t);
      });
      ScriptApp.newTrigger(DEL_HANDLER).forSpreadsheet(cfg.spreadsheetId).onEdit().create();
      console.log('OK  ' + cfg.title + ': вкладка "' + DEL_SHEET + '" і тригер поставлено');
    } catch (e) {
      console.error('ПОМИЛКА ' + cfg.title + ': ' + e.message);
    }
  });
}

function showDeleteSheets_() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === DEL_HANDLER;
  });
  DEL_DIRS.forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var has = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(DEL_SHEET) ? 'є' : 'НЕМАЄ';
    var tr = triggers.filter(function (t) { return t.getTriggerSourceId() === cfg.spreadsheetId; }).length;
    console.log(cfg.title + ': вкладка ' + has + ', тригерів ' + tr + (tr === 1 ? '' : '  <-- має бути 1'));
  });
}
