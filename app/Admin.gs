// ============================================================
// ПУЛЬТ КЕРУВАННЯ (адмінка)
// Відкривається за адресою застосунку з ?admin=1, вхід за PIN.
// Інтерфейс - ui/Admin.html, російською.
//
// Перший запуск:  i01_setAdminPin()  (вписати PIN усередині Actions.gs)
// Посилання:      i02_showAdminLink()
//
// Усе, що змінює дані, пишеться в лист "Журнал дій" Довідника.
// ============================================================

var ADMIN_PIN_KEY   = 'admin_pin';
var ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;      // 12 годин
var ADMIN_FAIL_KEY  = 'admin_fail';
var ADMIN_FAIL_MAX  = 5;                        // спроб на годину
var ADMIN_LOG_SHEET = 'Журнал дій';

// --- сторінка ---
function adminPage_() {
  return HtmlService.createTemplateFromFile('ui/Admin')
    .evaluate()
    .setTitle('Пульт Фемелі Маркет')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// --- вхід ---
function adminPin_() {
  return String(PropertiesService.getScriptProperties().getProperty(ADMIN_PIN_KEY) || '');
}

function setAdminPin(pin) {
  pin = String(pin || '').trim();
  if (pin.length < 4) throw new Error('PIN - мінімум 4 цифри');
  PropertiesService.getScriptProperties().setProperty(ADMIN_PIN_KEY, pin);
  console.log('PIN пульта записано. Посилання: ' + adminUrl_());
}

function adminUrl_() {
  var u = appUrl_() || '(спершу відкрийте застосунок у браузері)';
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'admin=1';
}

function adminFailCheck_() {
  var props = PropertiesService.getScriptProperties();
  var o = {};
  try { o = JSON.parse(props.getProperty(ADMIN_FAIL_KEY) || '{}'); } catch (e) {}
  if (o.ts && (Date.now() - o.ts) > 3600000) o = {};
  return { props: props, o: o };
}

function adminLogin_(pin) {
  var real = adminPin_();
  if (!real) throw new Error('PIN ще не задано. Запустіть i01_setAdminPin() у редакторі.');

  var f = adminFailCheck_();
  if ((f.o.n || 0) >= ADMIN_FAIL_MAX)
    throw new Error('Забагато спроб. Спробуйте за годину.');

  if (String(pin || '').trim() !== real) {
    f.props.setProperty(ADMIN_FAIL_KEY,
      JSON.stringify({ n: (f.o.n || 0) + 1, ts: f.o.ts || Date.now() }));
    throw new Error('Невірний PIN');
  }

  f.props.deleteProperty(ADMIN_FAIL_KEY);
  var token = Utilities.getUuid();
  f.props.setProperty('adm_' + token, String(Date.now() + ADMIN_TOKEN_TTL));
  return { token: token };
}

function adminCheck_(token) {
  token = String(token || '');
  if (!token) throw new Error('AUTH');
  var props = PropertiesService.getScriptProperties();
  var till = Number(props.getProperty('adm_' + token) || 0);
  if (!till || till < Date.now()) { props.deleteProperty('adm_' + token); throw new Error('AUTH'); }
  return true;
}

// --- журнал дій ---
function adminLog_(what, details) {
  try {
    var ss = SpreadsheetApp.openById(REGISTRY_ID);
    var sh = ss.getSheetByName(ADMIN_LOG_SHEET);
    if (!sh) {
      sh = ss.insertSheet(ADMIN_LOG_SHEET);
      sh.getRange(1, 1, 1, 3).setValues([['Коли', 'Дія', 'Подробиці']])
        .setFontWeight('bold').setBackground('#16181d').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 240); sh.setColumnWidth(3, 620);
    }
    sh.appendRow([Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy HH:mm'),
                  String(what), String(details || '')]);
  } catch (e) { console.error('журнал: ' + e.message); }
}

