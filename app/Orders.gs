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
      price: Math.round(p.price * cfg.markup * 100) / 100,   // те, що бачить продавець
      category: p.category || null,
      availability: p.availability || null,
      box: p.box || null
    };
  });

  var cats = [];
  if (cfg.hasCategories) {
    products.forEach(function (p) {
      if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    });
  }

  return {
    dir: dirKey,
    unit: cfg.unit,
    minOrder: Math.round(cfg.minOrder * cfg.markup * 100) / 100,
    categories: cats,
    products: products,
    alreadyOrdered: isOrderedToday_(dirKey, store)
  };
}

function isOrderedToday_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  var target = addrKey_(dirKey === 'bread'
    ? shortenAddress_(store[cfg.addressAlias])
    : store[cfg.addressAlias]);
  var today = formatDateDMY_(new Date());

  try {
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.rawSheet);
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

function apiSubmitOrder_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);
  var items = payload.items || [];

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');
  if (!items.length) throw new Error('Замовлення порожнє');
  if (items.length > 500) throw new Error('Занадто багато позицій');

  // Ціни беремо ЛИШЕ з сервера - клієнту не довіряємо
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
    if (isOrderedToday_(dirKey, store))
      throw new Error('Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено');

    var now = new Date();
    var ctx = {
      dateStr: now,                                   // у листах дата зберігається як Date
      timeStr: formatTime_(now),
      address: store[cfg.addressAlias],
      shortAddress: shortenAddress_(store[cfg.addressAlias]),
      store: store
    };

    var values = lines.map(function (p) { return cfg.rawRow(ctx, p); });

    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.rawSheet);
    if (!sh) throw new Error('Не знайдено лист "' + cfg.rawSheet + '"');

    var startRow = Math.max(sh.getLastRow() + 1, 2);
    var width = values[0].length;
    sh.getRange(startRow, 1, values.length, width).setValues(values);

    // Формати - щоб нові рядки виглядали як існуючі
    sh.getRange(startRow, 1, values.length, 1).setNumberFormat('dd.MM.yyyy');
    if (cfg.hasBarcodes) {
      var bcCol = (dirKey === 'bread') ? 4 : 5;
      sh.getRange(startRow, bcCol, values.length, 1).setNumberFormat('@');
    }
    SpreadsheetApp.flush();

    CacheService.getScriptCache().remove('status_v1');

    var totalShown = Math.round(totalSupplier * cfg.markup * 100) / 100;
    console.log('Замовлення ' + dirKey + ' / ' + store.label + ': ' +
      lines.length + ' позицій, ' + totalShown + ' грн');

    return {
      ok: true, positions: lines.length, total: totalShown,
      time: formatTime_(now), direction: cfg.title, store: store.label
    };
  } finally {
    lock.releaseLock();
  }
}