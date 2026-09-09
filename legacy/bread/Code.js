// --- КОНФИГУРАЦИЯ ---
const SPREADSHEET_ID = '1QJca7XlvZbIWfEIyxBxC64dSD6RkrlWoZOSmem2tix4';
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
const ROUTES_STORES_SHEET_NAME = 'Маршруты и Магазины';
const PRODUCTS_SHEET_NAME = 'Ассортимент';
const ORDERS_DATA_SHEET_NAME = 'Данные Заказов';
const FORMATTED_ORDERS_SHEET_NAME = 'Заказы'; // Новый лист для форматированных заказов
const HIDDEN_RAW_DATA_SHEET_NAME = '_Сырые_Заказы';
const MIN_ORDER_AMOUNT = 350;
const ORDER_TIMEOUT_MS = 5000;
const EDRPOU_CODE = '44413718'; // Единый код ЭДРПОУ для всех
const MAX_QUANTITY_PER_PRODUCT = 1000;
const MAX_PRODUCTS_PER_ORDER = 500;

// --- КОНЕЦ КОНФИГУРАЦИИ ---

const scriptProperties = PropertiesService.getScriptProperties();

/**
 * @overview Получает активную таблицу (оптимизированный доступ)
 */
function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function formatDateDMY(date) {
  return String(date.getDate()).padStart(2,'0') + '.' +
         String(date.getMonth()+1).padStart(2,'0') + '.' +
         date.getFullYear();
}

// ===================== КЕШ СПРАВОЧНИКОВ =====================
const CACHE_TTL_SEC = 600; // 10 минут

function getCache_() { return CacheService.getScriptCache(); }

/** Универсальное чтение с кешем. loader() вызывается только при промахе кеша. */
function cached_(key, loader) {
  const cache = getCache_();
  const hit = cache.get(key);
  if (hit !== null) {
    try { return JSON.parse(hit); } catch (e) {}
  }
  const data = loader();
  try { cache.put(key, JSON.stringify(data), CACHE_TTL_SEC); } catch (e) {}
  return data;
}

/** Сбрасывает кеш справочников (вызывать при ручном изменении листов). */
function invalidateRefCache_() {
  getCache_().removeAll(['ref_products', 'ref_stores', 'ref_routes', 'ref_storeNumbers', 'ref_barcodes']);
}

/** Сбрасывает кеш заказанных сегодня магазинов (после нового заказа/удаления). */
function invalidateOrdersCache_() {
  getCache_().remove('orders_today_stores');
}

function getStoreNumber(storeAddress) {
  try {
    const ss = getSpreadsheet();
    const routesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
    
    if (!routesSheet || routesSheet.getLastRow() < 2) {
      return '';
    }
    
    // Получаем данные: Маршрут, Адрес ТТ, Обліковий номер
    const data = routesSheet.getRange(2, 1, routesSheet.getLastRow() - 1, 3).getValues();
    const normalizedInput = normalizeAddress(storeAddress, false);
    
    for (let i = 0; i < data.length; i++) {
      const storeFromSheet = String(data[i][1]);
      const storeNumber = String(data[i][2] || '');
      const normalizedFromSheet = normalizeAddress(storeFromSheet, false);
      
      if (normalizedFromSheet === normalizedInput) {
        return storeNumber;
      }
    }
    
    return '';
    
  } catch (error) {
    console.error('Ошибка получения номера магазина: ' + error.toString());
    return '';
  }
}

/**
 * @overview Генерирует форматированный отчет по заказам (оптимизированная версия)
 */