// Час останньої збірки звіту напрямку - для екрана "Сегодня"
function markReport_(dirKey) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      'report_at_' + dirKey,
      Utilities.formatDate(new Date(), 'Europe/Kyiv', 'dd.MM.yyyy HH:mm'));
  } catch (e) {}
}

function reportAt_(dirKey) {
  var v = PropertiesService.getScriptProperties().getProperty('report_at_' + dirKey) || '';
  var today = formatDateDMY_(new Date());
  return (v.indexOf(today) === 0) ? v.slice(11) : '';
}

// ============================================================
// API пульта. Одна точка входу для ui/Admin.html
// ============================================================
function adminApi(action, payload, token) {
  payload = payload || {};
  try {
    if (action !== 'login') adminCheck_(token);
    var data;
    switch (action) {
      case 'login':          data = adminLogin_(payload.pin); break;
      case 'today':          data = admToday_(); break;
      case 'stores':         data = admStores_(payload); break;
      case 'dirStores':      data = admDirStores_(payload); break;
      case 'store':          data = admStore_(payload); break;
      case 'cancelOrder':    data = admCancelOrder_(payload); break;
      case 'clearMark':      data = admClearMark_(payload); break;
      case 'openStore':      data = admOpenStore_(payload); break;
      case 'openAll':        data = admOpenAll_(payload); break;
      case 'closeAll':       data = admCloseAll_(payload); break;
      case 'restoreScan':    data = admRestoreScan_(payload); break;
      case 'restoreApply':   data = admRestoreApply_(payload); break;
      case 'report':         data = admReport_(payload); break;
      case 'schedule':       data = admSchedule_(payload); break;
      case 'log':            data = admLogRead_(); break;
      default: throw new Error('Невідома дія: ' + action);
    }
    return { ok: true, data: data };
  } catch (err) {
    var msg = String((err && err.message) || err);
    if (msg !== 'AUTH') console.error('adminApi ' + action + ': ' + ((err && err.stack) || err));
    return { ok: false, error: msg };
  }
}

// --- екран "Сегодня" ---
function admToday_() {
  var status = loadTodayStatus_();
  var stores = loadStores_();
  var n = nowKyiv_();

  var dirs = Object.keys(DIRECTIONS).map(function (k) {
    var cfg = DIRECTIONS[k];
    var total = 0, ordered = 0, offDay = 0, all = 0, waiting = [];
    stores.forEach(function (s) {
      if (s.directions.indexOf(k) < 0) return;
      all++;
      if (!dayAllowed_(k, s)) { offDay++; return; }       // сьогодні не їхній день
      total++;
      var map = status[k];
      if (map && map[statusKey_(k, s)]) ordered++;
      else waiting.push(s.label);
    });
    return {
      key: k, title: cfg.title, color: cfg.color, deadline: cfg.deadline || '',
      closed: deadlinePassed_(k), openedAll: lateAllowed_(k),
      total: total, ordered: ordered, waiting: waiting.slice(0, 40),
      // графік по днях: скільки точок узагалі, скільки сьогодні не приймають
      all: all, offDay: offDay, byDays: !!cfg.orderDays,
      noDayToday: !!cfg.orderDays && total === 0 && all > 0,
      reportAt: reportAt_(k),
      minLeft: cfg.deadline ? deadlineLeftMin_(cfg.deadline, n) : null
    };
  });

  return {
    today: formatDateDMY_(new Date()),
    time: ('0' + n.hh).slice(-2) + ':' + ('0' + n.mm).slice(-2),
    dow: DAY_RU_FULL[todayDow_()],
    dirs: dirs
  };
}

// --- графік точки по напрямку: дні, чи сьогодні, коли наступний ---
var DAY_RU_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
var DAY_RU_FULL  = ['воскресенье', 'понедельник', 'вторник', 'среда',
                    'четверг', 'пятница', 'суббота'];

