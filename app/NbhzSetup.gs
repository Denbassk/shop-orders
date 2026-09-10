// ============================================================
// ХЛІБ НБХЗ - створення таблиці і структури
// ============================================================

var NBHZ_PRODUCTS = [
  'Батон Дорожній 0,400г','Батон Класичний 0,350г','Батон На Кефірі 0,200г',
  'Батон Нар. Молочний 0,400г','Батон Новобаварський 0,450г','Батон Слобожанський 0,450г',
  'Батон Студентський 0,300г','Круасани Полуниця 0,200г','Круасани Шоколад 0,200г',
  'Хліб Баварський 0,350г','Хліб Гусарик 0,450г','Хліб НБ Білий 0,500г',
  'Хліб Пш.Жит.Особливий 0,500г','Хліб Сергіївський 0,450г','Булка Квіточка 0,300г',
  'Булка Квіточка Креміко 0,300г','Рулет Вишня 0,320г','Рулет Мак 0,320г'
];

// Маршрут + адреса рівно як у списку заводу
var NBHZ_ROUTES = [
  ['Салтовка 3','Амосова 5А'],['Шишковка','Астраномическая 44-г'],
  ['Новые Дома 2','Байрона 138'],['Новые Дома 2','Байрона 163'],
  ['АТБ ХТЗ','Богдана хмельницкого,8'],['Салтовка 7','Бучмы 32'],
  ['Салтовка 7','Бучмы 52'],['Салтовка 8','Бучмы 33Б1 Джерело'],
  ['Салтовка 4','Валентиновская 24Б'],['Салтовка 4','Валентиновская 50а'],
  ['Салтовка 4','Гарибальди1'],['Новые Дома 2','Гер харькова 160'],
  ['Новые Дома','Грозненская 38'],['Новые Дома','Зернова 6/5'],
  ['Салтовка 1','Зубенко, 23'],['Салтовка 4','Зубенко31В/5'],
  ['Салтовка 5','Іскринський 19в'],['Новые Дома','Качановска 19'],
  ['Салтовка 3','Краснодарська 171/з'],['Центр 3','М. Семенка17'],
  ['Центр 2','Небесная сотня 14/1'],['Салтовка 5','Нескорених 33'],
  ['Салтовка 7','Нескорених 4д'],['Новые Дома 3','Ньютона 102'],
  ['Новые Дома 2','Ньютона 111'],['Новые Дома 3','Ньютона 143'],
  ['Новые Дома 3','Олимпийская 9а'],['Новые Дома 2','Петра Григоренко 37'],
  ['Сортировка','Переяславская 23'],['Салтовка 6','Тракторостроителей 95'],
  ['Рогань','Роганская 148'],['Рогань','Роганская130'],
  ['Салтовка 3','Салтівське шосе 264в'],['Новые Дома','Танкопія 16'],
  ['Салтовка 5','Шевченко 341'],['Салтовка 5','Широнинцев 54'],
  ['Салтовка 1','Юбилейный 67']
];

// 1. Створює нову таблицю з усією структурою
function createNbhzSpreadsheet() {
  var ss = SpreadsheetApp.create('Хліб НБХЗ - замовлення');

  // --- Асортимент: порядок рядків = порядок колонок у формі заводу ---
  var as = ss.getSheets()[0].setName('Асортимент');
  as.getRange(1, 1, 1, 3).setValues([['Статус','Назва','Ціна (необовʼязково)']])
    .setFontWeight('bold').setBackground('#f1f3f4');
  as.getRange(2, 2, NBHZ_PRODUCTS.length, 1)
    .setValues(NBHZ_PRODUCTS.map(function (n) { return [n]; }));
  as.setColumnWidth(1, 80); as.setColumnWidth(2, 330); as.setColumnWidth(3, 150);
  as.setFrozenRows(1);
  as.getRange('A2:A' + (NBHZ_PRODUCTS.length + 1)).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['','стоп'], true).build());

  // --- Замовлення: матриця як у файлі для заводу ---
  var or = ss.insertSheet('Замовлення');
  var head = ['Маршрут','Адрес Магазина','Час замовлення'].concat(NBHZ_PRODUCTS);
  or.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#f1f3f4').setVerticalAlignment('bottom');
  or.getRange(1, 4, 1, NBHZ_PRODUCTS.length).setTextRotation(90);
  or.getRange(2, 1, NBHZ_ROUTES.length, 2).setValues(NBHZ_ROUTES);
  or.setColumnWidth(1, 120); or.setColumnWidth(2, 200); or.setColumnWidth(3, 130);
  for (var i = 0; i < NBHZ_PRODUCTS.length; i++) or.setColumnWidth(4 + i, 42);
  or.setFrozenRows(1); or.setFrozenColumns(3);
  or.getRange(1, 1, 1, head.length).setWrap(false);
  or.setRowHeight(1, 190);

  // --- Архів: історія по днях ---
  var ar = ss.insertSheet('_Архів');
  ar.getRange(1, 1, 1, head.length + 1)
    .setValues([['Дата'].concat(head)])
    .setFontWeight('bold').setBackground('#f1f3f4');
  ar.setFrozenRows(1);

  console.log('=== ГОТОВО ===');
  console.log('Назва: ' + ss.getName());
  console.log('ID: ' + ss.getId());
  console.log('Посилання: ' + ss.getUrl());
  console.log('Позицій: ' + NBHZ_PRODUCTS.length + ', рядків ТТ: ' + NBHZ_ROUTES.length);
}

