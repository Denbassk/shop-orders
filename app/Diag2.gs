// ============================================================
// ПЕРЕВІРКА СТАТУСІВ І АДРЕС
// ============================================================

// Чи справді є замовлення за сьогодні і як там записана дата
function checkTodayOrders() {
  var today = formatDateDMY_(new Date());
  console.log('Сьогодні: ' + today);

  ['bread', 'bakery', 'veg'].forEach(function (k) {
    var cfg = dirCfg_(k);
    try {
      var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.rawSheet);
      if (!sh || sh.getLastRow() < 2) { console.log(k + ': лист порожній'); return; }
      var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
      var last = rows[rows.length - 1];
      var todayCount = 0, addrs = {};
      rows.forEach(function (r) {
        var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
        if (d === today) { todayCount++; addrs[String(r[2]).trim()] = true; }
      });
      console.log(k + ': всього рядків ' + rows.length +
        ', тип дати в останньому рядку: ' + (last[0] instanceof Date ? 'Date' : 'текст "' + last[0] + '"') +
        '\n   остання дата: ' + ((last[0] instanceof Date) ? formatDateDMY_(last[0]) : last[0]) +
        '\n   рядків за сьогодні: ' + todayCount +
        (todayCount ? '\n   ТТ: ' + Object.keys(addrs).join(' / ') : ''));
    } catch (e) { console.log(k + ': помилка - ' + e.message); }
  });
}

// Чи правильно скорочення адрес збігається з тим, що вже в хлібному листі
function checkAddressMatch() {
  var cfg = dirCfg_('bread');
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(cfg.rawSheet);
  var inSheet = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0]).trim();
      if (v) inSheet[addrKey_(v)] = v;
    });
  }

  var ok = [], bad = [], noHistory = [];
  loadStores_().filter(function (s) { return s.directions.indexOf('bread') >= 0; })
    .forEach(function (s) {
      var full = s.addrBread;
      var short = shortenAddress_(full);
      var key = addrKey_(short);
      if (!inSheet[key]) noHistory.push(s.label + '  ->  "' + short + '"');
      else if (inSheet[key] === short) ok.push(short);
      else bad.push(s.label + ': буде "' + short + '", у листі "' + inSheet[key] + '"');
    });

  console.log('ЗБІГАЄТЬСЯ ТОЧНО: ' + ok.length);
  console.log('\nРОЗБІЖНОСТІ (' + bad.length + '):\n' + (bad.join('\n') || 'немає'));
  console.log('\nБЕЗ ІСТОРІЇ, перевірити очима (' + noHistory.length + '):\n' + noHistory.join('\n'));
}