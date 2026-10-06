// ============================================================
// ПУЛЬТ: ЗДОРОВ'Я СИСТЕМИ, ПРАВКА ЗАМОВЛЕННЯ, КАРТКА ТОЧКИ
// Виклики - з adminApi (Admin.gs), екрани - ui/AdminToolsJs.html.
// ============================================================

// ---------- 1. ЗДОРОВ'Я СИСТЕМИ ----------
var HEALTH_STALE_MIN = 20;          // звіт старший за це під час прийому - жовтим
var HEALTH_ERR_KEY   = 'health_errors';
var HEALTH_TRIGGERS  = ['d02_cleanupProps', 'e03_nbhzExport', 'e04_refreshExport', 'nightlyArchive', 'nightlyHealth', 'refreshBakeryReports', 'refreshBreadReports', 'refreshVegReports', 'safeGuard', 'vegGuard'];
var PROPS_LIMIT      = 500 * 1024;  // ліміт ScriptProperties

function healthNoteError_(where, msg) {
  try {
    var p = PropertiesService.getScriptProperties();
    var arr = [];
    try { arr = JSON.parse(p.getProperty(HEALTH_ERR_KEY) || '[]'); } catch (e) {}
    var n = nowKyiv_();
    arr.unshift({ at: formatDateDMY_(new Date()).slice(0, 5) + ' ' +
                      ('0' + n.hh).slice(-2) + ':' + ('0' + n.mm).slice(-2),
                  where: String(where), msg: String(msg).slice(0, 300) });
    p.setProperty(HEALTH_ERR_KEY, JSON.stringify(arr.slice(0, 20)));
  } catch (e) {}
}

function hm_(s) { var p = String(s || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }

function admHealth_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var n = nowKyiv_();
  var now = n.hh * 60 + n.mm;
  var todayDM = formatDateDMY_(new Date()).slice(0, 5);
  var status = loadTodayStatus_();
  var rank = { ok: 0, off: 0, warn: 1, bad: 2 };
  var worst = 'ok', problems = 0;
  function bump(lv) { if (rank[lv] > rank[worst]) worst = lv; if (rank[lv] > 0) problems++; }

  var dirs = Object.keys(DIRECTIONS).map(function (k) {
    var cfg = DIRECTIONS[k];
    var at = reportAt_(k);
    var ordered = status[k] ? Object.keys(status[k]).length : -1;
    var age = at ? now - hm_(at) : null;
    var dl = cfg.deadline ? hm_(cfg.deadline) : 24 * 60;
    var lv = 'ok', text;
    if (ordered < 0) { lv = 'bad'; text = 'Не читается рабочий лист «' + rawSheetName_(cfg) + '»'; }
    else if (!dirEnabled_(k)) { lv = 'off'; text = 'Направление выключено'; }
    else if (ordered > 0 && !at) { lv = 'bad'; text = 'Есть заказы (' + ordered + ' точек), а отчёт сегодня не собирался'; }
    else if (ordered > 0 && age > HEALTH_STALE_MIN && now <= dl + 60) {
      lv = 'warn'; text = 'Отчёт собран ' + age + ' мин назад, в ' + at + ' · заказали ' + ordered;
    }
    else text = (at ? 'Отчёт в ' + at : 'Отчёт сегодня не собирался') + ' · заказали ' + ordered;
    if (all['busy_' + k]) {
      if (lv === 'ok') lv = 'warn';
      text += ' · висит замок записи (если дольше минуты - clearDirLocks() в редакторе)';
    }
    bump(lv);
    return { key: k, title: cfg.title, level: lv, text: text };
  });

  var triggers = [], have = {};
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var h = t.getHandlerFunction(); have[h] = (have[h] || 0) + 1;
    });
  } catch (e) { have = null; }
  if (!have) {
    bump('warn');
    triggers.push({ name: 'Триггеры', level: 'warn', text: 'Не удалось прочитать список триггеров' });
  } else {
    HEALTH_TRIGGERS.forEach(function (h) {
      var c = have[h] || 0;
      var lv = c === 1 ? 'ok' : (c === 0 ? 'bad' : 'warn');
      bump(lv);
      triggers.push({ name: h, level: lv,
        text: c === 1 ? 'установлен'
            : c === 0 ? 'НЕ установлен - запустите d06_installTriggers() в редакторе'
            : 'установлен ' + c + ' раза - работа дублируется' });
    });
    Object.keys(have).forEach(function (h) {
      if (HEALTH_TRIGGERS.indexOf(h) >= 0) return;
      triggers.push({ name: h, level: 'off', text: 'есть, но не из списка проверки (' + have[h] + ')' });
    });
  }

  var errors = [];
  try { errors = JSON.parse(all[HEALTH_ERR_KEY] || '[]'); } catch (e) {}
  errors.forEach(function (e) { e.today = String(e.at || '').indexOf(todayDM) === 0; });
  if (errors.some(function (e) { return e.today; })) bump('warn');

  var size = 0, keys = Object.keys(all), sess = 0;
  keys.forEach(function (k) {
    size += k.length + String(all[k]).length;
    if (k.indexOf('adm_') === 0) sess++;
  });
  var pct = Math.round(size / PROPS_LIMIT * 100);
  if (pct >= 70) bump(pct >= 90 ? 'bad' : 'warn');
  if (TEST_MODE) bump('bad');

  return {
    time: ('0' + n.hh).slice(-2) + ':' + ('0' + n.mm).slice(-2),
    level: worst,
    summary: worst === 'ok' ? 'Всё работает' : 'Требует внимания: ' + problems,
    dirs: dirs, triggers: triggers, errors: errors,
    sys: { version: APP_VERSION, test: !!TEST_MODE, keys: keys.length, pct: pct, sess: sess }
  };
}