// 2. Звіряє список заводу з довідником ТТ (лише звіт, нічого не змінює)
function matchNbhzList() {
  var reg = SpreadsheetApp.openById(REGISTRY_ID);
  var sh = reg.getSheetByName(REGISTRY_SHEET);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();

  var byKey = {};
  rows.forEach(function (r) {
    var a = String(r[2]).trim();
    if (a) byKey[addrKey_(a)] = { name: String(r[1]).trim(), addr: a };
  });

  var out = [['Маршрут НБХЗ','Адреса зі списку заводу','Статус','Адреса в довіднику']];
  var found = 0, missing = 0;
  NBHZ_ROUTES.forEach(function (p) {
    var hit = byKey[addrKey_(p[1])];
    if (hit) { found++; out.push([p[0], p[1], 'Є в довіднику', hit.addr]); }
    else { missing++; out.push([p[0], p[1], 'НЕМАЄ - додати', '']); }
  });

  var rep = reg.getSheetByName('_Сверка_НБХЗ') || reg.insertSheet('_Сверка_НБХЗ');
  rep.clear();
  rep.getRange(1, 1, out.length, 4).setValues(out);
  rep.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#f1f3f4');
  rep.setColumnWidth(1, 130); rep.setColumnWidth(2, 260);
  rep.setColumnWidth(3, 140); rep.setColumnWidth(4, 260);
  rep.setFrozenRows(1);

  console.log('Збіглося: ' + found + ', потрібно додати: ' + missing);
  console.log('Дивіть лист "_Сверка_НБХЗ" у довіднику');
}

// 3. Додає в довідник колонки під НБХЗ (без даних)
function addNbhzColumns() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var head = sh.getRange(1, 14, 1, 3).getValues()[0];
  if (String(head[0]).trim()) { console.log('Колонки вже є: ' + head.join(' | ')); return; }
  sh.getRange(1, 14, 1, 3).setValues([['НБХЗ','Адреса НБХЗ','Маршрут НБХЗ']])
    .setFontWeight('bold').setBackground('#f1f3f4');
  var n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 14, n, 1).insertCheckboxes();
  sh.setColumnWidth(14, 70); sh.setColumnWidth(15, 220); sh.setColumnWidth(16, 130);
  console.log('Додано колонки N, O, P. Прапорці НБХЗ поки зняті.');
}

// 4. Заповнює адресу і маршрут НБХЗ для тих ТТ, що збіглися
function applyNbhzToRegistry() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = sh.getLastRow() - 1;
  var addrs = sh.getRange(2, 3, n, 1).getValues();

  var byKey = {};
  NBHZ_ROUTES.forEach(function (p) { byKey[addrKey_(p[1])] = p; });

  var flags = sh.getRange(2, 14, n, 3).getValues();
  var set = 0;
  for (var i = 0; i < n; i++) {
    var hit = byKey[addrKey_(String(addrs[i][0]).trim())];
    if (!hit) continue;
    flags[i][0] = true; flags[i][1] = hit[1]; flags[i][2] = hit[0];
    set++;
  }
  sh.getRange(2, 14, n, 3).setValues(flags);
  invalidateAppCache();
  console.log('Проставлено НБХЗ для ' + set + ' точок. Решту з "_Сверка_НБХЗ" додайте рядками вручну.');
}
