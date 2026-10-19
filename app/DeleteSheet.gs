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
// Sheets API під запобіжником (18.10.2026: SpreadsheetApp на ВК висів хвилинами)
function delTodayOrders_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var out = [];
  var tail = guardedDir_(dirKey, function () { return rawTailApi_(cfg, 'H'); }, true);

  var today = formatDateDMY_(new Date());
  var c = rawCols_(dirKey);
  var hasTime = (dirKey === 'bakery' || dirKey === 'veg');

  var agg = {};
  tail.rows.forEach(function (r) {
    if (dmyApi_(r[0]) !== today) return;
    var addr = cellStr_(r[2]);
    var key = addrKey_(addr);
    if (!key) return;
    var a = agg[key] || (agg[key] = { key: key, addr: addr, n: 0, qty: 0, time: '' });
    a.n++;
    a.qty += numApi_(r[c.qty]);
    if (hasTime) { var t = timeApi_(r[1]); if (t) a.time = t; }
  });

  Object.keys(agg).forEach(function (k) { out.push(agg[k]); });
  out.sort(function (a, b) { return a.addr.localeCompare(b.addr, 'uk'); });
  return out;
}

// --- створити/оформити вкладку (разово, ідемпотентно) ---
// Усе через Sheets API: SpreadsheetApp на таблиці ВК висів хвилинами, і
// d09_installDeleteSheets не доходив до тригера.
function delSheetEnsure_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var ssId = cfg.spreadsheetId;
  var meta = sheetMetaApi_(ssId, DEL_SHEET);
  var isNew = !meta, sid;
  var tab = hexRgb_('#D32F2F');
  if (isNew) {
    var r = Sheets.Spreadsheets.batchUpdate({ requests: [{ addSheet: { properties: {
      title: DEL_SHEET, tabColor: tab } } }] }, ssId);
    sid = r.replies[0].addSheet.properties.sheetId;
  } else sid = meta.properties.sheetId;

  var vals = [
    ['A1', 'Видалення замовлення ТТ'],
    ['A2', 'Оберіть ТТ у списку і поставте галочку. Замовлення за сьогодні буде видалено, ' +
           'а ТТ зможе замовити знову.'],
    ['A4', 'Торгова точка:'], ['A5', 'Видалити замовлення:'], ['A7', 'Результат:'],
    ['A9', 'Замовили сьогодні (оновлюється разом зі звітом):'],
    ['A10', 'Торгова точка'], ['B10', 'Позицій · кількість · час']
  ];
  if (isNew) vals.push([DEL_MSG, 'Готово до роботи.']);
  Sheets.Spreadsheets.Values.batchUpdate({
    valueInputOption: 'RAW',
    data: vals.map(function (v) { return { range: a1q_(DEL_SHEET, v[0]), values: [[v[1]]] }; })
  }, ssId);

  var last = DEL_LIST_ROW + DEL_LIST_MAX;
  var R = function (r1, c1, r2, c2) { return gridRange_(sid, r1, c1, r2 || r1, c2 || c1); };
  var listRef = "='" + DEL_SHEET + "'!$A$" + DEL_LIST_ROW + ':$A$' + (last - 1);
  var reqs = [
    apiFmtReq_(R(1, 1, last, 2), { font: 'Arial' }),
    apiFmtReq_(R(1, 1), { size: 15, bold: true }),
    apiFmtReq_(R(2, 1), { color: '#5f6368' }),
    apiFmtReq_(R(4, 1), { bold: true }),
    apiFmtReq_(R(5, 1), { bold: true }),
    apiFmtReq_(R(7, 1), { bold: true }),
    apiFmtReq_(R(9, 1), { bold: true, color: '#1565C0' }),
    apiFmtReq_(R(10, 1, 10, 2), { bold: true, bg: '#E3F2FD' }),
    apiFmtReq_(R(4, 2), { bg: '#FFF8E1', bold: true }),          // DEL_PICK
    apiFmtReq_(R(5, 2), { halign: 'left' }),                     // DEL_TICK
    apiFmtReq_(R(7, 2), { wrap: true, valign: 'top' }),          // DEL_MSG
    // галочка
    { setDataValidation: { range: R(5, 2), rule: { condition: { type: 'BOOLEAN' } } } },
    // випадаючий список ТТ із рядків нижче
    { setDataValidation: { range: R(4, 2), rule: {
      condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: listRef }] },
      strict: true, showCustomUi: true, inputMessage: 'Оберіть ТТ зі списку нижче' } } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 330 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
      properties: { pixelSize: 430 }, fields: 'pixelSize' } },
    { updateSheetProperties: { properties: { sheetId: sid, tabColor: tab }, fields: 'tabColor' } }
  ];
  Sheets.Spreadsheets.batchUpdate({ requests: reqs }, ssId);
  return sid;
}