function admHealthClear_() {
  PropertiesService.getScriptProperties().deleteProperty(HEALTH_ERR_KEY);
  adminLog_('Очищено список помилок', '');
  return { ok: true };
}

// ---------- 2. ПРАВКА ЗАМОВЛЕННЯ ТОЧКИ ----------
// Кожен рядок перед записом перечитується під замком напрямку і звіряється:
// дата сьогодні, адреса точки, назва товару, стара кількість.
// Не збіглось хоч щось - не пишеться НІЧОГО.
function rawDate_(v) { return (v instanceof Date) ? formatDateDMY_(v) : String(v || '').trim(); }

function todayRowsCount_(sh, today, target) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var take = Math.min(last - 1, RAW_TAIL_ROWS);
  var n = 0;
  sh.getRange(last - take + 1, 1, take, 3).getValues().forEach(function (r) {
    if (rawDate_(r[0]) === today && addrKey_(String(r[2] || '').trim()) === target) n++;
  });
  return n;
}

function admEditOrder_(payload) {
  var store = findStore_(payload.storeId);
  var dir = String(payload.dir || '');
  var cfg = dirCfg_(dir);
  var c = rawCols_(dir);
  var today = formatDateDMY_(new Date());
  var target = statusKey_(dir, store);

  var seen = {};
  var ch = (payload.changes || []).map(function (x) {
    var q = Number(x.qty), row = Math.floor(Number(x.row));
    if (!(row >= 2)) throw new Error('Невірний рядок');
    if (seen[row]) throw new Error('Рядок ' + row + ' указано двічі');
    seen[row] = 1;
    if (!isFinite(q) || q < 0) throw new Error('Невірна кількість: ' + x.name);
    if (dir !== 'veg' && q % 1) throw new Error('Кількість має бути цілою: ' + x.name);
    return { row: row, name: String(x.name || ''), oldQty: Number(x.oldQty),
             qty: Math.round(q * 1000) / 1000 };
  }).filter(function (x) { return x.qty !== x.oldQty; });
  if (!ch.length) throw new Error('Змін немає');

  var tok = dirLockAcquire_(cfg.key, 20000);
  if (!tok) throw new Error('Зараз іде запис замовлень, спробуйте за хвилину');
  var log = [], left = 0;
  try {
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
    if (!sh) throw new Error('Немає листа ' + rawSheetName_(cfg));
    var w = Math.max(sh.getLastColumn(), 7);
    var last = sh.getLastRow();

    ch.forEach(function (x) {
      if (x.row > last) throw new Error('Рядок «' + x.name + '» вже не на місці. Оновіть екран.');
      var r = sh.getRange(x.row, 1, 1, w).getValues()[0];
      if (rawDate_(r[0]) !== today ||
          addrKey_(String(r[2] || '').trim()) !== target ||
          String(r[c.name] || '') !== x.name ||
          (Number(r[c.qty]) || 0) !== x.oldQty)
        throw new Error('Рядок «' + x.name + '» змінився з моменту відкриття. Оновіть екран.');
      x.r = r;
    });

    ch.forEach(function (x) {
      if (x.qty <= 0) return;
      sh.getRange(x.row, c.qty + 1).setValue(x.qty);
      if (dir === 'veg')
        sh.getRange(x.row, 7).setValue(Math.round((Number(x.r[4]) || 0) * x.qty * 100) / 100);
      log.push(x.name + ': ' + x.oldQty + ' → ' + x.qty);
    });
    ch.filter(function (x) { return x.qty <= 0; })
      .sort(function (a, b) { return b.row - a.row; })      // знизу вгору - номери не зсуваються
      .forEach(function (x) { sh.deleteRow(x.row); log.push(x.name + ': прибрано (було ' + x.oldQty + ')'); });
    SpreadsheetApp.flush();
    left = todayRowsCount_(sh, today, target);
  } finally {
    dirLockRelease_(cfg.key, tok);
  }

  var props = PropertiesService.getScriptProperties();
  if (!left) props.deleteProperty(orderMarkKey_(dir, store));
  if (dir === 'nbhz') props.setProperty('nbhz_export_dirty', today);
  invalidateAppCache();
  adminLog_('Змінено замовлення', cfg.title + ' / ' + store.label + ': ' + log.join('; ') +
            (left ? '' : ' - замовлення порожнє, позначку знято'));
  return { changed: log.length, left: left };
}

