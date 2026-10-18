// ============================================================
// СТРАХОВКА НАВКОЛО ЗАПИСУ ЗАМОВЛЕННЯ
// Закриває три причини втрати і задвоєння рядків:
//   1) append під час архівування (якір getLastRow вже недійсний);
//   2) успадкований формат - дата стає числом, і рядок зникає зі звітів;
//   3) хибне "не знайшов свої рядки" одразу після append: SpreadsheetApp
//      не завжди бачить те, що щойно записав Sheets API, і повторний запис
//      дублював усе замовлення (24.09.2026, два випадки).
//
// ПРАВИЛО: якщо Sheets API у відповіді підтвердив запис (updates.updatedRows),
// рядки В ТАБЛИЦІ, і повторно їх не пишемо НІКОЛИ. Пошук рядків через
// SpreadsheetApp - лише запасна перевірка, коли відповіді API немає.
// ============================================================

// Стан останнього append у ЦЬОМУ виконанні (глобальні змінні живуть до кінця виклику).
//   confirmed - Sheets API підтвердив запис
//   notified  - onWritten уже викликано (щоб не викликати двічі)
//   onWritten - що зробити одразу після запису (Orders.gs запам'ятовує orderId)
var APPEND_STATE_ = { confirmed: false, notified: false, onWritten: null };

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

// Слід нештатної події запису. Журнал Cloud Console у цьому проєкті
// недоступний, тож окрім console.error пишемо в "Журнал дій" (Довідник ТТ).
// Викликається лише у рідкісних гілках - на звичайне замовлення не впливає.
function logAppendEvent_(what, details) {
  console.error('APPEND ' + what + ': ' + details);
  try {
    if (typeof adminLog_ === 'function') adminLog_('Запис замовлення: ' + what, details);
  } catch (e) {}
}

function appendNotifyWritten_() {
  if (APPEND_STATE_.notified) return;
  APPEND_STATE_.notified = true;
  if (typeof APPEND_STATE_.onWritten !== 'function') return;
  try { APPEND_STATE_.onWritten(); } catch (e) { console.error('onWritten: ' + e.message); }
}

// --- розбір відповіді Values.append: де саме лежать нові рядки ---
// updatedRange має вигляд  '_Сырые_Заказы_ВК'!A1013:H1019
function parseUpdatedRange_(res) {
  var r = res && res.updates && res.updates.updatedRange;
  var m = String(r || '').match(/!\$?[A-Z]+(\d+)(?::\$?[A-Z]+(\d+))?$/);
  if (!m) return null;
  var first = Number(m[1]);
  var last = Number(m[2] || m[1]);
  return { first: first, last: last, count: last - first + 1, range: String(r) };
}

// --- нормалізація дати і часу для звірки з листом ---
function dmyOfCell_(v) {
  if (v instanceof Date) return formatDateDMY_(v);
  var p = parseDMY_(String(v == null ? '' : v));
  return p ? formatDateDMY_(p) : String(v == null ? '' : v).trim();
}

// "10:53:13" / "10:53" / "0:00:00" -> "10:53". Не час (наприклад, маршрут хліба) -> ''.
function hmOfCell_(v) {
  if (v instanceof Date) return '';
  var m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m ? (('0' + m[1]).slice(-2) + ':' + m[2]) : '';
}

function lineKey_(dirKey, r) {
  var c = rawCols_(dirKey);
  return String(r[c.name] == null ? '' : r[c.name]).trim().toLowerCase() + '|' +
         (Number(String(r[c.qty] == null ? '' : r[c.qty]).replace(',', '.')) || 0);
}

