// ============================================================
// ХЛІБ НБХЗ
// Дані живуть у таблиці НБХЗ:
//   "Ассортимент" - позиції (порядок рядків = порядок колонок для заводу)
//   "Маршрути"    - маршрут + адреса точки
// Код нічого не зберігає, лише читає з таблиці.
//
// ПОРЯДОК ЗАПУСКУ:
//   1) checkNbhz()                - чи відкривається таблиця
//   2) setupNbhz()                - створити листи
//   3) заповнити "Ассортимент" і "Маршрути" (або seedNbhzFromFiles())
//   4) addNbhzColumnsToRegistry() - колонки N/O/P у Довіднику
//   5) matchNbhzRoutes()          - розкласти маршрути, звіт "_Сверка_НБХЗ"
//   6) invalidateAppCache()       - і новий деплой
// ============================================================

function nbhzSS_() {
  try { return SpreadsheetApp.openById(NBHZ_ID); }
  catch (e) { throw new Error('Не відкривається таблиця НБХЗ (' + NBHZ_ID + '): ' + e.message); }
}

function checkNbhz() {
  var ss = nbhzSS_();
  console.log('Таблиця: ' + ss.getName());
  console.log('Посилання: ' + ss.getUrl());
  ss.getSheets().forEach(function (sh) {
    console.log('  лист "' + sh.getName() + '" - рядків: ' + sh.getLastRow());
  });
}

function setupNbhz() {
  var ss = nbhzSS_();
  var cfg = dirCfg_('nbhz');
  var raw = ['Дата', 'Маршрут', 'Адреса', 'Штрихкод', 'Назва', 'Ціна', 'Кількість'];

  ensureSheet_(ss, cfg.productsSheet,
    ['Статус', '№', 'Штрихкод', 'Ціна', 'Номенклатура', 'Шт в ящику']);
  ensureSheet_(ss, 'Маршрути', ['Маршрут', 'Адреса Магазина']);
  ensureSheet_(ss, cfg.rawSheet, raw);
  ensureSheet_(ss, cfg.testSheet, raw);

  console.log('Листи готові. Заповніть "Ассортимент" і "Маршрути" - або запустіть seedNbhzFromFiles()');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// --- Колонки НБХЗ у Довіднику ТТ (там же, де маршрути Роми) ---
function addNbhzColumnsToRegistry() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var last = sh.getLastRow();
  sh.getRange(1, 14, 1, 3).setValues([['Хліб НБХЗ', 'Маршрут НБХЗ', 'Адреса НБХЗ']])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  if (last > 1) {
    var flags = sh.getRange(2, 14, last - 1, 1);
    flags.insertCheckboxes();
  }
  sh.setColumnWidth(14, 90); sh.setColumnWidth(15, 150); sh.setColumnWidth(16, 240);
  console.log('Колонки N (прапорець), O (маршрут), P (адреса НБХЗ) готові');
}

// --- Маршрути з таблиці НБХЗ -> у Довідник ---
function matchNbhzRoutes() {
  var ss = nbhzSS_();
  var src = ss.getSheetByName('Маршрути');
  if (!src || src.getLastRow() < 2) throw new Error('Лист "Маршрути" порожній');

  var pairs = src.getRange(2, 1, src.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) { return { route: String(r[0]).trim(), addr: String(r[1]).trim() }; });

  var reg = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = reg.getLastRow() - 1;
  var names = reg.getRange(2, 2, n, 1).getValues();
  var addrs = reg.getRange(2, 3, n, 1).getValues();
  var cols = reg.getRange(2, 14, n, 3).getValues();

  var map = {};
  pairs.forEach(function (p) { map[fuzzyKey_(p.addr)] = p; });

  var used = {}, matched = 0;
  var report = [['Статус', 'Маршрут НБХЗ', 'Адреса зі списку заводу', 'ТТ у Довіднику', 'Адреса в Довіднику']];

  for (var i = 0; i < n; i++) {
    var hit = map[fuzzyKey_(addrs[i][0])];
    if (!hit) continue;
    cols[i][0] = true;          // N - точку возить НБХЗ
    cols[i][1] = hit.route;     // O - маршрут заводу
    cols[i][2] = hit.addr;      // P - адреса в написанні заводу
    used[fuzzyKey_(hit.addr)] = true;
    matched++;
    report.push(['OK', hit.route, hit.addr, names[i][0], addrs[i][0]]);
  }

  pairs.forEach(function (p) {
    if (!used[fuzzyKey_(p.addr)])
      report.push(['НЕ ЗІСТАВЛЕНО - вписати вручну', p.route, p.addr, '', '']);
  });

  reg.getRange(2, 14, n, 3).setValues(cols);

  var rep = ss.getSheetByName('_Сверка_НБХЗ');
  if (rep) rep.clear(); else rep = ss.insertSheet('_Сверка_НБХЗ');
  rep.getRange(1, 1, report.length, 5).setValues(report);
  rep.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  rep.setFrozenRows(1);
  rep.setColumnWidth(2, 130); rep.setColumnWidth(3, 240);
  rep.setColumnWidth(4, 200); rep.setColumnWidth(5, 300);

  invalidateAppCache();
  console.log('Зіставлено ' + matched + ' з ' + pairs.length +
              '. Решта - у листі "_Сверка_НБХЗ" таблиці НБХЗ');
}

