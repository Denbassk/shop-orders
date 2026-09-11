// ============================================================
// ОБСЛУГОВУВАННЯ І ПЕРЕВІРКИ
// Нічого з цього застосунок не викликає - лише руками з редактора
// або тригером (cleanupOldOrderIds - раз на добу).
// ============================================================

// --- Персональні посилання на кожну ТТ ---
// Продавець зберігає своє посилання на робочому столі телефона -
// і екран вибору точки більше не показується. Найнадійніший захист
// від "натиснув сусідню Бучму".
function storeLinks() {
  // для продавців - адреса оболонки, яка ставиться як застосунок
  var base = PWA_URL || appUrl_();
  var rows = loadStores_().map(function (s) {
    return [s.label, s.code, base + '?tt=' + encodeURIComponent(s.id)];
  });
  console.log('Точок: ' + rows.length + ', база: ' + base);
  console.log('назва | обліковий номер | посилання');
  rows.forEach(function (r) { console.log(r[0] + ' | ' + r[1] + ' | ' + r[2]); });
  return rows;
}

// Те саме, але окремим листом у Довіднику - зручно розсилати
function writeStoreLinksSheet() {
  var ss = SpreadsheetApp.openById(REGISTRY_ID);
  var sh = ss.getSheetByName('Посилання');
  if (sh) sh.clear(); else sh = ss.insertSheet('Посилання');
  var rows = storeLinks();
  sh.getRange(1, 1, 1, 3).setValues([['Торгова точка', 'Обліковий номер', 'Персональне посилання']])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.setColumnWidth(1, 240); sh.setColumnWidth(2, 130); sh.setColumnWidth(3, 520);
  console.log('Лист "Посилання" готовий: ' + rows.length + ' рядків');
}

// --- Прибрати тестові листи з усіх таблиць ---
function dropTestSheets() {
  var killed = 0;
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    if (!cfg.spreadsheetId || !cfg.testSheet) return;
    try {
      var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
      var sh = ss.getSheetByName(cfg.testSheet);
      if (!sh) return;
      ss.deleteSheet(sh);
      killed++;
      console.log('Видалено "' + cfg.testSheet + '" з таблиці ' + cfg.title);
    } catch (e) { console.log(cfg.title + ': ' + e.message); }
  });
  console.log(killed ? 'Готово, видалено листів: ' + killed : 'Тестових листів не знайдено');
}

// --- Прибрати листи "Дозволи", якщо десь лишилися від старої схеми ---
function dropLateSheets() {
  var ids = {};
  ids[REGISTRY_ID] = 'Довідник ТТ';
  Object.keys(DIRECTIONS).forEach(function (k) {
    if (DIRECTIONS[k].spreadsheetId) ids[DIRECTIONS[k].spreadsheetId] = DIRECTIONS[k].title;
  });
  Object.keys(ids).forEach(function (id) {
    try {
      var ss = SpreadsheetApp.openById(id);
      var sh = ss.getSheetByName('Дозволи');
      if (!sh) return;
      ss.deleteSheet(sh);
      console.log('Видалено лист "Дозволи" з: ' + ids[id]);
    } catch (e) { console.log(ids[id] + ': ' + e.message); }
  });
  console.log('Готово');
}

// --- Чистка ключів ідемпотентності. Повісити тригер: раз на добу ---
function cleanupOldOrderIds() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var today = formatDateDMY_(new Date());
  var killed = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('busy_') === 0) { props.deleteProperty(k); killed++; return; }
    if (k.indexOf('sub_') === 0) {                 // позначки "вже замовляли"
      if (all[k] !== today) { props.deleteProperty(k); killed++; }
      return;
    }
    if (k.indexOf('oid_') !== 0) return;
    var rec = {};
    try { rec = JSON.parse(all[k]); } catch (e) {}
    if (rec.date && rec.date !== today) { props.deleteProperty(k); killed++; }
  });
  console.log('Прибрано ключів замовлень: ' + killed + ', лишилось властивостей: ' +
              (Object.keys(all).length - killed));
}

// --- Зняти позначку "точка вже замовляла сьогодні" ---
// Потрібно лише в одному випадку: рядки замовлення видалили з листа
// руками, а застосунок далі вважає, що замовлення є.
// Приклад виклику з редактора неможливий (потрібні аргументи) -
// тимчасово підставте потрібні значення в clearOrderMarkHere() в Actions.gs
function clearOrderMark(dirKey, part) {
  if (!dirKey) { console.log('Вкажіть напрямок: ' + Object.keys(DIRECTIONS).join(', ')); return; }
  var q = String(part || '').toLowerCase();
  var props = PropertiesService.getScriptProperties();
  var hits = loadStores_().filter(function (s) {
    return s.directions.indexOf(dirKey) >= 0 && s.label.toLowerCase().indexOf(q) >= 0;
  });
  if (!hits.length) { console.log('Не знайдено точку: ' + part); return; }
  hits.forEach(function (s) {
    props.deleteProperty(orderMarkKey_(dirKey, s));
    console.log('Позначку знято: ' + dirCfg_(dirKey).title + ' / ' + s.label);
  });
  invalidateAppCache();
}

