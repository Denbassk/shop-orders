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
    minOrder: Math.round(cfg.minOrder * cfg.markup * 100) / 100,
    categories: cats,
    products: products,
    closed: closed,
    alreadyOrdered: already,
    // locked - кнопка "Відправити" вимкнена. Дозвіл закупниці знімає обидва замки:
    // і дедлайн, і "сьогодні вже замовляли" (інакше добавку зробити неможливо).
    locked: (closed || already) && !approved,
    canRequestLate: !!cfg.lateRequest && (closed || already),
    lateRequest: lateSt
  };
}

function isOrderedToday_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  var target = statusKey_(dirKey, store);
  var today = formatDateDMY_(new Date());

  try {
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
    if (!sh || sh.getLastRow() < 2) return false;
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
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

function rememberOrder_(orderId, result) {
  if (!orderId) return;
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('oid_' + orderId, JSON.stringify(result));
    if (Math.random() < 0.05) cleanupOrderIds_(props);
  } catch (e) {}
}

function cleanupOrderIds_(props) {
  try {
    var today = formatDateDMY_(new Date());
    var all = props.getProperties();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('oid_') !== 0) return;
      var rec = {};
      try { rec = JSON.parse(all[k]); } catch (e) {}
      if (rec.date && rec.date !== today) props.deleteProperty(k);
    });
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

  var minSupplier = cfg.minOrder;
  if (minSupplier > 0 && totalSupplier < minSupplier - 0.01) {
    var shown = Math.round(minSupplier * cfg.markup * 100) / 100;
    throw new Error('Мінімальне замовлення ' + shown + ' грн. Зараз ' +
      (Math.round(totalSupplier * cfg.markup * 100) / 100) + ' грн');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Сервер зайнятий, спробуйте через 10 секунд');

  try {
    var again = seenOrder_(orderId);
    if (again) { again.duplicate = true; return again; }

    var approvedNow = !!cfg.lateRequest &&
      lateRequestStatus_(dirKey, store.id) === 'approved';
    if (isOrderedToday_(dirKey, store) && !approvedNow)
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
      '". Запустіть setupTestSheets() або setupNbhz().');

    var startRow = Math.max(sh.getLastRow() + 1, 2);
    var width = values[0].length;
    sh.getRange(startRow, 1, values.length, width).setValues(values);

    sh.getRange(startRow, 1, values.length, 1).setNumberFormat('dd.MM.yyyy');
    if (cfg.hasBarcodes) {
      var bcCol = (dirKey === 'bread' || dirKey === 'nbhz') ? 4 : 5;
      sh.getRange(startRow, bcCol, values.length, 1).setNumberFormat('@');
    }
    SpreadsheetApp.flush();

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
    lock.releaseLock();
  }
}