// ---------- 3. КАРТКА ТОЧКИ (Довідник ТТ) ----------
// Адреси (C, K, L, M, P) тут НЕ редагуються: з них будується id точки
// і зіставлення з сирими листами.
var CARD_COLS = { active: 1, label: 2, code: 4, route: 5, bread: 7, bakery: 8, veg: 9,
  note: 10, nbhz: 14, routeNbhz: 15, daysVeg: 17, daysBakery: 18, zone: 19, edrpou: 20 };
var CARD_BOOL = { active: 1, bread: 1, bakery: 1, veg: 1, nbhz: 1 };
var CARD_DAYS_OK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
var CARD_ZONES_OK = ['Салтовка', 'Новые дома', 'Центр', 'не возится'];
var CARD_TITLES = { active: 'Активна', label: 'Назва', code: 'Обліковий номер', route: 'Маршрут',
  bread: 'Хліб Рома', bakery: 'Випічка', veg: 'Овочі', note: 'Примітка', nbhz: 'Хліб НБХЗ',
  routeNbhz: 'Маршрут НБХЗ', daysVeg: 'Дні овочів', daysBakery: 'Дні випічки',
  zone: 'Зона ВК', edrpou: 'ЄДРПОУ' };

function cardFind_(id) {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('Довідник порожній');
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 20).getValues();
  var hit = [];
  vals.forEach(function (r, i) {
    if (String(r[2]).trim() && canonKey_(String(r[2]).trim()) === String(id)) hit.push({ row: i + 2, r: r });
  });
  if (!hit.length) throw new Error('Точку не знайдено в Довіднику. Оновіть сторінку.');
  if (hit.length > 1) throw new Error('У Довіднику ' + hit.length + ' рядки з цією адресою (' +
    hit.map(function (h) { return h.row; }).join(', ') + '). Приберіть дубль руками.');
  return { sh: sh, row: hit[0].row, r: hit[0].r };
}

