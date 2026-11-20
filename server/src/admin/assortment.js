// Пульт: «Асортимент» напрямку - список позицій, перегляд «було -> стало» і масова зміна цін (на % або на суму).
// Одну позицію закупниця міняє на своїй сторінці (buyer/api.js setProduct); тут - багато за раз, з переглядом перед записом.
// Ціни овочей приходять із прайсу постачальника і перезаписуються при кожному читанні (vegPrices.js) - там лише перегляд.
const P = require('../prices');
const { cfgOf, logSafe } = require('./write');

const NOT_FOUND = 'Товар не знайдено. Оновіть сторінку.';
const MAX_ROWS = 500;
const LOCKED = 'Ціни цього напрямку беруться з прайсу постачальника автоматично - змінювати їх тут не можна';
const LOG_ITEMS = 8;
const LOG_MAX = 900;

// порядок як у списку закупниці: sort, потім назва (uk) - і в списку, і в перегляді
const bySort = (a, b) => ((Number(a.sort) || 0) - (Number(b.sort) || 0)) || String(a.name).localeCompare(String(b.name), 'uk');

function unlocked(dir) {
  const cfg = cfgOf(dir);
  if (cfg.priceSpreadsheetId) throw new Error(LOCKED);
  return cfg;
}

async function admAssortment(payload, env) {
  const dir = String((payload || {}).dir || '');
  const cfg = cfgOf(dir);
  const markup = cfg.markup || 1;
  const products = (await env.adm.dirProducts(dir)).slice().sort(bySort)
    .map((x) => {
      const price = Number(x.price) || 0;
      return { id: x.id, name: x.name, barcode: x.barcode || '', price, sellerPrice: P.round2(price * markup), stop: x.status === 'stop', category: x.category || '',
        access: accessOf(x) };
    });
  // точки напрямку - для вибору «доступ по точках»
  const stores = (await dirStores(dir, env)).map((st) => ({ id: st.id, label: st.label }));
  const locked = !!cfg.priceSpreadsheetId;
  const incoming = await require('./incoming').incomingInfo(dir, env);        // null - напрямок без цін з приходів (зараз є лише хліб Рома)
  return { dir, title: cfg.title, unit: cfg.unit || '', markup, hidePrice: !!cfg.hidePrice, priceLocked: locked, lockedReason: locked ? LOCKED : '', products, stores, incoming };
}

// ---------- доступ до позиції по точках (products.access_mode / access_stores; фільтр - rules.productAllowed) ----------
const ACCESS_MODES = ['all', 'only', 'except'];
const ACCESS_TEXT = { all: 'усім точкам', only: 'лише точкам', except: 'усім, крім' };
const accessOf = (x) => ({ mode: ACCESS_MODES.includes(x.access_mode) ? x.access_mode : 'all', stores: Array.isArray(x.access_stores) ? x.access_stores.map(String) : [] });
async function dirStores(dir, env) {
  if (!env.data || !env.data.stores) return [];
  return (await env.data.stores()).filter((st) => (st.directions || []).indexOf(dir) >= 0);
}

// Задати доступ відміченим позиціям. payload: { dir, ids, mode: 'all'|'only'|'except', stores: [store_id] }.
// 'all' - список точок очищується. 'only'/'except' - потрібна хоч одна точка; точки - лише активні точки цього напрямку.
// Позиції, у яких уже рівно такий доступ, пропускаються. Збій посеред запису: у журналі лише записане.
async function admAssortAccess(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const mode = String(payload.mode || '');
  if (!ACCESS_MODES.includes(mode)) throw new Error('Невірний режим доступу');
  const raw = Array.isArray(payload.stores) ? payload.stores.map(String) : [];
  if (new Set(raw).size !== raw.length) throw new Error('Точка вказана двічі');
  const byId = new Map((await dirStores(dir, env)).map((st) => [st.id, st]));
  raw.forEach((id) => { if (!byId.has(id)) throw new Error('Точку не знайдено або в неї немає цього напрямку. Оновіть сторінку.'); });
  const storeIds = mode === 'all' ? [] : raw.slice().sort();
  if (mode !== 'all' && !storeIds.length) throw new Error('Відмітьте хоча б одну точку');

  const list = pickByIds(await env.adm.dirProducts(dir), payload).sort(bySort);
  const same = (x) => { const a = accessOf(x); return a.mode === mode && a.stores.slice().sort().join('|') === storeIds.join('|'); };
  const todo = list.filter((x) => !same(x));
  if (!todo.length) throw new Error('Змін немає');
  const done = [];
  let failed = null;
  try {
    for (const x of todo) {
      if (!await env.adm.setProduct(dir, x.id, { access_mode: mode, access_stores: storeIds })) { failed = x; throw new Error(NOT_FOUND); }
      done.push(x);
    }
  } finally {
    if (done.length) {
      const who = mode === 'all' ? '' : ' ' + storeIds.length + ' ТТ (' + storeIds.slice(0, 6).map((id) => byId.get(id).label).join(', ') +
        (storeIds.length > 6 ? ', …ще ' + (storeIds.length - 6) : '') + ')';
      const head = cfg.title + ': доступ - ' + ACCESS_TEXT[mode] + who + ' - ' + done.length + ' поз.' +
        (failed ? ' (збій на «' + failed.name + '», решту не записано)' : '');
      const names = done.slice(0, LOG_ITEMS).map((x) => x.name).join('; ') + (done.length > LOG_ITEMS ? '; …ще ' + (done.length - LOG_ITEMS) : '');
      await logSafe(env, 'Змінено асортимент', (head + ': ' + names).slice(0, LOG_MAX));
    }
  }
  return { changed: done.length, skipped: list.length - todo.length, names: done.map((x) => x.name) };
}

