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
// Sheets API під запобіжником: зависла таблиця ВК не тримає нікого іншого.
// Дата - рядок ДД.ММ.РРРР, час - "HH:mm", рядок доповнено до 8 колонок.
function bakeryTodayRows_(probe) {
  var cfg = dirCfg_('bakery');
  var tail = guardedDir_('bakery', function () { return rawTailApi_(cfg, 'H'); }, probe);
  var today = formatDateDMY_(new Date());

  return tail.rows.map(function (r) {
    var x = [];
    for (var i = 0; i < 8; i++) x.push(r[i] == null ? '' : r[i]);
    x[0] = dmyApi_(x[0]).slice(0, 10);
    x[1] = timeApi_(x[1]);
    x[7] = numApi_(x[7]);
    return x;
  }).filter(function (r) {
    if (r[0] !== today) return false;
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
  if (dirStuck_('bakery')) { console.log('таблиця ВК не відповідає - пропускаю'); return; }
  // probe: тригер - єдиний, хто перевіряє, чи ожила "повільна" таблиця ВК
  var rows = bakeryTodayRows_(true);
  // Немає сьогодні замовлень ВК (вихідний напрямку, або вже після дедлайну
  // 13:00) - нема чого пересобирати і нема чого сортувати. Інакше тригер
  // щоп'ять хвилин бере ГЛОБАЛЬНИЙ ScriptLock на сортування всієї історії
  // листа ВК, і в цей час відправка інших напрямків (НБХЗ, овочі) стоїть
  // у черзі за тим самим замком. 18.10.2026: саме через це висів НБХЗ.
  if (!rows.length) return;
  var sig = bakerySignature_(rows);
  var props = PropertiesService.getScriptProperties();

  // лист могли перезаписать чужим скриптом (старый legacy/bakery) - тогда
  // заголовок уже не тот, что мы записали, и надо пересобрать.
  // Листа нет - чтение падает, тогда тоже пересобираем.
  if (props.getProperty('bakery_report_sig') === sig) {
    var stamp = '';
    try {
      stamp = bakeryReportStamp_();
      apiValues_(dirCfg_('bakery').spreadsheetId, a1q_(BAKERY_ROUTE_SHEET, 'A1'));
    } catch (e) { stamp = ''; }
    if (stamp && props.getProperty('bakery_report_stamp') === stamp) return;
  }

  // ті самі рядки: друге читання поза probe впало б на позначці "повільна"
  buildBakeryReports(rows);
}

// --- Зібрати обидва звіти ПРЯМО ЗАРАЗ, у будь-якому разі ---
function buildBakeryReports(preRows) {
  // Сирий лист БІЛЬШЕ НЕ СОРТУЄМО (18.10.2026): sortRange всієї таблиці під
  // глобальним ScriptLock тримав замок до 360 с і поклав усі напрямки.
  // Порядок потрібен лише звітам - сортуємо в памʼяті: адреса, назва.
  var rows = (preRows || bakeryTodayRows_()).slice().sort(function (a, b) {
    var x = String(a[2] || '').localeCompare(String(b[2] || ''), 'uk');
    return x || String(a[5] || '').localeCompare(String(b[5] || ''), 'uk');
  });
  buildBakeryOrdersSheet_(rows);
  buildBakerySummarySheet_(rows);
  buildBakeryRouteSheet_(rows);
  markReport_('bakery');
  PropertiesService.getScriptProperties().setProperties({
    bakery_report_sig: bakerySignature_(rows),
    bakery_report_stamp: bakeryReportStamp_()
  });
}

// Заголовки (A1) "Заказы ВК" и "Сводная ВК". В них есть время сборки,
// поэтому чужая перезапись сразу видна.
function bakeryReportStamp_() {
  var res = Sheets.Spreadsheets.Values.batchGet(dirCfg_('bakery').spreadsheetId, {
    ranges: [a1q_(BAKERY_ORDERS_SHEET, 'A1'), a1q_(BAKERY_SUMMARY_SHEET, 'A1')],
    valueRenderOption: 'FORMATTED_VALUE'
  });
  return (res.valueRanges || []).map(function (vr) {
    return (vr.values && vr.values[0] && vr.values[0][0] != null) ? String(vr.values[0][0]) : '';
  }).join('|');
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
    var cat = bakeryCatOf_(r);
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

  // один batchUpdate Sheets API замість SpreadsheetApp (див. SheetsFast.gs)
  var n = data.length;
  var w = apiSheetWriter_(dirCfg_('bakery').spreadsheetId, BAKERY_ORDERS_SHEET, data, 4);
  w.fmt(null, 'A', 'D', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
  w.rowHeights(24);

  w.fmt(g.title, 'A', 'D', { bg: '#1565C0', color: '#FFFFFF', bold: true, size: 14 });
  w.fmt(g.sub, 'A', 'D', { bg: '#E3F2FD', color: '#1565C0', size: 11 });
  w.fmt(g.head, 'A', 'D', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
  w.fmt(g.store, 'A', 'D', { bg: '#1976D2', color: '#FFFFFF', bold: true });
  w.fmt(g.cat, 'A', 'D', { bg: '#FFF8E1', color: '#E65100', bold: true });

  if (g.row.length) {
    var even = g.row.filter(function (_, i) { return i % 2 === 1; });
    w.fmt(even, 'A', 'D', { bg: '#F8F9FA' });
    w.fmt(g.row, 'A', 'A', { halign: 'center' });
    w.fmt(g.row, 'C', 'C', { halign: 'center', num: '0.###' });
    w.fmt(g.row, 'D', 'D', { halign: 'right', num: '#,##0.00' });
  }
  // 0.### - щоб кількість була "11", а не "11,00"
  w.fmt(g.total, 'A', 'D', { bg: '#E8F5E9', color: '#2E7D32', bold: true });
  w.fmt(g.total, 'C', 'C', { halign: 'center', num: '0.###' });
  w.fmt(g.total, 'D', 'D', { halign: 'right', num: '#,##0.00' });
  w.fmt(g.grand, 'A', 'D', { bg: '#388E3C', color: '#FFFFFF', bold: true, size: 11 });
  w.fmt(g.grand, 'C', 'C', { halign: 'center', num: '0.###' });
  w.fmt(g.grand, 'D', 'D', { halign: 'right', num: '#,##0.00' });
  w.fmt(g.missHead, 'A', 'D', { bg: '#FFEBEE', color: '#C62828', bold: true });
  w.fmt(g.miss, 'A', 'A', { color: '#C62828' });

  w.colWidths([50, 420, 90, 120]).frozen(4).commit();

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
    var cat = bakeryCatOf_(r);
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

  var n = data.length;
  var w = apiSheetWriter_(dirCfg_('bakery').spreadsheetId, BAKERY_SUMMARY_SHEET, data, 4);
  w.fmt(null, 'A', 'D', { font: 'Arial', size: 10, valign: 'middle', color: '#212121', bg: '#FFFFFF' });
  w.rowHeights(24);

  // формати задаємо явно, щоб % з колонки D не перетікав у C
  w.fmt(null, 'A', 'A', { num: '@' });
  w.fmt(null, 'B', 'B', { num: '0.###' });
  w.fmt(null, 'C', 'C', { num: '#,##0.00' });
  w.fmt(null, 'D', 'D', { num: '@' });

  w.fmt(g.title, 'A', 'D', { bg: '#1565C0', color: '#FFFFFF', bold: true, size: 14 });
  w.fmt(g.head, 'A', 'D', { bg: '#37474F', color: '#FFFFFF', bold: true, halign: 'center' });
  w.fmt(g.cat, 'A', 'D', { bg: '#FFF8E1', color: '#E65100', bold: true });
  w.fmt(g.total, 'A', 'D', { bg: '#388E3C', color: '#FFFFFF', bold: true });

  w.colWidths([420, 120, 120, 100]).frozen(2).commit();

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

  var head = ['Дата', 'Час', 'Адреса ТТ', 'Маршрут',
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

  // Орієнтація. Задаємо на ВСЮ колонку до кінця листа, щоб нові
  // рядки від append успадкували вирівнювання, а не отримали
  // випадкове від сусіда.
  //   дата, час, ціна, кіл-ть - по центру
  //   адреса, категорія, штрихкод, назва - по лівому краю
  sh.getRange(2, 1, maxR - 1, 2).setHorizontalAlignment('center');
  sh.getRange(2, 3, maxR - 1, 4).setHorizontalAlignment('left');
  sh.getRange(2, 7, maxR - 1, 2).setHorizontalAlignment('center');
  sh.getRange(1, 1, 1, 8).setHorizontalAlignment('center');
  sh.getRange(2, 1, maxR - 1, 8).setVerticalAlignment('middle');
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
  sortBakeryRawApi_([0, 1]);   // дата, час - на боці Google, див. BakeryZones.gs
  console.log('Сирий лист ВК впорядковано по даті і часу');
}

// ============================================================
// ХТО ЗАМОВЛЯВ, АЛЕ РЯДКІВ НЕМА = ЗАТЕРТЕ ЗАМОВЛЕННЯ
//
// Екран показує "можна замовити", бо статус читає сирий лист.
// Відправка ж дивиться на позначку sub_bakery_* у властивостях
// скрипта - вона лишається, навіть якщо рядки з листа зникли.
// Звідси розбіжність: напрямок відкритий, а на "Відправити"
// пише "вже сьогодні відправлено".
//
// Позначка = точка справді надсилала замовлення. Немає рядків -
// значить його затерло старим OVERWRITE.
// ============================================================
function bakeryLostOrders() {
  var today = formatDateDMY_(new Date());
  var props = PropertiesService.getScriptProperties().getProperties();

  var inSheet = {};
  bakeryTodayRows_().forEach(function (r) {
    inSheet[addrKey_(String(r[2] || '').trim())] = true;
  });

  var byKey = {};
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf('bakery') >= 0) byKey[statusKey_('bakery', s)] = s.label;
  });

  var lost = [], fine = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('sub_bakery_') !== 0 || props[k] !== today) return;
    var key = k.substring('sub_bakery_'.length);
    var label = byKey[key] || ('? ' + key);
    if (inSheet[key]) fine.push(label); else lost.push(label);
  });

  console.log('Позначок "замовляли сьогодні": ' + (lost.length + fine.length));
  console.log('З рядками в листі (усе гаразд): ' + fine.length);
  fine.sort().forEach(function (l) { console.log('   ' + l); });
  console.log('БЕЗ рядків - замовлення ЗАТЕРТО: ' + lost.length);
  lost.sort().forEach(function (l) { console.log('   ' + l); });
  if (lost.length) {
    console.log('---');
    console.log('Цим точкам треба переслати замовлення. Щоб застосунок їх пустив,');
    console.log('запустіть clearBakeryLostMarks() - вона знімає саме ці позначки.');
  }
}

