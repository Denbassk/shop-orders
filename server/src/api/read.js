// Читання для продавця: bootstrap, refresh, products. Перенос apiBootstrap_/apiRefresh_ (Code.gs)
// і apiProducts_ (Orders.gs). Відповіді - ті самі поля.
//
// env = { at: Date, data: DataSource, veg: { resolve(rows) } }
// DataSource (src/data.js; у тестах підмінний):
//   stores() -> [об'єкти у формі loadStores_] | settings() -> {dirs_off, late_all, app_version, test_mode, wo_deadline}
//   directions() -> {dir: cfg} | products(dir) -> рядки products (усі статуси)
//   orderedToday(day 'yyyy-MM-dd') -> {dir: Set(store_id)} | lateRows(dir, storeId) -> рядки late_requests
const R = require('../rules');
const { summarize } = require('../currentOrder');

const UA_EDRPOU = '45672783';
const isUaStore = (s) => String((s && s.edrpou) || '').replace(/\D/g, '') === UA_EDRPOU;
const money = (n) => Math.round(n * 100) / 100;
const cmp = (a, b) => String(a).localeCompare(String(b), 'uk');

async function load(env) {
  const d = env.data;
  const [stores, settings, directions, ordered] = await Promise.all([
    d.stores(), d.settings(), d.directions(), d.orderedToday(R.kyivNow(env.at).day),
  ]);
  const ctx = { at: env.at, settings, directions, lateRows: [] };
  return { stores, settings, directions, ordered, ctx };
}

const isOrdered = (ordered, dir, storeId) => !!(ordered[dir] && ordered[dir].has(storeId));

async function apiBootstrap(env) {
  const { stores, settings, directions, ctx, ordered } = await load(env);
  const off = R.disabledDirections(settings);

  const dirs = {};
  Object.keys(directions).forEach((k) => {
    if (off[k]) return;
    const c = directions[k];
    dirs[k] = {
      key: c.key, title: c.title, subtitle: c.subtitle,
      color: c.color, unit: c.unit, deadline: c.deadline, step: c.step,
      minOrder: money(R.minOrderOf(c, env.at) * c.markup),
      hasCategories: c.hasCategories, closed: R.deadlinePassed(k, undefined, ctx),
      dayOffTag: c.dayOffTag || 'Не ваш день',
    };
  });

  const list = stores.map((s) => {
    const dirKeys = s.directions.filter((k) => !off[k]);
    const ord = {}, dayOk = {}, dayOff = {};
    dirKeys.forEach((k) => {
      ord[k] = isOrdered(ordered, k, s.id);
      dayOk[k] = R.dayAllowed(k, s, ctx);
      if (!dayOk[k]) dayOff[k] = R.dayOffText(k, s, ctx);
    });
    return {
      id: s.id, label: s.label, code: s.code,
      ua: isUaStore(s),
      directions: dirKeys, ordered: ord, dayOk, dayOff,
      // списання випічки: за колонкою bakery Довідника, навіть якщо замовлення вимкнено
      wo: s.directions.indexOf('bakery') >= 0,
    };
  });

  return {
    stores: list, directions: dirs, version: settings.app_version,
    today: R.kyivNow(env.at).dmy, testMode: !!settings.test_mode,
    woDeadline: settings.wo_deadline,
  };
}

// Легкий пінг для автооновлення телефонів
async function apiRefresh(payload, env) {
  payload = payload || {};
  const { stores, settings, directions, ctx, ordered } = await load(env);
  const off = R.disabledDirections(settings);

  const ord = {};
  stores.forEach((s) => {
    const o = {};
    s.directions.forEach((k) => { if (!off[k]) o[k] = isOrdered(ordered, k, s.id); });
    ord[s.id] = o;
  });

  const closed = {};
  Object.keys(directions).forEach((k) => { if (!off[k]) closed[k] = R.deadlinePassed(k, undefined, ctx); });

  // стан конкретної пари "точка + напрямок", щоб телефон сам вмикав і гасив кнопку
  let late = 'none', lateLeft = 0, locked = null;
  if (payload.dir && payload.storeId && directions[payload.dir] && !off[payload.dir]) {
    const cfg = directions[payload.dir];
    const pairCtx = { ...ctx, lateRows: await env.data.lateRows(payload.dir, payload.storeId) };
    late = cfg.lateRequest ? R.lateStatus(payload.dir, payload.storeId, pairCtx) : 'none';
    lateLeft = late === 'approved' ? R.lateLeftMin(payload.dir, payload.storeId, pairCtx) : 0;
    const st = stores.find((x) => x.id === String(payload.storeId));
    if (st) {
      const already = isOrdered(ordered, payload.dir, st.id);
      locked = (R.deadlinePassed(payload.dir, st.id, pairCtx) || already) && late !== 'approved';
    }
  }

  return {
    version: settings.app_version,
    today: R.kyivNow(env.at).dmy,
    ordered: ord, closed, late, lateLeft, locked,
  };
}

// Порядок як у loadSheetProducts_: keepOrder - порядок рядків (sort), інакше категорія, потім назва (uk).
function sortProducts(cfg, rows) {
  const list = rows.slice();
  if (cfg.keepOrder) return list.sort((a, b) => a.sort - b.sort);
  return list.sort((a, b) => {
    if (a.category && b.category && a.category !== b.category) return cmp(a.category, b.category);
    return cmp(a.name, b.name);
  });
}

