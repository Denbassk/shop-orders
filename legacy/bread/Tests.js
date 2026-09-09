function testDeleteDry() {
  var ss = getSpreadsheet();
  var rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  
  if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
    console.log('Нет данных');
    return;
  }
  
  var today = new Date();
  var todayFormatted = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd.MM.yyyy');
  var allData = rawOrderSheet.getRange(2, 1, rawOrderSheet.getLastRow() - 1, 3).getValues();
  
  var storeCount = {};
  
  for (var i = 0; i < allData.length; i++) {
    var timestamp = allData[i][0];
    if (timestamp instanceof Date) {
      var rowDate = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd.MM.yyyy');
      if (rowDate === todayFormatted) {
        var store = allData[i][2];
        storeCount[store] = (storeCount[store] || 0) + 1;
      }
    }
  }
  
  console.log('Заказы на сегодня (' + todayFormatted + '):');
  for (var store in storeCount) {
    console.log('  ' + store + ': ' + storeCount[store] + ' позиций');
  }
  console.log('Всего строк в листе: ' + rawOrderSheet.getLastRow());
}

function testRecordOrderDry() {
  // Подставьте реальный адрес магазина из вашего листа "Маршруты и Магазины"
  var fakeOrder = {
    selectedStore: 'ВСТАВЬТЕ_РЕАЛЬНЫЙ_АДРЕС_МАГАЗИНА',
    totalOrderSum: 500,
    products: [
      { barcode: '0000000000000', name: 'ТЕСТ Хліб 1', price: 25.00, quantity: 10 },
      { barcode: '0000000000001', name: 'ТЕСТ Хліб 2', price: 30.00, quantity: 8 }
    ]
  };
  
  console.log('=== ТЕСТ: Проверка валидации ===');
  
  // Проверяем что getValidBarcodesSet работает
  var barcodes = getValidBarcodesSet();
  console.log('Загружено валидных штрих-кодов: ' + barcodes.size);
  
  // Проверяем пакетную запись (без реальной записи)
  var ss = getSpreadsheet();
  var rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  
  if (rawOrderSheet) {
    console.log('Текущих строк в сырых данных: ' + rawOrderSheet.getLastRow());
  }
  
  console.log('=== ТЕСТ: Генерация отчётов ===');
  
  var start = new Date();
  generateSummaryReport();
  var afterSummary = new Date();
  console.log('generateSummaryReport: ' + (afterSummary - start) + ' мс');
  
  generateFormattedOrdersReport();
  var afterFormatted = new Date();
  console.log('generateFormattedOrdersReport: ' + (afterFormatted - afterSummary) + ' мс');
  
  console.log('=== ТЕСТ ЗАВЕРШЁН ===');
  console.log('Общее время: ' + (afterFormatted - start) + ' мс');
}