// --- Чому в напрямку нуль позицій ---
// Показує шапку листа, перші рядки і причину відсіву кожного рядка.
function whyNoProducts(dirKey) {
  if (!dirKey) {                       // запустили з редактора без аргументу
    Object.keys(DIRECTIONS).forEach(function (k) {
      whyNoProducts(k); console.log('');
    });
    return;
  }
  var cfg = dirCfg_(dirKey);
  if (!cfg.productsSheet) { console.log(cfg.title + ': асортимент із зовнішнього прайсу'); return; }

  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.productsSheet);
  if (!sh) { console.log('Листа "' + cfg.productsSheet + '" немає. Є: ' +
      SpreadsheetApp.openById(cfg.spreadsheetId).getSheets()
        .map(function (x) { return x.getName(); }).join(' | ')); return; }

  var w = Math.max(sh.getLastColumn(), 6);
  console.log(cfg.title + ' -> лист "' + cfg.productsSheet + '", рядків ' +
              sh.getLastRow() + ', колонок ' + sh.getLastColumn());
  console.log('шапка: ' + sh.getRange(1, 1, 1, w).getValues()[0].join(' | '));
  if (sh.getLastRow() < 2) { console.log('Даних немає'); return; }

  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(w, 6)).getValues();
  console.log('перші 3 рядки:');
  rows.slice(0, 3).forEach(function (r) { console.log('   ' + r.slice(0, w).join(' | ')); });

  var why = { 'стоп': 0, 'порожня назва': 0, 'немає штрихкоду': 0,
              'немає ціни': 0, 'ok': 0 };
  rows.forEach(function (r) {
    if (String(r[0] || '').trim().toLowerCase() === 'стоп') { why['стоп']++; return; }
    var nameCol = (cfg.productLayout === 'nbhz') ? 2 : 4;
    var name = String(r[nameCol] || '').trim();
    if (!name) { why['порожня назва']++; return; }
    if (cfg.productLayout === 'nbhz' || cfg.allowNoPrice) { why['ok']++; return; }
    var barcode = String(r[2] || '').trim();
    var price = parseFloat(String(r[3] || '').replace(',', '.'));
    if (!barcode) { why['немає штрихкоду']++; return; }
    if (!(price > 0)) { why['немає ціни']++; return; }
    why['ok']++;
  });

  console.log('розбір ' + rows.length + ' рядків:');
  Object.keys(why).forEach(function (k) { if (why[k]) console.log('   ' + k + ': ' + why[k]); });
  console.log('застосунок бачить позицій: ' + loadProducts_(dirKey).length);
  console.log('---');
  console.log('Очікувані колонки: A статус | B ' +
    (dirKey === 'bakery' ? 'категорія' : '№') +
    ' | C штрихкод | D ціна | E номенклатура | F ' +
    (dirKey === 'bakery' ? 'наявність' : 'шт в ящику'));
}

// --- Прибрати чорний фон із рядків замовлень ---
// Наслідок старого insertDataOption: INSERT_ROWS. Разова процедура.
function fixRawFormat() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = dirCfg_(k);
    try {
      var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
      if (!sh || sh.getLastRow() < 2) { console.log(cfg.title + ': порожньо'); return; }

      var n = sh.getLastRow() - 1;
      var w = Math.max(sh.getLastColumn(), 1);
      var body = sh.getRange(2, 1, n, w);
      body.setBackground('#ffffff')
          .setFontColor('#000000')
          .setFontWeight('normal')
          .setFontStyle('normal');

      // числові формати повертаємо
      sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy');
      if (cfg.hasBarcodes) {
        var bcCol = (k === 'bread' || k === 'nbhz') ? 4 : 5;
        sh.getRange(2, bcCol, n, 1).setNumberFormat('@');
      }
      console.log(cfg.title + ': вирівняно ' + n + ' рядків');
    } catch (e) { console.log(cfg.title + ': ' + e.message); }
  });
  console.log('Готово');
}

