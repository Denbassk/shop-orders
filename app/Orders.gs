// ============================================================
// АСОРТИМЕНТ ДЛЯ КЛІЄНТА І ПРИЙОМ ЗАМОВЛЕНЬ
// ============================================================

function apiProducts_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  if (!dayAllowed_(dirKey, store))
    throw new Error('Вибачте, не ваш день для замовлення.' +
      (store.orderDays && store.orderDays.length
        ? ' Ваш день: ' + dayNamesOf_(store) + '.' : ''));

  var products = loadProducts_(dirKey).map(function (p) {
    return {
      id: p.id,
      name: p.name,
      price: Math.round(p.price * cfg.markup * 100) / 100,
      category: p.category || null,
      availability: p.availability || null,
      box: p.box || null
    };
  });

  var lateSt = cfg.lateRequest ? lateRequestStatus_(dirKey, store.id) : null;
  var approved = lateSt === 'approved';
  var closed = deadlinePassed_(dirKey, store.id);
  var already = orderedTodayCached_(dirKey, store);

  var cats = [];
  if (cfg.hasCategories) {
    products.forEach(function (p) {
      if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    });
  }

  return {
    dir: dirKey,
    unit: cfg.unit,
    hidePrice: !!cfg.hidePrice,
    step: cfg.step,
    deadline: cfg.deadline,
    minOrder: approved ? 0 : Math.round(cfg.minOrder * cfg.markup * 100) / 100,
    categories: cats,
    products: products,
    closed: closed,
    alreadyOrdered: already,
    // locked - кнопка "Відправити" вимкнена. Дозвіл закупниці знімає обидва замки:
    // і дедлайн, і "сьогодні вже замовляли" (інакше добавку зробити неможливо).
    locked: (closed || already) && !approved,
    canRequestLate: !!cfg.lateRequest && (closed || already),
    lateRequest: lateSt,
    lateLeftMin: approved ? lateLeftMin_(dirKey, store.id) : 0
  };
}

// Для ЕКРАНА досить кешованого статусу (60 с) - він і так рахується для
// bootstrap і heartbeat. Пряме читання сирого листа тут коштувало ~600-1000 мс
// на кожне відкриття товарів. Остаточна перевірка лишається у відправці.
function orderedTodayCached_(dirKey, store) {
  try {
    var map = loadTodayStatus_()[dirKey];
    if (map) return !!map[statusKey_(dirKey, store)];
  } catch (e) {}
  return isOrderedToday_(dirKey, store);
}

function isOrderedToday_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  var target = statusKey_(dirKey, store);
  var today = formatDateDMY_(new Date());

  try {
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
    if (!sh || sh.getLastRow() < 2) return false;
    var last = sh.getLastRow();
    var take = Math.min(last - 1, RAW_TAIL_ROWS);
    var rows = sh.getRange(last - take + 1, 1, take, 3).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      var d = (rows[i][0] instanceof Date) ? formatDateDMY_(rows[i][0]) : String(rows[i][0]).trim();
      if (d !== today) continue;
      if (addrKey_(String(rows[i][2]).trim()) === target) return true;
    }
  } catch (e) {
    console.error('isOrderedToday ' + dirKey + ': ' + e.message);
  }
  return false;
}

// --- Захист від повторної відправки при обриві зв язку ---
function seenOrder_(orderId) {
  if (!orderId) return null;
  try {
    var v = PropertiesService.getScriptProperties().getProperty('oid_' + orderId);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

// ============================================================
// ЗАПИС ЗАМОВЛЕННЯ БЕЗ ЧЕРГИ
//
// Черга була потрібна через getLastRow() + setValues: два виконання
// рахували один і той самий вільний рядок і писали одне поверх одного.
//
// Sheets API вміє дописувати рядки АТОМАРНО на своєму боці: append
// сам знаходить кінець таблиці і вставляє рядки. Ніякого читання,
// ніякого замка - скільки б телефонів не тиснули "Відправити"
// одночасно, вони не заважають одне одному взагалі.
//
// Глобальний замок лишився в одному місці і на 30-50 мс: щоб дві
// відправки з однієї точки не проскочили обидві. Це два звернення
// до властивостей, без жодного читання таблиці.
// ============================================================
var USE_SHEETS_API = true;     // false - повернутись до старого шляху з замком
var SUBMIT_WAIT_MS = 75000;    // скільки чекати свою чергу на коротку перевірку
var DIR_LOCK_TTL_MS = 45000;   // для archiveRawSheets, див. нижче

// Одне замовлення = один виклик append, скільки б у ньому не було позицій.
// У Sheets API є квота: 60 запитів на запис за хвилину на користувача.
// Реально це 60 замовлень за хвилину - більше за будь-який реальний пік
// (148 замовлень на добу). Але якщо квота таки скінчилась, ми не відмовляємо
// продавцю: чекаємо і пробуємо ще раз, а потім пишемо старим шляхом із
// замком - у нього своєї квоти немає.
// insertDataOption:
//   INSERT_ROWS - вставляє НОВІ рядки, і вони успадковують формат рядка
//                 вище. Перший запис успадковував чорну шапку, далі всі
//                 наступні - від нього. Звідси були чорні рядки.
//   OVERWRITE   - пише у вже наявні порожні рядки під таблицею, з їхнім
//                 звичайним форматом. Під сирим листом нічого немає,
//                 тож затирати нема чого.
function apiAppend_(spreadsheetId, sheetName, rows) {
  Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A1",
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'OVERWRITE' }
  );
}

