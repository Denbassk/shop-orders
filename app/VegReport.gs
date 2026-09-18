// ============================================================
// ЗВІТИ ОВОЧІВ: "Замовлення Овочі" і "Зведена Овочі"
//
// Раніше їх збирав ОКРЕМИЙ проєкт Apps Script (legacy/veg),
// прив'язаний до тієї самої таблиці, тригером autoMaintenance
// кожні 5 хвилин. Щойно тригер не відпрацьовував - постачальник
// бачив учорашні цифри.
//
// Тепер усе в одному застосунку:
//   джерело   - _Сырые_Заказы_Овочі (той самий лист, куди пише застосунок)
//   список ТТ - Довідник ТТ і графік по днях тижня, а не лист "Адреса ТТ"
//   тригер    - refreshVegReports, кожні 5 хвилин (d06_installTriggers)
//
// Старий проєкт після цього треба ВИКЛЮЧИТИ: зняти в ньому тригер
// autoMaintenance, інакше два проєкти перезаписуватимуть одні й ті
// самі два листи.
// ============================================================

var VEG_ORDERS_SHEET  = 'Замовлення Овочі';
var VEG_SUMMARY_SHEET = 'Зведена Овочі';

// Колонки сирого листа овочів (див. rawRow у Config.gs):
// A дата | B час | C адреса | D назва | E ціна | F кіл-ть | G сума

function vegNum_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function vegRound_(x) { return Math.round(x * 100) / 100; }

// --- Сьогоднішні робочі рядки сирого листа ---
function vegTodayRows_() {
  var cfg = dirCfg_('veg');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var rows = sh.getRange(last - take + 1, 1, take, 7).getValues();
  var today = formatDateDMY_(new Date());

  return rows.filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim().slice(0, 10);
    if (d !== today) return false;
    return String(r[3] || '').trim() && vegNum_(r[5]) > 0;
  });
}

// Підпис стану: дата | рядки | точки | сумарна кількість
function vegSignature_(rows) {
  var qty = 0, addr = {};
  rows.forEach(function (r) {
    qty += vegNum_(r[5]);
    addr[addrKey_(String(r[2] || '').trim())] = 1;
  });
  return formatDateDMY_(new Date()) + '|' + rows.length + '|' +
         Object.keys(addr).length + '|' + vegRound_(qty);
}

// --- Функція для тригера: перезбирає, лише якщо щось змінилось ---
function refreshVegReports() {
  var rows = vegTodayRows_();
  var sig = vegSignature_(rows);
  var props = PropertiesService.getScriptProperties();

  var ss = SpreadsheetApp.openById(dirCfg_('veg').spreadsheetId);
  var have = ss.getSheetByName(VEG_ORDERS_SHEET) && ss.getSheetByName(VEG_SUMMARY_SHEET);

  if (have && props.getProperty('veg_report_sig') === sig) return;

  buildVegReports();
}

// --- Зібрати обидва звіти ПРЯМО ЗАРАЗ, у будь-якому разі ---
function buildVegReports() {
  var rows = vegTodayRows_();
  buildVegOrdersSheet_(rows);
  buildVegSummarySheet_(rows);
  markReport_('veg');
  PropertiesService.getScriptProperties()
    .setProperty('veg_report_sig', vegSignature_(rows));
}

// ТТ напрямку з Довідника - лише ті, у кого сьогодні робочий день
function vegStoresToday_() {
  return loadStores_().filter(function (s) {
    return s.directions.indexOf('veg') >= 0 && dayAllowed_('veg', s);
  });
}

function vegRowList_(rows, c1, c2) {
  return rows.map(function (r) { return c1 + r + ':' + (c2 || c1) + r; });
}

