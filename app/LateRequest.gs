// ============================================================
// ЗАПИТ ДОЗВОЛУ НА ЗАМОВЛЕННЯ ПІСЛЯ ДЕДЛАЙНУ
// Продавець тисне кнопку -> рядок у листі "Дозволи" довідника.
// Закупниця ставить галочку -> точка може відправити замовлення.
// ============================================================

const LATE_SHEET = 'Дозволи';

function lateSheet_() {
  var ss = SpreadsheetApp.openById(REGISTRY_ID);
  var sh = ss.getSheetByName(LATE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LATE_SHEET);
    sh.getRange(1, 1, 1, 7)
      .setValues([['Дата', 'Напрямок', 'Торгова точка', 'ID точки', 'Час запиту', 'ДОЗВОЛЕНО', 'Коментар']])
      .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 240); sh.setColumnWidth(4, 240); sh.setColumnWidth(7, 240);
  }
  return sh;
}

// 'none' | 'pending' | 'approved'
function lateRequestStatus_(dirKey, storeId) {
  if (!dirKey || !storeId) return 'none';
  try {
    var sh = lateSheet_();
    if (sh.getLastRow() < 2) return 'none';
    var today = formatDateDMY_(new Date());
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
    var st = 'none';
    for (var i = 0; i < rows.length; i++) {
      var d = (rows[i][0] instanceof Date) ? formatDateDMY_(rows[i][0]) : String(rows[i][0]).trim();
      if (d !== today) continue;
      if (String(rows[i][1]).trim() !== dirKey) continue;
      if (String(rows[i][3]).trim() !== String(storeId)) continue;
      if (rows[i][5] === true) return 'approved';
      st = 'pending';
    }
    return st;
  } catch (e) {
    console.error('lateRequestStatus_: ' + e.message);
    return 'none';
  }
}

function apiRequestLate_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  var st = lateRequestStatus_(dirKey, store.id);
  if (st !== 'none') return { status: st };

  var sh = lateSheet_();
  var now = new Date();
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 7).setValues([[
    now, dirKey, store.label, store.id, formatTime_(now), false,
    String(payload.note || '').slice(0, 200)
  ]]);
  sh.getRange(row, 1).setNumberFormat('dd.MM.yyyy');
  sh.getRange(row, 6).insertCheckboxes();
  SpreadsheetApp.flush();

  console.log('Запит дозволу: ' + cfg.title + ' / ' + store.label);
  return { status: 'pending' };
}

// Прибрати рядки старші за 30 днів
function cleanupLateRequests() {
  var sh = lateSheet_();
  if (sh.getLastRow() < 2) return;
  var keepFrom = new Date(); keepFrom.setDate(keepFrom.getDate() - 30);
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var d = rows[i][0];
    if (d instanceof Date && d < keepFrom) sh.deleteRow(i + 2);
  }
  console.log('Готово');
}