function generateFormattedOrdersReport() {
  const reportLock = LockService.getScriptLock();
  reportLock.waitLock(45000);
  
  try {
    const ss = getSpreadsheet();
    const rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    let ordersSheet = ss.getSheetByName(FORMATTED_ORDERS_SHEET_NAME);
    
    if (!ordersSheet) {
      ordersSheet = ss.insertSheet(FORMATTED_ORDERS_SHEET_NAME);
    } else {
      ordersSheet.clearContents().clearFormats();
    }
    
    if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
      ordersSheet.getRange('A1').setValue('Нет данных для отчета.');
      return;
    }
    
    const today = new Date();
    const todayFormatted = formatDateDMY(today);
    const allRawData = rawOrderSheet.getRange(2, 1, rawOrderSheet.getLastRow() - 1, rawOrderSheet.getLastColumn()).getValues();
    
    const rawDataFilteredByDate = allRawData.filter(row => {
      const timestamp = row[0];
      if (timestamp instanceof Date) {
        const rowDateFormatted = formatDateDMY(timestamp);
        return rowDateFormatted === todayFormatted;
      }
      return false;
    });
    
    if (rawDataFilteredByDate.length === 0) {
      ordersSheet.getRange('A1').setValue(`Нет заказов на ${todayFormatted}.`);
      return;
    }
    
    // Кешируем номера магазинов — один запрос вместо множества
    const storeNumbersMap = getStoreNumbersMap();
    
    const ordersByRouteAndStore = {};
    
    rawDataFilteredByDate.forEach(row => {
      const route = row[1];
      const storeName = row[2];
      const barcode = String(row[3]);
      const productName = row[4];
      const quantity = row[6];
      
      if (!barcode || !storeName || quantity === null || quantity === '') return;
      
      const numericQuantity = parseFloat(String(quantity).replace(',', '.'));
      if (isNaN(numericQuantity)) return;
      
      const key = `${route}|||${storeName}`;
      
      if (!ordersByRouteAndStore[key]) {
        ordersByRouteAndStore[key] = {
          route: route,
          store: storeName,
          storeNumber: storeNumbersMap[normalizeAddress(storeName, false)] || '',
          products: []
        };
      }
      
      ordersByRouteAndStore[key].products.push({
        barcode: barcode,
        name: productName,
        quantity: numericQuantity
      });
    });
    
    const sortedKeys = Object.keys(ordersByRouteAndStore).sort((a, b) => {
      const [routeA, storeA] = a.split('|||');
      const [routeB, storeB] = b.split('|||');
      
      if (routeA !== routeB) {
        return routeA.localeCompare(routeB, 'uk');
      }
      return storeA.localeCompare(storeB, 'uk');
    });
    
    // Формируем данные для отчета
    const headers = ['Дата заказа', 'Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Количество', 'Код ЄДРПОУ', 'Номер магазина'];
    const reportData = [headers];
    
    sortedKeys.forEach((key) => {
      const order = ordersByRouteAndStore[key];
      order.products.sort((a, b) => a.barcode.localeCompare(b.barcode));
      
      // СНАЧАЛА добавляем строку с ЄДРПОУ и номером магазина
      reportData.push([
        '', 
        '', 
        '', 
        '', 
        '', 
        '', 
        EDRPOU_CODE,
        order.storeNumber
      ]);
      
      // ПОТОМ добавляем продукты магазина
      order.products.forEach((product) => {
        reportData.push([
          todayFormatted,
          order.route,
          order.store,
          product.barcode,
          product.name,
          product.quantity,
          '',
          ''
        ]);
      });
    });
    
    // Записываем данные
    if (reportData.length > 1) {
      ordersSheet.getRange(1, 1, reportData.length, headers.length).setValues(reportData);
      
      // === ФОРМАТИРОВАНИЕ ШТРИХ-КОДОВ ===
      ordersSheet.getRange(1, 4, reportData.length, 1).setNumberFormat('@');
      
      // === ФОРМАТИРОВАНИЕ ЗАГОЛОВКОВ ===
      ordersSheet.getRange(1, 1, 1, headers.length)
        .setBackground('#FFFF00')
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
      
      // === ФОРМАТИРОВАНИЕ ВСЕХ ДАННЫХ ОДНИМ ВЫЗОВОМ ===
      const dataRange = ordersSheet.getRange(2, 1, reportData.length - 1, headers.length);
      dataRange
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
      
      // === ПАКЕТНОЕ ФОРМАТИРОВАНИЕ ЖИРНЫМ ШРИФТОМ ===
      const boldRangeNotations = [];
      let currentRow = 2;
      
      sortedKeys.forEach((key) => {
        const order = ordersByRouteAndStore[key];
        const productsCount = order.products.length;
        
        // ЄДРПОУ и номер магазина (колонки G и H)
        boldRangeNotations.push(
          ordersSheet.getRange(currentRow, 7, 1, 2).getA1Notation()
        );
        
        // Продукты магазина
        if (productsCount > 0) {
          boldRangeNotations.push(
            ordersSheet.getRange(currentRow + 1, 1, productsCount, headers.length).getA1Notation()
          );
        }
        
        currentRow += productsCount + 1;
      });
      
      // Применяем жирный шрифт одним вызовом
      if (boldRangeNotations.length > 0) {
        ordersSheet.getRangeList(boldRangeNotations).setFontWeight('bold');
      }
      
      // === ВЫРАВНИВАНИЕ КОЛОНОК ОДНИМ БЛОКОМ ===
      const centerColumns = [1, 6, 7, 8]; // Дата, Количество, ЄДРПОУ, Номер магазина
      const centerNotations = centerColumns.map(col => 
        ordersSheet.getRange(2, col, reportData.length - 1, 1).getA1Notation()
      );
      ordersSheet.getRangeList(centerNotations).setHorizontalAlignment('center');
      
      // === ФИКСИРОВАННАЯ ШИРИНА КОЛОНОК ===
      const columnWidths = [110, 120, 200, 150, 400, 100, 110, 130];
      columnWidths.forEach((width, index) => {
        ordersSheet.setColumnWidth(index + 1, width);
      });
      
      ordersSheet.setFrozenRows(1);
    }
    
    console.log('Форматированный отчет по заказам создан.');
    
  } catch (error) {
    console.error('Ошибка генерации форматированного отчета: ' + error.toString());
    logError('generateFormattedOrdersReport', error, {});
  } finally {
    reportLock.releaseLock();
  }
}

/**
 * @overview Генерирует сводный отчет (добавлен Lock для защиты от параллельного запуска)
 */
