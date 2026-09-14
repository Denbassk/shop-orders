// ============================================================
// ЗВІТИ ВИПІЧКИ: "Заказы ВК" і "Сводная ВК"
//
// Раніше їх збирав ОКРЕМИЙ проєкт Apps Script (legacy/bakery),
// привязаний до тієї самої таблиці, своїм тригером autoMaintenance.
// Щойно той тригер не відпрацьовував - повар бачив учорашні цифри,
// хоча замовлення в сирому листі лежали.
//
// Тепер усе в одному застосунку:
//   джерело  - _Сырые_Заказы_ВК (той самий лист, куди пише застосунок)
//   список ТТ - Довідник ТТ, а не окремий лист "Адреса ТТ"
//   тригер   - refreshBakeryReports, кожні 5 хвилин (d06_installTriggers)
//
// Старий проєкт після цього треба ВИКЛЮЧИТИ: видалити в ньому
// тригер autoMaintenance, інакше два проєкти перезаписуватимуть
// одні й ті самі два листи.
// ============================================================

var BAKERY_ORDERS_SHEET  = 'Заказы ВК';
var BAKERY_SUMMARY_SHEET = 'Сводная ВК';
var BAKERY_CAT_ORDER = ['Випічка', 'Кулінарія'];
var BAKERY_CAT_ICONS = { 'Випічка': 'Випічка: ', 'Кулінарія': 'Кулінарія: ' };

// Колонки сирого листа випічки (див. rawRow у Config.gs):
// A дата | B час | C адреса | D категорія | E штрихкод | F назва | G ціна | H кіл-ть

// --- Сьогоднішні робочі рядки сирого листа ---
function bakeryTodayRows_() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var rows = sh.getRange(last - take + 1, 1, take, 8).getValues();
  var today = formatDateDMY_(new Date());

  return rows.filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim().slice(0, 10);
    if (d !== today) return false;
    // рядки старого формату (без дати, 4 значення) відкидаються саме тут
    return String(r[5] || '').trim() && (Number(r[7]) || 0) > 0;
  });
}

// Підпис стану: рядки | точки | сумарна кількість.
// Стара защіпка порівнювала getLastRow() - після архівування, коли
// лист схлопнувся з 20 000 рядків до 595, вона стала безглуздою
// і блокувала перезбірку. Тут порівнюється сам ВМІСТ за сьогодні.
function bakerySignature_(rows) {
  var qty = 0, addr = {};
  rows.forEach(function (r) {
    qty += Number(r[7]) || 0;
    addr[addrKey_(String(r[2] || '').trim())] = 1;
  });
  return formatDateDMY_(new Date()) + '|' + rows.length + '|' +
         Object.keys(addr).length + '|' + qty;
}

// --- Функція для тригера: перезбирає, лише якщо щось змінилось ---
function refreshBakeryReports() {
  var rows = bakeryTodayRows_();
  var sig = bakerySignature_(rows);
  var props = PropertiesService.getScriptProperties();

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var have = ss.getSheetByName(BAKERY_ORDERS_SHEET) && ss.getSheetByName(BAKERY_SUMMARY_SHEET);

  if (have && props.getProperty('bakery_report_sig') === sig) return;

  buildBakeryReports();
}

// --- Зібрати обидва звіти ПРЯМО ЗАРАЗ, у будь-якому разі ---
function buildBakeryReports() {
  var rows = bakeryTodayRows_();
  buildBakeryOrdersSheet_(rows);
  buildBakerySummarySheet_(rows);
  PropertiesService.getScriptProperties()
    .setProperty('bakery_report_sig', bakerySignature_(rows));
}

// ТТ напрямку з Довідника - лише ті, у кого сьогодні робочий день
function bakeryStoresToday_() {
  return loadStores_().filter(function (s) {
    return s.directions.indexOf('bakery') >= 0 && dayAllowed_('bakery', s);
  });
}

// Категорії у потрібному порядку: Випічка, Кулінарія, далі решта
function bakeryCats_(obj) {
  var cats = BAKERY_CAT_ORDER.filter(function (c) { return obj[c] && obj[c].length; });
  Object.keys(obj).forEach(function (c) {
    if (BAKERY_CAT_ORDER.indexOf(c) < 0 && obj[c] && obj[c].length) cats.push(c);
  });
  return cats;
}

