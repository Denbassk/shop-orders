// ============================================================
// ДІАГНОСТИКА - запускати вручну з редактора
// ============================================================

// Які саме варіанти адрес лежать у сирих даних хліба
function verifyBreadAddresses() {
  const cfg = dirCfg_('bread');
  const sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.rawSheet);
  const seen = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      const v = String(r[0]).trim();
      if (v) seen[v] = (seen[v] || 0) + 1;
    });
  }
  const keys = Object.keys(seen).sort();
  console.log('Варіантів адрес у сирих даних хліба: ' + keys.length);
  console.log(keys.map(function (k) { return k + '   (' + seen[k] + ' рядків)'; }).join('\n'));
}

// Перевірка структури листів асортименту
function inspectProducts() {
  ['bread', 'bakery', 'veg'].forEach(function (k) {
    const cfg = dirCfg_(k);
    if (!cfg.productsSheet) { console.log(k + ': асортимент із зовнішнього прайсу'); return; }
    try {
      const sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.productsSheet);
      if (!sh) { console.log(k + ': листа "' + cfg.productsSheet + '" немає'); return; }
      const w = Math.min(sh.getLastColumn(), 8);
      console.log(k + ' -> "' + cfg.productsSheet + '", рядків ' + sh.getLastRow() +
        ', колонок ' + sh.getLastColumn() +
        '\n   шапка: ' + sh.getRange(1, 1, 1, w).getValues()[0].join(' | ') +
        (sh.getLastRow() > 1 ? '\n   приклад: ' + sh.getRange(2, 1, 1, w).getValues()[0].join(' | ') : ''));
    } catch (e) { console.log(k + ': помилка - ' + e.message); }
  });
}

// Перевірка зовнішнього прайсу овочів
function inspectVegPrice() {
  const cfg = dirCfg_('veg');
  try {
    const ss = SpreadsheetApp.openById(cfg.priceSpreadsheetId);
    const sh = ss.getSheets()[0];
    const w = Math.min(sh.getLastColumn(), 6);
    console.log('Прайс "' + ss.getName() + '" -> лист "' + sh.getName() + '"' +
      '\n   рядків ' + sh.getLastRow() + ', колонок ' + sh.getLastColumn() +
      '\n   перші рядки:');
    console.log(sh.getRange(1, 1, Math.min(6, sh.getLastRow()), w).getValues()
      .map(function (r) { return '   ' + r.join(' | '); }).join('\n'));
  } catch (e) { console.log('Прайс недоступний: ' + e.message); }
}

// Перевірка довідника і статусів
function testBootstrap() {
  const b = apiBootstrap_();
  console.log('Дата: ' + b.today + ', точок: ' + b.stores.length);
  b.stores.slice(0, 5).forEach(function (s) {
    console.log(s.label + '  [' + s.directions.join(', ') + ']  замовлено: ' +
      JSON.stringify(s.ordered));
  });
}