// Що з рядків замовлення ВЖЕ лежить у хвості листа.
// Свіжий handle + flush + getDisplayValues (те, що бачить людина),
// дата - через getValues колонки A, бо формат комірки міг успадкуватись.
// Збіг рядка: та сама ДАТА + АДРЕСА (+ година:хвилина, якщо в колонці B час).
// Повертає { rowNums: [...], keys: {"назва|к-ть": скільки}, total }
function orderRowsInTail_(spreadsheetId, sheetName, dirKey, rows) {
  var res = { rowNums: [], keys: {}, total: 0 };
  if (!rows || !rows.length) return res;

  // Sheets API: бачить рівно те, що щойно записав append (SpreadsheetApp
  // інколи не бачив - див. шапку файлу), і не висне разом із SpreadsheetApp.
  var w = Math.max(rows[0].length, 3);
  var lastCol = String.fromCharCode(64 + Math.min(w, 26));
  var dispAll = apiValues_(spreadsheetId, a1q_(sheetName, 'A:' + lastCol), true);
  var datesAll = apiValues_(spreadsheetId, a1q_(sheetName, 'A:A'));
  var last = dispAll.length;
  if (last < 2) return res;

  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var from = last - take + 1;
  var disp = dispAll.slice(last - take).map(function (r) {
    var o = []; for (var j = 0; j < w; j++) o.push(r[j] == null ? '' : r[j]); return o;
  });
  var dates = datesAll.slice(from - 1, from - 1 + take).map(function (r) {
    var v = r && r[0];
    return [typeof v === 'number' ? new Date(Math.round((Math.floor(v) - 25569) * 86400000) + 43200000) : (v == null ? '' : v)];
  });
  while (dates.length < disp.length) dates.push(['']);

  var wantDate = dmyOfCell_(rows[0][0]);
  var wantAddr = String(rows[0][2] == null ? '' : rows[0][2]).trim();
  var wantHm = hmOfCell_(rows[0][1]);

  for (var i = 0; i < disp.length; i++) {
    var d = (dates[i][0] instanceof Date) ? formatDateDMY_(dates[i][0]) : dmyOfCell_(disp[i][0]);
    if (d !== wantDate) continue;
    if (String(disp[i][2]).trim() !== wantAddr) continue;
    if (wantHm && hmOfCell_(disp[i][1]) !== wantHm) continue;
    var k = lineKey_(dirKey, disp[i]);
    res.keys[k] = (res.keys[k] || 0) + 1;
    res.rowNums.push(from + i);
    res.total++;
  }
  return res;
}

// Які рядки замовлення ще НЕ лежать у листі (мультимножина "назва|к-ть").
function missingOrderLines_(dirKey, rows, present) {
  var used = {}, missing = [];
  rows.forEach(function (r) {
    var k = lineKey_(dirKey, r);
    used[k] = (used[k] || 0) + 1;
    if (used[k] > (present.keys[k] || 0)) missing.push(r);
  });
  return missing;
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

// Те саме, що fixAppendedFormat_, але одним batchUpdate через Sheets API.
function fixAppendedFormatApi_(spreadsheetId, sheetName, startRow, count, firstRow, bcCol) {
  try {
    var sid = sheetIdOf_(spreadsheetId, sheetName);
    var fmt = function (col, nf) {
      return { repeatCell: {
        range: { sheetId: sid, startRowIndex: startRow - 1, endRowIndex: startRow - 1 + count,
                 startColumnIndex: col - 1, endColumnIndex: col },
        cell: { userEnteredFormat: { numberFormat: nf } },
        fields: 'userEnteredFormat.numberFormat' } };
    };
    var req = [fmt(1, { type: 'DATE', pattern: 'dd.mm.yyyy' })];
    if (/^\d{1,2}:\d{2}/.test(String(firstRow[1] || '')))
      req.push(fmt(2, { type: 'TIME', pattern: 'hh:mm:ss' }));
    if (bcCol) req.push(fmt(bcCol, { type: 'TEXT' }));
    Sheets.Spreadsheets.batchUpdate({ requests: req }, spreadsheetId);
  } catch (e) { console.error('формат після append: ' + e.message); }
}

function apiAppend_(spreadsheetId, sheetName, rows, dirKey, bcCol) {
  APPEND_STATE_.confirmed = false;
  waitWhileArchiving_(dirKey, 45000);

  // якір - останній заповнений рядок колонки A, через Sheets API (не SpreadsheetApp)
  var anchor = 1;
  try { anchor = Math.max(apiValues_(spreadsheetId, a1q_(sheetName, 'A:A')).length, 1); } catch (e) {}

  var res = Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A" + anchor,
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );

  var at = parseUpdatedRange_(res);
  var updated = Number(res && res.updates && res.updates.updatedRows) || 0;

  // API відповів без помилки і назвав діапазон: рядки в таблиці. З цієї миті
  // жодних повторних записів - навіть якщо SpreadsheetApp ще їх не бачить.
  if (at && (updated === 0 || updated === rows.length)) {
    APPEND_STATE_.confirmed = true;
    appendNotifyWritten_();
    fixAppendedFormatApi_(spreadsheetId, sheetName, at.first, at.count, rows[0], bcCol || 0);
    return;
  }

  // Відповідь нетипова (немає діапазону або інше число рядків) - перевіряємо
  // лист, а не вгадуємо. Дамо таблиці мить і перечитаємо кілька разів.
  console.error('append ' + dirKey + ': нетипова відповідь API: ' + JSON.stringify(res && res.updates) +
                ', очікували рядків ' + rows.length);
  var have = null;
  for (var t = 0; t < 3; t++) {
    Utilities.sleep(t === 0 ? 800 : 1500);
    have = orderRowsInTail_(spreadsheetId, sheetName, dirKey, rows);
    if (!missingOrderLines_(dirKey, rows, have).length) break;
  }
  if (have && !missingOrderLines_(dirKey, rows, have).length) {
    APPEND_STATE_.confirmed = true;
    appendNotifyWritten_();
    return;
  }
  throw new Error('APPEND_LOST: рядки не знайдено в листі після append');
}

