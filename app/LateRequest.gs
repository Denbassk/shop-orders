// ============================================================
// ДОЗАМОВЛЕННЯ ПІСЛЯ ДЕДЛАЙНУ - БЕЗ ЖОДНИХ ТАБЛИЦЬ
//
// 1. Продавець тисне "Попросити дозвіл".
// 2. Закупниці приходить лист з однією кнопкою "ДОЗВОЛИТИ".
// 3. Вона тисне її з телефона.
// 4. Кнопка "Відправити" у продавця вмикається сама (до 45 секунд)
//    і працює LATE_TTL_MIN хвилин. Далі знову закрито.
// 5. Замовлення падає у звичайну таблицю напрямку, як усі інші.
//
// Дозвіл живе у властивостях скрипта. Жодних листів, жодного прибирання.
// ============================================================

// Кому слати листи. Кілька адрес - через кому.
var LATE_MAIL = {
  bread:  'svetlanalesakor@gmail.com',
  nbhz:   'svetlanalesakor@gmail.com',
  veg:    'svetlanalesakor@gmail.com',
  bakery: 'haikora1004@gmail.com'
};

var LATE_TTL_MIN = 30;     // скільки хвилин діє дозвіл після натискання
var LATE_Q_TTL_MIN = 120;  // скільки висить сам запит, якщо на нього не відповіли

// --- сховище: одна властивість на напрямок ---
// late_ok_<dir> = {"at":{"<id точки>": <мс>}}
// late_q_<dir>  = те саме для надісланих запитів

function lateBucket_(prefix, dirKey) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(prefix + dirKey);
    var o = v ? JSON.parse(v) : null;
    return { at: (o && o.at) ? o.at : {} };
  } catch (e) { return { at: {} }; }
}

function lateBucketPut_(prefix, dirKey, storeId, ttlMin) {
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(5000); } catch (e) {}
  try {
    var b = lateBucket_(prefix, dirKey);
    var now = Date.now(), keep = {};
    Object.keys(b.at).forEach(function (k) {           // просрочені викидаємо
      if (now - b.at[k] < ttlMin * 60000) keep[k] = b.at[k];
    });
    keep[String(storeId)] = now;
    PropertiesService.getScriptProperties()
      .setProperty(prefix + dirKey, JSON.stringify({ at: keep }));
  } finally {
    if (got) { try { lock.releaseLock(); } catch (e) {} }
  }
}

function lateLeftMs_(prefix, dirKey, storeId, ttlMin) {
  var ts = lateBucket_(prefix, dirKey).at[String(storeId)];
  if (!ts) return 0;
  var left = ttlMin * 60000 - (Date.now() - ts);
  return left > 0 ? left : 0;
}

// 'none' | 'pending' | 'approved'
function lateRequestStatus_(dirKey, storeId) {
  if (!dirKey || !storeId) return 'none';
  try {
    if (lateLeftMs_('late_ok_', dirKey, storeId, LATE_TTL_MIN) > 0) return 'approved';
    if (lateLeftMs_('late_q_', dirKey, storeId, LATE_Q_TTL_MIN) > 0) return 'pending';
    return 'none';
  } catch (e) {
    console.error('lateRequestStatus_: ' + e.message);
    return 'none';
  }
}