function generateSummaryReport() {
  var reportLock = LockService.getScriptLock();
  reportLock.waitLock(45000);
  
  try {
    // ... ВСЁ ТЕЛО ФУНКЦИИ generateSummaryReport ОСТАЁТСЯ КАК ЕСТЬ ...
    // Только оберните его в этот try/finally
    
    var ss = getSpreadsheet();
    var rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    var reportSheet = ss.getSheetByName(ORDERS_DATA_SHEET_NAME);
    
    if (!reportSheet) {
      reportSheet = ss.insertSheet(ORDERS_DATA_SHEET_NAME);
    } else {
      reportSheet.clearContents().clearFormats();
    }
    
    if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
      reportSheet.getRange('A1').setValue('Нет данных для сводного отчета.');
      return;
    }
    
    var today = new Date();
    var todayFormatted = formatDateDMY(today);
    var allRawData = rawOrderSheet.getRange(2, 1, rawOrderSheet.getLastRow() - 1, rawOrderSheet.getLastColumn()).getValues();
    
    var rawDataFilteredByDate = allRawData.filter(function(row) {
      var timestamp = row[0];
      if (timestamp instanceof Date) {
        var rowDateFormatted = formatDateDMY(timestamp);
        return rowDateFormatted === todayFormatted;
      }
      return false;
    });
    
    if (rawDataFilteredByDate.length === 0) {
      reportSheet.getRange('A1').setValue('Нет заказов на ' + todayFormatted + '.');
      return;
    }
    
    var ordersByRouteAndStore = {};
    var totalByBarcode = {};
    
    rawDataFilteredByDate.forEach(function(row) {
      var route = row[1];
      var storeName = row[2];
      var barcode = String(row[3]);
      var productName = row[4];
      var quantity = row[6];
      
      if (!barcode || !storeName || quantity === null || quantity === '') return;
      
      var numericQuantity = parseFloat(String(quantity).replace(',', '.'));
      if (isNaN(numericQuantity)) return;
      
      var key = route + '|||' + storeName;
      
      if (!ordersByRouteAndStore[key]) {
        ordersByRouteAndStore[key] = {
          route: route,
          store: storeName,
          products: []
        };
      }
      
      ordersByRouteAndStore[key].products.push({
        barcode: barcode,
        name: productName,
        quantity: numericQuantity
      });
      
      if (!totalByBarcode[barcode]) {
        totalByBarcode[barcode] = {
          name: productName,
          totalQuantity: 0
        };
      }
      totalByBarcode[barcode].totalQuantity += numericQuantity;
    });
    
    var sortedKeys = Object.keys(ordersByRouteAndStore).sort(function(a, b) {
      var partsA = a.split('|||');
      var partsB = b.split('|||');
      if (partsA[0] !== partsB[0]) return partsA[0].localeCompare(partsB[0], 'uk');
      return partsA[1].localeCompare(partsB[1], 'uk');
    });
    
    var headers = ['Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Количество'];
    var reportData = [headers];
    
    sortedKeys.forEach(function(key) {
      var order = ordersByRouteAndStore[key];
      order.products.sort(function(a, b) { return a.barcode.localeCompare(b.barcode); });
      
      order.products.forEach(function(product) {
        reportData.push([
          order.route,
          order.store,
          product.barcode,
          product.name,
          product.quantity
        ]);
      });
      
      reportData.push(['', '', '', '', '']);
    });
    
    if (reportData.length > 1) {
      reportSheet.getRange(1, 1, reportData.length, reportData[0].length).setValues(reportData);
      
      var barcodeColumn = reportSheet.getRange(1, 3, reportData.length, 1);
      barcodeColumn.setNumberFormat('@');
      
      var headerRange = reportSheet.getRange(1, 1, 1, headers.length);
      headerRange
        .setBackground('#FFFF00')
        .setFontWeight('bold')
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
      
      var dataRange = reportSheet.getRange(2, 1, reportData.length - 1, headers.length);
      dataRange
        .setHorizontalAlignment('left')
        .setVerticalAlignment('middle')
        .setBorder(true, true, true, true, true, true);
      
      reportSheet.getRange(2, 5, reportData.length - 1, 1).setHorizontalAlignment('center');
      
      reportSheet.setColumnWidth(1, 120);
      reportSheet.setColumnWidth(2, 200);
      reportSheet.setColumnWidth(3, 150);
      reportSheet.setColumnWidth(4, 400);
      reportSheet.setColumnWidth(5, 100);
    }
    
    // === ИТОГОВАЯ СВОДКА ===
    var summaryStartRow = reportData.length + 3;
    
    reportSheet.getRange(summaryStartRow, 1, 1, 5).merge()
      .setValue('ИТОГОВАЯ СВОДКА ПО ПРОДУКТАМ')
      .setBackground('#4CAF50')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    
    var summaryHeaders = ['Штрих-код', 'Название Продукта', 'Общее Количество'];
    var summaryData = [summaryHeaders];
    
    var sortedBarcodes = Object.keys(totalByBarcode).sort();
    
    sortedBarcodes.forEach(function(barcode) {
      summaryData.push([
        barcode,
        totalByBarcode[barcode].name,
        totalByBarcode[barcode].totalQuantity
      ]);
    });
    
    var totalItems = sortedBarcodes.reduce(function(sum, barcode) {
      return sum + totalByBarcode[barcode].totalQuantity;
    }, 0);
    
    summaryData.push(['', '**ВСЕГО:**', totalItems]);
    
    var summaryTableStartRow = summaryStartRow + 1;
    reportSheet.getRange(summaryTableStartRow, 1, summaryData.length, summaryHeaders.length)
      .setValues(summaryData);
    
    var summaryBarcodeColumn = reportSheet.getRange(summaryTableStartRow, 1, summaryData.length, 1);
    summaryBarcodeColumn.setNumberFormat('@');
    
    var summaryHeaderRange = reportSheet.getRange(summaryTableStartRow, 1, 1, summaryHeaders.length);
    summaryHeaderRange
      .setBackground('#FFC107')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true);
    
    var summaryDataRange = reportSheet.getRange(summaryTableStartRow + 1, 1, summaryData.length - 1, summaryHeaders.length);
    summaryDataRange
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, true, true);
    
    reportSheet.getRange(summaryTableStartRow + 1, 3, summaryData.length - 1, 1)
      .setHorizontalAlignment('center');
    
    var totalRowRange = reportSheet.getRange(summaryTableStartRow + summaryData.length - 1, 1, 1, summaryHeaders.length);
    totalRowRange
      .setBackground('#E0E0E0')
      .setFontWeight('bold')
      .setFontSize(11)
      .setBorder(true, true, true, true, true, true);
    
    reportSheet.setColumnWidth(1, 150);
    reportSheet.setColumnWidth(2, 400);
    reportSheet.setColumnWidth(3, 150);
    
    reportSheet.setFrozenRows(1);
    
    console.log('Сводный отчет с итоговой сводкой обновлен.');
    
  } catch (error) {
    console.error('Ошибка генерации отчета: ' + error.toString());
    logError('generateSummaryReport', error, {});
  } finally {
    reportLock.releaseLock();
  }
}

/**
 * @overview Записывает данные заказа в таблицу (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)
 */
