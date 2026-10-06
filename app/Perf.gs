// ============================================================
// ДІАГНОСТИКА ШВИДКОСТІ ПУЛЬТА - p01_profileAdmin()
// Лише читає. Побічний ефект один: скидає кеш застосунку.
// Запуск з редактора, результат - у журналі виконання.
// ============================================================
var PERF_LOG = [];

function perf_(name, fn) {
  var t = Date.now(), r, err = '';
  try { r = fn(); } catch (e) { err = String((e && e.message) || e); }
  var ms = Date.now() - t;
  PERF_LOG.push({ name: name, ms: ms });
  console.log(('      ' + ms).slice(-6) + ' мс  ' + name + (err ? '   ПОМИЛКА: ' + err : ''));
  return r;
}

function p01_profileAdmin() {
  PERF_LOG = [];
  var info = [];
  var today = formatDateDMY_(new Date());

  console.log('=== 1. Довідник і властивості ===');
  perf_('invalidateAppCache', invalidateAppCache);
  perf_('loadStores_ холодний', loadStores_);
  perf_('loadStores_ з кешу', loadStores_);
  perf_('getProperties (усі ключі)', function () {
    return PropertiesService.getScriptProperties().getProperties(); });
  perf_('getProperty (як adminCheck_ на кожен запит)', function () {
    return PropertiesService.getScriptProperties().getProperty('admin_pin'); });

  console.log('=== 2. Сирі листи по напрямках ===');
  Object.keys(DIRECTIONS).forEach(function (k) {
    var cfg = DIRECTIONS[k];
    var ss = perf_(k + ': openById', function () { return SpreadsheetApp.openById(cfg.spreadsheetId); });
    if (!ss) return;
    var sh = perf_(k + ': getSheetByName', function () { return ss.getSheetByName(rawSheetName_(cfg)); });
    if (!sh) { info.push(k + ': немає листа ' + rawSheetName_(cfg)); return; }
    var last = perf_(k + ': getLastRow', function () { return sh.getLastRow(); });
    var w = sh.getLastColumn();
    var take = Math.min(Math.max(last - 1, 0), RAW_TAIL_ROWS);
    if (!take) { info.push(k + ': сирий лист порожній'); return; }
    var vals = perf_(k + ': хвіст ' + take + ' x ' + w + ' (як dirStores/store)', function () {
      return sh.getRange(last - take + 1, 1, take, w).getValues(); }) || [];
    perf_(k + ': хвіст ' + take + ' x 3 (як статус)', function () {
      return sh.getRange(last - take + 1, 1, take, 3).getValues(); });
    var nToday = 0, firstToday = -1;
    vals.forEach(function (r, i) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0] || '').trim();
      if (d === today) { nToday++; if (firstToday < 0) firstToday = i; }
    });
    var cells = 0, big = [];
    ss.getSheets().forEach(function (s) {
      var c = s.getMaxRows() * s.getMaxColumns(); cells += c;
      big.push({ n: s.getName(), r: s.getMaxRows(), c: s.getMaxColumns(), cells: c });
    });
    big.sort(function (a, b) { return b.cells - a.cells; });
    info.push(k + ': у сирому листі рядків ' + last + ', прочитано ' + take +
      ', з них сьогоднішніх ' + nToday +
      (firstToday >= 0 ? ' (перший сьогоднішній - рядок ' + (last - take + 1 + firstToday) + ')' : '') +
      ' | книга: листів ' + big.length + ', комірок ' + cells +
      ' | найбільші: ' + big.slice(0, 3).map(function (x) { return x.n + ' ' + x.r + 'x' + x.c; }).join('; '));
  });

  console.log('=== 3. Статус замовлень (усі 4 таблиці) ===');
  perf_('invalidateAppCache', invalidateAppCache);
  perf_('loadTodayStatus_ холодний', loadTodayStatus_);
  perf_('loadTodayStatus_ з кешу', loadTodayStatus_);

  console.log('=== 4. Екрани пульта ===');
  perf_('invalidateAppCache', invalidateAppCache);
  perf_('today - після будь-якої дії (кеш скинуто)', admToday_);
  perf_('today - кеш теплий', admToday_);
  var sample = null;
  Object.keys(DIRECTIONS).forEach(function (k) {
    var d = perf_('dirStores ' + k, function () { return admDirStores_({ dir: k }); });
    perf_('   з них лише посилання xlsx ' + k, function () { return admXlsxUrl_(k); });
    if (!sample && d && d.done && d.done.length) sample = { id: d.done[0].id, dir: k };
  });
  if (!sample) { var s0 = loadStores_()[0]; if (s0) sample = { id: s0.id, dir: s0.directions[0] }; }
  if (sample) {
    perf_('store (екран точки, ' + sample.dir + ')', function () {
      return admStore_({ storeId: sample.id, dir: sample.dir }); });
    perf_('card (картка точки)', function () { return admCard_({ storeId: sample.id }); });
  }
  perf_('stores (пошук)', function () { return admStores_({ q: '' }); });
  perf_('schedule (графік)', function () { return admSchedule_({}); });
  perf_('log (журнал)', admLogRead_);
  perf_('health', admHealth_);
  perf_('   з них getProjectTriggers', function () { return ScriptApp.getProjectTriggers(); });
  perf_('Довідник: open + лист журналу (кожна дія)', function () {
    return SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(ADMIN_LOG_SHEET).getLastRow(); });

  console.log('=== Інформація ===');
  info.forEach(function (s) { console.log(s); });
  console.log('=== ТОП-10 найповільніших ===');
  PERF_LOG.slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, 10)
    .forEach(function (x) { console.log(('      ' + x.ms).slice(-6) + ' мс  ' + x.name); });
}
