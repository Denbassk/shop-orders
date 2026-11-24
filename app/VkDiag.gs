// ============================================================
// ДІАГНОСТИКА ТАБЛИЦІ ВК (18.10.2026). Лише читання, нічого не змінює.
// Запуск з редактора: d13_diagnoseVkTable. Кожен крок пише в журнал
// одразу, тож навіть якщо щось зависне - видно, на чому саме.
// ============================================================
var VK_VOLATILE_RE = /\b(NOW|TODAY|RAND|RANDBETWEEN|INDIRECT|OFFSET|IMPORTRANGE|IMPORTXML|IMPORTHTML|IMPORTDATA|GOOGLEFINANCE|QUERY|ARRAYFORMULA|FILTER|SORT|UNIQUE|VLOOKUP|SUMIFS?|COUNTIFS?)\s*\(/gi;

function d13_diagnoseVkTable() {
  var ids = {};
  Object.keys(DIRECTIONS).forEach(function (k) { ids[k] = DIRECTIONS[k].spreadsheetId; });
  var vk = ids.bakery;

  // 1. Швидкість: одна клітинка з кожної таблиці напрямку
  Object.keys(ids).forEach(function (k) {
    vkDiagStep_('1. A1 таблиці ' + k, function () {
      var meta = Sheets.Spreadsheets.get(ids[k], { fields: 'sheets.properties.title' });
      apiValues_(ids[k], a1q_(meta.sheets[0].properties.title, 'A1'));
      return 'ok';
    });
  });

  // 2. Метадані ВК: налаштування перерахунку, розміри листів, умовне форматування
  vkDiagStep_('2. метадані ВК', function () {
    var m = Sheets.Spreadsheets.get(vk, { fields:
      'properties(title,autoRecalc,iterativeCalculationSettings),namedRanges(name),' +
      'sheets(properties(title,hidden,gridProperties),conditionalFormats,charts(chartId),' +
      'filterViews(filterViewId),protectedRanges(protectedRangeId),basicFilter(range),merges)' });
    var p = m.properties;
    console.log('   назва: ' + p.title + ' | перерахунок: ' + p.autoRecalc +
                ' | ітеративні: ' + JSON.stringify(p.iterativeCalculationSettings || null) +
                ' | іменованих діапазонів: ' + (m.namedRanges || []).length);
    var total = 0;
    m.sheets.forEach(function (s) {
      var g = s.properties.gridProperties, cells = g.rowCount * g.columnCount;
      total += cells;
      console.log('   лист "' + s.properties.title + '"' + (s.properties.hidden ? ' (прихований)' : '') +
                  ': ' + g.rowCount + 'x' + g.columnCount + ' = ' + cells + ' клітинок' +
                  ' | умовн.формат: ' + (s.conditionalFormats || []).length +
                  ' | діаграм: ' + (s.charts || []).length +
                  ' | filterViews: ' + (s.filterViews || []).length +
                  ' | захист: ' + (s.protectedRanges || []).length +
                  ' | фільтр: ' + (s.basicFilter ? 'так' : 'ні') +
                  ' | обʼєднань: ' + (s.merges || []).length);
    });
    return 'клітинок усього ' + total;
  });

  // 3. Формули по листах ВК. Сирий лист і архів - останніми (там може зависнути)
  var titles = Sheets.Spreadsheets.get(vk, { fields: 'sheets.properties.title' })
    .sheets.map(function (s) { return s.properties.title; });
  var heavy = [rawSheetName_(DIRECTIONS.bakery), '_Архів'];
  titles.filter(function (t) { return heavy.indexOf(t) < 0; }).concat(heavy).forEach(function (t) {
    if (titles.indexOf(t) < 0) return;
    vkDiagStep_('3. формули "' + t + '"', function () {
      var res = Sheets.Spreadsheets.Values.get(vk, a1q_(t, 'A1:Z'), { valueRenderOption: 'FORMULA' });
      var n = 0, cells = 0, fn = {}, ex = [];
      (res.values || []).forEach(function (row, i) {
        row.forEach(function (v, j) {
          cells++;
          if (typeof v !== 'string' || v.charAt(0) !== '=') return;
          n++;
          (v.match(VK_VOLATILE_RE) || []).forEach(function (f) {
            var k = f.replace(/\s*\($/, '').toUpperCase(); fn[k] = (fn[k] || 0) + 1;
          });
          if (ex.length < 3) ex.push(String.fromCharCode(65 + j) + (i + 1) + ': ' + v.slice(0, 120));
        });
      });
      if (ex.length) console.log('   приклади: ' + ex.join('  ||  '));
      return 'заповнених ' + cells + ', формул ' + n + (n ? ', функції ' + JSON.stringify(fn) : '');
    });
  });
}

function vkDiagStep_(name, fn) {
  var t0 = Date.now();
  console.log('→ ' + name + ' ...');
  try { console.log('   ' + fn() + '  [' + (Date.now() - t0) + ' мс]'); }
  catch (e) { console.log('   ПОМИЛКА: ' + e.message + '  [' + (Date.now() - t0) + ' мс]'); }
}
