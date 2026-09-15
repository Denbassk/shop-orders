// ВИКЛЮЧЕНО 15.09.2026. Усе робить застосунок shop-orders.
// Нічого тут не дописувати: будь-яка функція в цьому проєкті
// пише в _Сырые_Заказы_Овочі поза замком застосунку.
function autoMaintenance() {}
function archiveOldOrders() {}
function generateFormattedOrdersReport() {}
function generateSummaryReport() {}
function updateTrigger() {}
function onOpen() {}
function ensureSheetsExist() {}
function formatRawDataSheet() {}
function deleteOrderForStoreFromDialog() { throw new Error('Вимкнено'); }
function applyDateFilter() { return 'Вимкнено'; }
function recordOrder() {
  return { success: false, message: 'Форма вимкнена. Замовлення тільки через застосунок.' };
}
function doGet() {
  return HtmlService.createHtmlOutput('<h2>Форма вимкнена</h2><p>Замовляйте через застосунок.</p>');
}
function killAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
