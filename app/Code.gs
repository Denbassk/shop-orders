// ============================================================
// ТОЧКА ВХОДУ
// ============================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  rememberAppUrl_();                      // адреса розгортання оновлюється сама
  if (p.ok) return lateApprovePage_(p);   // кнопка "Дозволити" з листа закупниці
  if (p.load) return loadProbe_(p);       // навантажувальний тест, Maintenance.gs
  if (p.admin) return adminPage_();       // пульт керування, Admin.gs (вхід за PIN)
  if (movedToFly_()) return movedPage_(); // 24.10.2026: сайт переїхав на Fly - нова адреса PWA_URL

  return HtmlService.createTemplateFromFile('ui/Index')
    .evaluate()
    .setTitle('Замовлення Фемелі Маркет')
    .setFaviconUrl(PWA_URL ? PWA_URL + 'icon-192.png' : '')
    // дозволяємо вбудовування: оболонка-застосунок тримає нас в iframe
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

// ---- Переїзд на Fly (24.10.2026) ----
// Сторінка продавця більше не працює: показує кнопку на нову адресу і просить оболонку (GitHub Pages) перезавантажитись.
// Відкат: у редакторі PropertiesService.getScriptProperties().setProperty('moved', '0') - сторінка знову робоча.
function movedToFly_() {
  try { return PropertiesService.getScriptProperties().getProperty('moved') !== '0'; } catch (e) { return true; }
}
function movedPage_() {
  var url = PWA_URL;
  var html = '<!doctype html><meta charset="utf-8"><base target="_top">' +
    '<style>body{margin:0;font-family:Arial,sans-serif;background:#eceef1;color:#16181d;text-align:center;padding:60px 24px}' +
    'h2{margin:0 0 10px;font-size:23px}p{font-size:16px;line-height:1.5;color:#5d626b;margin:0 0 26px}' +
    'a{display:inline-block;background:#e11b22;color:#fff;text-decoration:none;font-weight:700;font-size:18px;padding:16px 30px;border-radius:14px}</style>' +
    '<h2>Сайт замовлень переїхав</h2><p>Замовлення тепер приймаються на новій версії.<br>Натисніть кнопку - далі все як завжди.</p>' +
    '<a href="' + url + '" target="_top">Відкрити нову версію</a>' +
    '<script>try{window.top.postMessage({fm:"moved"},"*");}catch(e){}</script>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Замовлення Фемелі Маркет')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

function api(action, payload) {
  payload = payload || {};
  // після переїзду на Fly старі відкриті сторінки нічого не записують - щоб замовлення не лишалися лише в листі
  if (movedToFly_() && /^(submitOrder|requestLate|woSubmit|woDelete)$/.test(action))
    return { ok: false, error: 'Сайт переїхав. Закрийте застосунок повністю і відкрийте його знову.' };
  try {
    var data;
    switch (action) {
      case 'bootstrap':   data = apiBootstrap_(); break;
      case 'products':    data = apiProducts_(payload); break;
      case 'submitOrder': data = apiSubmitOrder_(payload); break;
      case 'requestLate': data = apiRequestLate_(payload); break;
      case 'refresh':     data = apiRefresh_(payload); break;
      // списання випічки і кулінарії - WriteOff.gs
      case 'woProducts':  data = apiWoProducts_(payload); break;
      case 'woSubmit':    data = apiWoSubmit_(payload); break;
      case 'woMine':      data = apiWoMine_(payload); break;
      case 'woDelete':    data = apiWoDelete_(payload); break;
      default: throw new Error('Невідома дія: ' + action);
    }
    return { ok: true, data: data };
  } catch (err) {
    console.error(action + ': ' + ((err && err.stack) || err));
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return ContentService.createTextOutput(JSON.stringify(api(body.action, body.payload)))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiBootstrap_() {
  const stores = loadStores_();
  const status = loadTodayStatus_();
  // Вимкнений напрямок (пульт -> "Выключить направление") не потрапляє
  // сюди взагалі - ні в dirs, ні в список напрямків жодної точки.
  const off = disabledDirections_();

  const dirs = {};
  Object.keys(DIRECTIONS).forEach(function (k) {
    if (off[k]) return;
    const c = DIRECTIONS[k];
    dirs[k] = {
      key: c.key, title: c.title, subtitle: c.subtitle,
      color: c.color, unit: c.unit, deadline: c.deadline, step: c.step,
      minOrder: Math.round(minOrderOf_(c) * c.markup * 100) / 100,
      hasCategories: c.hasCategories, closed: deadlinePassed_(k),
      dayOffTag: c.dayOffTag || 'Не ваш день'
    };
  });

  const list = stores.map(function (s) {
    const dirKeys = s.directions.filter(function (k) { return !off[k]; });
    const ordered = {}, dayOk = {}, dayOff = {};
    dirKeys.forEach(function (k) {
      const map = status[k];
      ordered[k] = map ? !!map[statusKey_(k, s)] : false;
      dayOk[k] = dayAllowed_(k, s);
      if (!dayOk[k]) dayOff[k] = dayOffText_(k, s);
    });
    return { id: s.id, label: s.label, code: s.code,
             // юрособа ЮА маркет (колонка T Довідника) - значок у списку точок
             ua: isUaStore_(s),
             directions: dirKeys, ordered: ordered,
             dayOk: dayOk, dayOff: dayOff,
             // списання випічки: за колонкою H Довідника, навіть якщо заказ вимкнено
             wo: s.directions.indexOf('bakery') >= 0 };
  });

  return {
    stores: list, directions: dirs, version: APP_VERSION,
    today: formatDateDMY_(new Date()), testMode: TEST_MODE,
    woDeadline: WO_DEADLINE
  };
}

// Легкий пінг для автооновлення телефонів
function apiRefresh_(payload) {
  payload = payload || {};
  const status = loadTodayStatus_();
  const off = disabledDirections_();
  const ordered = {};
  loadStores_().forEach(function (s) {
    const o = {};
    s.directions.forEach(function (k) {
      if (off[k]) return;
      const m = status[k];
      o[k] = m ? !!m[statusKey_(k, s)] : false;
    });
    ordered[s.id] = o;
  });

  const closed = {};
  Object.keys(DIRECTIONS).forEach(function (k) { if (!off[k]) closed[k] = deadlinePassed_(k); });

  // стан конкретної пари "точка + напрямок", щоб телефон сам вмикав
  // і ГАСИВ кнопку, коли 30 хвилин дозволу спливли
  var late = 'none', lateLeft = 0, locked = null;
  if (payload.dir && payload.storeId && DIRECTIONS[payload.dir] && !off[payload.dir]) {
    var cfg = DIRECTIONS[payload.dir];
    late = cfg.lateRequest ? lateRequestStatus_(payload.dir, payload.storeId) : 'none';
    lateLeft = (late === 'approved') ? lateLeftMin_(payload.dir, payload.storeId) : 0;
    try {
      var st = findStore_(payload.storeId);
      var map = status[payload.dir];                       // без зайвого читання таблиці
      var already = map ? !!map[statusKey_(payload.dir, st)] : false;
      locked = (deadlinePassed_(payload.dir, st.id) || already) && late !== 'approved';
    } catch (e) {}
  }

  return {
    version: APP_VERSION,
    today: formatDateDMY_(new Date()),
    ordered: ordered,
    closed: closed,
    late: late,
    lateLeft: lateLeft,
    locked: locked
  };
}