// --- Прибрати сьогоднішнє замовлення точки повністю ---
// Видаляє рядки з сирого листа і знімає позначку "вже замовляли",
// тобто точка зможе замовити наново як з чистого аркуша.
function cancelTodayOrder(dirKey, part) {
  if (!dirKey) { console.log('Вкажіть напрямок: ' + Object.keys(DIRECTIONS).join(', ')); return; }
  var cfg = dirCfg_(dirKey);
  var q = String(part || '').toLowerCase();
  var hits = loadStores_().filter(function (s) {
    return s.directions.indexOf(dirKey) >= 0 && s.label.toLowerCase().indexOf(q) >= 0;
  });
  if (!hits.length) { console.log('Не знайдено точку: ' + part); return; }
  if (hits.length > 1) {
    console.log('Знайдено кілька точок - уточніть назву:');
    hits.forEach(function (s) { console.log('   ' + s.label); });
    return;
  }

  var store = hits[0];
  var g = LockService.getScriptLock();
  if (!g.tryLock(30000)) { console.log('Сервер зайнятий, спробуйте ще раз'); return; }
  var removed = 0;
  try { removed = deleteTodayRows_(cfg, dirKey, store); }
  finally { try { g.releaseLock(); } catch (e) {} }

  PropertiesService.getScriptProperties().deleteProperty(orderMarkKey_(dirKey, store));
  if (dirKey === 'nbhz')
    PropertiesService.getScriptProperties().setProperty('nbhz_export_dirty', formatDateDMY_(new Date()));
  invalidateAppCache();

  console.log(cfg.title + ' / ' + store.label + ': видалено рядків ' + removed);
  console.log('Точка може замовляти наново.');
}

// ============================================================
// ЗАМІРИ ШВИДКОСТІ
// ============================================================
function benchmarkApp() {
  var res = [];
  function step(label, fn) {
    var t = Date.now(), out = '', err = '';
    try { out = fn(); } catch (e) { err = 'ПОМИЛКА: ' + e.message; }
    res.push({ label: label, ms: Date.now() - t, note: err || out });
  }

  console.log('=== розмір сирих листів ===');
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    try {
      var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
      console.log('   ' + cfg.title + ': ' + (sh ? sh.getLastRow() + ' рядків' : 'листа немає') +
                  (sh && sh.getLastRow() > RAW_TAIL_ROWS
                    ? '  (читається хвіст ' + RAW_TAIL_ROWS + ')' : ''));
    } catch (e) { console.log('   ' + cfg.title + ': ' + e.message); }
  });

  invalidateAppCache();
  step('bootstrap, холодний кеш', function () { return apiBootstrap_().stores.length + ' точок'; });
  step('bootstrap, теплий кеш', function () { return apiBootstrap_().stores.length + ' точок'; });
  step('refresh (heartbeat кожні 45 с)', function () {
    return Object.keys(apiRefresh_({}).ordered).length + ' точок';
  });

  Object.keys(DIRECTIONS).forEach(function (k) {
    var s = loadStores_().filter(function (x) { return x.directions.indexOf(k) >= 0; })[0];
    if (!s) { console.log('немає точок для ' + k); return; }
    CacheService.getScriptCache().remove('prod_' + k);
    step('products ' + k + ', холодний', function () {
      return apiProducts_({ dir: k, storeId: s.id }).products.length + ' позицій';
    });
    step('products ' + k + ', теплий', function () {
      return apiProducts_({ dir: k, storeId: s.id }).products.length + ' позицій';
    });
    step('isOrderedToday ' + k, function () { return isOrderedToday_(k, s) ? 'так' : 'ні'; });
  });

  console.log('=== мс | крок | результат ===');
  res.forEach(function (r) {
    console.log(String(r.ms).padStart(6) + ' | ' + r.label + ' | ' + r.note);
  });

  console.log('---');
  console.log('Черга при відправці тепер лише ВСЕРЕДИНІ напрямку: хліб, НБХЗ,');
  console.log('випічка і овочі пишуться одночасно, бо це різні таблиці.');
  console.log('Реальну вартість одного запису покаже measureWrite("bread").');

  var submitPath = res.filter(function (r) {
    return r.label.indexOf('isOrderedToday') === 0;
  }).reduce(function (a, r) { return Math.max(a, r.ms); }, 0);
  console.log('---');
  console.log('Найдовший isOrderedToday: ' + submitPath + ' мс. Приблизно стільки триває ' +
              'глобальне блокування при відправці одного замовлення - решта телефонів ' +
              'чекає саме цей час.');
}

// --- Аварійне зняття замка напрямку ---
// Потрібно, лише якщо виконання впало посеред запису і замок
// висить довше 45 секунд (сам він протухає, це на всяк випадок).
function clearDirLocks() {
  var props = PropertiesService.getScriptProperties();
  Object.keys(DIRECTIONS).forEach(function (k) {
    if (props.getProperty('busy_' + k)) {
      props.deleteProperty('busy_' + k);
      console.log('Замок знято: ' + dirCfg_(k).title);
    }
  });
  console.log('Готово');
}

