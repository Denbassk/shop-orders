// ============================================================
// ЗАГЛУШКА. Старий проєкт хліба ЧП Рома ВІДКЛЮЧЕНО.
//
// Він писав у ту саму таблицю 1QJca7Xl... і той самий лист
// _Сырые_Заказы, що й основний застосунок shop-orders.
// Небезпечне прибрано:
//   deleteOrderForStoreFromDialog - чистила сирий лист цілком
//   recordOrder                   - писала через getLastRow + setValues
//   generateSummaryReport         - затирала листи звітів
//   generateFormattedOrdersReport - те саме
//   setupTrigger / generateReportsAsync / rebuildReportsTriggered
//
// Замовлення і звіти веде основний проєкт: BreadReport.gs,
// тригер refreshBreadReports. Оригінал - у git та Code.js.bak.
// ============================================================

var NEW_APP_URL = 'https://denbassk.github.io/shop-orders/';

function doGet() {
  var html =
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="3;url=' + NEW_APP_URL + '">' +
    '</head><body style="font-family:Arial;padding:24px;text-align:center">' +
    '<h2>Стара форма більше не працює</h2>' +
    '<p>Переходимо на новий застосунок...</p>' +
    '<p><a href="' + NEW_APP_URL + '" style="font-size:18px">Відкрити застосунок</a></p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Замовлення')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Знімає ВСІ тригери цього проєкту. Запустити руками один раз.
function killAllTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    console.log('знімаю: ' + t.getHandlerFunction());
    ScriptApp.deleteTrigger(t);
    n++;
  });
  console.log('Знято тригерів: ' + n);
  var p = PropertiesService.getScriptProperties();
  ['reportsDirty', 'reportRebuildPending', 'lastProcessedRowCount']
    .forEach(function (k) { p.deleteProperty(k); });
  console.log('Прапорці звітів скинуто. Проєкт відключено.');
}

function showTriggers() {
  var t = ScriptApp.getProjectTriggers();
  if (!t.length) { console.log('тригерів немає - все чисто'); return; }
  t.forEach(function (x) { console.log('ЖИВИЙ: ' + x.getHandlerFunction()); });
}