// ============================================================
// НАЛАШТУВАННЯ НАПРЯМКУ "ХЛІБ НБХЗ"
//   1) setupNbhz()                - створює листи в таблиці НБХЗ
//   2) вставити з Excel у лист "Маршрути": A маршрут, B адреса
//   3) addNbhzColumnsToRegistry() - додає колонки N/O/P у довідник
//   4) matchNbhzRoutes()          - зіставляє, звіт у "_Сверка_НБХЗ"
// ============================================================

function setupNbhz() {
  var ss = SpreadsheetApp.openById(NBHZ_ID);
  var cfg = dirCfg_('nbhz');
  var head = ['Дата', 'Маршрут', 'Адреса', 'Штрихкод', 'Назва', 'Ціна', 'Кількість'];

  ensureSheet_(ss, cfg.productsSheet, ['Статус', '№', 'Штрихкод', 'Ціна', 'Номенклатура', 'Шт в ящику']);
  ensureSheet_(ss, cfg.rawSheet, head);
  ensureSheet_(ss, cfg.testSheet, head);
  ensureSheet_(ss, 'Маршрути', ['Маршрут', 'Адреса з файлу']);

  console.log('Готово. Вставте у лист "Маршрути" два стовпці з Excel і запустіть matchNbhzRoutes()');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 260);
  }
  return sh;
}

function addNbhzColumnsToRegistry() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var last = sh.getLastRow();
  sh.getRange(1, 14, 1, 3).setValues([['Хліб НБХЗ', 'Маршрут НБХЗ', 'Адреса НБХЗ']])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  if (last > 1) sh.getRange(2, 14, last - 1, 1).insertCheckboxes();
  sh.setColumnWidth(15, 150); sh.setColumnWidth(16, 240);
  console.log('Колонки N/O/P додано');
}

function matchNbhzRoutes() {
  var ss = SpreadsheetApp.openById(NBHZ_ID);
  var src = ss.getSheetByName('Маршрути');
  if (!src || src.getLastRow() < 2) throw new Error('Лист "Маршрути" порожній');

  var pairs = src.getRange(2, 1, src.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) { return { route: String(r[0]).trim(), addr: String(r[1]).trim() }; });

  var reg = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var last = reg.getLastRow();
  var regAddr = reg.getRange(2, 3, last - 1, 1).getValues();
  var flags = reg.getRange(2, 14, last - 1, 1).getValues();
  var routes = reg.getRange(2, 15, last - 1, 1).getValues();

  var map = {};
  pairs.forEach(function (p) { map[fuzzyKey_(p.addr)] = p; });

  var matched = 0, used = {}, report = [['Статус', 'Маршрут', 'Адреса з файлу', 'Адреса в довіднику']];

  for (var i = 0; i < regAddr.length; i++) {
    var k = fuzzyKey_(regAddr[i][0]);
    var hit = map[k];
    if (hit) {
      flags[i][0] = true;
      routes[i][0] = hit.route;
      used[k] = true;
      matched++;
      report.push(['OK', hit.route, hit.addr, regAddr[i][0]]);
    } else if (flags[i][0] === true && !String(routes[i][0]).trim()) {
      report.push(['НЕМАЄ МАРШРУТУ', '', '', regAddr[i][0]]);
    }
  }

  pairs.forEach(function (p) {
    if (!used[fuzzyKey_(p.addr)]) report.push(['НЕ ЗНАЙДЕНО В ДОВІДНИКУ', p.route, p.addr, '']);
  });

  reg.getRange(2, 14, flags.length, 1).setValues(flags);
  reg.getRange(2, 15, routes.length, 1).setValues(routes);

  var rep = ss.getSheetByName('_Сверка_НБХЗ');
  if (rep) rep.clear(); else rep = ss.insertSheet('_Сверка_НБХЗ');
  rep.getRange(1, 1, report.length, 4).setValues(report);
  rep.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  rep.setFrozenRows(1); rep.setColumnWidth(3, 280); rep.setColumnWidth(4, 320);

  invalidateAppCache();
  console.log('Зіставлено ' + matched + ' з ' + pairs.length + '. Решта - у листі "_Сверка_НБХЗ"');
}

// Ключ, стійкий до рос/укр написання:
// "Богдана хмельницкого,8" == "м. Харків вул. Богдана Хмельницького, 8"
function fuzzyKey_(s) {
  return addrKey_(s)
    .replace(/ь/g, '')
    .replace(/[иіїы]/g, 'i')
    .replace(/[еєэё]/g, 'e')
    .replace(/[ґг]/g, 'г')
    .replace(/\s+/g, ' ').trim();
}