function bakeryRowList_(rows, c1, c2) {
  return rows.map(function (r) { return c1 + r + ':' + (c2 || c1) + r; });
}

// ============================================================
// ЛИСТ "Заказы ВК"
// ============================================================
function buildBakeryOrdersSheet_(rows) {
  var today = formatDateDMY_(new Date());

  var byStore = {};
  rows.forEach(function (r) {
    var addr = String(r[2] || '').trim();
    if (!addr) return;
    var cat = String(r[3] || '').trim() || 'Інше';
    byStore[addr] = byStore[addr] || {};
    byStore[addr][cat] = byStore[addr][cat] || [];
    byStore[addr][cat].push({
      name: String(r[5] || '').trim(),
      price: Number(r[6]) || 0,
      qty: Number(r[7]) || 0
    });
  });

  var ordered = {};
  Object.keys(byStore).forEach(function (a) { ordered[addrKey_(a)] = true; });

  var all = bakeryStoresToday_();
  var missing = all.filter(function (s) {
    return !ordered[addrKey_(s.addrBakery)];
  }).map(function (s) { return s.label; });

  var data = [], g = { title: [], sub: [], head: [], store: [], cat: [],
                       row: [], total: [], grand: [], missHead: [], miss: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Замовлення випічки та кулінарії - ' + today, '', '', ''], 'title');
  push(['ТТ із замовленнями: ' + Object.keys(byStore).length + ' з ' + all.length +
        '   (оновлено ' + formatTime_(new Date()) + ')', '', '', ''], 'sub');
  push(['', '', '', ''], null);
  push(['№', 'Назва товару', 'Кіл-ть', 'Сума, грн'], 'head');

  var num = 1, grandQty = 0, grandSum = 0;

  Object.keys(byStore).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
    .forEach(function (store) {
      push([store, '', '', ''], 'store');
      var sQty = 0, sSum = 0;

      bakeryCats_(byStore[store]).forEach(function (cat) {
        push([cat, '', '', ''], 'cat');
        byStore[store][cat].forEach(function (it) {
          var sum = Math.round(it.price * it.qty * 100) / 100;
          sQty += it.qty;
          sSum = Math.round((sSum + sum) * 100) / 100;
          push([num++, it.name, it.qty, sum], 'row');
        });
      });

      push(['РАЗОМ по ТТ:', '', sQty, sSum], 'total');
      push(['', '', '', ''], null);
      grandQty += sQty;
      grandSum = Math.round((grandSum + sSum) * 100) / 100;
    });

  if (Object.keys(byStore).length) {
    push(['ЗАГАЛЬНИЙ ПІДСУМОК', '', grandQty, grandSum], 'grand');
    push(['', '', '', ''], null);
  } else {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'missHead');
    push(['', '', '', ''], null);
  }

  if (missing.length) {
    push(['ТТ без замовлень (' + missing.length + '):', '', '', ''], 'missHead');
    missing.sort(function (a, b) { return a.localeCompare(b, 'uk'); })
      .forEach(function (s) { push(['   ' + s, '', '', ''], 'miss'); });
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var sh = ss.getSheetByName(BAKERY_ORDERS_SHEET) || ss.insertSheet(BAKERY_ORDERS_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  var n = data.length;
  sh.getRange(1, 1, n, 4).setValues(data);

  sh.getRange(1, 1, n, 4).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  if (g.title.length) sh.getRangeList(bakeryRowList_(g.title, 'A', 'D'))
    .setBackground('#1565C0').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.sub.length) sh.getRangeList(bakeryRowList_(g.sub, 'A', 'D'))
    .setBackground('#E3F2FD').setFontColor('#1565C0').setFontSize(11);
  if (g.head.length) sh.getRangeList(bakeryRowList_(g.head, 'A', 'D'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.store.length) sh.getRangeList(bakeryRowList_(g.store, 'A', 'D'))
    .setBackground('#1976D2').setFontColor('#FFFFFF').setFontWeight('bold');
  if (g.cat.length) sh.getRangeList(bakeryRowList_(g.cat, 'A', 'D'))
    .setBackground('#FFF8E1').setFontColor('#E65100').setFontWeight('bold');

  if (g.row.length) {
    var even = g.row.filter(function (_, i) { return i % 2 === 1; });
    if (even.length) sh.getRangeList(bakeryRowList_(even, 'A', 'D')).setBackground('#F8F9FA');
    sh.getRangeList(bakeryRowList_(g.row, 'A', 'A')).setHorizontalAlignment('center');
    sh.getRangeList(bakeryRowList_(g.row, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.row, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.total.length) {
    sh.getRangeList(bakeryRowList_(g.total, 'A', 'D'))
      .setBackground('#E8F5E9').setFontColor('#2E7D32').setFontWeight('bold');
    // 0.### - щоб кількість була "11", а не "11,00": формат
    // підтягувався від попереднього вмісту листа
    sh.getRangeList(bakeryRowList_(g.total, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.total, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.grand.length) {
    sh.getRangeList(bakeryRowList_(g.grand, 'A', 'D'))
      .setBackground('#388E3C').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(11);
    sh.getRangeList(bakeryRowList_(g.grand, 'C', 'C'))
      .setHorizontalAlignment('center').setNumberFormat('0.###');
    sh.getRangeList(bakeryRowList_(g.grand, 'D', 'D'))
      .setHorizontalAlignment('right').setNumberFormat('#,##0.00');
  }
  if (g.missHead.length) sh.getRangeList(bakeryRowList_(g.missHead, 'A', 'D'))
    .setBackground('#FFEBEE').setFontColor('#C62828').setFontWeight('bold');
  if (g.miss.length) sh.getRangeList(bakeryRowList_(g.miss, 'A', 'A')).setFontColor('#C62828');

  sh.setColumnWidth(1, 50);
  sh.setColumnWidth(2, 420);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 120);
  sh.setFrozenRows(4);
  SpreadsheetApp.flush();

  console.log('Заказы ВК: рядків ' + n + ', позицій ' + (num - 1) +
              ', ТТ ' + Object.keys(byStore).length + ' з ' + all.length +
              ', без замовлень ' + missing.length);
}

// ============================================================
// ЛИСТ "Сводная ВК"
// ============================================================
function buildBakerySummarySheet_(rows) {
  var today = formatDateDMY_(new Date());

  var sum = {}, grandQty = 0, grandSum = 0;
  rows.forEach(function (r) {
    var cat = String(r[3] || '').trim() || 'Інше';
    var name = String(r[5] || '').trim();
    var qty = Number(r[7]) || 0;
    var price = Number(r[6]) || 0;
    sum[cat] = sum[cat] || {};
    sum[cat][name] = sum[cat][name] || { qty: 0, sum: 0 };
    sum[cat][name].qty += qty;
    sum[cat][name].sum = Math.round((sum[cat][name].sum + price * qty) * 100) / 100;
    grandQty += qty;
    grandSum = Math.round((grandSum + price * qty) * 100) / 100;
  });

  var data = [], g = { title: [], head: [], cat: [], row: [], total: [] };
  function push(v, t) { data.push(v); if (t) g[t].push(data.length); }

  push(['Зведена таблиця - ' + today +
        '   (оновлено ' + formatTime_(new Date()) + ')', '', '', ''], 'title');
  push(['Асортимент', 'Кількість, шт', 'Сума, грн', '% від заг.'], 'head');

  if (!rows.length) {
    push(['Замовлень на сьогодні ще немає', '', '', ''], 'cat');
  } else {
    var catNames = {};
    Object.keys(sum).forEach(function (c) { catNames[c] = Object.keys(sum[c]); });

    bakeryCats_(catNames).forEach(function (cat) {
      var items = sum[cat], cQty = 0, cSum = 0;
      Object.keys(items).forEach(function (nm) {
        cQty += items[nm].qty;
        cSum = Math.round((cSum + items[nm].sum) * 100) / 100;
      });
      push([cat, cQty, cSum,
            grandQty ? (cQty / grandQty * 100).toFixed(1) + '%' : '0%'], 'cat');

      Object.keys(items).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
        .forEach(function (nm) {
          var d = items[nm];
          push([nm, d.qty, d.sum,
                grandQty ? (d.qty / grandQty * 100).toFixed(1) + '%' : '0%'], 'row');
        });
      push(['', '', '', ''], null);
    });
    push(['ЗАГАЛОМ', grandQty, grandSum, '100%'], 'total');
  }

  var ss = SpreadsheetApp.openById(dirCfg_('bakery').spreadsheetId);
  var sh = ss.getSheetByName(BAKERY_SUMMARY_SHEET) || ss.insertSheet(BAKERY_SUMMARY_SHEET);
  sh.clear();
  sh.clearConditionalFormatRules();

  var n = data.length;
  sh.getRange(1, 1, n, 4).setValues(data);
  sh.getRange(1, 1, n, 4).setFontFamily('Arial').setFontSize(10)
    .setVerticalAlignment('middle').setFontColor('#212121').setBackground('#FFFFFF');
  sh.setRowHeights(1, n, 24);

  // формати задаємо явно, щоб % з колонки D не перетікав у C
  sh.getRange(1, 1, n, 1).setNumberFormat('@');
  sh.getRange(1, 2, n, 1).setNumberFormat('0.###');
  sh.getRange(1, 3, n, 1).setNumberFormat('#,##0.00');
  sh.getRange(1, 4, n, 1).setNumberFormat('@');

  if (g.title.length) sh.getRangeList(bakeryRowList_(g.title, 'A', 'D'))
    .setBackground('#1565C0').setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  if (g.head.length) sh.getRangeList(bakeryRowList_(g.head, 'A', 'D'))
    .setBackground('#37474F').setFontColor('#FFFFFF').setFontWeight('bold')
    .setHorizontalAlignment('center');
  if (g.cat.length) sh.getRangeList(bakeryRowList_(g.cat, 'A', 'D'))
    .setBackground('#FFF8E1').setFontColor('#E65100').setFontWeight('bold');
  if (g.total.length) sh.getRangeList(bakeryRowList_(g.total, 'A', 'D'))
    .setBackground('#388E3C').setFontColor('#FFFFFF').setFontWeight('bold');

  sh.setColumnWidth(1, 420);
  sh.setColumnWidth(2, 120);
  sh.setColumnWidth(3, 120);
  sh.setColumnWidth(4, 100);
  sh.setFrozenRows(2);
  SpreadsheetApp.flush();

  console.log('Сводная ВК: позицій ' + Math.max(n - 2, 0) +
              ', разом ' + grandQty + ' шт / ' + grandSum + ' грн');
}

// ============================================================
// ПРИБИРАННЯ СМІТТЯ В СИРОМУ ЛИСТІ
// Рядки старого формату: без дати в колонці A, адреса в першій
// колонці, чотири значення замість восьми. Звіт їх і так відкидає.
// ============================================================
function cleanBakeryRawJunk() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('Лист порожній'); return; }

  var last = sh.getLastRow();
  var vals = sh.getRange(2, 1, last - 1, 8).getValues();
  var bad = [];
  vals.forEach(function (r, i) {
    var hasDate = (r[0] instanceof Date) || !!parseDMY_(String(r[0]));
    if (!hasDate && r.join('').trim()) bad.push(i + 2);
  });

  if (!bad.length) { console.log('Смітникових рядків немає'); return; }
  console.log('Видаляю рядків: ' + bad.length);
  bad.forEach(function (r) { console.log('   ' + r + ': ' + vals[r - 2].join(' | ')); });

  for (var i = bad.length - 1; i >= 0; i--) sh.deleteRow(bad[i]);
  SpreadsheetApp.flush();
  console.log('Готово. У роботі лишилось рядків: ' + (sh.getLastRow() - 1));
}

// --- Діагностика: що саме бачить звіт ---
function whyNoBakeryReport() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  console.log('Таблиця: ' + cfg.spreadsheetId);
  console.log('Сирий лист "' + rawSheetName_(cfg) + '": ' +
              (sh ? (sh.getLastRow() - 1) + ' рядків' : 'НЕ ЗНАЙДЕНО'));

  var rows = bakeryTodayRows_();
  console.log('Робочих рядків за сьогодні: ' + rows.length);
  var addr = {};
  rows.forEach(function (r) { addr[String(r[2] || '').trim()] = true; });
  Object.keys(addr).sort().forEach(function (a) { console.log('   ' + a); });

  var all = bakeryStoresToday_();
  console.log('ТТ напрямку з робочим днем: ' + all.length);
  console.log('Асортимент доступний: ' + loadProducts_('bakery').length + ' позицій');
  console.log('Підпис стану: ' + bakerySignature_(rows));
  console.log('Записаний підпис: ' +
    PropertiesService.getScriptProperties().getProperty('bakery_report_sig'));
}


// ============================================================
// СИРИЙ ЛИСТ: ПРИВЕСТИ ДО ЛАДУ
//
// У листі лишилась шапка СТАРОГО формату на 4 колонки
// ("Адрес ТТ | | Назва | Кількість"), хоча застосунок пише 8 -
// див. rawRow для bakery у Config.gs:
//   A дата | B час | C адреса | D категорія
//   E штрихкод | F назва | G ціна | H кіл-ть
// Дані від цього не страдають (звіт читає за позицією колонки),
// але дивитись на лист неможливо: підписи не від тих колонок.
//
// Заодно знімаємо фільтр і розкриваємо все приховане. Фільтр на
// сирому листі тільки шкодить: append дописує рядки НИЖЧЕ його
// діапазону, і свіжі замовлення просто не показуються.
// ============================================================
function fixBakeryRawSheet() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh) { console.log('Лист "' + rawSheetName_(cfg) + '" не знайдено'); return; }

  console.log('Було в шапці: ' + sh.getRange(1, 1, 1, 8).getValues()[0].join(' | '));

  try {
    var f = sh.getFilter();
    if (f) { f.remove(); console.log('Фільтр знято'); }
  } catch (e) { console.log('Фільтр: ' + e.message); }

  var maxR = sh.getMaxRows(), maxC = Math.max(sh.getMaxColumns(), 8);
  sh.showRows(1, maxR);
  sh.showColumns(1, maxC);
  console.log('Розкрито рядки 1-' + maxR + ' і колонки 1-' + maxC);

  var head = ['Дата', 'Час', 'Адреса ТТ', 'Категорія',
              'Штрих-код', 'Номенклатура', 'Ціна', 'Кількість'];
  sh.getRange(1, 1, 1, 8).setValues([head])
    .setFontWeight('bold').setBackground('#1565C0').setFontColor('#ffffff')
    .setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(0);

  sh.setColumnWidth(1, 95);  sh.setColumnWidth(2, 75);
  sh.setColumnWidth(3, 280); sh.setColumnWidth(4, 110);
  sh.setColumnWidth(5, 140); sh.setColumnWidth(6, 330);
  sh.setColumnWidth(7, 80);  sh.setColumnWidth(8, 90);
  SpreadsheetApp.flush();

  console.log('Стало: ' + head.join(' | '));
  console.log('Останній рядок з даними: ' + sh.getLastRow() +
              ' (рядків з замовленнями ' + (sh.getLastRow() - 1) + ')');
  console.log('Усе, що нижче - порожній хвіст листа. Ctrl+Home - на початок.');
}

