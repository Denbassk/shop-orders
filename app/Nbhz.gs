// ============================================================
// ХЛІБ НБХЗ
// Дані живуть у таблиці НБХЗ:
//   "Ассортимент" - A Статус | B № | C Номенклатура
//                   (порядок рядків = порядок колонок для заводу)
//   "Маршрути"    - A Маршрут | B Адреса Магазина (як у Довіднику)
//                   | C Адреса у файлі НБХЗ
//
// ЗАПУСК ОДНІЄЮ КНОПКОЮ:  installNbhz()
// Далі: новий деплой веб-застосунку.
// ============================================================

// Що писати в колонку P Довідника (і, відповідно, у вивантаження для заводу):
//   'factory'  - адреса у написанні заводу (як у їхньому файлі)
//   'registry' - правильна адреса з Довідника
var NBHZ_EXPORT_ADDR = 'factory';


function installNbhz() {
  setupNbhz();
  rebuildNbhzProducts();
  rebuildNbhzRoutes();
  addNbhzColumnsToRegistry();
  matchNbhzRoutes();
  invalidateAppCache();
  console.log('НБХЗ готовий. Зробіть новий деплой веб-застосунку (Розгорнути -> Керувати розгортаннями -> Змінити версію).');
}

// Тримає лист вивантаження в актуальному стані.
// Вішається на тригер кожні 15 хвилин: якщо після останньої збірки було
// замовлення (позначка nbhz_export_dirty) або листа за сьогодні немає -
// перезбирає. Решту разів виходить майже миттєво.
function refreshNbhzExport() {
  var n = nowKyiv_();
  if (n.hh < 6 || n.hh > 20) return;                 // вночі не смикаємо

  var props = PropertiesService.getScriptProperties();
  var today = formatDateDMY_(new Date());
  var dirty = props.getProperty('nbhz_export_dirty') === today;
  var sheet = nbhzSS_().getSheetByName('Вивантаження ' + today);

  if (!dirty && sheet) return;

  buildNbhzExport();
  props.deleteProperty('nbhz_export_dirty');
}

function nbhzSS_() {
  try { return SpreadsheetApp.openById(NBHZ_ID); }
  catch (e) { throw new Error('Не відкривається таблиця НБХЗ (' + NBHZ_ID + '): ' + e.message); }
}

function checkNbhz() {
  var ss = nbhzSS_();
  console.log('Таблиця: ' + ss.getName());
  console.log('Посилання: ' + ss.getUrl());
  ss.getSheets().forEach(function (sh) {
    console.log('  лист "' + sh.getName() + '" - рядків: ' + sh.getLastRow() +
                ', колонок: ' + sh.getLastColumn());
  });
}