// --- Скільки насправді триває один запис у таблицю ---
// Пише один службовий рядок у сирий лист і одразу його видаляє.
// Якщо виконання обірветься посередині - лишиться один рядок
// зі словом ЗАМІР, його видно і його можна прибрати руками.
function measureWriteAll() {
  Object.keys(DIRECTIONS).forEach(function (k) { measureWrite(k); console.log(''); });
}

function measureWrite(dirKey) {
  var cfg = dirCfg_(dirKey || 'bread');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh) { console.log('Немає листа ' + rawSheetName_(cfg)); return; }

  var w = Math.max(sh.getLastColumn(), 7);
  var t0 = Date.now();
  var tok = dirLockAcquire_(cfg.key, 15000);
  var tLock = Date.now() - t0;
  if (!tok) { console.log('Не вдалось взяти замок напрямку'); return; }

  try {
    var row = sh.getLastRow() + 1;
    var vals = new Array(w).fill('');
    vals[0] = 'ЗАМІР ' + formatTime_(new Date());

    var t1 = Date.now();
    sh.getRange(row, 1, 1, w).setValues([vals]);
    SpreadsheetApp.flush();
    var tWrite = Date.now() - t1;

    sh.deleteRow(row);
    SpreadsheetApp.flush();

    var one = tLock + tWrite;
    console.log(cfg.title);
    console.log('   взяти замок напрямку: ' + tLock + ' мс');
    console.log('   записати + зафіксувати: ' + tWrite + ' мс');
    console.log('   разом на одне замовлення: ' + one + ' мс');
    console.log('---');
    console.log('Якщо всі 37 точок тиснуть "Відправити" в одну секунду по цьому напрямку,');
    console.log('останній чекає ' + Math.round(37 * one / 1000) + ' с. Ліміт очікування - 30 с,');
    console.log('плюс застосунок сам повторює спробу двічі. Інші напрямки не чекають взагалі.');
  } finally {
    dirLockRelease_(cfg.key, tok);
  }
}

// ============================================================
// ПЕРЕВІРКА НА ДУБЛІ ЗА СЬОГОДНІ
// ============================================================
function auditToday() {
  var today = formatDateDMY_(new Date());
  console.log('Дата перевірки: ' + today);

  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var sh;
    try { sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg)); }
    catch (e) { console.log(cfg.title + ': ' + e.message); return; }
    if (!sh || sh.getLastRow() < 2) { console.log(cfg.title + ': порожньо'); return; }

    var last = sh.getLastRow();
    var take = Math.min(last - 1, RAW_TAIL_ROWS);
    var w = sh.getLastColumn();
    var rows = sh.getRange(last - take + 1, 1, take, w).getValues();

    // де адреса і де назва - залежить від напрямку
    var aCol = (k === 'bread' || k === 'nbhz') ? 2 : 2;
    var nCol = (k === 'bread' || k === 'nbhz') ? 4 : (k === 'bakery' ? 5 : 3);
    var qCol = w - 1;

    var perStore = {}, exact = {}, dupPairs = [], exactDup = [];
    rows.forEach(function (r) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
      if (d !== today) return;
      var addr = String(r[aCol] || '').trim();
      var name = String(r[nCol] || '').trim();
      if (!addr || !name) return;

      var key = addrKey_(addr) + ' :: ' + nameKey_(name);
      perStore[key] = (perStore[key] || 0) + 1;
      if (perStore[key] === 2) dupPairs.push(addr + '  ->  ' + name);

      var full = r.join('');
      exact[full] = (exact[full] || 0) + 1;
      if (exact[full] === 2) exactDup.push(addr + '  ->  ' + name);
    });

    var stores = {};
    Object.keys(perStore).forEach(function (key) { stores[key.split(' :: ')[0]] = true; });

    console.log(cfg.title + ': точок ' + Object.keys(stores).length +
                ', позицій ' + Object.keys(perStore).length);
    if (exactDup.length) {
      console.log('   ПОВНІ ДУБЛІ РЯДКІВ (' + exactDup.length + ') - схоже на подвійну відправку:');
      exactDup.slice(0, 20).forEach(function (s) { console.log('      ' + s); });
    }
    var soft = dupPairs.filter(function (s) { return exactDup.indexOf(s) < 0; });
    if (soft.length) {
      console.log('   той самий товар двічі (' + soft.length +
                  ') - нормально, якщо це дозамовлення:');
      soft.slice(0, 20).forEach(function (s) { console.log('      ' + s); });
    }
    if (!exactDup.length && !soft.length) console.log('   дублів немає');
  });

  console.log('---');
  console.log('Повний дубль рядка = ту саму позицію з тією самою кількістю записано двічі. ' +
              'Це те, чого бути не повинно.');
}