function isQuotaError_(e) {
  var m = String((e && e.message) || e);
  return m.indexOf('Quota exceeded') >= 0 || m.indexOf('RATE_LIMIT') >= 0 ||
         m.indexOf('rateLimitExceeded') >= 0;
}

function appendRows_(cfg, dirKey, values) {
  var sheetName = rawSheetName_(cfg);
  if (!USE_SHEETS_API || typeof Sheets === 'undefined')
    return appendRowsLocked_(cfg, dirKey, sheetName, values);

  var bcCol = cfg.hasBarcodes ? ((dirKey === 'bread' || dirKey === 'nbhz') ? 4 : 5) : 0;
  var rows = values.map(function (r) {
    var out = r.slice();
    if (out[0] instanceof Date) out[0] = formatDateDMY_(out[0]);
    // апостроф не видно в комірці, але він не дає перетворити штрихкод на число
    if (bcCol && out[bcCol - 1] !== '' && out[bcCol - 1] != null)
      out[bcCol - 1] = "'" + String(out[bcCol - 1]);
    return out;
  });

  try {
    apiAppend_(cfg.spreadsheetId, sheetName, rows);
    return;
  } catch (e) {
    if (!isQuotaError_(e)) throw e;
  }

  // Одна коротка пауза - раптом квота вивільнилась - і одразу запасний шлях.
  // Довгі повтори тут неприпустимі: продавець чекає на екрані.
  Utilities.sleep(700 + Math.floor(Math.random() * 1500));
  try {
    apiAppend_(cfg.spreadsheetId, sheetName, rows);
    return;
  } catch (e2) {
    if (!isQuotaError_(e2)) throw e2;
  }
  console.log('Квота Sheets API вичерпана - пишемо через замок');
  appendRowsLocked_(cfg, dirKey, sheetName, values);
}

// Старий шлях - на випадок, якщо треба вимкнути Sheets API
function appendRowsLocked_(cfg, dirKey, sheetName, values) {
  var g = LockService.getScriptLock();
  if (!g.tryLock(SUBMIT_WAIT_MS)) throw new Error('BUSY: сервер зайнятий');
  try {
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(sheetName);
    if (!sh) throw new Error('Не знайдено лист "' + sheetName + '" у таблиці "' + cfg.title + '"');
    var startRow = Math.max(sh.getLastRow() + 1, 2);
    var width = values[0].length;
    sh.getRange(startRow, 1, values.length, width).setValues(values);
    sh.getRange(startRow, 1, values.length, 1).setNumberFormat('dd.MM.yyyy');
    if (cfg.hasBarcodes) {
      var bcCol = (dirKey === 'bread' || dirKey === 'nbhz') ? 4 : 5;
      sh.getRange(startRow, bcCol, values.length, 1).setNumberFormat('@');
    }
    SpreadsheetApp.flush();
  } finally { try { g.releaseLock(); } catch (e) {} }
}

// --- замок напрямку лишився тільки для архівування (нічний тригер) ---
function dirLockAcquire_(dirKey, waitMs) {
  var token = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  var key = 'busy_' + dirKey;
  var deadline = Date.now() + (waitMs || 30000);
  while (Date.now() < deadline) {
    var g = LockService.getScriptLock();
    var got = false;
    try { got = g.tryLock(10000); } catch (e) {}
    if (got) {
      try {
        var cur = null;
        try { cur = JSON.parse(props.getProperty(key) || 'null'); } catch (e) {}
        if (!cur || (Date.now() - cur.ts) > DIR_LOCK_TTL_MS) {
          props.setProperty(key, JSON.stringify({ t: token, ts: Date.now() }));
          return token;
        }
      } finally { try { g.releaseLock(); } catch (e) {} }
    }
    Utilities.sleep(150 + Math.floor(Math.random() * 250));
  }
  return null;
}