function setupNbhz() {
  var ss = nbhzSS_();
  var cfg = dirCfg_('nbhz');
  var raw = ['Дата', 'Маршрут', 'Адреса', 'Штрихкод', 'Назва', 'Ціна', 'Кількість'];

  ensureSheet_(ss, cfg.productsSheet, ['Статус', '№', 'Номенклатура']);
  ensureSheet_(ss, 'Маршрути', ['Маршрут', 'Адреса Магазина (Довідник)', 'Адреса у файлі НБХЗ']);
  ensureSheet_(ss, cfg.rawSheet, raw);
  ensureSheet_(ss, cfg.testSheet, raw);

  console.log('Листи на місці.');
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

// Скинути лист до рівно N колонок і поставити шапку
function resetSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.clear();
  var extra = sh.getMaxColumns() - headers.length;
  if (extra > 0) sh.deleteColumns(headers.length + 1, extra);
  if (extra < 0) sh.insertColumnsAfter(sh.getMaxColumns(), -extra);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

// --- Ассортимент: рівно 3 колонки, нічого зайвого ---
function rebuildNbhzProducts() {
  var ss = nbhzSS_();
  var cfg = dirCfg_('nbhz');

  // зберегти позначки "стоп" по назві
  var stops = {};
  var old = ss.getSheetByName(cfg.productsSheet);
  if (old && old.getLastRow() > 1) {
    var w = Math.max(old.getLastColumn(), 1);
    old.getRange(2, 1, old.getLastRow() - 1, w).getValues().forEach(function (r) {
      if (String(r[0] || '').trim().toLowerCase() !== 'стоп') return;
      for (var i = 1; i < r.length; i++) {
        var v = String(r[i] || '').trim();
        if (v && !/^\d+([.,]\d+)?$/.test(v)) { stops[nameKey_(v)] = true; break; }
      }
    });
  }

  var sh = resetSheet_(ss, cfg.productsSheet, ['Статус', '№', 'Номенклатура']);
  var rows = NBHZ_PRODUCTS.map(function (n, i) {
    return [stops[nameKey_(n)] ? 'стоп' : '', i + 1, n];
  });
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.setColumnWidth(1, 80); sh.setColumnWidth(2, 46); sh.setColumnWidth(3, 340);
  sh.getRange(2, 2, rows.length, 1).setHorizontalAlignment('center');

  console.log('Ассортимент: ' + rows.length + ' позицій, 3 колонки' +
              (Object.keys(stops).length ? ' (стопи збережено)' : ''));
}

// --- Маршрути: правильні адреси з Довідника + написання заводу ---
function rebuildNbhzRoutes() {
  var ss = nbhzSS_();
  var sh = resetSheet_(ss, 'Маршрути',
    ['Маршрут', 'Адреса Магазина (Довідник)', 'Адреса у файлі НБХЗ']);

  sh.getRange(2, 1, NBHZ_ROUTES.length, 3).setValues(NBHZ_ROUTES);
  sh.setColumnWidth(1, 130); sh.setColumnWidth(2, 320); sh.setColumnWidth(3, 220);
  sh.getRange(2, 3, NBHZ_ROUTES.length, 1).setFontColor('#6b7280');

  console.log('Маршрути: ' + NBHZ_ROUTES.length + ' рядків');
}

// --- Колонки НБХЗ у Довіднику ТТ ---
function addNbhzColumnsToRegistry() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var last = sh.getLastRow();
  sh.getRange(1, 14, 1, 3).setValues([['Хліб НБХЗ', 'Маршрут НБХЗ', 'Адреса НБХЗ']])
    .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  if (last > 1) sh.getRange(2, 14, last - 1, 1).insertCheckboxes();
  sh.setColumnWidth(14, 90); sh.setColumnWidth(15, 150); sh.setColumnWidth(16, 240);
  console.log('Колонки N (прапорець), O (маршрут), P (адреса НБХЗ) готові');
}

// --- Маршрути з таблиці НБХЗ -> у Довідник ---
function matchNbhzRoutes() {
  var ss = nbhzSS_();
  var src = ss.getSheetByName('Маршрути');
  if (!src || src.getLastRow() < 2)
    throw new Error('Лист "Маршрути" порожній - запустіть rebuildNbhzRoutes()');

  var pairs = src.getRange(2, 1, src.getLastRow() - 1, 3).getValues()
    .filter(function (r) { return String(r[0]).trim() && String(r[1]).trim(); })
    .map(function (r) {
      var reg = String(r[1]).trim();
      return { route: String(r[0]).trim(), reg: reg, fact: String(r[2] || '').trim() || reg };
    });

  var reg = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = reg.getLastRow() - 1;
  if (n < 1) throw new Error('Довідник ТТ порожній');

  var names = reg.getRange(2, 2, n, 1).getValues();
  var addrs = reg.getRange(2, 3, n, 1).getValues();

  // точний ключ - основний, нечіткий - страховка від різнописання
  var byExact = {}, byFuzzy = {};
  pairs.forEach(function (p) {
    byExact[addrKey_(p.reg)] = p;
    byFuzzy[fuzzyKey_(p.reg)] = p;
    byFuzzy[fuzzyKey_(p.fact)] = byFuzzy[fuzzyKey_(p.fact)] || p;
  });

  var cols = [], used = {}, matched = 0;
  var report = [['Статус', 'Маршрут', 'Адреса в Довіднику', 'Адреса у файлі НБХЗ', 'ТТ у Довіднику']];

  for (var i = 0; i < n; i++) {
    var a = String(addrs[i][0] || '').trim();
    var hit = a ? (byExact[addrKey_(a)] || byFuzzy[fuzzyKey_(a)]) : null;
    if (!hit) { cols.push([false, '', '']); continue; }
    cols.push([true, hit.route, NBHZ_EXPORT_ADDR === 'registry' ? hit.reg : hit.fact]);
    used[hit.reg] = true;
    matched++;
    report.push(['OK', hit.route, a, hit.fact, names[i][0]]);
  }

  pairs.forEach(function (p) {
    if (!used[p.reg])
      report.push(['НЕ ЗНАЙДЕНО В ДОВІДНИКУ - перевірити адресу', p.route, p.reg, p.fact, '']);
  });

  reg.getRange(2, 14, n, 1).insertCheckboxes();
  reg.getRange(2, 14, n, 3).setValues(cols);

  var rep = resetSheet_(ss, '_Сверка_НБХЗ', report[0]);
  rep.getRange(1, 1, report.length, 5).setValues(report);
  rep.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
  rep.setColumnWidth(1, 260); rep.setColumnWidth(2, 130);
  rep.setColumnWidth(3, 300); rep.setColumnWidth(4, 220); rep.setColumnWidth(5, 220);

  invalidateAppCache();
  console.log('Зіставлено ' + matched + ' з ' + pairs.length +
              '. Незіставлені - у листі "_Сверка_НБХЗ" таблиці НБХЗ');
}

