// ============================================================
// АСОРТИМЕНТ ДЛЯ КЛІЄНТА І ПРИЙОМ ЗАМОВЛЕНЬ
// ============================================================

function apiProducts_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  // Захист про всяк випадок: навіть якщо на телефоні лишився старий
  // bootstrap (не оновився екран), вимкнений напрямок все одно не відкриється.
  if (!dirEnabled_(dirKey)) throw new Error('Напрямок "' + cfg.title + '" зараз вимкнено.');

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  if (!dayAllowed_(dirKey, store)) throw new Error(dayOffText_(dirKey, store));
  // таблиця напрямку висить - асортимент із запасної копії (Products.gs),
  // замовлення піде в буфер (Buffer.gs)

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
    minOrder: approved ? 0 : Math.round(minOrderOf_(cfg) * cfg.markup * 100) / 100,
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
  // таблиця висить - судимо за позначкою "дата|orderId", яку ставить відправка
  if (dirSick_(dirKey)) return markedToday_(dirKey, store);
  try { return isOrderedToday_(dirKey, store); }
  catch (e) { if (dirSick_(dirKey)) return markedToday_(dirKey, store); throw e; }
}

function markedToday_(dirKey, store) {
  var v = PropertiesService.getScriptProperties().getProperty(orderMarkKey_(dirKey, store)) || '';
  return v.indexOf(formatDateDMY_(new Date())) === 0;
}

function isOrderedToday_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  var target = statusKey_(dirKey, store);
  var today = formatDateDMY_(new Date());

  // Sheets API під запобіжником. Помилку НЕ ковтаємо: "не змогли перевірити"
  // не означає "не замовляли" - інакше пропустимо дубль.
  var rows = guardedDir_(dirKey, function () { return rawTailApi_(cfg, 'C'); }).rows;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (dmyApi_(rows[i][0]) !== today) continue;
    if (addrKey_(cellStr_(rows[i][2])) === target) return true;
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
var SUBMIT_WAIT_MS = 30000;    // скільки чекати свою чергу на коротку перевірку
                               // (було 75 с: кожен, хто чекає, займає слот виконання)
var DIR_LOCK_TTL_MS = 45000;   // для archiveRawSheets, див. нижче