function admDays_(dirKey, store) {
  var cfg = dirCfg_(dirKey);
  if (!cfg.orderDays) return { free: true, label: 'каждый день', today: true, next: '' };

  var days = storeDays_(dirKey, store);
  if (!days.length) return { free: true, label: 'без ограничений', today: true, next: '' };

  var dow = todayDow_();
  var today = days.indexOf(dow) >= 0;
  var next = '';
  for (var i = 1; i <= 7; i++) {
    var d = (dow + i) % 7;
    if (days.indexOf(d) < 0) continue;
    next = (i === 1) ? 'завтра' : ('в ' + DAY_RU_FULL[d]);
    break;
  }
  return {
    free: false,
    label: days.map(function (d) { return DAY_RU_SHORT[d]; }).join(', '),
    today: today,
    next: next
  };
}

// --- графік по всіх точках: кому що і коли доступно ---
function admSchedule_(payload) {
  var only = String(payload.dir || '');
  var status = loadTodayStatus_();
  var keys = only ? [only] : Object.keys(DIRECTIONS);

  var rows = loadStores_().map(function (s) {
    var cells = [];
    keys.forEach(function (k) {
      if (s.directions.indexOf(k) < 0) return;
      var d = admDays_(k, s);
      var map = status[k];
      cells.push({
        dir: k, title: dirCfg_(k).title, deadline: dirCfg_(k).deadline || '',
        days: d.label, today: d.today, next: d.next,
        ordered: !!(map && map[statusKey_(k, s)])
      });
    });
    return { id: s.id, label: s.label, code: s.code, route: s.route, cells: cells };
  }).filter(function (r) { return r.cells.length; });

  rows.sort(function (a, b) { return a.label.localeCompare(b.label, 'uk'); });

  return {
    dir: only, dow: DAY_RU_FULL[todayDow_()], today: formatDateDMY_(new Date()),
    dirs: keys.map(function (k) {
      return { key: k, title: dirCfg_(k).title, deadline: dirCfg_(k).deadline || '',
               byDays: !!dirCfg_(k).orderDays };
    }),
    rows: rows
  };
}

function deadlineLeftMin_(deadline, n) {
  var p = String(deadline).split(':');
  return (+p[0] * 60 + +p[1]) - (n.hh * 60 + n.mm);
}

// --- пошук точок ---
function admStores_(payload) {
  var q = String(payload.q || '').trim().toLowerCase();
  var dir = String(payload.dir || '');
  var status = loadTodayStatus_();

  return loadStores_().filter(function (s) {
    if (dir && s.directions.indexOf(dir) < 0) return false;
    if (!q) return true;
    return (s.label + ' ' + s.address + ' ' + s.code).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 60).map(function (s) {
    var map = dir ? status[dir] : null;
    return {
      id: s.id, label: s.label, code: s.code, route: s.route,
      zone: s.zone, directions: s.directions,
      ordered: !!(map && map[statusKey_(dir, s)])
    };
  });
}

// --- хто саме замовив по напрямку, а хто ні ---
// Один прохід по сирому листу: позиції, кількість і час по кожній точці.
function admDirStores_(payload) {
  var dir = String(payload.dir || '');
  var cfg = dirCfg_(dir);
  var today = formatDateDMY_(new Date());
  var c = rawCols_(dir);
  var hasTime = (dir === 'bakery' || dir === 'veg');

  var agg = {};
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (sh && sh.getLastRow() > 1) {
    var last = sh.getLastRow();
    var take = Math.min(last - 1, RAW_TAIL_ROWS);
    var w = Math.max(sh.getLastColumn(), 7);
    sh.getRange(last - take + 1, 1, take, w).getValues().forEach(function (r) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0] || '').trim();
      if (d !== today) return;
      var key = addrKey_(String(r[2] || '').trim());
      if (!key) return;
      if (!agg[key]) agg[key] = { n: 0, qty: 0, time: '' };
      agg[key].n++;
      agg[key].qty += Number(r[c.qty]) || 0;
      if (hasTime) {
        var t = (r[1] instanceof Date)
          ? Utilities.formatDate(r[1], 'Europe/Kyiv', 'HH:mm')
          : String(r[1] || '').trim().slice(0, 5);
        if (t) agg[key].time = t;
      }
    });
  }

  var done = [], wait = [], off = [];
  loadStores_().forEach(function (s) {
    if (s.directions.indexOf(dir) < 0) return;
    var d = admDays_(dir, s);
    var a = agg[statusKey_(dir, s)];
    var row = {
      id: s.id, label: s.label, code: s.code, route: s.route,
      n: a ? a.n : 0, qty: a ? Math.round(a.qty * 1000) / 1000 : 0,
      time: a ? a.time : '',
      days: d.label, next: d.next, dayOk: d.today
    };
    // не їхній день: показуємо окремо, а не ховаємо - інакше незрозуміло,
    // чи точка забула замовити, чи їй сьогодні не можна
    if (!d.today) { off.push(row); return; }
    if (a) done.push(row); else wait.push(row);
  });

  var byLabel = function (a, b) { return a.label.localeCompare(b.label, 'uk'); };
  done.sort(function (a, b) { return (b.time || '').localeCompare(a.time || '') || byLabel(a, b); });
  wait.sort(byLabel);
  off.sort(byLabel);

  return { dir: dir, title: cfg.title, unit: cfg.unit,
           done: done, wait: wait, off: off,
           byDays: !!cfg.orderDays, dow: DAY_RU_FULL[todayDow_()],
           xlsx: admXlsxUrl_(dir), sheetUrl: admSheetUrl_(dir) };
}