// Скільки хвилин ще діє дозвіл (0 - не діє)
function lateLeftMin_(dirKey, storeId) {
  var ms = lateLeftMs_('late_ok_', dirKey, storeId, LATE_TTL_MIN);
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function approveLate_(dirKey, storeId) {
  lateBucketPut_('late_ok_', dirKey, storeId, LATE_TTL_MIN);
}

// --- запит від продавця ---
function apiRequestLate_(payload) {
  var dirKey = String(payload.dir || '');
  var cfg = dirCfg_(dirKey);
  var store = findStore_(payload.storeId);

  if (lateRequestStatus_(dirKey, store.id) === 'approved')
    return { status: 'approved', mailed: true, leftMin: lateLeftMin_(dirKey, store.id) };

  lateBucketPut_('late_q_', dirKey, store.id, LATE_Q_TTL_MIN);

  var mailed = false;
  try { mailed = sendLateMail_(cfg, store); }
  catch (e) { console.error('Лист про дозвіл: ' + e.message); }

  console.log('Запит дозволу: ' + cfg.title + ' / ' + store.label +
              (mailed ? ' - лист надіслано' : ' - БЕЗ листа (не налаштована пошта)'));
  return { status: 'pending', mailed: mailed, leftMin: 0 };
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
    (store.code ? '<div style="font-size:13px;color:#6b7280">обліковий номер ' +
        esc_(store.code) + '</div>' : '') +
    '<div style="font-size:16px;margin:8px 0 2px">' + esc_(cfg.title) + '</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-bottom:22px">запит о ' +
      formatTime_(now) + ', дедлайн був ' + esc_(cfg.deadline) + '</div>' +
    '<a href="' + url + '" style="display:block;text-align:center;background:#e11b22;color:#fff;' +
    'text-decoration:none;padding:17px;border-radius:13px;font-size:18px;font-weight:800">' +
    'ДОЗВОЛИТИ</a>' +
    '<div style="font-size:13px;color:#6b7280;margin-top:18px;line-height:1.5">' +
    'Дозвіл відкриє прийом на <b>' + LATE_TTL_MIN + ' хвилин</b> і лише для цієї точки ' +
    'та цього напрямку. Потім знову закриється.<br>' +
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
    head = 'Дозволено на ' + LATE_TTL_MIN + ' хв';
    body = '<b>' + esc_(cfg.title) + '</b><br>' + esc_(label) +
           '<br><br>Продавець зможе відправити замовлення протягом хвилини.<br>' +
           'Через ' + LATE_TTL_MIN + ' хвилин прийом закриється знову.';
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

// Один раз після clasp push - Google спитає дозвіл на відправку пошти
function authorizeMail() {
  console.log('Пошта авторизована. Листів сьогодні залишилось: ' +
              MailApp.getRemainingDailyQuota());
  Object.keys(LATE_MAIL).forEach(function (k) {
    console.log('   ' + dirCfg_(k).title + ': ' + (LATE_MAIL[k] || '- не налаштовано -'));
  });
  console.log('Дозвіл діє ' + LATE_TTL_MIN + ' хв після натискання кнопки в листі.');
}

// Що зараз дозволено і скільки лишилось
function showLateToday() {
  var any = false;
  Object.keys(DIRECTIONS).forEach(function (k) {
    var ok = lateBucket_('late_ok_', k).at;
    var q = lateBucket_('late_q_', k).at;
    var lines = [];
    Object.keys(ok).forEach(function (id) {
      var left = lateLeftMin_(k, id);
      if (left > 0) lines.push('   дозволено (' + left + ' хв): ' + id);
    });
    Object.keys(q).forEach(function (id) {
      if (lateLeftMs_('late_ok_', k, id, LATE_TTL_MIN) > 0) return;
      if (lateLeftMs_('late_q_', k, id, LATE_Q_TTL_MIN) > 0) lines.push('   чекає: ' + id);
    });
    if (!lines.length) return;
    any = true;
    console.log(dirCfg_(k).title + ':');
    lines.forEach(function (l) { console.log(l); });
  });
  if (!any) console.log('Активних дозволів і запитів немає');
  console.log('---');
  console.log('Ручне посилання: lateLinkFor("nbhz", "частина назви точки")');
}

// Посилання "Дозволити" вручну - можна переслати в месенджер
function lateLinkFor(dirKey, part) {
  var q = String(part || '').toLowerCase();
  var hits = loadStores_().filter(function (s) {
    return s.directions.indexOf(dirKey) >= 0 && s.label.toLowerCase().indexOf(q) >= 0;
  });
  if (!hits.length) { console.log('Не знайдено точку: ' + part); return; }
  hits.forEach(function (s) {
    console.log(s.label + (s.code ? ' (№' + s.code + ')' : '') + '  ->  ' +
                lateApproveUrl_(dirKey, s.id));
  });
}

// Скасувати всі активні дозволи по напрямку
function resetLateToday(dirKey) {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty('late_ok_' + dirKey);
  p.deleteProperty('late_q_' + dirKey);
  console.log('Дозволи скинуто: ' + dirCfg_(dirKey).title);
}
