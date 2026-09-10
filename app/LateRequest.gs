// ============================================================
// ДОЗАМОВЛЕННЯ ПІСЛЯ ДЕДЛАЙНУ - БЕЗ ЖОДНИХ ТАБЛИЦЬ
//
// 1. Продавець після дедлайну тисне "Попросити дозвіл".
// 2. Закупниці приходить лист із однією кнопкою "ДОЗВОЛИТИ".
// 3. Вона тисне її з телефона - відкривається сторінка "Дозволено".
// 4. Телефон продавця сам вмикає кнопку "Відправити" (до 45 секунд).
// 5. Замовлення падає у звичайну таблицю напрямку, як усі інші.
//
// Дозвіл живе у властивостях скрипта і діє ЛИШЕ сьогодні.
// Назавтра гасне сам - прибирати нічого не треба.
// ============================================================

// Кому слати листи. Кілька адрес - через кому.
// Порожньо = запит зафіксується, але нікого не сповістить.
var LATE_MAIL = {
  bread: '',
  nbhz:  '',
  bakery: '',
  veg:   ''
};

// --- сховище: одна властивість на напрямок ---
// late_ok_<dir> = {"day":"10.09.2026","ids":["амосова 5а", ...]}
// late_q_<dir>  = те саме для надісланих запитів

function lateBucket_(prefix, dirKey) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(prefix + dirKey);
    var o = v ? JSON.parse(v) : null;
    if (!o || o.day !== nowKyiv_().day) return { day: nowKyiv_().day, ids: [] };
    return { day: o.day, ids: o.ids || [] };
  } catch (e) { return { day: nowKyiv_().day, ids: [] }; }
}

function lateBucketAdd_(prefix, dirKey, storeId) {
  var lock = LockService.getScriptLock();
  try { lock.tryLock(5000); } catch (e) {}
  try {
    var b = lateBucket_(prefix, dirKey);
    if (b.ids.indexOf(storeId) < 0) b.ids.push(storeId);
    PropertiesService.getScriptProperties()
      .setProperty(prefix + dirKey, JSON.stringify(b));
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// 'none' | 'pending' | 'approved'
function lateRequestStatus_(dirKey, storeId) {
  if (!dirKey || !storeId) return 'none';
  try {
    if (lateBucket_('late_ok_', dirKey).ids.indexOf(String(storeId)) >= 0) return 'approved';
    if (lateBucket_('late_q_', dirKey).ids.indexOf(String(storeId)) >= 0) return 'pending';
    return 'none';
  } catch (e) {
    console.error('lateRequestStatus_: ' + e.message);
    return 'none';
  }
}

function approveLate_(dirKey, storeId) {
  lateBucketAdd_('late_ok_', dirKey, String(storeId));
}

// --- запит від продавця ---
function apiRequestLate_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  var st = lateRequestStatus_(dirKey, store.id);
  if (st === 'approved') return { status: 'approved', mailed: true };

  lateBucketAdd_('late_q_', dirKey, store.id);

  var mailed = false;
  try { mailed = sendLateMail_(cfg, store); }
  catch (e) { console.error('Лист про дозвіл: ' + e.message); }

  console.log('Запит дозволу: ' + cfg.title + ' / ' + store.label +
              (mailed ? ' - лист надіслано' : ' - БЕЗ листа (не налаштована пошта)'));
  return { status: 'pending', mailed: mailed };
}

// --- підпис посилання, щоб ніхто сторонній не "дозволив" ---
function lateSecret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('late_secret');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('late_secret', s); }
  return s;
}

function lateToken_(dirKey, storeId, day) {
  var sig = Utilities.computeHmacSha256Signature(dirKey + '|' + storeId + '|' + day, lateSecret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '').slice(0, 24);
}

function lateApproveUrl_(dirKey, storeId) {
  var day = nowKyiv_().day;
  return ScriptApp.getService().getUrl() +
    '?ok=' + encodeURIComponent(dirKey) +
    '&st=' + encodeURIComponent(storeId) +
    '&d='  + encodeURIComponent(day) +
    '&s='  + lateToken_(dirKey, storeId, day);
}