function dirLockRelease_(dirKey, token) {
  if (!token) return;
  var props = PropertiesService.getScriptProperties();
  var key = 'busy_' + dirKey;
  var g = LockService.getScriptLock();
  var got = false;
  try { got = g.tryLock(10000); } catch (e) {}
  try {
    var cur = null;
    try { cur = JSON.parse(props.getProperty(key) || 'null'); } catch (e) {}
    if (cur && cur.t === token) props.deleteProperty(key);
  } finally { if (got) { try { g.releaseLock(); } catch (e) {} } }
}

// Позначка "ця точка сьогодні по цьому напрямку вже замовляла".
// Потрібна, щоб під ГЛОБАЛЬНИМ локом не читати сирий лист: читання
// 5000 рядків - це 300-500 мс, і весь цей час решта телефонів чекає.
// Лист читається лише раз на добу на точку - поки позначки ще немає.
function orderMarkKey_(dirKey, store) {
  return 'sub_' + dirKey + '_' + statusKey_(dirKey, store);
}

// Чистка старих ключів - НЕ тут: getProperties() по всьому сховищу
// займає секунди, а ця функція викликається під глобальним локом.
// Прибирає cleanupOldOrderIds() у Maintenance.gs, раз на добу тригером.
function rememberOrder_(orderId, result) {
  if (!orderId) return;
  try {
    PropertiesService.getScriptProperties().setProperty('oid_' + orderId, JSON.stringify(result));
  } catch (e) {}
}

// Видалити рядки сьогоднішнього замовлення однієї точки.
// Викликати ЛИШЕ під замком: видалення зсуває нумерацію.
function deleteTodayRows_(cfg, dirKey, store) {
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return 0;

  var today = formatDateDMY_(new Date());
  var target = statusKey_(dirKey, store);
  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var from = last - take + 1;
  var rows = sh.getRange(from, 1, take, 3).getValues();

  var hits = [];
  for (var i = 0; i < rows.length; i++) {
    var d = (rows[i][0] instanceof Date) ? formatDateDMY_(rows[i][0]) : String(rows[i][0]).trim();
    if (d !== today) continue;
    if (addrKey_(String(rows[i][2]).trim()) !== target) continue;
    hits.push(from + i);
  }
  if (!hits.length) return 0;

  // склеюємо сусідні рядки у відрізки і йдемо знизу вгору
  var ranges = [], start = hits[0], prev = hits[0];
  for (var j = 1; j < hits.length; j++) {
    if (hits[j] === prev + 1) { prev = hits[j]; continue; }
    ranges.push([start, prev]); start = hits[j]; prev = hits[j];
  }
  ranges.push([start, prev]);
  ranges.reverse();

  if (typeof Sheets !== 'undefined') {
    Sheets.Spreadsheets.batchUpdate({
      requests: ranges.map(function (r) {
        return { deleteDimension: { range: {
          sheetId: sh.getSheetId(), dimension: 'ROWS',
          startIndex: r[0] - 1, endIndex: r[1] } } };
      })
    }, cfg.spreadsheetId);
  } else {
    ranges.forEach(function (r) { sh.deleteRows(r[0], r[1] - r[0] + 1); });
    SpreadsheetApp.flush();
  }
  return hits.length;
}