function recordOrder(orderData) {
  try {
    if (isDuplicateOrder(orderData.selectedStore)) {
      throw new Error('Заказ уже обрабатывается. Пожалуйста, подождите несколько секунд перед повторной отправкой.');
    }
    
    const storesWithOrders = getStoresWithOrdersToday();
    const normalizedStore = normalizeAddress(orderData.selectedStore, false);
    if (storesWithOrders.has(normalizedStore)) {
      throw new Error(`Магазин "${orderData.selectedStore}" уже сделал заказ сегодня. Повторный заказ не возможен.`);
    }
    
    validateOrder(orderData);
    
    if (orderData.totalOrderSum < MIN_ORDER_AMOUNT) {
      const missingAmount = (MIN_ORDER_AMOUNT - orderData.totalOrderSum).toFixed(2);
      throw new Error(`ЗАКАЗ НЕ ПРИНЯТ! Сумма ${orderData.totalOrderSum.toFixed(2)} грн меньше минимальной (${MIN_ORDER_AMOUNT} грн). Не хватает ${missingAmount} грн.`);
    }
    
    if (!orderData.products || orderData.products.length === 0) {
      throw new Error(`Ваш заказ не содержит позиций. Пожалуйста, заполните количество.`);
    }
    
    const ss = getSpreadsheet();
    let rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    const headers = ['Отметка времени', 'Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Цена Продукта', 'Количество'];
    
    if (!rawOrderSheet) {
      rawOrderSheet = ss.insertSheet(HIDDEN_RAW_DATA_SHEET_NAME);
      rawOrderSheet.appendRow(headers);
      rawOrderSheet.hideSheet();
    }
    
    const timestamp = new Date();
    const route = getRouteForStoreInternal(orderData.selectedStore);
    
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      
      invalidateOrdersCache_();
      const storesWithOrdersAfterLock = getStoresWithOrdersToday();
      if (storesWithOrdersAfterLock.has(normalizedStore)) {
        throw new Error(`Магазин "${orderData.selectedStore}" уже сделал заказ сегодня.`);
      }
      
      const rows = orderData.products.map(function(productOrder) {
        return [
          timestamp,
          route,
          orderData.selectedStore,
          productOrder.barcode,
          productOrder.name,
          productOrder.price,
          productOrder.quantity
        ];
      });
      
      var lastRow = rawOrderSheet.getLastRow();
      rawOrderSheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);
      
    } finally {
      lock.releaseLock();
    }
    
       SpreadsheetApp.flush();
    invalidateOrdersCache_();

    // Пробуем построить отчёты сразу, но без ожидания в очереди
    const reportLock = LockService.getScriptLock();
    if (reportLock.tryLock(0)) {
      try {
        do {
          scriptProperties.deleteProperty('reportsDirty'); // сбрасываем флаг ПЕРЕД сборкой
          invalidateOrdersCache_();
          generateSummaryReport();
          generateFormattedOrdersReport();
        } while (scriptProperties.getProperty('reportsDirty') === '1'); // пока есть новые заказы
      } catch (e) {
        console.error('Ошибка генерации отчётов после заказа: ' + e.toString());
        scheduleReportRebuild_(); // на всякий случай отложенная пересборка
      } finally {
        reportLock.releaseLock();
      }
    } else {
      // Лок занят — кто-то уже строит отчёты. Помечаем, что есть новые данные.
      scriptProperties.setProperty('reportsDirty', '1');
      scheduleReportRebuild_(); // страховка, если первый поток уже завершился
    }

    return `Ваш заказ на сумму ${orderData.totalOrderSum.toFixed(2)} грн успешно принят. Спасибо!`;
    
  } catch (error) {
    logError('recordOrder', error, {
      store: orderData.selectedStore,
      productsCount: orderData.products ? orderData.products.length : 0,
      totalSum: orderData.totalOrderSum
    });
    
    console.error('Ошибка записи заказа: ' + error.toString());
    throw error;
  }
}
    

function generateReportsAsync() {
  try {
    withRetry(() => {
      const ss = getSpreadsheet();
      const rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
      
      if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
        return;
      }
      
      const currentRowCount = rawOrderSheet.getLastRow();
      const lastProcessedCount = scriptProperties.getProperty('lastProcessedRowCount');
      
      if (lastProcessedCount && parseInt(lastProcessedCount) === currentRowCount) {
        return;
      }
      
      generateSummaryReport();
      generateFormattedOrdersReport();
      
      scriptProperties.setProperty('lastProcessedRowCount', currentRowCount.toString());
      console.log('Отчеты сгенерированы. Строк: ' + currentRowCount);
    });
    
  } catch (error) {
    logError('generateReportsAsync', error, {});
    console.error('Ошибка генерации отчетов: ' + error.toString());
  }
}

function normalizeAddress(address, preserveCase = true) {
  if (!address || typeof address !== 'string') {
    return '';
  }
  
  let cleaned = String(address).trim();
  cleaned = cleaned.replace(/^(м|г|місто|город)\.?\s*харк(о|і)в\s*,?\s*/i, '');
  cleaned = cleaned.replace(/^(вул|ул|улиця|пр-т|проспект|пл|площа|пров|провулок)\.?\s*/i, '');
  cleaned = cleaned.trim();
  
  if (preserveCase && cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  } else if (!preserveCase) {
    cleaned = cleaned.toLowerCase();
  }
  
  return cleaned;
}

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Заказ хлеба ЧП Рома')
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
}

function getSheetDataInternal(sheetName, startRow, startCol, numCols) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      console.error('Ошибка: Лист "' + sheetName + '" не найден.');
      return [];
    }
    
    if (sheet.getLastRow() < startRow) {
      console.log('Лист "' + sheetName + '" не содержит данных начиная со строки ' + startRow);
      return [];
    }
    
    const data = sheet.getRange(startRow, startCol, sheet.getLastRow() - startRow + 1, numCols).getValues();
    console.log('Получено строк из листа "' + sheetName + '": ' + data.length);
    return data;
    
  } catch (error) {
    console.error('Ошибка при чтении листа "' + sheetName + '": ' + error.toString());
    return [];
  }
}

function getStoresWithOrdersToday() {
  try {
    const arr = cached_('orders_today_stores', function() {
      const ss = getSpreadsheet();
      const rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
      if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) return [];
      const todayFormatted = formatDateDMY(new Date());
      const allRawData = rawOrderSheet.getRange(2, 1, rawOrderSheet.getLastRow() - 1, 3).getValues();
      const set = [];
      const seen = {};
      allRawData.forEach(row => {
        const timestamp = row[0];
        const storeAddress = row[2];
        if (timestamp instanceof Date) {
          const rowDateFormatted = formatDateDMY(timestamp);
          if (rowDateFormatted === todayFormatted && storeAddress) {
            const norm = normalizeAddress(storeAddress, false);
            if (!seen[norm]) { seen[norm] = true; set.push(norm); }
          }
        }
      });
      return set;
    });
    return new Set(arr);
  } catch (error) {
    console.error('Ошибка при получении магазинов с заказами: ' + error.toString());
    return new Set();
  }
}