async function apiProducts(payload, env) {
  payload = payload || {};
  const dirKey = String(payload.dir || '');
  const { stores, settings, directions, ctx, ordered } = await load(env);
  const cfg = R.dirCfg(dirKey, ctx);

  const store = stores.find((s) => s.id === String(payload.storeId));
  if (!store) throw new Error('Торгову точку не знайдено. Оновіть сторінку.');

  // вимкнений напрямок не відкриється, навіть якщо на телефоні старий bootstrap
  if (!R.dirEnabled(dirKey, settings)) throw new Error('Напрямок "' + cfg.title + '" зараз вимкнено.');

  if (store.directions.indexOf(dirKey) < 0)
    throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  const pairCtx = { ...ctx, lateRows: await env.data.lateRows(dirKey, store.id) };
  if (!R.dayAllowed(dirKey, store, pairCtx)) throw new Error(R.dayOffText(dirKey, store, pairCtx));

  let rows = (await env.data.products(dirKey)).filter((p) => p.status === 'active');
  if (dirKey === 'veg') rows = await env.veg.resolve(rows);

  const products = sortProducts(cfg, rows).map((p) => ({
    id: p.id,
    name: p.name,
    price: money(Number(p.price) * cfg.markup),
    category: p.category || null,
    availability: p.availability || null,
    box: p.box || null,
  }));

  const lateSt = cfg.lateRequest ? R.lateStatus(dirKey, store.id, pairCtx) : null;
  const approved = lateSt === 'approved';
  const closed = R.deadlinePassed(dirKey, store.id, pairCtx);
  const already = isOrdered(ordered, dirKey, store.id);
  // прийом відкритий для всіх (до дедлайну або late_all): відправлене замовлення міняють самі, дозвіл не потрібен
  const open = R.windowOpen(dirKey, pairCtx);

  const cats = [];
  if (cfg.hasCategories) {
    products.forEach((p) => { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
  }

  return {
    dir: dirKey,
    unit: cfg.unit,
    hidePrice: !!cfg.hidePrice,
    step: cfg.step,
    deadline: cfg.deadline,
    // мінімалку знімає лише дозвіл на ПЕРШЕ замовлення за день; заміна відправленого - повне замовлення, мінімалка діє
    minOrder: (approved && !already) ? 0 : money(R.minOrderOf(cfg, env.at) * cfg.markup),
    categories: cats,
    products,
    closed,
    alreadyOrdered: already,
    // locked - кнопка "Відправити" вимкнена. Дозвіл закупниці знімає обидва замки: і дедлайн, і "сьогодні вже замовляли".
    // Якщо замовлення вже є, екран усе одно вмикає відправку лише після "Змінити замовлення" (заміна з підставленим замовленням).
    locked: (closed || already) && !approved,
    // Запит дозволу має сенс лише ПІСЛЯ дедлайну. До нього (windowOpen) продавець міняє замовлення сам.
    canRequestLate: !!cfg.lateRequest && !open && (closed || already),
    windowOpen: open,
    lateRequest: lateSt,
    lateLeftMin: approved ? R.lateLeftMin(dirKey, store.id, pairCtx) : 0,
  };
}

// Поточне замовлення точки за сьогодні для "Змінити замовлення": позиції, які можна підставити в кошик (є в активному
// асортименті), і ті, що вже зникли (items / gone). Нічого не змінює; рішення "можна міняти" приймає submitOrder.
async function apiCurrentOrder(payload, env) {
  payload = payload || {};
  const dirKey = String(payload.dir || '');
  const d = env.data;
  const [stores, settings, directions] = await Promise.all([d.stores(), d.settings(), d.directions()]);
  const cfg = R.dirCfg(dirKey, { directions });
  const store = stores.find((s) => s.id === String(payload.storeId));
  if (!store) throw new Error('Торгову точку не знайдено. Оновіть сторінку.');
  if (!R.dirEnabled(dirKey, settings)) throw new Error('Напрямок "' + cfg.title + '" зараз вимкнено.');
  if (store.directions.indexOf(dirKey) < 0) throw new Error('Для цієї ТТ напрямок "' + cfg.title + '" не передбачений');

  const cur = summarize(cfg, await d.activeOrderLines(dirKey, store.id, R.kyivNow(env.at).day));
  if (!cur) throw new Error('Замовлення на сьогодні не знайдено. Оновіть сторінку.');

  let rows = (await d.products(dirKey)).filter((p) => p.status === 'active');
  if (dirKey === 'veg') rows = await env.veg.resolve(rows);
  const live = new Set(rows.map((p) => String(p.id)));
  return {
    positions: cur.positions, total: cur.total, hidePrice: cur.hidePrice,
    items: cur.lines.filter((l) => live.has(l.product_id)).map((l) => ({ id: l.product_id, qty: l.qty })),
    gone: cur.lines.filter((l) => !live.has(l.product_id)).map((l) => ({ name: l.name, qty: l.qty })),
  };
}

module.exports = { apiBootstrap, apiRefresh, apiProducts, apiCurrentOrder };
