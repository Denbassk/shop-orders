// ============================================================
// ТЕСТОВІ ЛИСТИ - структура 1:1 з робочими, дані окремо
// ============================================================

function setupTestSheets() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var ss = SpreadsheetApp.openById(cfg.spreadsheetId);
    var src = ss.getSheetByName(cfg.rawSheet);
    var dst = ss.getSheetByName(cfg.testSheet);
    if (!dst) dst = ss.insertSheet(cfg.testSheet);
    dst.clear();
    if (src && src.getLastColumn() > 0) {
      src.getRange(1, 1, 1, src.getLastColumn()).copyTo(dst.getRange(1, 1));  // та сама шапка
    }
    dst.setTabColor('#e11b22');
    console.log('Готово: ' + cfg.testSheet + ' у "' + ss.getName() + '"');
  });
  CacheService.getScriptCache().remove('status_v2');
}

function clearTestSheets() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.testSheet);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  PropertiesService.getScriptProperties().getKeys().forEach(function (k) {
    if (k.indexOf('oid_') === 0) PropertiesService.getScriptProperties().deleteProperty(k);
  });
  CacheService.getScriptCache().remove('status_v2');
  console.log('Тестові дані очищено');
}