// Зняти позначки лише в тих, у кого рядків немає. Точок із живими
// рядками не торкається - інакше вони змогли б замовити двічі.
function clearBakeryLostMarks() {
  var today = formatDateDMY_(new Date());
  var sp = PropertiesService.getScriptProperties();
  var props = sp.getProperties();

  var inSheet = {};
  bakeryTodayRows_().forEach(function (r) {
    inSheet[addrKey_(String(r[2] || '').trim())] = true;
  });

  var byKey = {};
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf('bakery') >= 0) byKey[statusKey_('bakery', s)] = s.label;
  });

  var n = 0;
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('sub_bakery_') !== 0 || props[k] !== today) return;
    var key = k.substring('sub_bakery_'.length);
    if (inSheet[key]) return;
    sp.deleteProperty(k);
    console.log('знято: ' + (byKey[key] || key));
    n++;
  });

  CacheService.getScriptCache().remove('status_v4');
  console.log('Знято позначок: ' + n + '. Ці точки можуть відправити замовлення заново.');
}
// ============================================================
// СЛІД ЗАМОВЛЕНЬ У ВЛАСТИВОСТЯХ СКРИПТА
// rememberOrder_ зберігає результат кожної відправки під ключем oid_<id>.
// cleanupOldOrderIds чистить лише записи за минулі дні, тож сьогоднішні
// живі. Позицій там немає - є точка, час, кількість позицій і сума.
// ============================================================
function bakeryOrderTrace() {
  var cfg = dirCfg_('bakery');
  var today = formatDateDMY_(new Date());
  var props = PropertiesService.getScriptProperties().getProperties();

  var traces = [];
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('oid_') !== 0) return;
    var r = null;
    try { r = JSON.parse(props[k]); } catch (e) { return; }
    if (!r || r.direction !== cfg.title) return;
    traces.push({ date: r.date || '', time: String(r.time || ''),
                  store: r.store || '', pos: r.positions || 0,
                  total: r.total || 0 });
  });
  traces.sort(function (a, b) { return a.time < b.time ? -1 : 1; });

  var inSheet = {};
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
      if (d !== today) return;
      inSheet[addrKey_(String(r[2]).trim())] = true;
    });
  }

  var keyByLabel = {};
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf('bakery') < 0) return;
    keyByLabel[s.label] = statusKey_('bakery', s);
  });

  console.log('=== слід замовлень випічки (' + traces.length + ' записів) ===');
  console.log('дата | час | точка | позицій | сума | рядки в листі');
  var lost = [];
  traces.forEach(function (t) {
    var key = keyByLabel[t.store];
    var ok = key ? !!inSheet[key] : false;
    console.log(t.date + ' | ' + t.time + ' | ' + t.store + ' | ' +
                t.pos + ' | ' + t.total + ' | ' + (ok ? 'є' : 'НЕМА'));
    if (t.date === today && !ok) lost.push(t);
  });

  if (!lost.length) {
    console.log('---');
    console.log('Усі сьогоднішні відправки мають рядки в листі. Втрат немає.');
    return;
  }

  console.log('---');
  console.log('ЗАТЕРТО, але слід зберігся (' + lost.length + '):');
  lost.forEach(function (t) {
    console.log('   ' + t.store + ' - ' + t.time + ', позицій ' + t.pos +
                ', сума ' + t.total + ' грн');
  });
  console.log('---');
  console.log('Позицій у властивостях немає - лише кількість і сума.');
  console.log('Склад замовлення бере або з Історії версій листа, або у продавця.');
}
// ============================================================
// СОРТУВАННЯ СИРОГО ЛИСТА: ДАТА -> АДРЕСА -> ТОВАР
//
// Так рядки однієї ТТ стоять разом. Дата лишається ПЕРШИМ ключем -
// інакше архівування вважає дати "вперемішку".
// Категорія окремим ключем не потрібна: назви починаються з "Випічка" /
// "Кулінарія", тож сортування за назвою саме ставить випічку першою.
//
// Сортує Google (sortRange), а не читання-запис: див. sortBakeryRawApi_
// у BakeryZones.gs - саме перезапис листа задвоював замовлення.
// ============================================================
function sortBakeryRawByAddress_() {
  sortBakeryRawApi_([0, 2, 5]);   // дата, адреса, назва товару
}

/** Впорядкувати сирий лист ВК по адресах просто зараз. */
function g18_sortBakeryByAddress() {
  sortBakeryRawByAddress_();
}