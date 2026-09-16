// ============================================================
// ЗВІТИ ХЛІБА (ЧП Рома): "Заказы" і "Данные Заказов"
//
// Раніше їх збирав ОКРЕМИЙ проєкт Apps Script (legacy/bread),
// прив'язаний до тієї самої таблиці, своїми тригерами
// generateReportsAsync / rebuildReportsTriggered. Щойно тригер не
// відпрацьовував - постачальник бачив учорашні цифри.
//
// Тепер усе в одному застосунку:
//   джерело   - _Сырые_Заказы (той самий лист, куди пише застосунок)
//   номери ТТ - Довідник ТТ, колонка D, а не лист "Маршруты и Магазины"
//   тригер    - refreshBreadReports, кожні 5 хвилин (d06_installTriggers)
//
// Старий проєкт після цього треба ВИКЛЮЧИТИ: зняти в ньому тригери,
// інакше два проєкти перезаписуватимуть одні й ті самі листи.
//
// Вигляд листів лишився такий, як його звик бачити постачальник:
// ті самі колонки, рядок ЄДРПОУ + номер ТТ перед позиціями магазину.
// ============================================================

var BREAD_ORDERS_SHEET  = 'Заказы';
var BREAD_SUMMARY_SHEET = 'Данные Заказов';
var BREAD_EDRPOU = '44413718';

// Колонки сирого листа хліба (див. rawRow у Config.gs):
// A дата | B маршрут | C адреса (коротка) | D штрихкод | E назва | F ціна | G кіл-ть

function breadNum_(v) {
  var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// --- Сьогоднішні робочі рядки сирого листа ---
function breadTodayRows_() {
  var cfg = dirCfg_('bread');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var rows = sh.getRange(last - take + 1, 1, take, 7).getValues();
  var today = formatDateDMY_(new Date());

  return rows.filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim().slice(0, 10);
    if (d !== today) return false;
    // рядки старого формату і порожні хвости відкидаються саме тут
    return String(r[4] || '').trim() && breadNum_(r[6]) > 0;
  });
}

// Підпис стану: дата | рядки | точки | сумарна кількість
function breadSignature_(rows) {
  var qty = 0, addr = {};
  rows.forEach(function (r) {
    qty += breadNum_(r[6]);
    addr[addrKey_(String(r[2] || '').trim())] = 1;
  });
  return formatDateDMY_(new Date()) + '|' + rows.length + '|' +
         Object.keys(addr).length + '|' + qty;
}

// --- Функція для тригера: перезбирає, лише якщо щось змінилось ---
function refreshBreadReports() {
  var rows = breadTodayRows_();
  var sig = breadSignature_(rows);
  var props = PropertiesService.getScriptProperties();

  var ss = SpreadsheetApp.openById(dirCfg_('bread').spreadsheetId);
  var have = ss.getSheetByName(BREAD_ORDERS_SHEET) && ss.getSheetByName(BREAD_SUMMARY_SHEET);

  if (have && props.getProperty('bread_report_sig') === sig) return;

  buildBreadReports();
}

// --- Зібрати обидва звіти ПРЯМО ЗАРАЗ, у будь-якому разі ---
function buildBreadReports() {
  var rows = breadTodayRows_();
  buildBreadOrdersSheet_(rows);
  buildBreadSummarySheet_(rows);
  PropertiesService.getScriptProperties()
    .setProperty('bread_report_sig', breadSignature_(rows));
}

// Обліковий номер ТТ з Довідника за адресою, як вона лежить у сирому листі
// (у хлібі це КОРОТКА адреса - shortAddr: true в Config.gs)
function breadCodeByAddr_() {
  var map = {};
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf('bread') < 0) return;
    map[addrKey_(shortenAddress_(s.addrBread))] = s.code;
  });
  return map;
}

function breadRowList_(rows, c1, c2) {
  return rows.map(function (r) { return c1 + r + ':' + (c2 || c1) + r; });
}