// Посилання, що качає ТІЛЬКИ лист звіту цього напрямку
function admXlsxUrl_(dir) {
  var names = {
    bread:  'Заказы',
    bakery: 'Заказы ВК',
    veg:    'Замовлення Овочі',
    nbhz:   'Вивантаження ' + formatDateDMY_(new Date())
  };
  try {
    var cfg = dirCfg_(dir);
    var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(names[dir]);
    if (!sh) return '';
    return 'https://docs.google.com/spreadsheets/d/' + cfg.spreadsheetId +
           '/export?format=xlsx&gid=' + sh.getSheetId();
  } catch (e) { return ''; }
}

function admSheetUrl_(dir) {
  try {
    return 'https://docs.google.com/spreadsheets/d/' + dirCfg_(dir).spreadsheetId + '/edit';
  } catch (e) { return ''; }
}

// Зібрати звіт напрямку просто зараз
function admReport_(payload) {
  var dir = String(payload.dir || '');
  var cfg = dirCfg_(dir);
  if (dir === 'bread') buildBreadReports();
  else if (dir === 'bakery') buildBakeryReports();
  else if (dir === 'veg') buildVegReports();
  else if (dir === 'nbhz') buildNbhzExport();
  else throw new Error('Невідомий напрямок');
  adminLog_('Зібрано звіт', cfg.title);
  return { at: reportAt_(dir), xlsx: admXlsxUrl_(dir) };
}

// --- картка точки ---
function admStore_(payload) {
  var store = findStore_(payload.storeId);
  var dir = String(payload.dir || store.directions[0]);
  var cfg = dirCfg_(dir);
  var today = formatDateDMY_(new Date());

  var rows = [], first = 0;
  var sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
  if (sh && sh.getLastRow() > 1) {
    var last = sh.getLastRow();
    var take = Math.min(last - 1, RAW_TAIL_ROWS);
    var from = last - take + 1;
    var w = Math.max(sh.getLastColumn(), 7);
    var c = rawCols_(dir);
    var target = statusKey_(dir, store);
    sh.getRange(from, 1, take, w).getValues().forEach(function (r, i) {
      var d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
      if (d !== today) return;
      if (addrKey_(String(r[2] || '').trim()) !== target) return;
      if (!first) first = from + i;
      rows.push({ name: String(r[c.name] || ''), qty: Number(r[c.qty]) || 0 });
    });
  }

  var qty = 0;
  rows.forEach(function (r) { qty += r.qty; });

  return {
    id: store.id, label: store.label, code: store.code,
    route: store.route, zone: store.zone, directions: store.directions,
    dir: dir, dirTitle: cfg.title, unit: cfg.unit, today: today,
    sheet: rawSheetName_(cfg), firstRow: first,
    rows: rows, qty: Math.round(qty * 1000) / 1000,
    marked: isMarked_(dir, store),
    dayOk: dayAllowed_(dir, store),
    // графік по всіх напрямках точки - видно одразу, кому що і коли можна
    schedule: store.directions.map(function (k) {
      var d = admDays_(k, store);
      return { dir: k, title: dirCfg_(k).title, deadline: dirCfg_(k).deadline || '',
               days: d.label, today: d.today, next: d.next };
    }),
    closed: deadlinePassed_(dir, store.id),
    lateLeft: lateLeftMin_(dir, store.id)
  };
}