// Викликається з appendRows_, коли apiAppend_ кинув APPEND_LOST (API НЕ підтвердив запис).
// Дописуємо ТІЛЬКИ ті рядки, яких у листі точно немає.
function recoverLostAppend_(cfg, dirKey, sheetName, values, rows) {
  var addr = String(rows[0][2] == null ? '' : rows[0][2]).trim();
  var when = String(rows[0][0]) + ' ' + String(rows[0][1]);
  logAppendEvent_('APPEND_LOST', dirKey + ' | ' + addr + ' | ' + when + ' | рядків ' + rows.length);

  var present = null, missing = null;
  try {
    for (var t = 0; t < 2; t++) {
      Utilities.sleep(1500);
      present = orderRowsInTail_(cfg.spreadsheetId, sheetName, dirKey, rows);
      missing = missingOrderLines_(dirKey, rows, present);
      if (!missing.length) break;
    }
  } catch (e) {
    // Не змогли ні побачити, ні виключити наявність рядків - НЕ пишемо наосліп.
    logAppendEvent_('перевірка листа не вдалась', addr + ' | ' + e.message);
    throw new Error('Не вдалось перевірити, чи записалось замовлення. Не відправляйте ще раз - ' +
                    'зателефонуйте закупниці. (' + e.message + ')');
  }

  if (!missing.length) {
    logAppendEvent_('рядки вже в листі - повторний запис скасовано',
                    addr + ' | ' + when + ' | у листі ' + present.total);
    return;
  }

  // Мультимножина порівнюється за назвою і кількістю, а повні `values`
  // (з Date у колонці A) беремо за тими ж позиціями, що й rows.
  var used = {}, toWrite = [];
  values.forEach(function (v, i) {
    var k = lineKey_(dirKey, rows[i]);
    used[k] = (used[k] || 0) + 1;
    if (used[k] > (present.keys[k] || 0)) toWrite.push(v);
  });

  logAppendEvent_(present.total ? 'дописуємо лише відсутні рядки' : 'рядків замовлення в листі немає - пишемо',
                  addr + ' | ' + when + ' | у листі ' + present.total + ', дописуємо ' + toWrite.length);
  appendRowsLocked_(cfg, dirKey, sheetName, toWrite);
}

// Не квота, не APPEND_LOST: помилка могла прийти вже ПІСЛЯ коміту (тайм-аут відповіді).
// true - замовлення повністю в листі, повторювати нічого.
function orderAlreadyInSheet_(cfg, dirKey, sheetName, rows) {
  try {
    Utilities.sleep(1500);
    var present = orderRowsInTail_(cfg.spreadsheetId, sheetName, dirKey, rows);
    return present.total > 0 && !missingOrderLines_(dirKey, rows, present).length;
  } catch (e) { return false; }
}