function getAllStoresForClient() {
  try {
    const data = getSheetDataInternal(ROUTES_STORES_SHEET_NAME, 2, 2, 1);
    if (data.length === 0) {
      console.log('Нет данных о магазинах');
      return [];
    }
    
    const storesWithOrders = getStoresWithOrdersToday();
    
    const stores = data
      .flat()
      .filter(address => address && String(address).trim() !== '')
      .map(address => normalizeAddress(address, true))
      .filter(address => {
        const normalizedForComparison = normalizeAddress(address, false);
        return !storesWithOrders.has(normalizedForComparison);
      });
    
    const uniqueStores = [...new Set(stores)].sort();
    console.log('Доступных магазинов: ' + uniqueStores.length);
    return uniqueStores;
    
  } catch (error) {
    console.error('Ошибка в getAllStoresForClient: ' + error.toString());
    return [];
  }
}

function getStoresOrderStatus() {
  try {
    const data = getSheetDataInternal(ROUTES_STORES_SHEET_NAME, 2, 2, 1);
    if (data.length === 0) {
      return { available: [], ordered: [] };
    }
    
    const storesWithOrders = getStoresWithOrdersToday();
    const allStores = data
      .flat()
      .filter(address => address && String(address).trim() !== '')
      .map(address => normalizeAddress(address, true));
    const uniqueStores = [...new Set(allStores)];
    
    const available = [];
    const ordered = [];
    
    uniqueStores.forEach(store => {
      const normalizedForComparison = normalizeAddress(store, false);
      if (storesWithOrders.has(normalizedForComparison)) {
        ordered.push(store);
      } else {
        available.push(store);
      }
    });
    
    console.log('Статус магазинов - доступно: ' + available.length + ', с заказами: ' + ordered.length);
    
    return { 
      available: available.sort(), 
      ordered: ordered.sort() 
    };
    
  } catch (error) {
    console.error('Ошибка в getStoresOrderStatus: ' + error.toString());
    return { available: [], ordered: [] };
  }
}

function getAllProductsForClient() {
  try {
    return cached_('ref_products', function() {
      const data = getSheetDataInternal(PRODUCTS_SHEET_NAME, 2, 1, 6);
      if (data.length === 0) return [];
      return data
        .filter(row => {
          const status = String(row[0] || '').toLowerCase().trim();
          return status !== 'стоп' && status !== '#' && row[2];
        })
        .map(row => ({
          barcode: String(row[2] || ''),
          name: String(row[4] || 'Без названия'),
          price: parseFloat(String(row[3] || '0').replace(',', '.')) || 0,
          quantityInBox: String(row[5] || '')
        }))
        .filter(product => product.barcode);
    });
  } catch (error) {
    console.error('Ошибка в getAllProductsForClient: ' + error.toString());
    return [];
  }
}

function getInitialFormData() {
  try {
    console.log('Начинаем загрузку данных для формы...');
    
    const storesStatus = getStoresOrderStatus();
    const products = getAllProductsForClient();
    
    const result = { 
      stores: storesStatus.available,
      storesWithOrders: storesStatus.ordered,
      products: products 
    };
    
    console.log('Данные успешно загружены. Магазинов: ' + result.stores.length + ', Продуктов: ' + result.products.length);
    
    return result;
    
  } catch (error) {
    console.error('КРИТИЧЕСКАЯ ОШИБКА в getInitialFormData: ' + error.toString());
    return {
      stores: [],
      storesWithOrders: [],
      products: []
    };
  }
}

function getRouteForStoreInternal(storeAddress) {
  try {
    const routesArr = cached_('ref_routes', function() {
      return getSheetDataInternal(ROUTES_STORES_SHEET_NAME, 2, 1, 2);
    });
    if (!routesArr || routesArr.length === 0) return 'Неизвестный маршрут';
    const normalizedInput = normalizeAddress(storeAddress, false);
    for (let i = 0; i < routesArr.length; i++) {
      if (normalizeAddress(String(routesArr[i][1]), false) === normalizedInput) {
        return routesArr[i][0];
      }
    }
    return 'Неизвестный маршрут';
  } catch (error) {
    console.error('Ошибка в getRouteForStoreInternal: ' + error.toString());
    return 'Неизвестный маршрут';
  }
}

function isDuplicateOrder(storeAddress) {
  const lastOrderKey = `lastOrder_${storeAddress}`;
  const lastOrderTime = scriptProperties.getProperty(lastOrderKey);
  
  if (lastOrderTime) {
    const timeDiff = Date.now() - parseInt(lastOrderTime);
    if (timeDiff < ORDER_TIMEOUT_MS) {
      return true;
    }
  }
  
  scriptProperties.setProperty(lastOrderKey, Date.now().toString());
  cleanupOldOrderRecords();
  
  return false;
}

function cleanupOldOrderRecords() {
  try {
    const allProperties = scriptProperties.getProperties();
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    for (let key in allProperties) {
      if (key.startsWith('lastOrder_')) {
        const timestamp = parseInt(allProperties[key]);
        if (timestamp < oneDayAgo) {
          scriptProperties.deleteProperty(key);
        }
      }
    }
  } catch (error) {
    console.error('Ошибка очистки старых записей: ' + error.toString());
  }
}
/**
 * @overview Записывает ошибки в специальный лог
 */
function logError(functionName, error, additionalInfo = {}) {
  try {
    const ss = getSpreadsheet();
    let errorLog = ss.getSheetByName('_Лог_Ошибок');
    
    if (!errorLog) {
      errorLog = ss.insertSheet('_Лог_Ошибок');
      errorLog.appendRow(['Дата и время', 'Функция', 'Ошибка', 'Дополнительная информация', 'Stack Trace']);
      errorLog.hideSheet();
      
      // Форматирование заголовков
      const headerRange = errorLog.getRange(1, 1, 1, 5);
      headerRange.setBackground('#FF0000')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
    }
    
    errorLog.appendRow([
      new Date(),
      functionName,
      error.toString(),
      JSON.stringify(additionalInfo),
      error.stack || 'Нет stack trace'
    ]);
    
    // Автоподбор ширины колонок
    errorLog.autoResizeColumns(1, 5);
    
  } catch (e) {
    console.error('Не удалось записать ошибку в лог:', e);
  }
}

