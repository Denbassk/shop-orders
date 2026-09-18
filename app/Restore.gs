// ============================================================
// ВІДНОВЛЕННЯ ЗАМОВЛЕНЬ ІЗ БЕКАПУ
//
// Бекап пишуть сторожі (Safety.gs щогодини, vegGuard для овочів):
//   випічка / хліб / НБХЗ - таблиця safe_backup_ss, лист = ключ напрямку,
//                           рядок = [знято, ...рядок сирого листа]
//   овочі                 - таблиця veg_backup_ss, лист "log",
//                           рядок = [знято, дата, час, адреса, товар, ціна, кг, сума, к-ть]
//
// Тут - зворотна операція, якої досі не було:
//   1. беремо з бекапу найповніший знімок кожної точки за дату;
//   2. порівнюємо з робочим листом;
//   3. те, чого в листі немає, ДОПИСУЄМО в кінець через apiAppend_.
// Нічого не стирається і не перезаписується, дублі не додаються.
// ============================================================

var RESTORE_TAIL_ROWS = 20000;     // скільки останніх рядків бекапу читати

function restoreBackupSS_(dirKey) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(dirKey === 'veg' ? VEG_BACKUP_SS : SAFE_BACKUP_SS);
  if (!id) throw new Error('Бекапу ще немає - сторож жодного разу не відпрацював');
  return SpreadsheetApp.openById(id);
}

function restoreBackupSheet_(dirKey) {
  var ss = restoreBackupSS_(dirKey);
  var sh = ss.getSheetByName(dirKey === 'veg' ? 'log' : dirKey);
  if (!sh) throw new Error('У бекапі немає листа для напрямку "' + dirKey + '"');
  return sh;
}

// Рядки бекапу за дату: [{stamp, raw[]}]
function restoreBackupRows_(dirKey, dmy) {
  var sh = restoreBackupSheet_(dirKey);
  if (sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RESTORE_TAIL_ROWS);
  var w = Math.max(sh.getLastColumn(), 8);
  var vals = sh.getRange(last - take + 1, 1, take, w).getValues();

  var out = [];
  vals.forEach(function (r) {
    var raw = (dirKey === 'veg') ? r.slice(1, 8) : r.slice(1);
    var d = (raw[0] instanceof Date) ? formatDateDMY_(raw[0]) : String(raw[0] || '').trim();
    if (d !== dmy) return;
    if (!String(raw[2] || '').trim()) return;
    raw[0] = d;
    var stamp = (r[0] instanceof Date)
      ? Utilities.formatDate(r[0], 'Europe/Kyiv', 'dd.MM.yyyy HH:mm')
      : String(r[0] || '').trim();
    out.push({ stamp: stamp, raw: raw });
  });
  return out;
}

// Рядки робочого листа за дату
function restoreLiveRows_(dirKey, dmy) {
  var cfg = dirCfg_(dirKey);
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (!sh || sh.getLastRow() < 2) return [];

  var last = sh.getLastRow();
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var w = Math.max(sh.getLastColumn(), 7);
  return sh.getRange(last - take + 1, 1, take, w).getValues().filter(function (r) {
    var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0] || '').trim();
    return d === dmy && String(r[2] || '').trim();
  });
}

function restoreItemKey_(dirKey, raw) {
  var c = rawCols_(dirKey);
  return String(raw[c.name] || '').trim().toLowerCase() + '|' + (Number(raw[c.qty]) || 0);
}

// Найповніший знімок кожної точки: серед усіх знімків за дату беремо той,
// де в цієї точки найбільше рядків. Проміжні знімки (точка ще дозамовляла)
// таким чином не обрізають замовлення.
function restoreBestSnapshot_(dirKey, dmy) {
  var byStore = {};
  restoreBackupRows_(dirKey, dmy).forEach(function (o) {
    var addr = String(o.raw[2] || '').trim();
    var key = addrKey_(addr);
    if (!byStore[key]) byStore[key] = { addr: addr, snaps: {} };
    var snaps = byStore[key].snaps;
    if (!snaps[o.stamp]) snaps[o.stamp] = [];
    snaps[o.stamp].push(o.raw);
  });

  var best = {};
  Object.keys(byStore).forEach(function (key) {
    var s = byStore[key], top = null, topStamp = '';
    Object.keys(s.snaps).forEach(function (stamp) {
      var rows = s.snaps[stamp];
      if (!top || rows.length > top.length ||
          (rows.length === top.length && stamp > topStamp)) { top = rows; topStamp = stamp; }
    });
    best[key] = { addr: s.addr, stamp: topStamp, rows: top || [] };
  });
  return best;
}