function isMarked_(dirKey, store) {
  try {
    return !!PropertiesService.getScriptProperties().getProperty(orderMarkKey_(dirKey, store));
  } catch (e) { return false; }
}

// Колонки сирого листа по напрямках: де назва і де кількість
function rawCols_(dirKey) {
  if (dirKey === 'bakery') return { name: 5, qty: 7 };
  if (dirKey === 'veg')    return { name: 3, qty: 5 };
  return { name: 4, qty: 6 };                      // bread, nbhz
}

// --- дії з замовленням точки ---
function admCancelOrder_(payload) {
  var store = findStore_(payload.storeId);
  var dir = String(payload.dir || '');
  var cfg = dirCfg_(dir);

  var g = LockService.getScriptLock();
  if (!g.tryLock(30000)) throw new Error('Сервер зайнятий, спробуйте ще раз');
  var removed = 0;
  try { removed = deleteTodayRows_(cfg, dir, store); }
  finally { try { g.releaseLock(); } catch (e) {} }

  PropertiesService.getScriptProperties().deleteProperty(orderMarkKey_(dir, store));
  if (dir === 'nbhz')
    PropertiesService.getScriptProperties().setProperty('nbhz_export_dirty', formatDateDMY_(new Date()));
  invalidateAppCache();
  adminLog_('Скасовано замовлення', cfg.title + ' / ' + store.label + ' - рядків ' + removed);
  return { removed: removed };
}

function admClearMark_(payload) {
  var store = findStore_(payload.storeId);
  var dir = String(payload.dir || '');
  PropertiesService.getScriptProperties().deleteProperty(orderMarkKey_(dir, store));
  invalidateAppCache();
  adminLog_('Знято позначку', dirCfg_(dir).title + ' / ' + store.label);
  return { ok: true };
}

function admOpenStore_(payload) {
  var store = findStore_(payload.storeId);
  var dir = String(payload.dir || '');
  approveLate_(dir, store.id);
  invalidateAppCache();
  adminLog_('Відкрито прийом точці', dirCfg_(dir).title + ' / ' + store.label +
            ' - на ' + LATE_TTL_MIN + ' хв');
  return { left: lateLeftMin_(dir, store.id) };
}

function admOpenAll_(payload) {
  var dir = String(payload.dir || '');
  allowLate_(dir);
  invalidateAppCache();
  adminLog_('Відкрито прийом усім', dirCfg_(dir).title + ' - до кінця дня');
  return { ok: true };
}

function admCloseAll_(payload) {
  var dir = String(payload.dir || '');
  closeLate_(dir);
  invalidateAppCache();
  adminLog_('Повернуто звичайний режим', dirCfg_(dir).title);
  return { ok: true };
}

// --- журнал у пульті ---
function admLogRead_() {
  var sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(ADMIN_LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var last = sh.getLastRow();
  var take = Math.min(last - 1, 30);
  return sh.getRange(last - take + 1, 1, take, 3).getValues()
    .map(function (r) {
      var when = (r[0] instanceof Date)
        ? Utilities.formatDate(r[0], 'Europe/Kyiv', 'dd.MM.yyyy HH:mm')
        : String(r[0] || '');
      return { when: when, what: String(r[1] || ''), details: String(r[2] || '') };
    })
    .reverse();
}