function testGetSpreadsheet() {
  try {
    const ss = getSpreadsheet();
    console.log('Имя таблицы: ' + ss.getName());
    console.log('ID: ' + ss.getId());
    console.log('Листов: ' + ss.getSheets().length);
    
    const sheets = ss.getSheets().map(s => s.getName());
    console.log('Листы: ' + sheets.join(', '));
    
    return 'OK — таблица доступна';
  } catch (error) {
    console.error('ОШИБКА: ' + error.toString());
    return 'ОШИБКА: ' + error.toString();
  }
}
function testReportsManually() {
  console.log('=== ТЕСТ ГЕНЕРАЦИИ ОТЧЁТОВ ===');
  
  const start = new Date();
  
  try {
    console.log('1. Запускаю generateSummaryReport...');
    generateSummaryReport();
    console.log('   ✓ Сводный отчёт — OK');
  } catch (e) {
    console.error('   ✗ Сводный отчёт — ОШИБКА: ' + e.toString());
  }
  
  try {
    console.log('2. Запускаю generateFormattedOrdersReport...');
    generateFormattedOrdersReport();
    console.log('   ✓ Форматированный отчёт — OK');
  } catch (e) {
    console.error('   ✗ Форматированный отчёт — ОШИБКА: ' + e.toString());
  }
  
  try {
    console.log('3. Запускаю generateReportsAsync...');
    generateReportsAsync();
    console.log('   ✓ Async отчёт — OK');
  } catch (e) {
    console.error('   ✗ Async отчёт — ОШИБКА: ' + e.toString());
  }
  
  const elapsed = (new Date() - start) / 1000;
  console.log('=== ЗАВЕРШЕНО за ' + elapsed + ' сек ===');
}
function checkTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  console.log('Всего триггеров: ' + triggers.length);
  
  triggers.forEach((trigger, i) => {
    console.log(
      (i + 1) + '. Функция: ' + trigger.getHandlerFunction() +
      ' | Тип: ' + trigger.getEventType() +
      ' | Источник: ' + trigger.getTriggerSource()
    );
  });
  
  // Проверяем дубли
  const funcCounts = {};
  triggers.forEach(t => {
    const name = t.getHandlerFunction();
    funcCounts[name] = (funcCounts[name] || 0) + 1;
  });
  
  for (const [func, count] of Object.entries(funcCounts)) {
    if (count > 1) {
      console.warn('⚠️ ДУБЛЬ: "' + func + '" имеет ' + count + ' триггеров!');
    }
  }
  
  return 'Проверка завершена';
}
function diagnoseSpreadsheet() {
  try {
    const ss = SpreadsheetApp.openById('1EN_cfEjzVHrAQuwJQPII-WMLdnnxn6u7EGdJ-D4LyYQ');
    console.log('✓ Таблица открылась: ' + ss.getName());
    
    const sheets = ss.getSheets();
    let totalCells = 0;
    
    sheets.forEach(sheet => {
      const rows = sheet.getMaxRows();
      const cols = sheet.getMaxColumns();
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const cells = rows * cols;
      totalCells += cells;
      
      console.log(`Лист "${sheet.getName()}": ` +
                  `строк ${rows} (использовано ${lastRow}), ` +
                  `колонок ${cols} (использовано ${lastCol}), ` +
                  `всего ячеек: ${cells.toLocaleString()}`);
    });
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ВСЕГО ячеек в таблице: ' + totalCells.toLocaleString());
    console.log('Лимит Google Sheets: 10 000 000');
    console.log('Использовано: ' + (totalCells / 10000000 * 100).toFixed(2) + '%');
    
  } catch (e) {
    console.error('Ошибка диагностики: ' + e.toString());
    console.error(e.stack);
  }
}
/**
 * Профилировщик: замеряет, сколько занимает каждый этап заказа.
 * Запускать вручную из редактора. Реальный заказ НЕ создаёт (использует тестовый магазин).
 */
function profileRecordOrder() {
  const t = {};
  let mark = Date.now();
  const lap = (name) => { t[name] = Date.now() - mark; mark = Date.now(); };

  // 1. Открытие таблицы
  const ss = getSpreadsheet();
  lap('getSpreadsheet (openById)');

  // 2. Чтение продуктов (как при валидации)
  getValidBarcodesSet();
  lap('getValidBarcodesSet');

  // 3. Чтение "магазины с заказами сегодня"
  getStoresWithOrdersToday();
  lap('getStoresWithOrdersToday');

  // 4. Чтение маршрута
  getRouteForStoreInternal('Полевая, 83');
  lap('getRouteForStoreInternal');

  // 5. Карта номеров магазинов
  getStoreNumbersMap();
  lap('getStoreNumbersMap');

  // 6. Генерация сводного отчёта
  try { generateSummaryReport(); } catch(e) {}
  lap('generateSummaryReport');

  // 7. Генерация форматированного отчёта
  try { generateFormattedOrdersReport(); } catch(e) {}
  lap('generateFormattedOrdersReport');

  let report = 'ТАЙМИНГИ (мс):\n';
  let total = 0;
  Object.keys(t).forEach(k => { report += `  ${k}: ${t[k]} мс\n`; total += t[k]; });
  report += `  ИТОГО: ${total} мс`;
  console.log(report);
  return report;
}
/**
 * Полная диагностика хлебного скрипта.
 * Запускать вручную из редактора. Реальных заказов НЕ создаёт.
 */