// --- що саме загубилось ---
function restoreScan(dirKey, dmy) {
  var cfg = dirCfg_(dirKey);
  dmy = dmy || formatDateDMY_(new Date());

  var best = restoreBestSnapshot_(dirKey, dmy);
  var live = restoreLiveRows_(dirKey, dmy);

  // скільки однакових рядків уже лежить у листі - по точках
  var liveCount = {};
  live.forEach(function (r) {
    var key = addrKey_(String(r[2] || '').trim());
    if (!liveCount[key]) liveCount[key] = { n: 0, items: {} };
    liveCount[key].n++;
    var ik = restoreItemKey_(dirKey, r);
    liveCount[key].items[ik] = (liveCount[key].items[ik] || 0) + 1;
  });

  var labels = {};
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf(dirKey) < 0) return;
    labels[statusKey_(dirKey, s)] = s.label;
  });

  var stores = [], missingTotal = 0;
  Object.keys(best).forEach(function (key) {
    var b = best[key];
    var have = liveCount[key] || { n: 0, items: {} };
    var used = {}, missing = [];

    b.rows.forEach(function (raw) {
      var ik = restoreItemKey_(dirKey, raw);
      used[ik] = (used[ik] || 0) + 1;
      if (used[ik] > (have.items[ik] || 0)) missing.push(raw);
    });
    if (!missing.length) return;

    var c = rawCols_(dirKey);
    var qty = 0;
    missing.forEach(function (raw) { qty += Number(raw[c.qty]) || 0; });
    missingTotal += missing.length;

    stores.push({
      key: key,
      label: labels[key] || b.addr,
      addr: b.addr,
      stamp: b.stamp,
      backup: b.rows.length,
      live: have.n,
      missing: missing.length,
      qty: Math.round(qty * 1000) / 1000,
      items: missing.map(function (raw) {
        return { name: String(raw[c.name] || ''), qty: Number(raw[c.qty]) || 0 };
      })
    });
  });

  stores.sort(function (a, b) { return b.missing - a.missing; });

  return {
    dir: dirKey, dirTitle: cfg.title, date: dmy, unit: cfg.unit,
    sheet: rawSheetName_(cfg),
    backupRows: Object.keys(best).reduce(function (n, k) { return n + best[k].rows.length; }, 0),
    liveRows: live.length,
    missingRows: missingTotal,
    stores: stores
  };
}

// --- повернути рядки ---
// keys - масив ключів точок зі restoreScan; порожньо = всі
function restoreApply(dirKey, dmy, keys) {
  var cfg = dirCfg_(dirKey);
  dmy = dmy || formatDateDMY_(new Date());
  var scan = restoreScan(dirKey, dmy);
  var want = {};
  (keys || []).forEach(function (k) { want[String(k)] = true; });

  var picked = scan.stores.filter(function (s) { return !keys || !keys.length || want[s.key]; });
  if (!picked.length) return { added: 0, stores: [], date: dmy };

  // рядки беремо ще раз із найповнішого знімка, щоб не тягти їх крізь клієнта
  var best = restoreBestSnapshot_(dirKey, dmy);
  var live = restoreLiveRows_(dirKey, dmy);
  var liveItems = {};
  live.forEach(function (r) {
    var key = addrKey_(String(r[2] || '').trim());
    if (!liveItems[key]) liveItems[key] = {};
    var ik = restoreItemKey_(dirKey, r);
    liveItems[key][ik] = (liveItems[key][ik] || 0) + 1;
  });

  var rows = [], done = [];
  picked.forEach(function (s) {
    var b = best[s.key];
    if (!b) return;
    var used = {}, mine = [];
    b.rows.forEach(function (raw) {
      var ik = restoreItemKey_(dirKey, raw);
      used[ik] = (used[ik] || 0) + 1;
      if (used[ik] > ((liveItems[s.key] || {})[ik] || 0)) mine.push(raw);
    });
    if (!mine.length) return;
    rows = rows.concat(mine);
    done.push({ key: s.key, label: s.label, rows: mine.length });
  });

  if (!rows.length) return { added: 0, stores: [], date: dmy };

  appendRows_(cfg, dirKey, rows);

  PropertiesService.getScriptProperties().deleteProperty('bread_report_sig');
  if (dirKey === 'nbhz')
    PropertiesService.getScriptProperties().setProperty('nbhz_export_dirty', formatDateDMY_(new Date()));
  invalidateAppCache();

  if (typeof adminLog_ === 'function')
    adminLog_('Відновлено з бекапу', cfg.title + ' ' + dmy + ' - рядків ' + rows.length +
              ' (' + done.map(function (d) { return d.label + ': ' + d.rows; }).join(', ') + ')');

  return { added: rows.length, stores: done, date: dmy };
}

// --- те саме для пульта ---
function admRestoreScan_(payload) {
  return restoreScan(String(payload.dir || ''), String(payload.date || '') || null);
}

function admRestoreApply_(payload) {
  return restoreApply(String(payload.dir || ''),
                      String(payload.date || '') || null,
                      payload.keys || []);
}

// --- ручний запуск із редактора ---
function i05_restoreScanHere() {
  var DIR = 'bakery';                  // bakery | bread | nbhz | veg
  var DATE = '';                       // порожньо = сьогодні, інакше "17.09.2026"
  var r = restoreScan(DIR, DATE || null);
  console.log(r.dirTitle + ' ' + r.date + ': у бекапі ' + r.backupRows +
              ', у листі ' + r.liveRows + ', не вистачає ' + r.missingRows);
  r.stores.forEach(function (s) {
    console.log('   ' + s.label + ' - ' + s.missing + ' рядків (знімок ' + s.stamp + ')');
  });
  if (!r.stores.length) console.log('   усе на місці');
}