// Одне замовлення = один виклик append, скільки б у ньому не було позицій.
// У Sheets API є квота: 60 запитів на запис за хвилину на користувача.
// Реально це 60 замовлень за хвилину - більше за будь-який реальний пік
// (148 замовлень на добу). Але якщо квота таки скінчилась, ми не відмовляємо
// продавцю: чекаємо і пробуємо ще раз, а потім пишемо старим шляхом із
// замком - у нього своєї квоти немає.
// insertDataOption:
//   Деталі щодо insertDataOption - у коментарі до apiAppend_ нижче.
// ВАЖЛИВО. 14.09.2026 через OVERWRITE було ЗАТЕРТО замовлення
// Ньютона, 111 - у ті самі рядки записалось замовлення Богдана
// Хмельницького, 8, яке прийшло на годину пізніше.
//
// Чому: append шукає "таблицю" від якоря. Якщо в листі є РОЗРИВ
// (порожній рядок або рядки старого формату), таблицею вважається
// лише те, що ДО розриву, а все нижче для append - "порожнє місце",
// куди можна писати. Приклад: шапка, розрив - таблиця це один рядок,
// і кожне замовлення пише в рядок 2, поверх попереднього.
//
// insertDataOption:
//   OVERWRITE   - затирає вміст. Ніколи. Більше не використовуємо.
//   INSERT_ROWS - вставляє НОВІ рядки. Затерти чуже не може за
//                 визначенням. Формат успадковує від рядка вище,
//                 тому в даних листа не повинно бути чорної шапки -
//                 за це відповідає repairBakeryRawSheet().
//
// Плюс якір: не A1, а ОСТАННІЙ заповнений рядок. Тоді розриви вище
// не збивають визначення таблиці. getLastRow коштує ~50 мс і не
// ламає атомарність: межу таблиці Google перераховує у себе, тому
// навіть якщо якір трохи застарів через одночасну відправку,
// рядки все одно стануть у кінець.
function apiAppend_OLD_(spreadsheetId, sheetName, rows) {
  var anchor = 1;
  try {
    var sh = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
    if (sh) anchor = Math.max(sh.getLastRow(), 1);
  } catch (e) {}

  Sheets.Spreadsheets.Values.append(
    { values: rows },
    spreadsheetId,
    "'" + sheetName + "'!A" + anchor,
    { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
  );
}

function isQuotaError_(e) {
  var m = String((e && e.message) || e);
  return m.indexOf('Quota exceeded') >= 0 || m.indexOf('RATE_LIMIT') >= 0 ||
         m.indexOf('rateLimitExceeded') >= 0;
}

// onWritten - необовʼязковий колбек: викликається ОДРАЗУ, як рядки точно
// в таблиці (Orders запамʼятовує orderId, щоб повтор не записав удруге).
//
// ПОВТОРНИЙ ЗАПИС (appendRowsLocked_) допускається лише коли рядків замовлення
// в листі точно немає - див. recoverLostAppend_ в AppendGuard.gs. Якщо
// Sheets API підтвердив запис, а помилка виникла вже після цього, - не пишемо.
function appendRows_(cfg, dirKey, values, onWritten) {
  var sheetName = rawSheetName_(cfg);
  APPEND_STATE_ = { confirmed: false, notified: false, onWritten: onWritten || null };

  if (!USE_SHEETS_API || typeof Sheets === 'undefined') {
    appendRowsLocked_(cfg, dirKey, sheetName, values);
    appendNotifyWritten_();
    return;
  }

  var bcCol = cfg.hasBarcodes ? ((dirKey === 'bread' || dirKey === 'nbhz') ? 4 : 5) : 0;
  var rows = values.map(function (r) {
    var out = r.slice();
    if (out[0] instanceof Date) out[0] = formatDateDMY_(out[0]);
    // апостроф не видно в комірці, але він не дає перетворити штрихкод на число
    if (bcCol && out[bcCol - 1] !== '' && out[bcCol - 1] != null)
      out[bcCol - 1] = "'" + String(out[bcCol - 1]);
    return out;
  });

  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      apiAppend_(cfg.spreadsheetId, sheetName, rows, dirKey, bcCol);
      return;
    } catch (e) {
      // Помилка вже ПІСЛЯ підтвердженого запису - рядки в таблиці, нічого не повторюємо.
      if (APPEND_STATE_.confirmed) {
        logAppendEvent_('помилка після підтвердженого запису (проігноровано)',
                        dirKey + ' | ' + rows[0][2] + ' | ' + e.message);
        return;
      }
      if (isAppendLost_(e)) {
        recoverLostAppend_(cfg, dirKey, sheetName, values, rows);
        appendNotifyWritten_();
        return;
      }
      if (!isQuotaError_(e)) {
        // Не квота і не підтверджено: тайм-аут відповіді міг настати після коміту.
        if (orderAlreadyInSheet_(cfg, dirKey, sheetName, rows)) {
          logAppendEvent_('помилка API, але замовлення вже в листі',
                          dirKey + ' | ' + rows[0][2] + ' | ' + e.message);
          appendNotifyWritten_();
          return;
        }
        throw e;
      }
      // Квота: API відхилив запит ДО запису, повторювати безпечно.
      // Одна коротка пауза - раптом квота вивільнилась - і одразу запасний шлях.
      // Довгі повтори тут неприпустимі: продавець чекає на екрані.
      if (attempt === 0) Utilities.sleep(700 + Math.floor(Math.random() * 1500));
    }
  }
  console.log('Квота Sheets API вичерпана - пишемо через замок');
  appendRowsLocked_(cfg, dirKey, sheetName, values);
  appendNotifyWritten_();
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
  return deleteTodayRowsByKey_(cfg, dirKey, statusKey_(dirKey, store));
}