function cardVal_(k, v) {
  if (CARD_BOOL[k]) return v === true;
  return String(v == null ? '' : v).trim();
}

function cardFields_(r) {
  var f = {};
  Object.keys(CARD_COLS).forEach(function (k) { f[k] = cardVal_(k, r[CARD_COLS[k] - 1]); });
  return f;
}

function cardFmt_(v) {
  return v === true ? 'так' : v === false ? 'ні' : (String(v) === '' ? '(порожньо)' : String(v));
}

function admCard_(payload) {
  var x = cardFind_(String(payload.storeId || ''));
  var r = x.r;
  return {
    id: String(payload.storeId), row: x.row,
    label: String(r[1] || '').trim(), address: String(r[2] || '').trim(),
    addr: { bread: String(r[10] || '').trim(), bakery: String(r[11] || '').trim(),
            veg: String(r[12] || '').trim(), nbhz: String(r[15] || '').trim() },
    f: cardFields_(r), zones: CARD_ZONES_OK,
    defEdrpou: (typeof BREAD_EDRPOU !== 'undefined') ? BREAD_EDRPOU : ''
  };
}

function admCardSave_(payload) {
  var id = String(payload.storeId || '');
  var set = payload.set || {}, orig = payload.orig || {};
  var keys = Object.keys(set).filter(function (k) { return CARD_COLS[k]; });
  if (!keys.length) throw new Error('Змін немає');

  keys.forEach(function (k) {
    if (CARD_BOOL[k]) { set[k] = (set[k] === true); return; }
    var v = String(set[k] == null ? '' : set[k]).trim();
    if (k === 'label' && !v) throw new Error('Назва не може бути порожньою');
    if (k === 'code' && v && !/^\d+$/.test(v)) throw new Error('Обліковий номер - тільки цифри');
    if (k === 'edrpou' && v && !/^\d{8}$/.test(v)) throw new Error('ЄДРПОУ - 8 цифр або порожньо');
    if (k === 'zone' && v && CARD_ZONES_OK.indexOf(v) < 0) throw new Error('Невідома зона: ' + v);
    if (k === 'daysVeg' || k === 'daysBakery') {
      var t = v ? v.split(/[\s,;]+/).filter(String) : [];
      t.forEach(function (d) { if (CARD_DAYS_OK.indexOf(d) < 0) throw new Error('Невідомий день: ' + d); });
      t = CARD_DAYS_OK.filter(function (d) { return t.indexOf(d) >= 0; });
      v = t.join(', ');
      if (typeof parseDays_ === 'function' && parseDays_(v).length !== t.length)
        throw new Error('Застосунок не розпізнає дні "' + v + '" - нічого не змінено');
    }
    set[k] = v;
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Сервер зайнятий, спробуйте ще раз');
  var log = [], x;
  try {
    x = cardFind_(id);
    var cur = cardFields_(x.r);
    keys.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(orig, k) &&
          String(cur[k]) !== String(cardVal_(k, orig[k])))
        throw new Error('Поле «' + CARD_TITLES[k] + '» вже змінили в Довіднику (зараз: ' +
                        cardFmt_(cur[k]) + '). Оновіть картку.');
    });
    keys.forEach(function (k) {
      if (String(cur[k]) === String(set[k])) return;
      var cell = x.sh.getRange(x.row, CARD_COLS[k]);
      if (k === 'edrpou') cell.setNumberFormat('@');
      cell.setValue(k === 'code' && set[k] ? Number(set[k]) : set[k]);
      log.push(CARD_TITLES[k] + ': ' + cardFmt_(cur[k]) + ' → ' + cardFmt_(set[k]));
    });
    SpreadsheetApp.flush();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }

  invalidateAppCache();
  if (log.length) adminLog_('Змінено картку точки',
    String(x.r[1] || '').trim() + ' (рядок ' + x.row + '): ' + log.join('; '));
  return { changed: log.length, row: x.row };
}