// --- лист закупниці ---
function sendLateMail_(cfg, store) {
  var to = String(LATE_MAIL[cfg.key] || '').trim();
  if (!to) return false;

  var url = lateApproveUrl_(cfg.key, store.id);
  var now = new Date();
  var html =
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:460px;' +
    'margin:0 auto;padding:22px 18px;color:#16181d">' +
    '<div style="font-size:13px;color:#6b7280">Замовлення після дедлайну</div>' +
    '<div style="font-size:22px;font-weight:800;margin:6px 0 2px">' + esc_(store.label) + '</div>' +
    '<div style="font-size:16px;margin-bottom:2px">' + esc_(cfg.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-bottom:22px">запит о ' +
      formatTime_(now) + ', дедлайн був ' + esc_(cfg.deadline) + '</div>' +
    '<a href="' + url + '" style="display:block;text-align:center;background:#e11b22;color:#fff;' +
    'text-decoration:none;padding:17px;border-radius:13px;font-size:18px;font-weight:800">' +
    'ДОЗВОЛИТИ</a>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:18px;line-height:1.5">' +
    'Дозвіл діє лише сьогодні і лише для цієї точки та цього напрямку.<br>' +
    'Нічого не робити - значить не дозволити.</div></div>';

  MailApp.sendEmail({
    to: to,
    subject: 'Дозвіл: ' + cfg.title + ' - ' + store.label,
    htmlBody: html,
    name: 'Замовлення Фемелі Маркет'
  });
  return true;
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- сторінка, що відкривається з листа ---
function lateApprovePage_(p) {
  var dirKey = String(p.ok || '');
  var storeId = String(p.st || '');
  var day = String(p.d || '');
  var sig = String(p.s || '');

  var okState = false, head = '', body = '';
  try {
    var cfg = dirCfg_(dirKey);
    if (!storeId || lateToken_(dirKey, storeId, day) !== sig)
      throw new Error('Посилання недійсне');
    if (day !== nowKyiv_().day)
      throw new Error('Посилання діє лише в день запиту. Попросіть продавця натиснути кнопку ще раз.');

    approveLate_(dirKey, storeId);
    okState = true;

    var label = storeId;
    try { label = findStore_(storeId).label; } catch (e) {}
    head = 'Дозволено';
    body = '<b>' + esc_(cfg.title) + '</b><br>' + esc_(label) +
           '<br><br>Продавець зможе відправити замовлення протягом хвилини.<br>' +
           'Дозвіл діє до кінця дня.';
  } catch (err) {
    head = 'Не вийшло';
    body = esc_(String(err.message || err));
  }

  var html =
    '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + head + '</title></head>' +
    '<body style="margin:0;background:#eceef1;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">' +
    '<div style="max-width:420px;margin:0 auto;padding:56px 22px;text-align:center;color:#16181d">' +
    '<div style="width:82px;height:82px;border-radius:50%;line-height:82px;font-size:44px;color:#fff;' +
    'margin:0 auto;background:' + (okState ? '#2e7d32' : '#b3261e') + '">' +
    (okState ? '&#10003;' : '!') + '</div>' +
    '<h2 style="margin:18px 0 10px;font-size:24px">' + head + '</h2>' +
    '<p style="color:#5d626b;font-size:16px;line-height:1.5">' + body + '</p>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================
// РУЧНЕ КЕРУВАННЯ З РЕДАКТОРА
// ============================================================

// Що дозволено сьогодні
function showLateToday() {
  Object.keys(DIRECTIONS).forEach(function (k) {
    var ok = lateBucket_('late_ok_', k).ids;
    var q = lateBucket_('late_q_', k).ids;
    if (!ok.length && !q.length) return;
    console.log(dirCfg_(k).title + ':');
    if (ok.length) console.log('   дозволено: ' + ok.join(' | '));
    q.filter(function (id) { return ok.indexOf(id) < 0; }).forEach(function (id) {
      console.log('   чекає: ' + id);
    });
  });
  console.log('---');
  console.log('Ручне посилання на дозвіл: lateLinkFor("nbhz", "частина назви точки")');
}

// Посилання "Дозволити" вручну - можна просто переслати в месенджер
function lateLinkFor(dirKey, part) {
  var q = String(part || '').toLowerCase();
  var hits = loadStores_().filter(function (s) {
    return s.directions.indexOf(dirKey) >= 0 && s.label.toLowerCase().indexOf(q) >= 0;
  });
  if (!hits.length) { console.log('Не знайдено точку: ' + part); return; }
  hits.forEach(function (s) {
    console.log(s.label + '  ->  ' + lateApproveUrl_(dirKey, s.id));
  });
}

// Скасувати всі сьогоднішні дозволи по напрямку
function resetLateToday(dirKey) {
  PropertiesService.getScriptProperties().deleteProperty('late_ok_' + dirKey);
  PropertiesService.getScriptProperties().deleteProperty('late_q_' + dirKey);
  console.log('Дозволи скинуто: ' + dirCfg_(dirKey).title);
}

// --- прибрати листи "Дозволи", якщо вони десь лишилися ---
function dropLateSheets() {
  var ids = {};
  ids[REGISTRY_ID] = 'Довідник ТТ';
  Object.keys(DIRECTIONS).forEach(function (k) {
    if (DIRECTIONS[k].spreadsheetId) ids[DIRECTIONS[k].spreadsheetId] = DIRECTIONS[k].title;
  });
  Object.keys(ids).forEach(function (id) {
    try {
      var ss = SpreadsheetApp.openById(id);
      var sh = ss.getSheetByName('Дозволи');
      if (!sh) return;
      ss.deleteSheet(sh);
      console.log('Видалено лист "Дозволи" з: ' + ids[id]);
    } catch (e) { console.log(ids[id] + ': ' + e.message); }
  });
  console.log('Готово');
}
