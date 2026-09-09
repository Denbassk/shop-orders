function benchmarkReports() {
  var t0 = Date.now();
  generateFormattedOrdersReport();
  var t1 = Date.now();
  generateSummaryReport();
  var t2 = Date.now();
  
  console.log('=== BENCHMARK ===');
  console.log('generateFormattedOrdersReport: ' + (t1 - t0) + ' мс');
  console.log('generateSummaryReport: ' + (t2 - t1) + ' мс');
  console.log('Итого: ' + (t2 - t0) + ' мс');
}
function testLockDeadlock() {
  var lock = LockService.getScriptLock();
  console.log('Беру лок...');
  lock.tryLock(5000);
  console.log('Лок взят. Теперь вызываю generateFormattedOrdersReport...');
  
  var t0 = Date.now();
  generateFormattedOrdersReport(); // В старом коде — зависнет на 10 сек здесь
  console.log('Выполнилось за: ' + (Date.now() - t0) + ' мс');
  
  lock.releaseLock();
}

function benchmarkDates() {
  var rawSheet = getSpreadsheet().getSheetByName(HIDDEN_RAW_DATA_SHEET_NAME);
  var allData = rawSheet.getRange(2, 1, rawSheet.getLastRow()-1, 1).getValues();
  var tz = Session.getScriptTimeZone();

  // Вариант 1: Utilities.formatDate (текущий)
  var t0 = Date.now();
  allData.forEach(function(row) {
    if (row[0] instanceof Date)
      Utilities.formatDate(row[0], tz, 'dd.MM.yyyy');
  });
  var t1 = Date.now();

  // Вариант 2: чистый JS
  allData.forEach(function(row) {
    if (row[0] instanceof Date) {
      var d = row[0];
      var s = String(d.getDate()).padStart(2,'0') + '.' +
              String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
    }
  });
  var t2 = Date.now();

  console.log('Utilities.formatDate: ' + (t1-t0) + ' мс');
  console.log('Pure JS:              ' + (t2-t1) + ' мс');
}
function benchmarkFinal() {
  var t0 = Date.now();
  generateFormattedOrdersReport_v3();
  var t1 = Date.now();
  generateSummaryReport();
  var t2 = Date.now();
  console.log('Заказы: ' + (t1-t0) + ' мс');
  console.log('Сводная: ' + (t2-t1) + ' мс');
  console.log('Итого: ' + (t2-t0) + ' мс');
}
function benchmarkFormLoad() {
  var t0 = Date.now();
  ensureSheetsExist();
  var t1 = Date.now();

  var storesStatus = getStoresOrderStatus();
  var t2 = Date.now();

  var products = getAllProductsForClient();
  var t3 = Date.now();

  console.log('ensureSheetsExist:   ' + (t1-t0) + ' мс');
  console.log('getStoresOrderStatus: ' + (t2-t1) + ' мс  (включает getStoresWithOrdersToday)');
  console.log('getAllProductsForClient: ' + (t3-t2) + ' мс');
  console.log('Итого загрузка формы: ' + (t3-t0) + ' мс');
}

function benchmarkRecordOrder() {
  // Симулируем реальный заказ
  var fakeOrder = {
    selectedStore: 'м. Харків вул. Амосова, 5А',
    products: [
      { barcode: '2984670066468', name: 'Пампушка', price: 37.50, quantity: 5, category: 'Випічка' },
      { barcode: '2984670068158', name: 'Сосиска', price: 29.50, quantity: 3, category: 'Випічка' }
    ]
  };
  var t0 = Date.now();
  var result = recordOrder(fakeOrder);
  console.log('recordOrder: ' + (Date.now()-t0) + ' мс — ' + result.message);
}

function finalCheck() {
  invalidateCache();
  var t0 = Date.now();
  getInitialFormData(); // холодный
  var t1 = Date.now();
  getInitialFormData(); // тёплый
  var t2 = Date.now();
  console.log('Холодний: ' + (t1-t0) + ' мс');
  console.log('Тёплий:   ' + (t2-t1) + ' мс');
}