// Ключ, стійкий до рос/укр написання адреси
function fuzzyKey_(s) {
  return addrKey_(s)
    .replace(/ь/g, '')
    .replace(/[иіїы]/g, 'i')
    .replace(/[еєэё]/g, 'e')
    .replace(/[ґг]/g, 'г')
    .replace(/\s+/g, ' ').trim();
}

// --- Вивантаження для заводу: матриця як у файлі "заказ хлеб" ---
function buildNbhzExport() {
  var ss = nbhzSS_();
  var cfg = dirCfg_('nbhz');
  var today = formatDateDMY_(new Date());

  var prods = loadProducts_('nbhz');
  if (!prods.length) throw new Error('Лист "Ассортимент" порожній');
  var colOf = {};
  prods.forEach(function (p, i) { colOf[nameKey_(p.name)] = i; });

  var routeSh = ss.getSheetByName('Маршрути');
  var routeOf = {};
  routeSh.getRange(2, 1, routeSh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (String(r[1]).trim()) routeOf[fuzzyKey_(r[1])] = { route: String(r[0]).trim(), addr: String(r[1]).trim() };
  });

  var raw = ss.getSheetByName(rawSheetName_(cfg));
  if (!raw || raw.getLastRow() < 2) throw new Error('Замовлень немає');

  var rowsByStore = {}, order = [];
  raw.getRange(2, 1, raw.getLastRow() - 1, 7).getValues().forEach(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
    if (d !== today) return;
    var key = fuzzyKey_(r[2]);
    var ci = colOf[nameKey_(r[4])];
    if (ci === undefined) return;
    if (!rowsByStore[key]) {
      var meta = routeOf[key] || { route: String(r[1] || '').trim(), addr: String(r[2] || '').trim() };
      rowsByStore[key] = { route: meta.route, addr: meta.addr, qty: new Array(prods.length).fill(0) };
      order.push(key);
    }
    rowsByStore[key].qty[ci] += Number(r[6]) || 0;
  });

  if (!order.length) throw new Error('На ' + today + ' замовлень немає');

  order.sort(function (a, b) {
    var A = rowsByStore[a], B = rowsByStore[b];
    return A.route.localeCompare(B.route, 'uk') || A.addr.localeCompare(B.addr, 'uk');
  });

  var head = ['Маршрут', 'Адрес Магазина'].concat(prods.map(function (p) { return p.name; }));
  var body = order.map(function (k) {
    var s = rowsByStore[k];
    return [s.route, s.addr].concat(s.qty);
  });

  var name = 'Вивантаження ' + today;
  var out = ss.getSheetByName(name);
  if (out) out.clear(); else out = ss.insertSheet(name);
  out.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#f1f3f4').setVerticalAlignment('bottom').setWrap(false);
  out.getRange(1, 3, 1, prods.length).setTextRotation(90);
  out.setRowHeight(1, 200);
  out.getRange(2, 1, body.length, head.length).setValues(body);
  out.setColumnWidth(1, 120); out.setColumnWidth(2, 210);
  for (var i = 0; i < prods.length; i++) out.setColumnWidth(3 + i, 44);
  out.setFrozenRows(1); out.setFrozenColumns(2);

  console.log('Готово: лист "' + name + '", точок ' + body.length + ', позицій ' + prods.length);
}