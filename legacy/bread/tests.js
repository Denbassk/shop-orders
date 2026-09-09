function diagnosticCheck() {
  var results = [];
  var ss = getSpreadsheet();
  
  results.push('========================================');
  results.push('🔍 ДІАГНОСТИКА СКРИПТУ ОВОЧІ');
  results.push('Дата: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy HH:mm:ss'));
  results.push('========================================');
  
  // 1. Проверка листов
  results.push('\n📋 1. ПЕРЕВІРКА ЛИСТІВ:');
  var sheetsToCheck = [ROUTES_STORES_SHEET_NAME, HIDDEN_RAW_DATA_SHEET_NAME, FORMATTED_ORDERS_SHEET_NAME, SUMMARY_SHEET_NAME];
  sheetsToCheck.forEach(function(name) {
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      results.push('  ✅ "' + name + '" — знайдено, рядків: ' + sheet.getLastRow() + ', прихований: ' + sheet.isSheetHidden());
    } else {
      results.push('  ❌ "' + name + '" — НЕ ЗНАЙДЕНО');
    }
  });
  
  // 2. Проверка прайса
  results.push('\n💰 2. ПЕРЕВІРКА ПРАЙСУ:');
  try {
    var products = getPricesFromExternalSheet();
    results.push('  ✅ Прайс доступний, позицій: ' + products.length);
    if (products.length > 0) {
      results.push('  Перші 5 позицій:');
      for (var i = 0; i < Math.min(5, products.length); i++) {
        results.push('    ' + (i+1) + '. ' + products[i].name + ' — ' + products[i].price + ' грн/кг');
      }
    } else {
      results.push('  ⚠️ Прайс порожній або жодна позиція не пройшла фільтр allowedProducts');
    }
  } catch (e) {
    results.push('  ❌ Помилка читання прайсу: ' + e.toString());
  }
  
  // 3. Проверка адресов ТТ
  results.push('\n🏪 3. ПЕРЕВІРКА АДРЕС ТТ:');
  var storesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  if (storesSheet && storesSheet.getLastRow() > 1) {
    var storesCount = storesSheet.getLastRow() - 1;
    results.push('  ✅ Адрес ТТ: ' + storesCount);
  } else {
    results.push('  ❌ Лист адрес порожній або не знайдено');
  }
  
  // 4. Проверка сырых данных за сегодня
  results.push('\n📦 4. СИРІ ДАНІ ЗА СЬОГОДНІ:');
  var rawSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
  var todayCount = 0;
  var todayStores = {};
  
  if (rawSheet && rawSheet.getLastRow() >= 2) {
    var lastRow = rawSheet.getLastRow();
    var allData = rawSheet.getRange(2, 1, lastRow - 1, 7).getValues();
    var displayDates = rawSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    
    results.push('  Всього рядків у сирих даних: ' + (lastRow - 1));
    
    // Проверяем формат дат
    var dateAsObject = 0;
    var dateAsText = 0;
    var dateAsRawText = 0;
    
    for (var i = 0; i < allData.length; i++) {
      var dateMatch = false;
      var matchType = '';
      
      if (allData[i][0] instanceof Date) {
        dateAsObject++;
        var rowDate = Utilities.formatDate(allData[i][0], Session.getScriptTimeZone(), 'dd.MM.yyyy');
        if (rowDate === today) { dateMatch = true; matchType = 'Date об\'єкт'; }
      }
      
      if (!dateMatch) {
        var displayed = String(displayDates[i][0]).trim();
        if (displayed === today) { dateMatch = true; matchType = 'displayValue'; dateAsText++; }
      }
      
      if (!dateMatch) {
        var rawVal = String(allData[i][0] || '').trim();
        if (rawVal === today) { dateMatch = true; matchType = 'raw текст'; dateAsRawText++; }
      }
      
      if (dateMatch) {
        todayCount++;
        var addr = String(allData[i][2] || '').trim();
        if (addr) {
          if (!todayStores[addr]) todayStores[addr] = 0;
          todayStores[addr]++;
        }
      }
    }
    
    results.push('  Формат дат: Date об\'єкти=' + dateAsObject + ', текстові=' + (dateAsText + dateAsRawText));
    results.push('  Рядків за сьогодні (' + today + '): ' + todayCount);
    
    if (todayCount > 0) {
      results.push('  ТТ із замовленнями сьогодні:');
      Object.keys(todayStores).forEach(function(addr) {
        results.push('    📍 ' + addr + ' — ' + todayStores[addr] + ' позицій');
      });
    }
    
    // Показываем первые 3 строки сырых для отладки
    results.push('\n  Перші 3 рядки сирих даних (для відладки):');
    for (var j = 0; j < Math.min(3, allData.length); j++) {
      var dateType = (allData[j][0] instanceof Date) ? 'Date' : typeof allData[j][0];
      results.push('    Рядок ' + (j+2) + ': дата=[' + displayDates[j][0] + '] тип=[' + dateType + '] адрес=[' + allData[j][2] + '] кількість=[' + allData[j][5] + ']');
    }
    
  } else {
    results.push('  ℹ️ Сирих даних немає');
  }
  
  // 5. Проверка getStoresOrderStatus
  results.push('\n🔄 5. ПЕРЕВІРКА getStoresOrderStatus():');
  try {
    var status = getStoresOrderStatus();
    results.push('  ✅ Доступних ТТ: ' + status.available.length);
    results.push('  ✅ ТТ із замовленнями: ' + status.ordered.length);
    if (status.ordered.length > 0) {
      status.ordered.forEach(function(s) { results.push('    📦 ' + s); });
    }
  } catch (e) {
    results.push('  ❌ Помилка: ' + e.toString());
  }
  
  // 6. Проверка getStoresWithOrdersToday
  results.push('\n🔄 6. ПЕРЕВІРКА getStoresWithOrdersToday():');
  try {
    var storesWithOrders = getStoresWithOrdersToday();
    results.push('  ✅ Розмір Set: ' + storesWithOrders.size);
    if (storesWithOrders.size > 0) {
      storesWithOrders.forEach(function(s) { results.push('    🔑 нормалізовано: "' + s + '"'); });
    }
  } catch (e) {
    results.push('  ❌ Помилка: ' + e.toString());
  }
  
  // 7. Проверка триггеров
  results.push('\n⏰ 7. ПЕРЕВІРКА ТРИГЕРІВ:');
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    results.push('  ⚠️ Тригерів немає! Запустіть updateTrigger()');
  } else {
    triggers.forEach(function(t) {
      results.push('  ✅ ' + t.getHandlerFunction() + ' — тип: ' + t.getEventType() + ', джерело: ' + t.getTriggerSource());
    });
  }
  
  // 8. Проверка scriptProperties
  results.push('\n🔧 8. ПЕРЕВІРКА scriptProperties:');
  var lastProcessed = scriptProperties.getProperty('lastProcessedRowCount_Veg');
  results.push('  lastProcessedRowCount_Veg = ' + (lastProcessed || 'не встановлено'));
  
  // 9. Проверка конфигурации
  results.push('\n⚙️ 9. КОНФІГУРАЦІЯ:');
  results.push('  MIN_ORDER_AMOUNT = ' + MIN_ORDER_AMOUNT + ' грн');
  results.push('  MAX_QUANTITY_PER_PRODUCT = ' + MAX_QUANTITY_PER_PRODUCT + ' кг');
  results.push('  PRICE_SPREADSHEET_ID = ' + PRICE_SPREADSHEET_ID);
  results.push('  HIDDEN_RAW_DATA_SHEET_NAME = ' + HIDDEN_RAW_DATA_SHEET_NAME);
  results.push('  FORMATTED_ORDERS_SHEET_NAME = ' + FORMATTED_ORDERS_SHEET_NAME);
  results.push('  SUMMARY_SHEET_NAME = ' + SUMMARY_SHEET_NAME);
  
  // 10. Тест генерации отчётов
  results.push('\n📊 10. ТЕСТ ГЕНЕРАЦІЇ ЗВІТІВ:');
  try {
    generateFormattedOrdersReport();
    results.push('  ✅ generateFormattedOrdersReport() — OK');
  } catch (e) {
    results.push('  ❌ generateFormattedOrdersReport() — ПОМИЛКА: ' + e.toString());
  }
  try {
    generateSummaryReport();
    results.push('  ✅ generateSummaryReport() — OK');
  } catch (e) {
    results.push('  ❌ generateSummaryReport() — ПОМИЛКА: ' + e.toString());
  }
  
  // 11. Проверка рабочего времени
  results.push('\n🕐 11. РОБОЧИЙ ЧАС:');
  var nowHour = new Date().getHours();
  results.push('  Поточна година: ' + nowHour);
  if (nowHour >= 9 && nowHour < 18) {
    results.push('  ✅ Робочий час — замовлення приймаються');
  } else {
    results.push('  ⚠️ Неробочий час — замовлення заблоковані (9:00-18:00)');
  }
  
  results.push('\n========================================');
  results.push('✅ ДІАГНОСТИКА ЗАВЕРШЕНА');
  results.push('========================================');
  
  var output = results.join('\n');
  console.log(output);
  
  // Также показываем в алерте (урезанную версию)
  try {
    var shortResults = [];
    shortResults.push('📋 Листи: всі ' + (sheetsToCheck.every(function(n) { return ss.getSheetByName(n); }) ? '✅' : '❌'));
    shortResults.push('💰 Прайс: ' + (products && products.length > 0 ? products.length + ' позицій ✅' : '❌'));
    shortResults.push('🏪 ТТ: ' + (storesSheet ? (storesSheet.getLastRow() - 1) : 0));
    shortResults.push('📦 Замовлень сьогодні: ' + todayCount + ' рядків, ' + Object.keys(todayStores).length + ' ТТ');
    shortResults.push('⏰ Тригери: ' + triggers.length);
    shortResults.push('🕐 Робочий час: ' + (nowHour >= 9 && nowHour < 18 ? 'ТАК' : 'НІ') + ' (' + nowHour + ':00)');
    shortResults.push('\nДетальний лог — у консолі (Ctrl+Enter → Журнал виконання)');
    
    SpreadsheetApp.getUi().alert('🔍 Діагностика', shortResults.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // Если запущено не из UI
  }
}
function debugFullChain() {
  // 1. Что на листе Налаштування
  var allowed = getAllowedProductsList();
  console.log('📋 Дозволені позиції (' + allowed.length + '):');
  allowed.forEach(function(name, i) {
    console.log('  ' + (i+1) + '. ' + name);
  });
  
  // 2. Что возвращает getPricesFromExternalSheet
  var products = getPricesFromExternalSheet();
  console.log('\n💰 Товари з прайсу (' + products.length + '):');
  products.forEach(function(p, i) {
    console.log('  ' + (i+1) + '. ' + p.name + ' — постачальник: ' + p.supplierPrice + ', продажна: ' + p.displayPrice);
  });
  
  // 3. Что возвращает getInitialFormData
  var formData = getInitialFormData();
  console.log('\n📦 getInitialFormData():');
  console.log('  stores: ' + formData.stores.length);
  console.log('  products: ' + formData.products.length);
  console.log('  minOrderAmount: ' + formData.minOrderAmount);
  
  if (formData.products.length > 0) {
    console.log('\n  Перші 3 товари що йдуть в форму:');
    for (var i = 0; i < Math.min(3, formData.products.length); i++) {
      var p = formData.products[i];
      console.log('    ' + p.name + ' — displayPrice: ' + p.displayPrice + ', supplierPrice: ' + p.supplierPrice);
    }
  }
}
function debugSettingsSheet() {
  var ss = getSpreadsheet();
  var settingsSheet = ss.getSheetByName('Налаштування');
  
  if (!settingsSheet) {
    console.log('❌ Лист "Налаштування" не знайдено!');
    return;
  }
  
  var lastRow = settingsSheet.getLastRow();
  console.log('📋 Лист "Налаштування": ' + lastRow + ' рядків');
  
  if (lastRow < 2) {
    console.log('⚠️ Лист порожній (немає даних)');
    return;
  }
  
  // Читаємо всі дані
  var data = settingsSheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
  
  var active = [];
  var stopped = [];
  var empty = [];
  
  for (var i = 0; i < data.length; i++) {
    var name = String(data[i][0] || '').trim();
    var status = String(data[i][1] || '').trim().toLowerCase();
    
    if (!name) { empty.push(i + 2); continue; }
    
    if (status === 'стоп') {
      stopped.push(name);
    } else {
      active.push(name);
    }
  }
  
  console.log('\n✅ Активні позиції (' + active.length + '):');
  active.forEach(function(n, i) { console.log('  ' + (i+1) + '. ' + n); });
  
  console.log('\n🚫 Зупинені (стоп) позиції (' + stopped.length + '):');
  stopped.forEach(function(n, i) { console.log('  ' + (i+1) + '. ' + n); });
  
  if (empty.length) console.log('\n⚠️ Пусті рядки: ' + empty.join(', '));
  
  // Тепер перевіримо що повертає getAllowedProductsList()
  var allowed = getAllowedProductsList();
  console.log('\n📦 getAllowedProductsList() повертає ' + allowed.length + ' позицій:');
  allowed.forEach(function(n, i) { console.log('  ' + (i+1) + '. ' + n); });
  
  // Порівняння
  if (active.length !== allowed.length) {
    console.log('\n⚠️ РОЗБІЖНІСТЬ: активних у листі ' + active.length + ', повертає функція ' + allowed.length);
  } else {
    console.log('\n✅ Кількість збігається');
  }
}
function checkDateType() {
  var raw = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var v = raw.getRange(2, 1).getValue();
  console.log('Тип дати: ' + (v instanceof Date ? 'DATE' : 'TEXT') + ', значення: ' + v);
}
function getInitialFormData() {
  try {
    var t0 = Date.now();
    ensureSheetsExist();
    var t1 = Date.now();
    const storesStatus = getStoresOrderStatus();
    var t2 = Date.now();
    const products = getPricesFromExternalSheet();
    var t3 = Date.now();
    console.log('ensureSheets: ' + (t1-t0) + 'ms | stores: ' + (t2-t1) + 'ms | prices: ' + (t3-t2) + 'ms');
    return {
      stores: storesStatus.available,
      storesWithOrders: storesStatus.ordered,
      products: products,
      minOrderAmount: MIN_ORDER_AMOUNT_DISPLAY
    };
  } catch (error) {
    console.error('КРИТИЧНА ПОМИЛКА getInitialFormData: ' + error.toString());
    return { stores: [], storesWithOrders: [], products: [], minOrderAmount: MIN_ORDER_AMOUNT_DISPLAY };
  }
}
function diagStores() {
  var ss = getSpreadsheet();
  var raw = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var stores = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
  console.log('Лист заказів _Сырые: рядків = ' + (raw ? raw.getLastRow() : 'НЕМАЄ') + ', колонок = ' + (raw ? raw.getLastColumn() : '-'));
  console.log('Лист адрес ТТ: рядків = ' + (stores ? stores.getLastRow() : 'НЕМАЄ'));

  var t1 = Date.now();
  var s = getStoresWithOrdersToday();
  var t2 = Date.now();
  console.log('getStoresWithOrdersToday: ' + (t2-t1) + 'ms, знайдено ТТ із замовленнями сьогодні: ' + s.size);
}