// ============================================================
// ЛИСТ "Замовлення Овочі" - у розрізі торгових точок
// ============================================================
function buildVegOrdersSheet_(rows) {
  var today = formatDateDMY_(new Date());

  var byStore = {};
  rows.forEach(function (r) {
    var addr = String(r[2] || '').trim();
    if (!addr) return;
    byStore[addr] = byStore[addr] || [];
    byStore[addr].push({
      name: String(r[3] || '').trim(),
      price: vegNum_(r[4]),
      qty: vegNum_(r[5]),
      sum: vegNum_(r[6]) || vegRound_(vegNum_(r[4]) * vegNum_(r[5]))
    });
  });

  var ordered = {};
  Object.keys(byStore).forEach(function (a) { ordered[addrKey_(a)] = 1; });

  var all = vegStoresToday_();
  var missing = all.filter(function (s) {
    return !ordered[addrKey_(s.addrVeg)];
  }).map(function (s) { return s.label; });

  var data = [], g = { title: [], sub: [], head: [], store: [],
                       row: [], total: [], grand: [], missHead: [], miss: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Замовлення овочів - ' + today, '', '', '', ''], 'title');
  push(['ТТ із замовленнями: ' + Object.keys(byStore).length + ' з ' + all.length +
        '   (оновлено ' + formatTime_(new Date()) + ')', '', '', '', ''], 'sub');
  push(['', '', '', '', ''], null);
  push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість, кг', 'Сума, грн'], 'head');

  var num = 1, grandQty = 0, grandSum = 0;

  Object.keys(byStore).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
    .forEach(function (store) {
      push([store, '', '', '', ''], 'store');
      var sQty = 0, sSum = 0;

      byStore[store].sort(function (a, b) { return a.name.localeCompare(b.name, 'uk'); })
        .forEach(function (it) {
          sQty = vegRound_(sQty + it.qty);
          sSum = vegRound_(sSum + it.sum);
          push([num++, it.name, it.price, it.qty, it.sum], 'row');
        });

      push(['РАЗОМ по ТТ:', '', '', sQty, sSum], 'total');
      push(['', '', '', '', ''], null);
      grandQty = vegRound_(grandQty + sQty);
      grandSum = vegRound_(grandSum + sSum);
    });

  if (Object.keys(byStore).length) {
    push(['ЗАГАЛЬНИЙ ПІДСУМОК', '', '', grandQty, grandSum], 'grand');
    push(['', '', '', '', ''], null);
  } else {
    push(['Замовлень на сьогодні ще немає', '', '', '', ''], 'missHead');
    push(['', '', '', '', ''], null);
  }

  if (missing.length) {
    push(['ТТ без замовлень (' + missing.length + '):', '', '', '', ''], 'missHead');
    missing.sort(function (a, b) { return a.localeCompare(b, 'uk'); })
      .forEach(function (s) { push(['   ' + s, '', '', '', ''], 'miss'); });
  }

  var ss = SpreadsheetApp.openById(dirCfg_('veg').spreadsheetId);
  var sh = ss.getSheetByName(VEG_ORDERS_SHEET) || ss.insertSheet(VEG_ORDERS_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();
  // старий проєкт зліплював комірки в шапці і в рядках ТТ;
  // clear() їх не розбирає, а setValues на зліплених падає
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}

  var n = data.length;
  sh.getRange(1, 1, n, 5).setValues(data);
  sh.getRange(1, 1, n, 5).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  if (g.title.length) sh.getRangeList(vegRowList_(g.title, 'A', 'E'))
    .setBackground('#2E7D32').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.sub.length) sh.getRangeList(vegRowList_(g.sub, 'A', 'E'))
    .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontSize(11);
  if (g.head.length) sh.getRangeList(vegRowList_(g.head, 'A', 'E'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.store.length) sh.getRangeList(vegRowList_(g.store, 'A', 'E'))
    .setBackground('#FFF3E0').setFontColor('#E65100').setFontWeight('bold');

  if (g.row.length) {
    var even = g.row.filter(function (_, i) { return i % 2 === 1; });
    if (even.length) sh.getRangeList(vegRowList_(even, 'A', 'E')).setBackground('#F8F9FA');
    sh.getRangeList(vegRowList_(g.row, 'A', 'A')).setHorizontalAlignment('center');
    sh.getRangeList(vegRowList_(g.row, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('#,##0.00');
    sh.getRangeList(vegRowList_(g.row, 'D', 'D'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(vegRowList_(g.row, 'E', 'E'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.total.length) {
    sh.getRangeList(vegRowList_(g.total, 'A', 'E'))
      .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    sh.getRangeList(vegRowList_(g.total, 'D', 'D'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(vegRowList_(g.total, 'E', 'E'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.grand.length) {
    sh.getRangeList(vegRowList_(g.grand, 'A', 'E'))
      .setBackground('#1B5E20').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    sh.getRangeList(vegRowList_(g.grand, 'D', 'D'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(vegRowList_(g.grand, 'E', 'E'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.missHead.length) sh.getRangeList(vegRowList_(g.missHead, 'A', 'E'))
    .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');
  if (g.miss.length) sh.getRangeList(vegRowList_(g.miss, 'A', 'A')).setFontColor('#C62828');

  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 300);
  sh.setColumnWidth(3, 100);
  sh.setColumnWidth(4, 130);
  sh.setColumnWidth(5, 130);
  sh.setFrozenRows(4);
  SpreadsheetApp.flush();

  console.log('Замовлення Овочі: рядків ' + n + ', позицій ' + (num - 1) +
              ', ТТ ' + Object.keys(byStore).length + ' з ' + all.length +
              ', без замовлень ' + missing.length);
}

// ============================================================
// ЛИСТ "Зведена Овочі" - сумарно по видах овочів
// ============================================================
function buildVegSummarySheet_(rows) {
  var today = formatDateDMY_(new Date());

  var sum = {}, grandQty = 0, grandSum = 0, stores = {};
  rows.forEach(function (r) {
    var name = String(r[3] || '').trim();
    if (!name) return;
    var price = vegNum_(r[4]);
    var qty = vegNum_(r[5]);
    var s = vegNum_(r[6]) || vegRound_(price * qty);

    sum[name] = sum[name] || { qty: 0, sum: 0, price: price };
    sum[name].qty = vegRound_(sum[name].qty + qty);
    sum[name].sum = vegRound_(sum[name].sum + s);
    if (price > 0) sum[name].price = price;

    grandQty = vegRound_(grandQty + qty);
    grandSum = vegRound_(grandSum + s);
    var addr = String(r[2] || '').trim();
    if (addr) stores[addrKey_(addr)] = 1;
  });

  var data = [], g = { title: [], sub: [], head: [], row: [], total: [], empty: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Зведене замовлення овочів - ' + today, '', '', '', ''], 'title');
  push(['ТТ: ' + Object.keys(stores).length + '   |   разом ' + grandQty + ' кг   |   ' +
        grandSum.toFixed(2) + ' грн   (оновлено ' + formatTime_(new Date()) + ')',
        '', '', '', ''], 'sub');
  push(['', '', '', '', ''], null);
  push(['№', 'Назва овочу', 'Ціна/кг', 'Кількість, кг', 'Сума, грн'], 'head');

  if (!rows.length) {
    push(['Замовлень на сьогодні ще немає', '', '', '', ''], 'empty');
  } else {
    var num = 1;
    Object.keys(sum).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
      .forEach(function (name) {
        var it = sum[name];
        push([num++, name, it.price, it.qty, it.sum], 'row');
      });
    push(['', '', '', '', ''], null);
    push(['ЗАГАЛОМ', '', '', grandQty, grandSum], 'total');
  }

  var ss = SpreadsheetApp.openById(dirCfg_('veg').spreadsheetId);
  var sh = ss.getSheetByName(VEG_SUMMARY_SHEET) || ss.insertSheet(VEG_SUMMARY_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}

  var n = data.length;
  sh.getRange(1, 1, n, 5).setValues(data);
  sh.getRange(1, 1, n, 5).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  if (g.title.length) sh.getRangeList(vegRowList_(g.title, 'A', 'E'))
    .setBackground('#2E7D32').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.sub.length) sh.getRangeList(vegRowList_(g.sub, 'A', 'E'))
    .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontSize(11);
  if (g.head.length) sh.getRangeList(vegRowList_(g.head, 'A', 'E'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.row.length) {
    var even = g.row.filter(function (_, i) { return i % 2 === 1; });
    if (even.length) sh.getRangeList(vegRowList_(even, 'A', 'E')).setBackground('#F8F9FA');
    sh.getRangeList(vegRowList_(g.row, 'A', 'A')).setHorizontalAlignment('center');
    sh.getRangeList(vegRowList_(g.row, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('#,##0.00');
    sh.getRangeList(vegRowList_(g.row, 'D', 'D'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(vegRowList_(g.row, 'E', 'E'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.total.length) {
    sh.getRangeList(vegRowList_(g.total, 'A', 'E'))
      .setBackground('#1B5E20').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    sh.getRangeList(vegRowList_(g.total, 'D', 'D'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(vegRowList_(g.total, 'E', 'E'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.empty.length) sh.getRangeList(vegRowList_(g.empty, 'A', 'E'))
    .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');

  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 300);
  sh.setColumnWidth(3, 100);
  sh.setColumnWidth(4, 130);
  sh.setColumnWidth(5, 130);
  sh.setFrozenRows(4);
  SpreadsheetApp.flush();

  console.log('Зведена Овочі: позицій ' + Object.keys(sum).length +
              ', разом ' + grandQty + ' кг / ' + grandSum + ' грн');
}