// Те саме, але за ключем адреси (addrKey_) - так видаляє лист "Видалення
// замовлення" (DeleteSheet.gs), де є лише адреса з сирого листа.
function deleteTodayRowsByKey_(cfg, dirKey, target) {
  // Sheets API: викликається під ScriptLock, тож зависле SpreadsheetApp тут
  // тримало б замок для всіх напрямків
  var tail = guardedDir_(dirKey, function () { return rawTailApi_(cfg, 'C'); });
  if (!tail.rows.length) return 0;

  var today = formatDateDMY_(new Date());
  var from = tail.from, rows = tail.rows;

  var hits = [];
  for (var i = 0; i < rows.length; i++) {
    if (dmyApi_(rows[i][0]) !== today) continue;
    if (addrKey_(cellStr_(rows[i][2])) !== target) continue;
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

  var sid = sheetIdOf_(cfg.spreadsheetId, rawSheetName_(cfg));
  Sheets.Spreadsheets.batchUpdate({
    requests: ranges.map(function (r) {
      return { deleteDimension: { range: {
        sheetId: sid, dimension: 'ROWS',
        startIndex: r[0] - 1, endIndex: r[1] } } };
    })
  }, cfg.spreadsheetId);
  return hits.length;
}

function apiSubmitOrder_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);
  var items = payload.items || [];
  var orderId = String(payload.orderId || '').slice(0, 60);

  // спершу буфер, потім oid_: bufDrain ставить oid_ ДО того, як прибрати буфер
  var buf = bufHas_(orderId);
  if (buf) return bufResult_(buf);
  var prev = seenOrder_(orderId);
  if (prev) { prev.duplicate = true; return prev; }

  // Той самий захист, що в apiProducts_: вимкнений напрямок не приймає нових
  // замовлень, навіть якщо запит прийшов зі старого (ще не оновленого) екрана.
  if (!dirEnabled_(dirKey)) throw new Error('Напрямок "' + cfg.title + '" зараз вимкнено.');

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  if (!dayAllowed_(dirKey, store)) throw new Error(dayOffText_(dirKey, store));

  // таблиця напрямку не відповідає - замовлення йде в буфер (Buffer.gs),
  // а не висить 6 хвилин і не губиться
  var sick = dirSick_(dirKey);

  // Дозвіл закупниці = зміни. Знімає ТРИ замки: дедлайн, повторне
  // замовлення на сьогодні і мінімальну суму.
  var approvedNow = !!cfg.lateRequest &&
    lateRequestStatus_(dirKey, store.id) === 'approved';

  // 'replace' - замовлення переписується з нуля: старі рядки за сьогодні
  // видаляються. Так прибирають зайву позицію або міняють кількість.
  var replaceAll = approvedNow && String(payload.mode || '') === 'replace';
  // заміна видаляє рядки в листі - без живої таблиці її не зробити
  if (replaceAll && sick) assertDirHealthy_(dirKey);

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

  var minSupplier = approvedNow ? 0 : minOrderOf_(cfg);
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
  // Позначка = "дата|orderId". Повтор ТОГО САМОГО замовлення (той самий orderId,
  // телефон його зберігає) не блокується: 18.10.2026 запит, убитий Google на
  // 360 с, лишав позначку, і продавець уже не міг відправити ще раз.
  var mine = orderId ? todayStr + '|' + orderId : '';
  var markBlocks = function () {
    var v = props.getProperty(markKey) || '';
    return v.indexOf(todayStr) === 0 && v !== mine;
  };
  var retry = !!mine && props.getProperty(markKey) === mine;
  var already = markBlocks();
  if (!already && !sick) {
    var inSheet;
    try { inSheet = isOrderedToday_(dirKey, store); }
    catch (e) { if (!dirSick_(dirKey)) throw e; sick = true; inSheet = false; }
    if (inSheet && retry && !approvedNow) {
      // перша спроба записалась, але відповідь до телефона не дійшла
      return { ok: true, duplicate: true, positions: lines.length,
               total: Math.round(totalSupplier * cfg.markup * 100) / 100,
               time: formatTime_(new Date()), date: todayStr,
               direction: cfg.title, store: store.label, test: TEST_MODE };
    }
    already = inSheet;
  }
  if (sick && replaceAll) assertDirHealthy_(dirKey);
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
    var bufAgain = bufHas_(orderId);
    if (bufAgain) return bufResult_(bufAgain);
    var again = seenOrder_(orderId);
    if (again) { again.duplicate = true; return again; }

    if (!approvedNow) {
      if (markBlocks())
        throw new Error('Замовлення на "' + cfg.title + '" для цієї ТТ вже сьогодні відправлено.' +
          (cfg.lateRequest ? ' Для добавки натисніть "Попросити дозвіл".' : ''));
      props.setProperty(markKey, mine || todayStr);
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
    // замок напрямку - той самий, що в пульті, на листі "Видалення" і в архіві:
    // видалення за номерами рядків не повинні йти одночасно
    var dtok = dirLockAcquire_(dirKey, SUBMIT_WAIT_MS);
    if (!dtok) throw new Error('BUSY: сервер зайнятий');
    try { removed = deleteTodayRows_(cfg, dirKey, store); }
    finally { dirLockRelease_(dirKey, dtok); }
  }

  var totalShown = Math.round(totalSupplier * cfg.markup * 100) / 100;
  var result = {
    ok: true, positions: lines.length, total: totalShown,
    time: formatTime_(now), date: formatDateDMY_(now),
    direction: cfg.title, store: store.label, test: TEST_MODE,
    replaced: replaceAll, removed: removed
  };

  // orderId запамʼятовується ОДРАЗУ після підтвердженого запису (колбек),
  // а не в кінці виклику: якщо щось обірветься пізніше, повтор з телефона
  // отримає "дублі не створені" замість другого запису.
  // Запис - під запобіжником: якщо append висне, наступні продавці бачать
  // "таблиця не відповідає" і йдуть у буфер, а не стають за ним у чергу.
  var bufOid = orderId || ('srv-' + Utilities.getUuid());
  if (sick) {
    var bres = bufAccept_(bufOid, dirKey, store, values, result, approvedNow, 'таблиця не відповідала');
    CacheService.getScriptCache().remove('status_v4');
    return bres;
  }
  APPEND_STATE_ = { confirmed: false, notified: false, onWritten: null };
  try {
    guardedDir_(dirKey, function () {
      appendRows_(cfg, dirKey, values, function () { rememberOrder_(orderId, result); });
    });
  } catch (e) {
    // Не підтверджено - у буфер. bufDrain перед записом дивиться, чи рядків уже
    // немає в листі (той самий час), тож навіть "можливо записалось" не дасть дубля.
    if (!APPEND_STATE_.notified && !replaceAll) {
      try {
        var b2 = bufAccept_(bufOid, dirKey, store, values, result, approvedNow,
                            'запис не вдався: ' + e.message);
        CacheService.getScriptCache().remove('status_v4');
        return b2;
      } catch (e3) { console.error('буфер не прийняв: ' + e3.message); }
    }
    if (APPEND_STATE_.notified) {
      console.error('помилка після запису (замовлення в листі): ' + e.message);
    } else {
      if (claimed) { try { props.deleteProperty(markKey); } catch (e2) {} }
      throw e;
    }
  }
  if (!APPEND_STATE_.notified) rememberOrder_(orderId, result);

  CacheService.getScriptCache().remove('status_v4');
  if (dirKey === 'nbhz') {
    try { props.setProperty('nbhz_export_dirty', todayStr); } catch (e) {}
  }

  console.log((TEST_MODE ? '[ТЕСТ] ' : '') + 'Замовлення ' + dirKey + ' / ' + store.label +
    ': ' + lines.length + ' позицій, ' + totalShown + ' грн');
  return result;
}