// --- Діагностика: чому НБХЗ не видно в застосунку ---
function whyNoNbhz() {
  invalidateAppCache();

  var reg = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = reg.getLastRow() - 1;
  if (n < 1) { console.log('Довідник ТТ порожній'); return; }

  var rows = reg.getRange(2, 1, n, 16).getValues();
  var active = 0, flagged = 0, withAddr = 0, noRoute = 0;
  rows.forEach(function (r) {
    if (r[0] !== true || !String(r[2]).trim()) return;
    active++;
    if (r[13] !== true) return;
    flagged++;
    if (!String(r[14]).trim()) noRoute++;
    if (String(r[15]).trim()) withAddr++;
  });

  console.log('1. Активних ТТ у Довіднику: ' + active);
  console.log('2. З галочкою "Хліб НБХЗ" (кол. N): ' + flagged +
              (flagged ? '' : '   <- запустіть matchNbhzRoutes()'));
  console.log('3. З адресою НБХЗ (кол. P): ' + withAddr);
  if (noRoute) console.log('   без маршруту (кол. O): ' + noRoute);

  var prods = 0;
  try { prods = loadProducts_('nbhz').length; }
  catch (e) { console.log('4. Ассортимент: ПОМИЛКА ' + e.message); }
  if (prods !== null) console.log('4. Позицій в асортименті: ' + prods +
              (prods ? '' : '   <- запустіть rebuildNbhzProducts()'));

  var seen = [];
  loadStores_().forEach(function (s) { if (s.directions.indexOf('nbhz') >= 0) seen.push(s.label); });
  console.log('5. Точок, де застосунок покаже НБХЗ: ' + seen.length);
  if (seen.length) console.log('   напр.: ' + seen.slice(0, 5).join(' | '));

  console.log('6. Версія коду: ' + APP_VERSION + ', дедлайн ' + dirCfg_('nbhz').deadline +
              ', зараз ' + (deadlinePassed_('nbhz') ? 'ЗАКРИТО' : 'відкрито'));
  console.log('Якщо тут усе гаразд, а на телефоні НБХЗ немає - потрібен НОВИЙ ДЕПЛОЙ.');
}

