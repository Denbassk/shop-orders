// ============================================================
// ДОВІДНИК ТТ + СТАТУС ЗАМОВЛЕНЬ
// A Активна | B Назва | C Адреса | D Обл.номер | E Маршрут (Рома)
// F Тип | G Хліб | H Випічка | I Овочі | J Примітка
// K Адреса Хліб | L Адреса Випічка | M Адреса Овочі
// N Хліб НБХЗ | O Маршрут НБХЗ | P Адреса НБХЗ
// ============================================================

function loadStores_() {
  const cached = cacheGet_('registry_v3');
  if (cached) return cached;

  const sh = SpreadsheetApp.openById(REGISTRY_ID).getSheetByName(REGISTRY_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];

  const stores = sh.getRange(2, 1, sh.getLastRow() - 1, 16).getValues()
    .filter(function (r) { return r[0] === true && String(r[2]).trim(); })
    .map(function (r) {
      const addr = String(r[2]).trim();
      return {
        id: canonKey_(addr),
        label: String(r[1] || '').trim() || addr,
        address: addr,
        code: String(r[3] || '').trim(),
        route: String(r[4] || '').trim(),
        type: String(r[5] || 'Магазин').trim(),
        addrBread: String(r[10] || '').trim() || addr,
        addrBakery: String(r[11] || '').trim() || addr,
        addrVeg: String(r[12] || '').trim() || addr,
        addrNbhz: String(r[15] || '').trim() || addr,
        routeNbhz: String(r[14] || '').trim(),
        directions: [r[6] === true && 'bread', r[13] === true && 'nbhz',
                     r[7] === true && 'bakery', r[8] === true && 'veg'].filter(Boolean)
      };
    })
    .filter(function (s) { return s.directions.length; })
    .sort(function (a, b) { return a.label.localeCompare(b.label, 'uk'); });

  cachePut_('registry_v3', stores, 600);
  return stores;
}

function findStore_(storeId) {
  const all = loadStores_();
  for (var i = 0; i < all.length; i++) if (all[i].id === String(storeId)) return all[i];
  throw new Error('Торгову точку не знайдено. Оновіть сторінку.');
}

function loadTodayStatus_() {
  const cached = cacheGet_('status_v3');
  if (cached) return cached;

  const today = formatDateDMY_(new Date());
  const status = {};

  Object.keys(DIRECTIONS).forEach(function (k) {
    const cfg = DIRECTIONS[k];
    status[k] = {};
    try {
      const sh = SpreadsheetApp.openById(cfg.spreadsheetId).getSheetByName(rawSheetName_(cfg));
      if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
        const d = (r[0] instanceof Date) ? formatDateDMY_(r[0]) : String(r[0]).trim();
        if (d === today) {
          const a = String(r[2]).trim();
          if (a) status[k][addrKey_(a)] = true;
        }
      });
    } catch (e) {
      console.error('Статус ' + k + ': ' + e.message);
      status[k] = null;
    }
  });

  cachePut_('status_v3', status, 60);
  return status;
}

function formatDateDMY_(d) {
  return String(d.getDate()).padStart(2, '0') + '.' +
         String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
}

function formatTime_(d) {
  return String(d.getHours()).padStart(2, '0') + ':' +
         String(d.getMinutes()).padStart(2, '0') + ':' +
         String(d.getSeconds()).padStart(2, '0');
}

function canonKey_(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u2019\u0027\u0060]/g, '')
    .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cacheGet_(k) {
  try { const v = CacheService.getScriptCache().get(k); return v ? JSON.parse(v) : null; }
  catch (e) { return null; }
}

function cachePut_(k, data, sec) {
  try {
    const s = JSON.stringify(data);
    if (s.length < 95000) CacheService.getScriptCache().put(k, s, sec || 600);
  } catch (e) {}
}

function invalidateAppCache() {
  CacheService.getScriptCache().removeAll(['registry_v2', 'registry_v3', 'status_v2', 'status_v3',
    'prod_bread', 'prod_nbhz', 'prod_bakery', 'prod_veg']);
  console.log('Кеш очищено');
}