function fullDiagnostics() {
  const out = [];
  const line = (s) => out.push(s);

  line('========== ДИАГНОСТИКА ==========\n');

  // --- 1. Проверка getSpreadsheet ---
  let mark = Date.now();
  let ss;
  try {
    ss = getSpreadsheet();
    const dt = Date.now() - mark;
    line(`1. getSpreadsheet: ${dt} мс ${dt < 100 ? '✅ (активная таблица)' : '⚠️ (возможно ещё openById)'}`);
  } catch (e) {
    line('1. getSpreadsheet: ❌ ОШИБКА — ' + e.toString());
    console.log(out.join('\n'));
    return out.join('\n');
  }

  // --- 2. Проверка formatDateDMY существует ---
  try {
    const test = formatDateDMY(new Date());
    line(`2. formatDateDMY: ✅ работает, пример = ${test}`);
  } catch (e) {
    line('2. formatDateDMY: ❌ НЕ НАЙДЕНА или ошибка — ' + e.toString());
  }

  // --- 3. Проверка функций кеша ---
  ['cached_', 'invalidateOrdersCache_', 'invalidateRefCache_', 'getCache_'].forEach(fn => {
    line(`3. ${fn}: ${typeof this[fn] === 'function' || eval('typeof ' + fn) === 'function' ? '✅ есть' : '❌ НЕТ'}`);
  });

  // --- 4. Тайминги горячих функций ---
  line('\n--- ТАЙМИНГИ (мс) ---');
  const lap = (name, fn) => {
    const m = Date.now();
    let err = '';
    try { fn(); } catch (e) { err = ' ❌ ' + e.toString(); }
    line(`   ${name}: ${Date.now() - m} мс${err}`);
  };

  lap('getValidBarcodesSet', () => getValidBarcodesSet());
  lap('getStoresWithOrdersToday (1й, холодный кеш)', () => getStoresWithOrdersToday());
  lap('getStoresWithOrdersToday (2й, из кеша)', () => getStoresWithOrdersToday());
  lap('getRouteForStoreInternal', () => getRouteForStoreInternal('Полевая, 83'));
  lap('getStoreNumbersMap', () => getStoreNumbersMap());

  // --- 5. Генерация отчётов (с проверкой ошибок) ---
  line('\n--- ОТЧЁТЫ ---');
  let m = Date.now();
  try {
    generateSummaryReport();
    line(`5. generateSummaryReport: ${Date.now() - m} мс ✅`);
  } catch (e) {
    line(`5. generateSummaryReport: ❌ ОШИБКА — ${e.toString()}`);
  }
  m = Date.now();
  try {
    generateFormattedOrdersReport();
    line(`6. generateFormattedOrdersReport: ${Date.now() - m} мс ✅`);
  } catch (e) {
    line(`6. generateFormattedOrdersReport: ❌ ОШИБКА — ${e.toString()}`);
  }

  // --- 6. Проверка, что отчёты реально заполнились ---
  line('\n--- СОДЕРЖИМОЕ ОТЧЁТОВ ---');
  try {
    const sumSheet = ss.getSheetByName(ORDERS_DATA_SHEET_NAME);
    const a1 = sumSheet ? String(sumSheet.getRange('A1').getValue()) : '(лист не найден)';
    line(`   "${ORDERS_DATA_SHEET_NAME}" A1 = "${a1}", строк = ${sumSheet ? sumSheet.getLastRow() : 0}`);
  } catch (e) { line('   Данные Заказов: ❌ ' + e.toString()); }
  try {
    const fmtSheet = ss.getSheetByName(FORMATTED_ORDERS_SHEET_NAME);
    const a1 = fmtSheet ? String(fmtSheet.getRange('A1').getValue()) : '(лист не найден)';
    line(`   "${FORMATTED_ORDERS_SHEET_NAME}" A1 = "${a1}", строк = ${fmtSheet ? fmtSheet.getLastRow() : 0}`);
  } catch (e) { line('   Заказы: ❌ ' + e.toString()); }

  // --- 7. Сырые заказы сегодня ---
  line('\n--- ДАННЫЕ ---');
  try {
    const raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    const total = raw ? Math.max(raw.getLastRow() - 1, 0) : 0;
    const todayStores = getStoresWithOrdersToday();
    line(`   Всего строк в _Сырые_Заказы: ${total}`);
    line(`   Магазинов с заказами сегодня: ${todayStores.size}`);
  } catch (e) { line('   ❌ ' + e.toString()); }

  // --- 8. Триггеры ---
  line('\n--- ТРИГГЕРЫ ---');
  try {
    const trs = ScriptApp.getProjectTriggers();
    if (trs.length === 0) line('   ⚠️ Нет ни одного триггера! Запусти setupTrigger.');
    trs.forEach(t => line(`   ${t.getHandlerFunction()} | ${t.getEventType()}`));
  } catch (e) { line('   ❌ ' + e.toString()); }

  line('\n========== КОНЕЦ ==========');
  const report = out.join('\n');
  console.log(report);
  return report;
}
function stressTestOrders() {
  const out = [];
  const line = (s) => { out.push(s); };

  const STORES = [
    'м. Харків вул. Амосова, 5А',
    'м. Харків вул. Астрономічна, 44 Г',
    'м. Харків вул. Богдана Хмельницького, 8',
    'м. Харків вул. Бучми, 32',
    'м. Харків вул. Бучми, 32Б1',
    'м. Харків вул. Бучми, 52',
    'м. Харків вул. Валентинівська, 24 Б',
    'м. Харків вул. Валентинівська, 50 А',
    'м. Харків вул. Гарібальді, 1',
    'м. Харків вул. Гвардій Широнінців, 54'
  ];

  // Берём реальные товары из ассортимента (нужны barcode, name, price)
  const allProducts = getAllProductsForClient();
  const wantedBarcodes = [
    '4820041522387', '4820041527030', '4820041520321',
    '4820041521823', '4820041521380'
  ];
  const testProducts = allProducts
    .filter(p => wantedBarcodes.indexOf(p.barcode) !== -1)
    .map(p => ({ barcode: p.barcode, name: p.name, price: p.price, quantity: 5 }));

  line('========== НАГРУЗОЧНЫЙ ТЕСТ ==========');
  line(`Магазинов: ${STORES.length}, позиций в заказе: ${testProducts.length}`);
  if (testProducts.length === 0) {
    line('❌ Ни один тестовый штрихкод не найден в ассортименте! Проверь коды.');
    console.log(out.join('\n'));
    return out.join('\n');
  }
  line('');

  const ss = getSpreadsheet();
  const rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  const rowsBefore = rawSheet ? Math.max(rawSheet.getLastRow() - 1, 0) : 0;
  line(`Строк в _Сырые_Заказы ДО теста: ${rowsBefore}\n`);

  // Считаем сумму заказа (должна быть >= MIN_ORDER_AMOUNT = 350)
  const totalSum = testProducts.reduce((s, p) => s + p.price * p.quantity, 0);
  line(`Сумма каждого заказа: ${totalSum.toFixed(2)} грн (мин. ${MIN_ORDER_AMOUNT})\n`);

  const timings = [];
  STORES.forEach((store, i) => {
    // ВАЖНО: между заказами разных магазинов задержки нет, но ключ дубль-защиты
    // у каждого свой (по адресу), поэтому блокировки быть не должно.
    const orderData = {
      selectedStore: store,
      products: testProducts.map(p => ({ ...p })), // копия, чтобы не делить ссылку
      totalOrderSum: totalSum
    };
    const m = Date.now();
    let result = '', err = '';
    try {
      result = recordOrder(orderData);
    } catch (e) {
      err = e.toString();
    }
    const dt = Date.now() - m;
    timings.push(dt);
    line(`Заказ #${i + 1} [${store}]: ${dt} мс${err ? ' ❌ ' + err : ' ✅'}`);
    if (result) line(`   → ${result}`);
  });

  const total = timings.reduce((a, b) => a + b, 0);
  const max = Math.max.apply(null, timings);
  const min = Math.min.apply(null, timings);
  const avg = Math.round(total / timings.length);
  line(`\n--- ТАЙМИНГИ ---`);
  line(`   Суммарно: ${total} мс | Среднее: ${avg} мс | Мин: ${min} мс | Макс: ${max} мс`);

  SpreadsheetApp.flush();
  const rowsAfter = rawSheet ? Math.max(rawSheet.getLastRow() - 1, 0) : 0;
  const expectedNewRows = STORES.length * testProducts.length;
  const actualNewRows = rowsAfter - rowsBefore;
  line(`\n--- ЗАПИСЬ В СЫРЫЕ ---`);
  line(`   Ожидалось новых строк: ${expectedNewRows}`);
  line(`   Фактически добавлено: ${actualNewRows} ${actualNewRows === expectedNewRows ? '✅' : '❌ РАССИНХРОН!'}`);

  line(`\n--- ФИНАЛЬНЫЙ ОТЧЁТ ---`);
  try {
    invalidateOrdersCache_();
    const m = Date.now();
    generateSummaryReport();
    generateFormattedOrdersReport();
    line(`   Пересборка отчётов: ${Date.now() - m} мс ✅`);
    invalidateOrdersCache_();
    line(`   Магазинов с заказами сегодня: ${getStoresWithOrdersToday().size}`);
  } catch (e) {
    line(`   ❌ Ошибка: ${e.toString()}`);
  }

  line(`\n========== КОНЕЦ ТЕСТА ==========`);
  line(`ВНИМАНИЕ: создано до ${STORES.length} тестовых заказов. Удали их через меню.`);
  const report = out.join('\n');
  console.log(report);
  return report;
}
function compareStoreLists() {
  var SRC = {
    bread:  { id: '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4', sheet: 'Маршруты и Магазины', col: 2 },
    bakery: { id: '1THdB-b4JkXzAKsaVPw8DLrXATlycpFkTgolTmqCOXWo', sheet: 'Адреса ТТ', col: 1 },
    veg:    { id: '1HbvDCuMMJe7GI4zQyDxkyqVWahTPtWf5vNuMFLEXIC0', sheet: 'Адреса ТТ', col: 1 }
  };

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\u2019'`]/g, '')
      .replace(/(м\.|вул\.|просп\.|пров\.|буд\.)/g, ' ')
      .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var sets = {}, originals = {};
  Object.keys(SRC).forEach(function (k) {
    var c = SRC[k];
    var sh = SpreadsheetApp.openById(c.id).getSheetByName(c.sheet);
    sets[k] = {};
    originals[k] = {};
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(2, c.col, sh.getLastRow() - 1, 1).getValues();
    vals.forEach(function (r) {
      var n = norm(r[0]);
      if (n) { sets[k][n] = true; originals[k][n] = String(r[0]).trim(); }
    });
  });

  var all = {};
  Object.keys(sets).forEach(function (k) {
    Object.keys(sets[k]).forEach(function (n) { all[n] = true; });
  });

  var out = [['Адрес (как в хлебе/первом найденном)', 'Хлеб', 'Выпечка', 'Овощи']];
  Object.keys(all).sort().forEach(function (n) {
    var label = originals.bread[n] || originals.bakery[n] || originals.veg[n] || n;
    out.push([label, sets.bread[n] ? '+' : '', sets.bakery[n] ? '+' : '', sets.veg[n] ? '+' : '']);
  });

  Object.keys(sets).forEach(function (k) {
    console.log(k + ': ' + Object.keys(sets[k]).length + ' адресов');
  });
  console.log('Уникальных всего: ' + Object.keys(all).length);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = ss.getSheetByName('_Сверка_ТТ') || ss.insertSheet('_Сверка_ТТ');
  res.clear();
  res.getRange(1, 1, out.length, 4).setValues(out);
  res.setFrozenRows(1);
}