/**
 * @overview Проверяет, существует ли штрих-код в ассортименте
 */
function validateBarcode(barcode) {
  try {
    const data = getSheetDataInternal(PRODUCTS_SHEET_NAME, 2, 1, 6);
    if (data.length === 0) {
      return false;
    }
    
    return data.some(row => {
      const status = String(row[0] || '').toLowerCase().trim();
      return status !== 'стоп' && 
             status !== '#' && 
             String(row[2]) === String(barcode);
    });
  } catch (error) {
    logError('validateBarcode', error, { barcode: barcode });
    return false;
  }
}

/**
 * @overview Валидирует весь заказ перед записью (ОПТИМИЗИРОВАННАЯ — один раз читает ассортимент)
 */
function validateOrder(orderData) {
  if (orderData.products.length > MAX_PRODUCTS_PER_ORDER) {
    throw new Error(`Максимальное количество позиций в заказе: ${MAX_PRODUCTS_PER_ORDER}. У вас: ${orderData.products.length}`);
  }
  
  // Загружаем ассортимент ОДИН РАЗ
  const validBarcodes = getValidBarcodesSet();
  
  const invalidProducts = [];
  const invalidBarcodes = [];
  
  orderData.products.forEach(function(product) {
    if (product.quantity > MAX_QUANTITY_PER_PRODUCT) {
      invalidProducts.push(`${product.name}: ${product.quantity} шт (макс. ${MAX_QUANTITY_PER_PRODUCT})`);
    }
    
    if (product.quantity <= 0) {
      invalidProducts.push(`${product.name}: некорректное количество (${product.quantity})`);
    }
    
    if (!validBarcodes.has(String(product.barcode))) {
      invalidBarcodes.push(`${product.name} (штрих-код: ${product.barcode})`);
    }
  });
  
  if (invalidProducts.length > 0) {
    throw new Error(`Некорректное количество для продуктов:\n${invalidProducts.join('\n')}`);
  }
  
  if (invalidBarcodes.length > 0) {
    throw new Error(`Следующие продукты не найдены в ассортименте:\n${invalidBarcodes.join('\n')}\n\nВозможно, они были удалены из каталога.`);
  }
  
  return true;
}

/**
 * @overview Возвращает Set валидных штрих-кодов (один запрос к листу)
 */
function getValidBarcodesSet() {
  const arr = cached_('ref_barcodes', function() {
    var data = getSheetDataInternal(PRODUCTS_SHEET_NAME, 2, 1, 6);
    var list = [];
    data.forEach(function(row) {
      var status = String(row[0] || '').toLowerCase().trim();
      if (status !== 'стоп' && status !== '#' && row[2]) list.push(String(row[2]));
    });
    return list;
  });
  return new Set(arr);
}
/**
 * @overview Генерирует ссылку для экспорта листа в Excel
 * @param {string} sheetName Название листа для экспорта
 * @returns {string} URL для скачивания Excel файла
 * @clientCallable
 */