// ============================================================
// ЛИСТ "Заказы" - по маршрутах і точках, для постачальника
// ============================================================
function buildBreadOrdersSheet_(rows) {
  var today = formatDateDMY_(new Date());
  var codes = breadCodeByAddr_();

  var byKey = {};
  rows.forEach(function (r) {
    var route = String(r[1] || '').trim();
    var store = String(r[2] || '').trim();
    if (!store) return;
    var key = route + '|||' + store;
    if (!byKey[key]) byKey[key] = {
      route: route, store: store,
      code: codes[addrKey_(store)] || '', items: []
    };
    byKey[key].items.push({
      barcode: String(r[3] || '').trim(),
      name: String(r[4] || '').trim(),
      qty: breadNum_(r[6])
    });
  });

  var keys = Object.keys(byKey).sort(function (a, b) {
    var pa = a.split('|||'), pb = b.split('|||');
    if (pa[0] !== pb[0]) return pa[0].localeCompare(pb[0], 'uk');
    return pa[1].localeCompare(pb[1], 'uk');
  });

  var head = ['Дата заказа', 'Маршрут', 'Магазин', 'Штрих-код',
              'Название Продукта', 'Количество', 'Код ЄДРПОУ', 'Номер магазина'];
  var data = [head], g = { sep: [], row: [], empty: [] };

  keys.forEach(function (k) {
    var o = byKey[k];
    o.items.sort(function (a, b) { return a.barcode.localeCompare(b.barcode); });

    // спершу рядок із ЄДРПОУ і номером магазину, далі його позиції
    data.push(['', '', '', '', '', '', BREAD_EDRPOU, o.code]);
    g.sep.push(data.length);

    o.items.forEach(function (it) {
      data.push([today, o.route, o.store, it.barcode, it.name, it.qty, '', '']);
      g.row.push(data.length);
    });
  });

  if (data.length === 1) {
    data.push(['Замовлень на ' + today + ' немає', '', '', '', '', '', '', '']);
    g.empty.push(data.length);
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bread').spreadsheetId);
  var sh = ss.getSheetByName(BREAD_ORDERS_SHEET) || ss.insertSheet(BREAD_ORDERS_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();
  // clear() не розбирає зліплені комірки, лишені старим проєктом,
  // а setValues на них падає
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}

  var n = data.length;
  sh.getRange(1, 1, n, head.length).setValues(data);

  sh.getRange(1, 1, n, head.length)
    .setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF')
    .setHorizontalAlignment('left')
    .setBorder(true, true, true, true, true, true);

  // штрихкод і номер магазину - текстом, інакше Google з'їдає нулі
  sh.getRange(1, 4, n, 1).setNumberFormat('@');
  sh.getRange(1, 7, n, 2).setNumberFormat('@');
  sh.getRange(1, 6, n, 1).setNumberFormat('0.###');

  sh.getRange(1, 1, 1, head.length)
    .setBackground('#FFFF00').setFontWeight('bold')
    .setHorizontalAlignment('center');

  if (g.sep.length) sh.getRangeList(breadRowList_(g.sep, 'G', 'H'))
    .setFontWeight('bold').setHorizontalAlignment('center');
  if (g.row.length) {
    sh.getRangeList(breadRowList_(g.row, 'A', 'H')).setFontWeight('bold');
    sh.getRangeList(breadRowList_(g.row, 'A', 'A')).setHorizontalAlignment('center');
    sh.getRangeList(breadRowList_(g.row, 'F', 'F')).setHorizontalAlignment('center');
  }
  if (g.empty.length) sh.getRangeList(breadRowList_(g.empty, 'A', 'H'))
    .setFontColor('#C62828').setFontWeight('bold');

  [110, 120, 200, 150, 400, 100, 110, 130].forEach(function (w, i) {
    sh.setColumnWidth(i + 1, w);
  });
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();

  console.log('Заказы (хліб): рядків ' + n + ', ТТ ' + keys.length +
              ', позицій ' + g.row.length);
}

// ============================================================
// ЛИСТ "Данные Заказов" - зведення по позиціях
// ============================================================
function buildBreadSummarySheet_(rows) {
  var today = formatDateDMY_(new Date());

  var byKey = {}, total = {}, grandQty = 0;
  rows.forEach(function (r) {
    var route = String(r[1] || '').trim();
    var store = String(r[2] || '').trim();
    var barcode = String(r[3] || '').trim();
    var name = String(r[4] || '').trim();
    var qty = breadNum_(r[6]);
    if (!store || !name) return;

    var key = route + '|||' + store;
    if (!byKey[key]) byKey[key] = { route: route, store: store, items: [] };
    byKey[key].items.push({ barcode: barcode, name: name, qty: qty });

    if (!total[barcode]) total[barcode] = { name: name, qty: 0 };
    total[barcode].qty += qty;
    grandQty += qty;
  });

  var keys = Object.keys(byKey).sort(function (a, b) {
    var pa = a.split('|||'), pb = b.split('|||');
    if (pa[0] !== pb[0]) return pa[0].localeCompare(pb[0], 'uk');
    return pa[1].localeCompare(pb[1], 'uk');
  });

  var ordered = {};
  keys.forEach(function (k) { ordered[addrKey_(byKey[k].store)] = 1; });
  var all = loadStores_().filter(function (s) {
    return s.directions.indexOf('bread') >= 0 && dayAllowed_('bread', s);
  });
  var missing = all.filter(function (s) {
    return !ordered[addrKey_(shortenAddress_(s.addrBread))];
  }).map(function (s) { return s.label; });

  var head = ['Маршрут', 'Магазин', 'Штрих-код', 'Название Продукта', 'Количество'];
  var data = [head], g = { row: [], band: [], sumHead: [], sumRow: [],
                           grand: [], missHead: [], miss: [] };

  keys.forEach(function (k) {
    var o = byKey[k];
    o.items.sort(function (a, b) { return a.barcode.localeCompare(b.barcode); });
    o.items.forEach(function (it) {
      data.push([o.route, o.store, it.barcode, it.name, it.qty]);
      g.row.push(data.length);
    });
    data.push(['', '', '', '', '']);
  });

  if (keys.length) {
    data.push(['', '', '', '', '']);
    data.push(['ЗВЕДЕННЯ ПО ПОЗИЦІЯХ - ' + today, '', '', '', '']);
    g.band.push(data.length);
    data.push(['Штрих-код', 'Название Продукта', 'Общее Количество', '', '']);
    g.sumHead.push(data.length);

    Object.keys(total).sort().forEach(function (bc) {
      data.push([bc, total[bc].name, total[bc].qty, '', '']);
      g.sumRow.push(data.length);
    });
    data.push(['', 'ВСЬОГО:', grandQty, '', '']);
    g.grand.push(data.length);
  } else {
    data.push(['Замовлень на ' + today + ' немає', '', '', '', '']);
    g.missHead.push(data.length);
  }

  if (missing.length) {
    data.push(['', '', '', '', '']);
    data.push(['ТТ без замовлень (' + missing.length + '):', '', '', '', '']);
    g.missHead.push(data.length);
    missing.sort(function (a, b) { return a.localeCompare(b, 'uk'); })
      .forEach(function (s) {
        data.push(['   ' + s, '', '', '', '']);
        g.miss.push(data.length);
      });
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bread').spreadsheetId);
  var sh = ss.getSheetByName(BREAD_SUMMARY_SHEET) || ss.insertSheet(BREAD_SUMMARY_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();
  try { sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); } catch (e) {}

  var n = data.length;
  sh.getRange(1, 1, n, head.length).setValues(data);
  sh.getRange(1, 1, n, head.length)
    .setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF')
    .setHorizontalAlignment('left');

  sh.getRange(1, 3, n, 1).setNumberFormat('@');
  sh.getRange(1, 5, n, 1).setNumberFormat('0.###');

  sh.getRange(1, 1, 1, head.length)
    .setBackground('#FFFF00').setFontWeight('bold').setHorizontalAlignment('center');

  if (g.row.length) {
    sh.getRangeList(breadRowList_(g.row, 'A', 'E'))
      .setBorder(true, true, true, true, true, true);
    sh.getRangeList(breadRowList_(g.row, 'E', 'E')).setHorizontalAlignment('center');
  }
  if (g.band.length) sh.getRangeList(breadRowList_(g.band, 'A', 'E'))
    .setBackground('#4CAF50').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(12);
  if (g.sumHead.length) sh.getRangeList(breadRowList_(g.sumHead, 'A', 'C'))
    .setBackground('#FFC107').setFontWeight('bold').setHorizontalAlignment('center');
  if (g.sumRow.length) {
    sh.getRangeList(breadRowList_(g.sumRow, 'A', 'C'))
      .setBorder(true, true, true, true, true, true);
    sh.getRangeList(breadRowList_(g.sumRow, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
  }
  if (g.grand.length) sh.getRangeList(breadRowList_(g.grand, 'A', 'C'))
    .setBackground('#E0E0E0').setFontWeight('bold').setFontSize(11);
  if (g.missHead.length) sh.getRangeList(breadRowList_(g.missHead, 'A', 'E'))
    .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');
  if (g.miss.length) sh.getRangeList(breadRowList_(g.miss, 'A', 'A'))
    .setFontColor('#C62828');

  [120, 200, 150, 400, 100].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  SpreadsheetApp.flush();

  console.log('Данные Заказов (хліб): ТТ ' + keys.length + ' з ' + all.length +
              ', позицій ' + Object.keys(total).length + ', разом ' + grandQty +
              ', без замовлень ' + missing.length);
}