// --- Що саме записано в Довіднику по НБХЗ (колонки N, O, P) ---
function showNbhzInRegistry() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  var n = sh.getLastRow() - 1;
  if (n < 1) { console.log('Довідник порожній'); return; }
  var rows = sh.getRange(2, 1, n, 16).getValues();

  var out = [], byRoute = {}, noRoute = 0;
  rows.forEach(function (r) {
    if (r[13] !== true) return;
    var route = String(r[14] || '').trim();
    if (!route) { route = '(порожньо)'; noRoute++; }
    out.push([route, String(r[1] || '').trim(), String(r[15] || '').trim()]);
    byRoute[route] = (byRoute[route] || 0) + 1;
  });
  out.sort(function (a, b) {
    return a[0].localeCompare(b[0], 'uk') || a[1].localeCompare(b[1], 'uk');
  });

  console.log('У Довіднику ТТ: N = "Хліб НБХЗ", O = "Маршрут НБХЗ", P = "Адреса НБХЗ".');
  console.log('Це 14-16 колонки - ПРАВОРУЧ від "Примітка" і трьох колонок адрес, треба прокрутити лист.');
  console.log('Точок НБХЗ: ' + out.length + ', маршрутів: ' +
              Object.keys(byRoute).length + (noRoute ? ', без маршруту: ' + noRoute : ''));
  Object.keys(byRoute).sort(function (a, b) { return a.localeCompare(b, 'uk'); })
    .forEach(function (k) { console.log('   ' + k + ' - ' + byRoute[k] + ' точок'); });
  console.log('--- маршрут | ТТ | адреса для заводу ---');
  out.forEach(function (r) { console.log(r[0] + '  |  ' + r[1] + '  |  ' + r[2]); });
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

  // 1. Усі точки НБХЗ із Довідника - навіть ті, що сьогодні не замовляли.
  //    Завод отримує повний список маршруту, як у їхньому файлі: де
  //    замовлення немає, стоять нулі.
  var rowsByStore = {}, order = [];
  loadStores_().forEach(function (st) {
    if (st.directions.indexOf('nbhz') < 0) return;
    var addr = st.addrNbhz || st.address;
    var key = fuzzyKey_(shortenAddress_(addr));
    if (rowsByStore[key]) return;
    rowsByStore[key] = {
      route: st.routeNbhz || '',
      addr: addr,
      qty: new Array(prods.length).fill(0),
      got: false
    };
    order.push(key);
  });

  // 2. Розкладаємо сьогоднішні замовлення
  var raw = ss.getSheetByName(rawSheetName_(cfg));
  if (raw && raw.getLastRow() > 1) {
    var last = raw.getLastRow();
    var take = Math.min(last - 1, RAW_TAIL_ROWS);
    raw.getRange(last - take + 1, 1, take, 7).getValues().forEach(function (r) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
      if (d !== today) return;
      var ci = colOf[nameKey_(r[4])];
      if (ci === undefined) return;
      var key = fuzzyKey_(String(r[2] || '').trim());
      if (!rowsByStore[key]) {                       // точки немає в Довіднику
        rowsByStore[key] = {
          route: String(r[1] || '').trim(),
          addr: String(r[2] || '').trim(),
          qty: new Array(prods.length).fill(0),
          got: true
        };
        order.push(key);
      }
      rowsByStore[key].qty[ci] += Number(r[6]) || 0;
      rowsByStore[key].got = true;
    });
  }

  if (!order.length) throw new Error('Немає жодної точки НБХЗ - запустіть installNbhz()');

  order.sort(function (a, b) {
    var A = rowsByStore[a], B = rowsByStore[b];
    return A.route.localeCompare(B.route, 'uk') || A.addr.localeCompare(B.addr, 'uk');
  });

  var head = ['Маршрут', 'Адрес Магазина'].concat(prods.map(function (p) { return p.name; }));
  var body = order.map(function (k) {
    var s = rowsByStore[k];
    return [s.route, s.addr].concat(s.qty);
  });

  // 3. Лист вивантаження
  var name = 'Вивантаження ' + today;
  var out = ss.getSheetByName(name);
  if (out) {
    var oldFilter = out.getFilter();
    if (oldFilter) oldFilter.remove();
    out.clear();
    out.clearConditionalFormatRules();
  } else out = ss.insertSheet(name);

  var nCols = head.length, nRows = body.length;
  var firstProd = 3;

  out.getRange(1, 1, 1, nCols).setValues([head]);
  out.getRange(2, 1, nRows, nCols).setValues(body);

  // --- шапка: горизонтальний текст, перенос, по центру ---
  var headRange = out.getRange(1, 1, 1, nCols);
  headRange.setFontWeight('bold').setFontSize(10)
           .setBackground('#e8eaed').setFontColor('#16181d')
           .setTextRotation(0).setWrap(true)
           .setVerticalAlignment('middle').setHorizontalAlignment('center');
  out.getRange(1, 1, 1, 2).setHorizontalAlignment('left');

  // --- тіло ---
  var bodyRange = out.getRange(2, 1, nRows, nCols);
  bodyRange.setFontSize(10).setFontWeight('normal').setWrap(false)
           .setVerticalAlignment('middle');
  out.getRange(2, 1, nRows, 2).setHorizontalAlignment('left');
  out.getRange(2, firstProd, nRows, prods.length).setHorizontalAlignment('center');

  // смужки через рядок + нулі блідим, замовлене - чорним жирним
  var bg = [], fc = [], fw = [];
  for (var r = 0; r < nRows; r++) {
    var stripe = (r % 2) ? '#f6f7f9' : '#ffffff';
    var bgRow = [], fcRow = [], fwRow = [];
    for (var c = 0; c < nCols; c++) {
      bgRow.push(stripe);
      if (c < 2) { fcRow.push('#16181d'); fwRow.push(c === 0 ? 'bold' : 'normal'); }
      else {
        var v = body[r][c];
        fcRow.push(v > 0 ? '#16181d' : '#c3c7cd');
        fwRow.push(v > 0 ? 'bold' : 'normal');
      }
    }
    bg.push(bgRow); fc.push(fcRow); fw.push(fwRow);
  }
  bodyRange.setBackgrounds(bg).setFontColors(fc).setFontWeights(fw);

  // --- сітка ---
  out.getRange(1, 1, nRows + 1, nCols)
     .setBorder(true, true, true, true, true, true, '#9aa0a6', SpreadsheetApp.BorderStyle.SOLID);
  out.getRange(1, 1, nRows + 1, 2)
     .setBorder(null, null, null, true, null, null, '#5f6368', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  out.getRange(1, 1, 1, nCols)
     .setBorder(null, null, true, null, null, null, '#5f6368', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // --- ширини: маршрут і адреса по вмісту, товари однакові ---
  out.autoResizeColumns(1, 2);
  out.setColumnWidth(1, Math.min(Math.max(out.getColumnWidth(1) + 14, 96), 170));
  out.setColumnWidth(2, Math.min(Math.max(out.getColumnWidth(2) + 14, 170), 300));
  for (var q = 0; q < prods.length; q++) out.setColumnWidth(firstProd + q, 92);

  // висота шапки - під перенесений текст
  out.autoResizeRows(1, 1);
  if (out.getRowHeight(1) < 48) out.setRowHeight(1, 48);

  out.setFrozenRows(1);
  out.setFrozenColumns(2);
  out.getRange(1, 1, nRows + 1, nCols).createFilter();

  // прибрати зайві порожні колонки і рядки справа-знизу
  if (out.getMaxColumns() > nCols) out.deleteColumns(nCols + 1, out.getMaxColumns() - nCols);
  if (out.getMaxRows() > nRows + 1) out.deleteRows(nRows + 2, out.getMaxRows() - (nRows + 1));

  // 4. Посилання, що завантажує ЛИШЕ цей лист у Excel
  var xlsx = 'https://docs.google.com/spreadsheets/d/' + NBHZ_ID +
             '/export?format=xlsx&gid=' + out.getSheetId();
  writeExportLinkSheet_(ss, today, xlsx, out.getSheetId());

  var ordered = order.filter(function (k) { return rowsByStore[k].got; }).length;
  console.log('Готово: лист "' + name + '"');
  console.log('   точок у списку: ' + nRows + ', з них замовили сьогодні: ' + ordered);
  console.log('   позицій: ' + prods.length);
  console.log('   лист: ' + ss.getUrl() + '#gid=' + out.getSheetId());
  console.log('   ЗАВАНТАЖИТИ ТІЛЬКИ ЦЕЙ ЛИСТ: ' + xlsx);
}

// Окремий лист із постійним посиланням - його зручно покласти в закладки.
// Посилання веде на завантаження САМЕ листа вивантаження, а не всієї книги.
function writeExportLinkSheet_(ss, today, xlsx, gid) {
  var sh = ss.getSheetByName('Завантаження');
  if (!sh) sh = ss.insertSheet('Завантаження', 0);
  sh.clear();

  sh.getRange(1, 1).setValue('ЗАМОВЛЕННЯ ДЛЯ ЗАВОДУ')
    .setFontSize(16).setFontWeight('bold');
  sh.getRange(2, 1).setValue('за ' + today).setFontColor('#6b7280');

  sh.getRange(4, 1).setFormula(
    '=HYPERLINK("' + xlsx + '"; "⬇  ЗАВАНТАЖИТИ EXCEL за ' + today + '")');
  sh.getRange(4, 1).setFontSize(14).setFontWeight('bold').setFontColor('#1a73e8');

  sh.getRange(6, 1).setValue(
    'Файл міститиме ТІЛЬКИ таблицю замовлення - решта листів у нього не потрапляє.');
  sh.getRange(7, 1).setValue(
    'Посилання оновлюється щодня само. Можна покласти цей лист у закладки.');
  sh.getRange(6, 1, 2, 1).setFontColor('#6b7280').setFontSize(10);

  sh.setColumnWidth(1, 620);
  sh.setHiddenGridlines(true);
}

