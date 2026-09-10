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
  var base = ScriptApp.getService().getUrl();
  var rows = loadStores_().map(function (s) {
    return [s.label, s.code, base + '?tt=' + encodeURIComponent(s.id)];
  });
  console.log('Точок: ' + rows.length);
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
function clearOrderMark(dirKey, part) {
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

  var submitPath = res.filter(function (r) {
    return r.label.indexOf('isOrderedToday') === 0;
  }).reduce(function (a, r) { return Math.max(a, r.ms); }, 0);
  console.log('---');
  console.log('Найдовший isOrderedToday: ' + submitPath + ' мс. Приблизно стільки триває ' +
              'глобальне блокування при відправці одного замовлення - решта телефонів ' +
              'чекає саме цей час.');
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
