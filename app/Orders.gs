// ============================================================
// АСОРТИМЕНТ ДЛЯ КЛІЄНТА І ПРИЙОМ ЗАМОВЛЕНЬ
// ============================================================

function apiProducts_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

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
  var already = isOrderedToday_(dirKey, store);

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
// ЗАМОК НА НАПРЯМОК, А НЕ НА ВЕСЬ СКРИПТ
//
// Гонка можлива лише між двома записами в ОДИН і той самий лист:
// обидва рахують getLastRow() і пишуть в один рядок. Різні напрямки -
// різні таблиці, їм ділити нічого.
//
// LockService дає тільки глобальний замок на весь скрипт. Тому робимо
// поверх нього чотири окремі: глобальний береться на 20-30 мс, щоб
// атомарно зайняти "busy_<напрямок>", і одразу відпускається. Сам запис
// у таблицю (найдовша частина) іде вже без нього.
//
// Підсумок: хліб і овочі пишуться одночасно. Черга лишається тільки
// всередині одного напрямку - і вона там потрібна.
// ============================================================
var DIR_LOCK_TTL_MS = 45000;   // якщо виконання впало - замок сам протухне

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
    Utilities.sleep(200 + Math.floor(Math.random() * 300));
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

  // Дозвіл закупниці = добавка. Знімає ТРИ замки: дедлайн, повторне
  // замовлення на сьогодні і мінімальну суму.
  var approvedNow = !!cfg.lateRequest &&
    lateRequestStatus_(dirKey, store.id) === 'approved';

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

  var lockToken = dirLockAcquire_(dirKey, 30000);
  if (!lockToken) throw new Error('BUSY: зараз відправляється інше замовлення на цей напрямок');

  try {
    var again = seenOrder_(orderId);
    if (again) { again.duplicate = true; return again; }

    var props = PropertiesService.getScriptProperties();
    var markKey = orderMarkKey_(dirKey, store);
    var todayStr = formatDateDMY_(new Date());
    var already = (props.getProperty(markKey) === todayStr);
    if (!already) already = isOrderedToday_(dirKey, store);   // перший раз за добу

    if (already && !approvedNow)
      throw new Error('Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено.' +
        (cfg.lateRequest ? ' Для добавки натисніть "Попросити дозвіл".' : ''));

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

    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
    if (!sh) throw new Error('Не знайдено лист "' + rawSheetName_(cfg) +
      '" у таблиці напрямку "' + cfg.title + '". Створіть його або перевірте назву в Config.gs.');

    var startRow = Math.max(sh.getLastRow() + 1, 2);
    var width = values[0].length;
    sh.getRange(startRow, 1, values.length, width).setValues(values);

    sh.getRange(startRow, 1, values.length, 1).setNumberFormat('dd.MM.yyyy');
    if (cfg.hasBarcodes) {
      var bcCol = (dirKey === 'bread' || dirKey === 'nbhz') ? 4 : 5;
      sh.getRange(startRow, bcCol, values.length, 1).setNumberFormat('@');
    }
    SpreadsheetApp.flush();

    try { props.setProperty(markKey, todayStr); } catch (e) {}
    CacheService.getScriptCache().remove('status_v3');

    var totalShown = Math.round(totalSupplier * cfg.markup * 100) / 100;
    console.log((TEST_MODE ? '[ТЕСТ] ' : '') + 'Замовлення ' + dirKey + ' / ' + store.label +
      ': ' + lines.length + ' позицій, ' + totalShown + ' грн');

    var result = {
      ok: true, positions: lines.length, total: totalShown,
      time: formatTime_(now), date: formatDateDMY_(now),
      direction: cfg.title, store: store.label, test: TEST_MODE
    };
    rememberOrder_(orderId, result);
    return result;
  } finally {
    dirLockRelease_(dirKey, lockToken);
  }
}