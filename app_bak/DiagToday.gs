// ============================================================
// ДЕ ЗАМОВЛЕННЯ ЗА СЬОГОДНІ
// Показує все одразу: у який лист пишемо, скільки там рядків,
// що саме лежить у хвості, і чи бачить застосунок асортимент.
// ============================================================

function z01_checkBakeryToday() { checkDirToday_('bakery'); }
function z02_checkVegToday()    { checkDirToday_('veg'); }
function z03_checkBreadToday()  { checkDirToday_('bread'); }
function z04_checkNbhzToday()   { checkDirToday_('nbhz'); }

function checkDirToday_(dirKey) {
  var cfg = dirCfg_(dirKey);
  var today = formatDateDMY_(new Date());
  var dowName = { 0: 'неділя', 1: 'понеділок', 2: 'вівторок', 3: 'середа',
                  4: 'четвер', 5: 'пʼятниця', 6: 'субота' }[todayDow_()];

  console.log('===== ' + cfg.title + ' =====');
  console.log('Сьогодні: ' + today + ', ' + dowName + ', ' +
              Utilities.formatDate(new Date(), 'Europe/Kyiv', 'HH:mm'));
  console.log('TEST_MODE: ' + TEST_MODE + '  ->  застосунок пише в лист "' +
              rawSheetName_(cfg) + '"');
  console.log('Дедлайн ' + cfg.deadline + ': зараз ' +
              (deadlinePassed_(dirKey) ? 'ЗАКРИТО' : 'відкрито'));

  // --- усі листи таблиці напрямку ---
  var ss;
  try { ss = SpreadsheetApp.openById(cfg.spreadsheetId); }
  catch (e) { console.log('НЕ ВІДКРИВАЄТЬСЯ ТАБЛИЦЯ: ' + e.message); return; }

  console.log('--- листи таблиці "' + ss.getName() + '" ---');
  ss.getSheets().forEach(function (sh) {
    console.log('   "' + sh.getName() + '": рядків ' + sh.getLastRow() +
                ', колонок ' + sh.getLastColumn());
  });

  // --- хвіст робочого листа ---
  var raw = ss.getSheetByName(rawSheetName_(cfg));
  if (!raw) {
    console.log('!!! ЛИСТА "' + rawSheetName_(cfg) + '" НЕМАЄ - замовлення падати нікуди');
    return;
  }

  var last = raw.getLastRow();
  console.log('--- лист "' + raw.getName() + '": ' + last + ' рядків ---');
  if (last < 2) {
    console.log('   ПОРОЖНЬО (тільки шапка)');
  } else {
    var w = Math.min(raw.getLastColumn(), 8);
    var take = Math.min(last - 1, 8);
    var tail = raw.getRange(last - take + 1, 1, take, w).getValues();
    console.log('   останні ' + take + ' рядків:');
    tail.forEach(function (r, i) {
      var d = r[0];
      var kind = (d instanceof Date) ? 'Date' : 'текст';
      var shown = (d instanceof Date) ? formatDateDMY_(d) : String(d);
      console.log('   рядок ' + (last - take + 1 + i) + ' | ' + shown +
                  ' (' + kind + ') | ' + r.slice(1, w).join(' | '));
    });

    // скільки саме за сьогодні
    var cnt = 0, addrs = {};
    var scan = Math.min(last - 1, RAW_TAIL_ROWS);
    raw.getRange(last - scan + 1, 1, scan, 3).getValues().forEach(function (r) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
      if (d !== today) return;
      cnt++;
      addrs[String(r[2]).trim()] = true;
    });
    console.log('   рядків ЗА СЬОГОДНІ: ' + cnt +
                ', точок: ' + Object.keys(addrs).length);
    if (cnt) console.log('   ТТ: ' + Object.keys(addrs).join(' / '));
  }

  // --- архів ---
  var arch = ss.getSheetByName('_Архів');
  if (arch && arch.getLastRow() > 1) {
    var al = arch.getLastRow();
    var aw = Math.min(arch.getLastColumn(), 3);
    var a = arch.getRange(al, 1, 1, aw).getValues()[0];
    var ad = (a[0] instanceof Date) ? formatDateDMY_(a[0]) : String(a[0]);
    console.log('--- архів: ' + (al - 1) + ' рядків, останній за ' + ad + ' ---');
  }

  // --- асортимент ---
  var prods = [];
  try { prods = loadProducts_(dirKey); }
  catch (e) { console.log('АСОРТИМЕНТ: ПОМИЛКА ' + e.message); }
  console.log('--- асортимент: застосунок бачить ' + prods.length + ' позицій ---');
  if (!prods.length)
    console.log('   !!! ПРОДАВЕЦЬ НЕ МОЖЕ ЗАМОВИТИ НІЧОГО. Перевірте колонку "Статус"');

  // --- дні прийому ---
  var stores = loadStores_().filter(function (s) {
    return s.directions.indexOf(dirKey) >= 0;
  });
  console.log('--- точок з цим напрямком: ' + stores.length + ' ---');
  if (cfg.orderDays) {
    var ok = 0, no = 0, free = 0;
    stores.forEach(function (s) {
      var d = storeDays_(dirKey, s);
      if (!d.length) free++;
      else if (dayAllowed_(dirKey, s)) ok++;
      else no++;
    });
    console.log('   сьогодні можуть замовляти: ' + ok);
    console.log('   сьогодні заблоковані днем: ' + no);
    console.log('   без обмеження по днях: ' + free);
    if (stores.length)
      console.log('   приклад "' + stores[0].label + '": дні [' +
                  storeDays_(dirKey, stores[0]).join(',') + '], сьогодні ' +
                  (dayAllowed_(dirKey, stores[0]) ? 'МОЖНА' : 'НЕ МОЖНА'));
  } else {
    console.log('   графіка по днях немає');
  }

  console.log('--- статус, який бачить застосунок ---');
  var st = loadTodayStatus_()[dirKey];
  console.log('   позначено як "вже замовили": ' + (st ? Object.keys(st).length : 'статус не прочитався'));
}
