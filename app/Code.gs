// ============================================================
// ТОЧКА ВХОДУ
// ============================================================

function doGet(e) {
  return HtmlService.createTemplateFromFile('ui/Index')
    .evaluate()
    .setTitle('Замовлення Фемелі Маркет')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

// Єдина точка входу для клієнта.
// Формат відповіді: { ok: true, data } або { ok: false, error }
function api(action, payload) {
  payload = payload || {};
  try {
    var data;
    switch (action) {
      case 'bootstrap':   data = apiBootstrap_(); break;
      case 'products':    data = apiProducts_(payload); break;
      case 'submitOrder': data = apiSubmitOrder_(payload); break;
      default: throw new Error('Невідома дія: ' + action);
    }
    return { ok: true, data: data };
  } catch (err) {
    console.error(action + ': ' + ((err && err.stack) || err));
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Той самий роутер по HTTP - для майбутнього переїзду на Cloudflare
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
      hasCategories: c.hasCategories
    };
  });

  const list = stores.map(function (s) {
    const ordered = {};
    s.directions.forEach(function (k) {
      const map = status[k];
      ordered[k] = map ? !!map[statusKey_(k, s)] : false;
    });
    // route і code навмисно НЕ віддаємо на телефон - вони потрібні лише
    // постачальнику у вивантаженні закупниці
    return { id: s.id, label: s.label, directions: s.directions, ordered: ordered };
  });

  return {
    stores: list, directions: dirs,
    today: formatDateDMY_(new Date()), testMode: TEST_MODE
  };
}
