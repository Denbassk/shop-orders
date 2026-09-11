// ============================================================
// ТОЧКА ВХОДУ
// ============================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  rememberAppUrl_();                      // адреса розгортання оновлюється сама
  if (p.ok) return lateApprovePage_(p);   // кнопка "Дозволити" з листа закупниці
  if (p.load) return loadProbe_(p);       // навантажувальний тест, Maintenance.gs

  return HtmlService.createTemplateFromFile('ui/Index')
    .evaluate()
    .setTitle('Замовлення Фемелі Маркет')
    .setFaviconUrl(PWA_URL ? PWA_URL + 'icon-192.png' : '')
    // дозволяємо вбудовування: оболонка-застосунок тримає нас в iframe
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

function api(action, payload) {
  payload = payload || {};
  try {
    var data;
    switch (action) {
      case 'bootstrap':   data = apiBootstrap_(); break;
      case 'products':    data = apiProducts_(payload); break;
      case 'submitOrder': data = apiSubmitOrder_(payload); break;
      case 'requestLate': data = apiRequestLate_(payload); break;
      case 'refresh':     data = apiRefresh_(payload); break;
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

  const dirs = {};
  Object.keys(DIRECTIONS).forEach(function (k) {
    const c = DIRECTIONS[k];
    dirs[k] = {
      key: c.key, title: c.title, subtitle: c.subtitle,
      color: c.color, unit: c.unit, deadline: c.deadline, step: c.step,
      minOrder: Math.round(c.minOrder * c.markup * 100) / 100,
      hasCategories: c.hasCategories, closed: deadlinePassed_(k)
    };
  });

  const list = stores.map(function (s) {
    const ordered = {};
    s.directions.forEach(function (k) {
      const map = status[k];
      ordered[k] = map ? !!map[statusKey_(k, s)] : false;
    });
    return { id: s.id, label: s.label, code: s.code,
             directions: s.directions, ordered: ordered };
  });

  return {
    stores: list, directions: dirs, version: APP_VERSION,
    today: formatDateDMY_(new Date()), testMode: TEST_MODE
  };
}

// Легкий пінг для автооновлення телефонів
function apiRefresh_(payload) {
  payload = payload || {};
  const status = loadTodayStatus_();
  const ordered = {};
  loadStores_().forEach(function (s) {
    const o = {};
    s.directions.forEach(function (k) {
      const m = status[k];
      o[k] = m ? !!m[statusKey_(k, s)] : false;
    });
    ordered[s.id] = o;
  });

  const closed = {};
  Object.keys(DIRECTIONS).forEach(function (k) { closed[k] = deadlinePassed_(k); });

  // стан конкретної пари "точка + напрямок", щоб телефон сам вмикав
  // і ГАСИВ кнопку, коли 30 хвилин дозволу спливли
  var late = 'none', lateLeft = 0, locked = null;
  if (payload.dir && payload.storeId && DIRECTIONS[payload.dir]) {
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