// --- оновити список "Замовили сьогодні" (і випадаючий список) ---
// Викликається з markReport_ після кожної збірки звіту. Якщо вкладки немає -
// нічого не робить (функція ще не встановлена).
function delSheetRefresh_(dirKey) {
  if (DEL_DIRS.indexOf(dirKey) < 0) return;
  var cfg = dirCfg_(dirKey);
  var ssId = cfg.spreadsheetId;
  var pickV;
  // немає вкладки - Values.get падає: функція ще не встановлена, тихо виходимо
  try { pickV = apiValues_(ssId, a1q_(DEL_SHEET, DEL_PICK), true); } catch (e) { return; }

  var list = delTodayOrders_(dirKey).slice(0, DEL_LIST_MAX);
  var rows = [];
  for (var i = 0; i < DEL_LIST_MAX; i++) {
    var o = list[i];
    rows.push(o ? [o.addr, o.n + ' поз. · ' + (Math.round(o.qty * 1000) / 1000) + ' ' + cfg.unit +
                           (o.time ? ' · ' + o.time : '')] : ['', '']);
  }
  var data = [{ range: a1q_(DEL_SHEET, 'A' + DEL_LIST_ROW + ':B' + (DEL_LIST_ROW + DEL_LIST_MAX - 1)),
                values: rows }];

  // вибрана ТТ більше не серед тих, що замовляли - прибираємо вибір
  var pick = cellStr_(pickV[0] && pickV[0][0]);
  if (pick) {
    var k = addrKey_(pick), still = false;
    list.forEach(function (x) { if (x.key === k) still = true; });
    if (!still) data.push({ range: a1q_(DEL_SHEET, DEL_PICK), values: [['']] });
  }
  Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, ssId);
}

// --- рядки замовлення для журналу (до видалення) ---
function delRowsSummary_(cfg, dirKey, target) {
  var out = [];
  var tail = guardedDir_(dirKey, function () { return rawTailApi_(cfg, 'H'); }, true);
  var today = formatDateDMY_(new Date());
  var c = rawCols_(dirKey);
  tail.rows.forEach(function (r) {
    if (dmyApi_(r[0]) !== today || addrKey_(cellStr_(r[2])) !== target) return;
    out.push(cellStr_(r[c.name]) + ' x' + numApi_(r[c.qty]));
  });
  return out;
}

// --- саме видалення. Під замком напрямку, БЕЗ глобального ScriptLock: зависла
// таблиця ВК не повинна тримати замок для решти напрямків (18.10.2026).
// Рядки видаляються одним deleteDimension, append дописує в кінець - номери
// рядків вище не зсуває.
function delCancelOrder_(dirKey, addr) {
  var cfg = dirCfg_(dirKey);
  var target = addrKey_(addr);
  if (!target) throw new Error('Порожня адреса');

  var removed = 0, items = [];
  var tok = dirLockAcquire_(dirKey, 30000);
  if (!tok) throw new Error('Лист зайнятий (іде запис замовлень). Спробуйте ще раз за хвилину.');
  try {
    items = delRowsSummary_(cfg, dirKey, target);
    removed = deleteTodayRowsByKey_(cfg, dirKey, target);
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
// Таблиці, що були замість нинішніх (копія ВК 18.10.2026). Їхні тригери
// onDeleteSheetEdit прибираємо, щоб не лишалось двох.
var DEL_OLD_SPREADSHEETS = ['1a94srF34gowBQ71U1sLDgiDnJgvTEvW32l2gLtJk3FY'];

function installDeleteSheets_() {
  // спершу - усі тригери обробника: старих таблиць і поточних (поставимо заново)
  var ours = DEL_DIRS.map(function (k) { return DIRECTIONS[k].spreadsheetId; });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() !== DEL_HANDLER) return;
    var src = t.getTriggerSourceId();
    if (DEL_OLD_SPREADSHEETS.indexOf(src) >= 0 || ours.indexOf(src) >= 0) {
      ScriptApp.deleteTrigger(t);
      console.log('прибрано тригер ' + DEL_HANDLER + ' для ' + src);
    }
  });

  DEL_DIRS.forEach(function (k) {
    var cfg = DIRECTIONS[k];
    // тригер - першим і окремо: навіть якщо таблиця зараз не відповідає,
    // старі тригери вже прибрані, а без нового видалення не працюватиме
    try {
      ScriptApp.newTrigger(DEL_HANDLER).forSpreadsheet(cfg.spreadsheetId).onEdit().create();
      console.log('OK  ' + cfg.title + ': тригер поставлено');
    } catch (e) { console.error('ПОМИЛКА тригера ' + cfg.title + ': ' + e.message); }
    try {
      var t0 = Date.now();
      delSheetEnsure_(k);
      try { delSheetRefresh_(k); } catch (e) { console.error('список ТТ: ' + e.message); }
      console.log('OK  ' + cfg.title + ': вкладка "' + DEL_SHEET + '" за ' + (Date.now() - t0) + ' мс');
    } catch (e) {
      console.error('ПОМИЛКА вкладки ' + cfg.title + ': ' + e.message);
    }
  });
}

function showDeleteSheets_() {
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === DEL_HANDLER;
  });
  DEL_DIRS.forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var has = sheetMetaApi_(cfg.spreadsheetId, DEL_SHEET) ? 'є' : 'НЕМАЄ';
    var tr = triggers.filter(function (t) { return t.getTriggerSourceId() === cfg.spreadsheetId; }).length;
    console.log(cfg.title + ': вкладка ' + has + ', тригерів ' + tr + (tr === 1 ? '' : '  <-- має бути 1'));
  });
}