// ------------------------------------------------------------
// ДУБЛІ В СИРОМУ ЛИСТІ (пульт: "Убрати дубли"; лог: s04_findDuplicatesToday)
//
// Дубль = той самий ДАТА + ЧАС + АДРЕСА + ТОВАР + КІЛЬКІСТЬ. У межах одного
// замовлення товар не може стояти двічі (кошик рахує за штрихкодом), а час
// до секунди ставиться один раз на виклик, тож будь-який збіг - зайвий рядок.
// Тільки напрямки з ЧАСОМ у колонці B (випічка, овочі). У хліба в колонці B
// маршрут, там добавка з дозволу закупниці законно збігається з рядком
// основного замовлення, тому автоматично не чистимо.
// ------------------------------------------------------------
var DUP_DIRS_ = { bakery: true, veg: true };

// Скануємо ВЕСЬ хвіст листа (усі дати, що там є). Нічого не змінює.
function dupScan_(dirKey) {
  if (!DUP_DIRS_[dirKey])
    throw new Error('Для цього напрямку дублі автоматично не шукаються (немає часу замовлення в листі)');
  var cfg = dirCfg_(dirKey);
  var sheetName = rawSheetName_(cfg);
  var out = { dir: dirKey, dirTitle: cfg.title, sheet: sheetName, unit: cfg.unit,
              liveRows: 0, orders: [], extraTotal: 0 };

  // Sheets API (як бачить людина - аналог getDisplayValues) під запобіжником
  var all = guardedDir_(dirKey, function () {
    return apiValues_(cfg.spreadsheetId, a1q_(sheetName, 'A:H'), true);
  });
  if (all.length < 2) return out;
  var take = Math.min(all.length - 1, RAW_TAIL_ROWS);
  var from = all.length - take + 1;
  var disp = all.slice(all.length - take);
  var c = rawCols_(dirKey);

  var byOrder = {}, seq = [];
  for (var i = 0; i < disp.length; i++) {
    var r = disp[i];
    var d = dmyOfCell_(r[0]);
    var addr = cellStr_(r[2]), name = cellStr_(r[c.name]);
    if (!parseDMY_(d) || !addr || !name) continue;
    out.liveRows++;
    var time = cellStr_(r[1]);
    var okey = d + '|' + time + '|' + addr;
    var o = byOrder[okey];
    if (!o) { o = byOrder[okey] = { key: okey, date: d, time: time, addr: addr, total: 0, lines: {} }; seq.push(o); }
    o.total++;
    var qty = numApi_(r[c.qty]);
    var lkey = name + '|' + qty;
    var l = o.lines[lkey] = o.lines[lkey] || { name: name, qty: qty, rows: [] };
    l.rows.push(from + i);
  }

  seq.forEach(function (o) {
    var positions = [], extra = 0;
    Object.keys(o.lines).forEach(function (k) {
      var l = o.lines[k];
      if (l.rows.length < 2) return;
      positions.push({ name: l.name, qty: l.qty, n: l.rows.length, rows: l.rows });
      extra += l.rows.length - 1;
    });
    if (!positions.length) return;
    out.orders.push({ key: o.key, date: o.date, time: o.time, addr: o.addr,
                      total: o.total, extra: extra, positions: positions });
    out.extraTotal += extra;
  });

  out.orders.sort(function (a, b) {
    var d = parseDMY_(b.date) - parseDMY_(a.date);
    return d || (a.time < b.time ? 1 : -1);
  });
  return out;
}

// Видалити рядки за номерами (знизу вгору, сусідні склеюємо у відрізки).
function deleteRowNums_(cfg, sh, nums) {
  nums = nums.slice().sort(function (a, b) { return a - b; });
  if (!nums.length) return 0;
  var ranges = [], start = nums[0], prev = nums[0];
  for (var j = 1; j < nums.length; j++) {
    if (nums[j] === prev + 1) { prev = nums[j]; continue; }
    ranges.push([start, prev]); start = nums[j]; prev = nums[j];
  }
  ranges.push([start, prev]);
  ranges.reverse();

  // sh - лист SpreadsheetApp або вже готовий sheetId (число)
  if (typeof sh === 'number' || typeof Sheets !== 'undefined') {
    var sid = (typeof sh === 'number') ? sh : sh.getSheetId();
    Sheets.Spreadsheets.batchUpdate({
      requests: ranges.map(function (r) {
        return { deleteDimension: { range: {
          sheetId: sid, dimension: 'ROWS',
          startIndex: r[0] - 1, endIndex: r[1] } } };
      })
    }, cfg.spreadsheetId);
  } else {
    ranges.forEach(function (r) { sh.deleteRows(r[0], r[1] - r[0] + 1); });
    SpreadsheetApp.flush();
  }
  return nums.length;
}