// позиції за payload.ids (відмічені в списку): непорожньо, без дублів, не більше MAX_ROWS, усі існують
function pickByIds(all, payload) {
  const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
  if (!ids.length) throw new Error('Оберіть позиції');
  if (ids.length > MAX_ROWS) throw new Error('Позицій не більше ' + MAX_ROWS + ' за раз');
  if (new Set(ids).size !== ids.length) throw new Error('Позиція вказана двічі');
  const byId = new Map(all.map((x) => [String(x.id), x]));
  return ids.map((id) => { const x = byId.get(id); if (!x) throw new Error(NOT_FOUND); return x; });
}

const sum2 = (rows, f) => P.round2(rows.reduce((s, r) => s + r[f], 0));

// Перегляд: нічого не пише. payload: { dir, ids: [..] | all: true, mode: 'pct'|'sum', value }
async function admPricePreview(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  unlocked(dir);
  const all = await env.adm.dirProducts(dir);
  let list;
  if (payload.all === true) {
    list = all;
  } else {
    list = pickByIds(all, payload);
  }
  if (list.length > MAX_ROWS) throw new Error('Позицій не більше ' + MAX_ROWS + ' за раз - оберіть частину');
  list = list.slice().sort(bySort);
  const plan = P.planPriceChange(list.map((x) => ({ id: x.id, name: x.name, price: x.price })), payload.mode, payload.value);
  return { dir, mode: payload.mode, value: payload.value, rows: plan.rows, skipped: plan.skipped, n: plan.rows.length,
    sumOld: sum2(plan.rows, 'old'), sumNew: sum2(plan.rows, 'new') };
}

// Запис. payload: { dir, mode, value, rows: [{ id, old }] } - old = ціна, яку бачили в перегляді; нову сервер рахує сам.
// Якщо хоч одна ціна вже інша - помилка ДО запису. Збій посеред запису: у журналі лише те, що змінилось.
async function admPriceApply(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const cfg = unlocked(dir);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) throw new Error('Оберіть позиції');
  if (rows.length > MAX_ROWS) throw new Error('Позицій не більше ' + MAX_ROWS + ' за раз');
  const ids = rows.map((r) => String((r || {}).id));
  if (new Set(ids).size !== ids.length) throw new Error('Позиція вказана двічі');
  const byId = new Map((await env.adm.dirProducts(dir)).map((x) => [String(x.id), x]));
  const items = rows.map((r) => {
    const cur = byId.get(String(r.id));
    if (!cur) throw new Error(NOT_FOUND);
    const old = P.parseMoney(r.old);
    if (isNaN(old)) throw new Error('Невірна ціна: ' + cur.name);
    if (old !== P.round2(Number(cur.price))) throw new Error('Ціна «' + cur.name + '» змінилась з моменту перегляду. Оновіть екран.');
    return { id: cur.id, name: cur.name, price: old };
  });
  const plan = P.planPriceChange(items, payload.mode, payload.value);
  if (!plan.rows.length) throw new Error('Змін немає');

  const done = [];
  let failed = null;
  try {
    for (const r of plan.rows) {
      if (!await env.adm.setProduct(dir, r.id, { price: r.new })) { failed = r; throw new Error(NOT_FOUND); }
      done.push(r);
    }
  } finally {
    if (done.length) {
      const head = cfg.title + ': ' + done.length + ' поз., ' + P.fmtChange(payload.mode, payload.value) +
        (failed ? ' (збій на «' + failed.name + '», решту не записано)' : '');
      const items8 = done.slice(0, LOG_ITEMS).map((r) => r.name + ' ' + r.old + ' → ' + r.new).join('; ');
      const more = done.length > LOG_ITEMS ? '; …ще ' + (done.length - LOG_ITEMS) : '';
      await logSafe(env, 'Змінено ціни', (head + '; ' + items8 + more).slice(0, LOG_MAX));
    }
  }
  return { changed: done.length, rows: done };
}

// Стоп / зняття стопу пачкою (у закупниці - по одній позиції, buyer/api.js setProduct { stop }). payload: { dir, ids, stop: true|false }.
// Ціни овочей з прайсу заблоковані, а стоп - ні (як у закупниці): статус vegPrices не перезаписує. Позиції, що вже в потрібному стані, пропускаються.
async function admAssortStop(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  if (typeof payload.stop !== 'boolean') throw new Error('Невірна дія');
  const target = payload.stop ? 'stop' : 'active';
  const list = pickByIds(await env.adm.dirProducts(dir), payload).sort(bySort);
  const todo = list.filter((x) => x.status !== target);
  if (!todo.length) throw new Error('Змін немає');
  const done = [];
  let failed = null;
  try {
    for (const x of todo) {
      if (!await env.adm.setProduct(dir, x.id, { status: target })) { failed = x; throw new Error(NOT_FOUND); }
      done.push(x);
    }
  } finally {
    if (done.length) {
      const head = cfg.title + ': ' + (payload.stop ? 'стоп' : 'знято стоп') + ' - ' + done.length + ' поз.' +
        (failed ? ' (збій на «' + failed.name + '», решту не записано)' : '');
      const names = done.slice(0, LOG_ITEMS).map((x) => x.name).join('; ') + (done.length > LOG_ITEMS ? '; …ще ' + (done.length - LOG_ITEMS) : '');
      await logSafe(env, 'Змінено асортимент', (head + ': ' + names).slice(0, LOG_MAX));
    }
  }
  return { changed: done.length, skipped: list.length - todo.length, names: done.map((x) => x.name) };
}

module.exports = { admAssortment, admPricePreview, admPriceApply, admAssortStop, admAssortAccess, MAX_ROWS };