// --- Показати хвіст сирого листа прямо в лог ---
// Найнадійніший спосіб переконатись, що замовлення на місці:
// не залежить ні від прокрутки, ні від фільтрів, ні від шапки.
function showBakeryRawTail(n) {
  n = n || 25;
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) { console.log('Лист порожній'); return; }

  var last = sh.getLastRow();
  var take = Math.min(last - 1, n);
  var from = last - take + 1;
  var rows = sh.getRange(from, 1, take, 8).getValues();
  var today = formatDateDMY_(new Date());

  console.log('Лист "' + rawSheetName_(cfg) + '": рядків з даними ' + (last - 1) +
              ', показую останні ' + take + ' (рядки ' + from + '-' + last + ')');
  console.log('рядок | дата | час | адреса | категорія | назва | ціна | кіл-ть');
  rows.forEach(function (r, i) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
    var t = (r[1] instanceof Date) ? formatTime_(r[1]) : String(r[1]).trim();
    console.log((from + i) + (d === today ? ' * ' : ' | ') +
                [d, t, r[2], r[3], r[5], r[6], r[7]].join(' | '));
  });
  console.log('--- рядки з * - сьогоднішні (' + today + ') ---');
  console.log('Архів старших замовлень - на листі "_Архів".');
}


// ============================================================
// РЕМОНТ СИРОГО ЛИСТА
//
// Прибирає все, через що append писав не в кінець листа:
//   - рядки СТАРОГО формату (адреса в колонці A, без дати)
//   - порожні рядки всередині даних (саме вони і є "розрив")
// І вирівнює формати, щоб нові рядки успадковували нормальний
// вигляд, а не чорну шапку.
//
// Запускати один раз після переходу на INSERT_ROWS.
// ============================================================
function repairBakeryRawSheet() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh) { console.log('Лист "' + rawSheetName_(cfg) + '" не знайдено'); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { console.log('Лист зайнятий - спробуйте за хвилину'); return; }
  try {
    var last = sh.getLastRow();
    if (last < 2) { console.log('Даних немає'); return; }

    var vals = sh.getRange(2, 1, last - 1, 8).getValues();
    var bad = [], junk = 0, empty = 0, good = 0;
    vals.forEach(function (row, i) {
      var blank = row.join('').trim() === '';
      var dated = (row[0] instanceof Date) || !!parseDMY_(String(row[0]));
      if (blank) { empty++; bad.push(i + 2); return; }
      if (!dated) { junk++; bad.push(i + 2); return; }
      good++;
    });

    console.log('Рядків усього ' + (last - 1) + ': робочих ' + good +
                ', старого формату ' + junk + ', порожніх ' + empty);

    if (bad.length) {
      var ranges = [], start = bad[0], prev = bad[0];
      for (var j = 1; j < bad.length; j++) {
        if (bad[j] === prev + 1) { prev = bad[j]; continue; }
        ranges.push([start, prev]); start = bad[j]; prev = bad[j];
      }
      ranges.push([start, prev]);
      ranges.reverse();
      ranges.forEach(function (x) { sh.deleteRows(x[0], x[1] - x[0] + 1); });
      SpreadsheetApp.flush();
      console.log('Видалено рядків: ' + bad.length + ', відрізків: ' + ranges.length);
    } else {
      console.log('Видаляти нічого - лист уже чистий');
    }

    var n = Math.max(sh.getLastRow() - 1, 1);
    sh.getRange(2, 1, n, 8).setBackground(null).setFontColor('#000000')
      .setFontWeight('normal').setFontSize(10).setFontFamily('Arial');
    sh.getRange(2, 1, n, 1).setNumberFormat('dd.MM.yyyy');
    sh.getRange(2, 2, n, 1).setNumberFormat('HH:mm:ss');
    sh.getRange(2, 5, n, 1).setNumberFormat('@');
    sh.getRange(2, 7, n, 1).setNumberFormat('0.00');
    sh.getRange(2, 8, n, 1).setNumberFormat('0.###');
    SpreadsheetApp.flush();

    console.log('Формати вирівняно. Робочих рядків лишилось: ' + (sh.getLastRow() - 1));
    console.log('Тепер append дописує строго в кінець листа.');
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// ============================================================
// СОРТУВАННЯ СИРОГО ЛИСТА ПО ДАТІ І ЧАСУ
//
// Рядки від 12.09 лишились посеред 14.09 - так їх колись поклав
// append із OVERWRITE. Звіту це не шкодить (він фільтрує по даті),
// але archiveRawSheets() з Archive.gs вважає старі рядки ПРЕФІКСОМ
// листа і ріже перший блок до першої свіжої дати. Якщо дати
// вперемішку - архівування зупиняється з "дати вперемішку".
//
// Далі порядок тримається сам: append дописує в кінець.
// ============================================================
function sortBakeryRawSheet() {
  var cfg = dirCfg_('bakery');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 3) { console.log('Сортувати нічого'); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { console.log('Лист зайнятий - спробуйте за хвилину'); return; }
  try {
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
    rows.sort(function (a, b) { return bakeryStamp_(a) - bakeryStamp_(b); });
    sh.getRange(2, 1, rows.length, 8).setValues(rows);
    SpreadsheetApp.flush();
    console.log('Відсортовано рядків: ' + rows.length);
    console.log('Перший: ' + rows[0][0] + ', останній: ' + rows[rows.length - 1][0]);
  } finally { try { lock.releaseLock(); } catch (e) {} }
}

// Дата + час одним числом. Час у листі - Date від 30.12.1899,
// тож із нього беремо лише години-хвилини-секунди.
function bakeryStamp_(r) {
  var d = (r[0] instanceof Date) ? r[0] : parseDMY_(String(r[0]));
  if (!d) return 0;
  var ms = d.getTime(), t = r[1];
  if (t instanceof Date)
    ms += t.getHours() * 3600000 + t.getMinutes() * 60000 + t.getSeconds() * 1000;
  return ms;
}