function getExcelExportUrl(sheetName) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error(`Лист "${sheetName}" не найден`);
    }
    
    const sheetId = sheet.getSheetId();
    const spreadsheetId = ss.getId();
    
    // URL для экспорта конкретного листа в Excel
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx&gid=${sheetId}`;
    
    return url;
    
  } catch (error) {
    logError('getExcelExportUrl', error, { sheetName: sheetName });
    throw error;
  }
}

/**
 * @overview Экспортирует лист "Заказы" в Excel
 * @returns {string} URL для скачивания
 * @clientCallable
 */
function exportOrdersToExcel() {
  return getExcelExportUrl(FORMATTED_ORDERS_SHEET_NAME);
}

/**
 * @overview Экспортирует лист "Данные Заказов" в Excel
 * @returns {string} URL для скачивания
 * @clientCallable
 */
function exportSummaryToExcel() {
  return getExcelExportUrl(ORDERS_DATA_SHEET_NAME);
}

/**
 * @overview Создает меню при открытии таблицы
 */
function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi();
    
    ui.createMenu('📥 Экспорт')
      .addItem('Экспортировать "Заказы" в Excel', 'downloadOrdersAsExcel')
      .addItem('Экспортировать "Данные Заказов" в Excel', 'downloadSummaryAsExcel')
      .addSeparator()
      .addItem('🗑️ Удалить заказ магазина', 'showDeleteOrderDialog')
      .addSeparator()
      .addItem('Очистить лог ошибок', 'clearErrorLog')
      .addToUi();
      
  } catch (error) {
    console.error('Ошибка создания меню:', error);
  }
}
/**
 * Простой триггер: при ручной правке справочников сбрасывает их кеш,
 * чтобы изменения применялись сразу, а не через TTL.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sheetName = e.range.getSheet().getName();

    if (sheetName === PRODUCTS_SHEET_NAME) {
      // Изменён ассортимент — сбрасываем продукты и штрихкоды
      getCache_().removeAll(['ref_products', 'ref_barcodes']);
    } else if (sheetName === ROUTES_STORES_SHEET_NAME) {
      // Изменены маршруты/магазины — сбрасываем связанные справочники
      getCache_().removeAll(['ref_stores', 'ref_routes', 'ref_storeNumbers']);
    }
  } catch (err) {
    // onEdit не должен ничего ронять — просто молча игнорируем сбой
    console.error('onEdit cache invalidation error: ' + err.toString());
  }
}

/**
 * @overview Открывает диалог с ссылкой для скачивания "Заказы"
 */
function downloadOrdersAsExcel() {
  try {
    const url = exportOrdersToExcel();
    const html = `
      <html>
        <body>
          <h3>Экспорт листа "Заказы"</h3>
          <p>Нажмите на ссылку ниже для скачивания Excel файла:</p>
          <a href="${url}" target="_blank" style="font-size: 16px;">📥 Скачать Excel файл</a>
          <br><br>
          <button onclick="google.script.host.close()">Закрыть</button>
        </body>
      </html>
    `;
    
    const htmlOutput = HtmlService.createHtmlOutput(html)
      .setWidth(400)
      .setHeight(150);
    
    SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Экспорт в Excel');
    
  } catch (error) {
    SpreadsheetApp.getUi().alert('Ошибка: ' + error.toString());
  }
}

/**
 * @overview Открывает диалог с ссылкой для скачивания "Данные Заказов"
 */
function downloadSummaryAsExcel() {
  try {
    const url = exportSummaryToExcel();
    const html = `
      <html>
        <body>
          <h3>Экспорт листа "Данные Заказов"</h3>
          <p>Нажмите на ссылку ниже для скачивания Excel файла:</p>
          <a href="${url}" target="_blank" style="font-size: 16px;">📥 Скачать Excel файл</a>
          <br><br>
          <button onclick="google.script.host.close()">Закрыть</button>
        </body>
      </html>
    `;
    
    const htmlOutput = HtmlService.createHtmlOutput(html)
      .setWidth(400)
      .setHeight(150);
    
    SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Экспорт в Excel');
    
  } catch (error) {
    SpreadsheetApp.getUi().alert('Ошибка: ' + error.toString());
  }
}

/**
 * @overview Очищает лог ошибок
 */
function clearErrorLog() {
  try {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert(
      'Подтверждение',
      'Вы уверены, что хотите очистить лог ошибок?',
      ui.ButtonSet.YES_NO
    );
    
    if (response === ui.Button.YES) {
      const ss = getSpreadsheet();
      const errorLog = ss.getSheetByName('_Лог_Ошибок');
      
      if (errorLog) {
        errorLog.clearContents();
        errorLog.appendRow(['Дата и время', 'Функция', 'Ошибка', 'Дополнительная информация', 'Stack Trace']);
        
        const headerRange = errorLog.getRange(1, 1, 1, 5);
        headerRange.setBackground('#FF0000')
          .setFontColor('#FFFFFF')
          .setFontWeight('bold')
          .setHorizontalAlignment('center');
        
        ui.alert('Лог ошибок очищен');
      } else {
        ui.alert('Лог ошибок не найден');
      }
    }
    
  } catch (error) {
    SpreadsheetApp.getUi().alert('Ошибка: ' + error.toString());
  }
}

function testMenu() {
  onOpen();
  SpreadsheetApp.getUi().alert('Если видите это сообщение - всё работает!');
}

/**
 * @overview Показывает диалог для выбора и удаления заказа магазина
 */
function showDeleteOrderDialog() {
  try {
    const ui = SpreadsheetApp.getUi();
    
    // Получаем список магазинов с заказами
    const storesWithOrders = getStoresWithOrdersToday();
    
    if (storesWithOrders.size === 0) {
      ui.alert('Информация', 'На сегодня нет заказов для удаления.', ui.ButtonSet.OK);
      return;
    }
    
    // Преобразуем Set в отсортированный массив
    const storesList = Array.from(storesWithOrders).sort((a, b) => a.localeCompare(b, 'uk'));
    
    // Создаем HTML с выпадающим списком
    const html = `
      <html>
        <head>
          <base target="_top">
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 20px;
            }
            select {
              width: 100%;
              padding: 10px;
              font-size: 14px;
              margin-bottom: 20px;
              border: 2px solid #ddd;
              border-radius: 4px;
            }
            .button-container {
              display: flex;
              gap: 10px;
              justify-content: flex-end;
            }
            button {
              padding: 10px 20px;
              font-size: 14px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            }
            #delete-btn {
              background-color: #d32f2f;
              color: white;
            }
            #delete-btn:hover {
              background-color: #b71c1c;
            }
            #cancel-btn {
              background-color: #757575;
              color: white;
            }
            #cancel-btn:hover {
              background-color: #616161;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffc107;
              padding: 15px;
              border-radius: 4px;
              margin-bottom: 20px;
              color: #856404;
            }
            .info {
              background-color: #e3f2fd;
              border: 1px solid #2196f3;
              padding: 10px;
              border-radius: 4px;
              margin-bottom: 20px;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <div class="warning">
            <strong>⚠️ Внимание:</strong> Удаление заказа позволит магазину снова сделать заказ на сегодня. Действие необратимо!
          </div>
          
          <div class="info">
            <strong>📊 Всего заказов сегодня:</strong> ${storesList.length}
          </div>
          
          <label for="store-select"><strong>Выберите магазин для удаления заказа:</strong></label>
          <select id="store-select">
            <option value="">-- Выберите магазин --</option>
            ${storesList.map(store => `<option value="${escapeHtmlForDialog(store)}">${escapeHtmlForDialog(store)}</option>`).join('')}
          </select>
          
          <div class="button-container">
            <button id="cancel-btn" onclick="google.script.host.close()">Отмена</button>
            <button id="delete-btn" onclick="deleteOrder()">🗑️ Удалить заказ</button>
          </div>
          
          <script>
            function deleteOrder() {
              const select = document.getElementById('store-select');
              const selectedStore = select.value;
              
              if (!selectedStore) {
                alert('Пожалуйста, выберите магазин');
                return;
              }
              
              if (!confirm('Вы уверены, что хотите удалить заказ магазина "' + selectedStore + '"?\\n\\nЭто действие нельзя отменить!')) {
                return;
              }
              
              document.getElementById('delete-btn').disabled = true;
              document.getElementById('delete-btn').textContent = 'Удаление...';
              
              google.script.run
                .withSuccessHandler(onSuccess)
                .withFailureHandler(onError)
                .deleteOrderForStoreFromDialog(selectedStore);
            }
            
            function onSuccess(message) {
              alert(message);
              google.script.host.close();
            }
            
            function onError(error) {
              alert('Ошибка: ' + error.message);
              document.getElementById('delete-btn').disabled = false;
              document.getElementById('delete-btn').textContent = '🗑️ Удалить заказ';
            }
          </script>
        </body>
      </html>
    `;
    
    const htmlOutput = HtmlService.createHtmlOutput(html)
      .setWidth(500)
      .setHeight(350);
    
    ui.showModalDialog(htmlOutput, '🗑️ Удаление заказа магазина');
    
  } catch (error) {
    SpreadsheetApp.getUi().alert('Ошибка: ' + error.toString());
    logError('showDeleteOrderDialog', error, {});
  }
}

/**
 * @overview Экранирование HTML для диалога
 */
function escapeHtmlForDialog(text) {
  if (text === null || typeof text === 'undefined') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * @overview Удаляет заказы конкретного магазина за сегодня (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ)
 */
function deleteOrderForStoreFromDialog(storeAddress) {
  try {
    var ss = getSpreadsheet();
    var rawOrderSheet = ss.getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
    
    if (!rawOrderSheet || rawOrderSheet.getLastRow() < 2) {
      throw new Error('Нет данных для удаления');
    }
    
    var today = new Date();
    var todayFormatted = formatDateDMY(today);
    var normalizedStore = normalizeAddress(storeAddress, false);
    
    var lastRow = rawOrderSheet.getLastRow();
    var allData = rawOrderSheet.getRange(2, 1, lastRow - 1, rawOrderSheet.getLastColumn()).getValues();
    
    // Фильтруем — оставляем только строки, которые НЕ нужно удалять
    var rowsToKeep = [];
    var deletedCount = 0;
    
    for (var i = 0; i < allData.length; i++) {
      var timestamp = allData[i][0];
      var storeFromSheet = allData[i][2];
      var shouldDelete = false;
      
      if (timestamp instanceof Date) {
        var rowDateFormatted = formatDateDMY(timestamp);
        var normalizedFromSheet = normalizeAddress(storeFromSheet, false);
        
        if (rowDateFormatted === todayFormatted && normalizedFromSheet === normalizedStore) {
          shouldDelete = true;
          deletedCount++;
        }
      }
      
      if (!shouldDelete) {
        rowsToKeep.push(allData[i]);
      }
    }
    
    if (deletedCount === 0) {
      throw new Error('Заказ для магазина "' + storeAddress + '" не найден');
    }
    
    // Очищаем и перезаписываем одним блоком — вместо deleteRow в цикле
    var headerRow = rawOrderSheet.getRange(1, 1, 1, rawOrderSheet.getLastColumn()).getValues();
    rawOrderSheet.clearContents();
    rawOrderSheet.getRange(1, 1, 1, headerRow[0].length).setValues(headerRow);
    
    if (rowsToKeep.length > 0) {
      rawOrderSheet.getRange(2, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);
    }
    
    console.log('Удалено строк для "' + storeAddress + '": ' + deletedCount);
    
    // Сбрасываем кеш и пересоздаём отчёты
    invalidateOrdersCache_();
    generateSummaryReport();
    generateFormattedOrdersReport();
    scriptProperties.deleteProperty('lastProcessedRowCount');
    
    return '✅ Успешно удалено ' + deletedCount + ' позиций для магазина "' + storeAddress + '".\n\nМагазин снова может сделать заказ сегодня.';
    
  } catch (error) {
    console.error('Ошибка удаления заказа:', error);
    logError('deleteOrderForStoreFromDialog', error, { storeAddress: storeAddress });
    throw error;
  }
}

function checkMinAmount() {
  console.log('MIN_ORDER_AMOUNT = ' + MIN_ORDER_AMOUNT);
  return MIN_ORDER_AMOUNT;
}

/**
 * @overview Возвращает карту адресов -> номеров магазинов (кешированный доступ)
 */
function getStoreNumbersMap() {
  return cached_('ref_storeNumbers', function() {
    const ss = getSpreadsheet();
    const routesSheet = ss.getSheetByName(ROUTES_STORES_SHEET_NAME);
    const map = {};
    if (!routesSheet || routesSheet.getLastRow() < 2) return map;
    const data = routesSheet.getRange(2, 1, routesSheet.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const normalizedAddress = normalizeAddress(String(data[i][1]), false);
      map[normalizedAddress] = String(data[i][2] || '');
    }
    return map;
  });
}

/**
 * @overview Удаляет все зависшие триггеры generateReportsAsync (запустить один раз)
 */
function cleanupOldTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'generateReportsAsync') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  
  console.log('Удалено старых триггеров: ' + deleted);
}
function withRetry(fn, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      const errorMsg = error.toString().toLowerCase();
      const isTransient = errorMsg.includes('server error') || 
                          errorMsg.includes('internal') ||
                          errorMsg.includes('please wait') ||
                          errorMsg.includes('is missing') ||
                          errorMsg.includes('timed out') ||
                          errorMsg.includes('temporarily unavailable') ||
                          errorMsg.includes('try again');
      
      if (isTransient && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Временная ошибка, попытка ${attempt}/${maxRetries}. Ждём ${delay}ms...`);
        Utilities.sleep(delay);
      } else {
        throw error;
      }
    }
  }
}
function setupTrigger() {
  // Сначала удаляем старые триггеры generateReportsAsync (на всякий случай)
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'generateReportsAsync') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Создаём новый триггер — каждые 5 минут
  ScriptApp.newTrigger('generateReportsAsync')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  console.log('✓ Триггер создан: generateReportsAsync каждые 5 минут');
  
  // Проверяем
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    console.log('Триггер: ' + t.getHandlerFunction() + ' | Тип: ' + t.getEventType());
  });
}
/**
 * Ставит разовый триггер пересборки отчётов (~через 30 сек), не плодя дубли.
 */
function scheduleReportRebuild_() {
  try {
    const pending = scriptProperties.getProperty('reportRebuildPending');
    const now = Date.now();
    if (pending && (now - parseInt(pending, 10)) < 60000) return; // уже запланировано
    scriptProperties.setProperty('reportRebuildPending', String(now));
    ScriptApp.newTrigger('rebuildReportsTriggered')
      .timeBased()
      .after(30 * 1000)
      .create();
  } catch (e) {
    console.error('scheduleReportRebuild_ error: ' + e.toString());
  }
}

/**
 * Вызывается разовым триггером: строит отчёты и удаляет свои триггеры.
 */
function rebuildReportsTriggered() {
  try {
    generateSummaryReport();
    generateFormattedOrdersReport();
  } catch (e) {
    logError('rebuildReportsTriggered', e, {});
  } finally {
    scriptProperties.deleteProperty('reportRebuildPending');
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === 'rebuildReportsTriggered') {
        ScriptApp.deleteTrigger(t);
      }
    });
  }
}