// Прибрати дублі у вибраних замовленнях. keys - ключі з dupScan_ (обовʼязково,
// порожній список = нічого). Перший рядок кожної групи ЛИШАЄТЬСЯ, зайві видаляються.
// Під замком напрямку (його чекають сортування й append) і ScriptLock (як deleteTodayRows_);
// номери рядків беруться із СВІЖОГО сканування вже під замком.
function dupApply_(dirKey, keys) {
  var want = {};
  (keys || []).forEach(function (k) { want[String(k)] = true; });
  if (!Object.keys(want).length) return { removed: 0, orders: [] };

  var cfg = dirCfg_(dirKey);
  var token = dirLockAcquire_(dirKey, 30000);
  if (!token) throw new Error('Лист зайнятий, спробуйте через хвилину');
  var removed = 0, done = [];
  // без глобального ScriptLock (18.10.2026): зависла таблиця одного напрямку
  // не повинна тримати замок для всіх; від паралельних видалень - замок напрямку
  try {
    {
      var scan = dupScan_(dirKey);
      var nums = [];
      scan.orders.forEach(function (o) {
        if (!want[o.key]) return;
        var n = 0, items = [];
        o.positions.forEach(function (p) {
          p.rows.slice(1).forEach(function (rn) { nums.push(rn); n++; });
          items.push(p.name + ' x' + p.qty);
        });
        done.push({ key: o.key, addr: o.addr, date: o.date, time: o.time, removed: n, items: items });
      });
      if (nums.length)
        removed = deleteRowNums_(cfg, sheetIdOf_(cfg.spreadsheetId, rawSheetName_(cfg)), nums);
    }
  } finally { dirLockRelease_(dirKey, token); }

  if (removed) {
    safeNoteDeleted_(dirKey);
    try { PropertiesService.getScriptProperties().deleteProperty(dirKey + '_report_sig'); } catch (e) {}
    try { CacheService.getScriptCache().remove('status_v4'); } catch (e) {}
    done.forEach(function (d) {
      var msg = cfg.title + ' / ' + d.addr + ', ' + d.date + ' ' + d.time + ' - рядків ' + d.removed +
                ' (' + d.items.join('; ') + ')';
      console.log('Прибрано дублі: ' + msg);
      if (typeof adminLog_ === 'function') adminLog_('Прибрано дублі', msg);
    });
  }
  return { removed: removed, orders: done };
}

// Лише вивід у лог, нічого не видаляє (те саме бачить пульт).
function findDuplicatesToday_(dirKey) {
  var scan = dupScan_(dirKey || 'bakery');
  console.log('=== ' + scan.dirTitle + ': дублі в листі "' + scan.sheet + '" (рядків з датою ' +
              scan.liveRows + ') ===');
  if (!scan.orders.length) { console.log('Задвоєнь немає.'); return; }
  scan.orders.forEach(function (o) {
    console.log(o.date + ' ' + o.time + ' | ' + o.addr + ' | у замовленні рядків ' + o.total +
                ', задвоєних позицій ' + o.positions.length + ', зайвих рядків ' + o.extra);
    o.positions.forEach(function (p) {
      console.log('     "' + p.name + '" x ' + p.qty + ' - рядки ' + p.rows.join(', '));
    });
  });
  console.log('---');
  console.log('Разом зайвих рядків: ' + scan.extraTotal + '. Скрипт нічого не видаляв.');
  console.log('Прибрати: пульт -> "Убрать дубли" (лишає перший рядок кожної групи).');
}

// Ручна перевірка: чи стоїть страховка і чи не висить замок
function s03_showAppendGuard() {
  console.log('apiAppend_ параметрів: ' + apiAppend_.length + ' (має бути 5)');
  console.log('старий шлях на місці: ' + (typeof apiAppend_OLD_ === 'function'));
  console.log('APPEND_STATE_ на місці: ' + (typeof APPEND_STATE_ === 'object'));
  var props = PropertiesService.getScriptProperties();
  Object.keys(DIRECTIONS).forEach(function (k) {
    var v = props.getProperty('busy_' + k);
    if (v) console.log('ЗАМОК ВИСИТЬ: ' + k + ' -> ' + v);
  });
  console.log('замків більше немає - все вільно');
}