function apiSubmitOrder_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);
  var items = payload.items || [];
  var orderId = String(payload.orderId || '').slice(0, 60);

  var prev = seenOrder_(orderId);
  if (prev) { prev.duplicate = true; return prev; }

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  if (!dayAllowed_(dirKey, store))
    throw new Error('Вибачте, не ваш день для замовлення.' +
      (store.orderDays && store.orderDays.length
        ? ' Ваш день: ' + dayNamesOf_(store) + '.' : ''));

  // Дозвіл закупниці = зміни. Знімає ТРИ замки: дедлайн, повторне
  // замовлення на сьогодні і мінімальну суму.
  var approvedNow = !!cfg.lateRequest &&
    lateRequestStatus_(dirKey, store.id) === 'approved';

  // 'replace' - замовлення переписується з нуля: старі рядки за сьогодні
  // видаляються. Так прибирають зайву позицію або міняють кількість.
  var replaceAll = approvedNow && String(payload.mode || '') === 'replace';

  if (deadlinePassed_(dirKey, store.id)) {
    throw new Error(cfg.lateRequest
      ? 'Прийом на "' + cfg.title + '" закрито (до ' + cfg.deadline +
        '). Натисніть "Попросити дозвіл" або зателефонуйте закупниці.'
      : 'Прийом замовлень на "' + cfg.title + '" на сьогодні закрито (до ' + cfg.deadline +
        '). Замовлення можна передати телефоном закупниці.');
  }

  if (!items.length) throw new Error('Замовлення порожнє');
  if (items.length > 500) throw new Error('Занадто багато позицій');

  // Ціни беремо ЛИШЕ з сервера
  var priceMap = {};
  loadProducts_(dirKey).forEach(function (p) { priceMap[String(p.id)] = p; });

  var lines = [], totalSupplier = 0;
  items.forEach(function (it) {
    var p = priceMap[String(it.id)];
    if (!p) return;
    var qty = Math.round(parseFloat(it.qty) * 1000) / 1000;
    if (!(qty > 0)) return;
    if (qty > 5000) throw new Error('Завелика кількість для "' + p.name + '"');
    lines.push({
      barcode: p.barcode || '', name: p.name, price: p.price,
      qty: qty, category: p.category || ''
    });
    totalSupplier += p.price * qty;
  });

  if (!lines.length) throw new Error('Не розпізнано жодної позиції');

  var minSupplier = approvedNow ? 0 : cfg.minOrder;
  if (minSupplier > 0 && totalSupplier < minSupplier - 0.01) {
    var shown = Math.round(minSupplier * cfg.markup * 100) / 100;
    throw new Error('Мінімальне замовлення ' + shown + ' грн. Зараз ' +
      (Math.round(totalSupplier * cfg.markup * 100) / 100) + ' грн');
  }

  var props = PropertiesService.getScriptProperties();
  var markKey = orderMarkKey_(dirKey, store);
  var todayStr = formatDateDMY_(new Date());

  // Швидка відмова ПОЗА замком. Читання сирого листа буває лише один раз
  // на добу на точку - поки позначки ще немає.
  var already = (props.getProperty(markKey) === todayStr);
  if (!already) already = isOrderedToday_(dirKey, store);
  if (already && !approvedNow)
    throw new Error('Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено.' +
      (cfg.lateRequest ? ' Для добавки натисніть "Попросити дозвіл".' : ''));

  // Єдине місце із замком: 30-50 мс, два звернення до властивостей.
  // Тут дві одночасні відправки з ОДНІЄЇ точки розходяться.
  var claimed = false;
  var g = LockService.getScriptLock();
  if (!g.tryLock(SUBMIT_WAIT_MS))
    throw new Error('BUSY: сервер зайнятий, спробуйте ще раз');
  try {
    var again = seenOrder_(orderId);
    if (again) { again.duplicate = true; return again; }

    if (!approvedNow) {
      if (props.getProperty(markKey) === todayStr)
        throw new Error('Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено.' +
          (cfg.lateRequest ? ' Для добавки натисніть "Попросити дозвіл".' : ''));
      props.setProperty(markKey, todayStr);
      claimed = true;
    }
  } finally {
    try { g.releaseLock(); } catch (e) {}
  }

  // Запис - БЕЗ замка. Sheets API дописує атомарно на своєму боці.
  var now = new Date();
  var ctx = {
    dateStr: now,
    timeStr: formatTime_(now),
    address: store[cfg.addressAlias],
    shortAddress: shortenAddress_(store[cfg.addressAlias]),
    route: store[cfg.routeAlias || 'route'] || store.route || '',
    store: store
  };
  var values = lines.map(function (p) { return cfg.rawRow(ctx, p); });

  var removed = 0;
  if (replaceAll) {
    var gd = LockService.getScriptLock();
    if (!gd.tryLock(SUBMIT_WAIT_MS)) throw new Error('BUSY: сервер зайнятий');
    try { removed = deleteTodayRows_(cfg, dirKey, store); }
    finally { try { gd.releaseLock(); } catch (e) {} }
  }

  try {
    appendRows_(cfg, dirKey, values);
  } catch (e) {
    if (claimed) { try { props.deleteProperty(markKey); } catch (e2) {} }
    throw e;
  }

  CacheService.getScriptCache().remove('status_v3');
  if (dirKey === 'nbhz') {
    try { props.setProperty('nbhz_export_dirty', todayStr); } catch (e) {}
  }

  var totalShown = Math.round(totalSupplier * cfg.markup * 100) / 100;
  console.log((TEST_MODE ? '[ТЕСТ] ' : '') + 'Замовлення ' + dirKey + ' / ' + store.label +
    ': ' + lines.length + ' позицій, ' + totalShown + ' грн');

  var result = {
    ok: true, positions: lines.length, total: totalShown,
    time: formatTime_(now), date: formatDateDMY_(now),
    direction: cfg.title, store: store.label, test: TEST_MODE,
    replaced: replaceAll, removed: removed
  };
  rememberOrder_(orderId, result);
  return result;
}