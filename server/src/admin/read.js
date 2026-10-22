// Пульт: читання (екрани «Сегодня», «График», пошук точок). Перенос admToday_, admDays_, admSchedule_, admStores_ (app/Admin.gs).
// env = { at, data, reportAt? (dir) -> 'HH:mm' | '' }. «Замовила» - за orders у базі (store_id), як read.js продавця.
const R = require('../rules');
const { DIRECTIONS, REGISTRY_ID } = require('../directions');
const { rowToStore } = require('../db');

const UA_EDRPOU = '45672783';
const isUaStore = (s) => String((s && s.edrpou) || '').replace(/\D/g, '') === UA_EDRPOU;
const DAY_RU_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_RU_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const pad = (n) => ('0' + n).slice(-2);
const byLabel = (a, b) => a.label.localeCompare(b.label, 'uk');

async function load(env) {
  const d = env.data;
  const [stores, settings, directions, ordered] = await Promise.all([
    d.stores(), d.settings(), d.directions(), d.orderedToday(R.kyivNow(env.at).day)]);
  const ctx = { at: env.at, settings, directions, lateRows: [] };
  const keys = Object.keys(DIRECTIONS).filter((k) => directions[k]);
  // до переключення замовлення пише Apps Script (у базі їх нема): «замовила» = база АБО сирий лист Google (env.gOrders, лише читання)
  const g = env.gOrders ? await Promise.resolve(env.gOrders(R.kyivNow(env.at).day, stores)).catch(() => ({})) : {};
  const isOrd = (k, s) => !!((ordered[k] && ordered[k].has(s.id)) || (g[k] && g[k].has && g[k].has(s.id)));
  return { stores, settings, ctx, keys, isOrd, g };
}

// графік точки по напрямку: дні, чи сьогодні, коли наступний
function admDays(dirKey, store, ctx) {
  const cfg = R.dirCfg(dirKey, ctx);
  if (!cfg.orderDays) return { free: true, label: 'каждый день', today: true, next: '' };
  const days = R.storeDays(dirKey, store);
  if (!days.length) return { free: true, label: 'без ограничений', today: true, next: '' };
  const dow = R.todayDow(ctx.at);
  let next = '';
  for (let i = 1; i <= 7; i++) {
    const d = (dow + i) % 7;
    if (days.indexOf(d) < 0) continue;
    next = (i === 1) ? 'завтра' : ('в ' + DAY_RU_FULL[d]);
    break;
  }
  return { free: false, label: days.map((d) => DAY_RU_SHORT[d]).join(', '), today: days.indexOf(dow) >= 0, next };
}

function deadlineLeftMin(deadline, n) {
  const p = String(deadline).split(':');
  return (+p[0] * 60 + +p[1]) - (n.hh * 60 + n.mm);
}

// екран "Сегодня"
async function admToday(env) {
  const { stores, settings, ctx, keys, isOrd } = await load(env);
  const n = R.kyivNow(env.at);
  const dirs = [];
  for (const k of keys) {
    const cfg = R.dirCfg(k, ctx);
    let total = 0, ordered = 0, offDay = 0, all = 0;
    const waiting = [];
    stores.forEach((s) => {
      if (s.directions.indexOf(k) < 0) return;
      all++;
      if (!R.dayAllowed(k, s, ctx)) { offDay++; return; }      // сьогодні не їхній день
      total++;
      if (isOrd(k, s)) ordered++; else waiting.push(s.label);
    });
    dirs.push({
      key: k, title: cfg.title, color: cfg.color, deadline: cfg.deadline || '',
      closed: R.deadlinePassed(k, undefined, ctx), openedAll: R.lateAllowed(k, ctx), enabled: R.dirEnabled(k, settings),
      total, ordered, waiting: waiting.slice(0, 40),
      all, offDay, byDays: !!cfg.orderDays,
      noDayToday: !!cfg.orderDays && total === 0 && all > 0,
      reportAt: env.reportAt ? await env.reportAt(k) : '',
      minLeft: cfg.deadline ? deadlineLeftMin(cfg.deadline, n) : null,
    });
  }
  return { today: n.dmy, time: pad(n.hh) + ':' + pad(n.mm), dow: DAY_RU_FULL[n.dow], dirs };
}

// графік по всіх точках: кому що і коли доступно
async function admSchedule(payload, env) {
  payload = payload || {};
  const only = String(payload.dir || '');
  const { stores, ctx, keys: all, isOrd } = await load(env);
  const keys = only ? [only] : all;
  const n = R.kyivNow(env.at);
  const rows = stores.map((s) => {
    const cells = [];
    keys.forEach((k) => {
      if (s.directions.indexOf(k) < 0) return;
      const d = admDays(k, s, ctx);
      const cfg = R.dirCfg(k, ctx);
      cells.push({ dir: k, title: cfg.title, deadline: cfg.deadline || '', days: d.label, today: d.today, next: d.next, ordered: isOrd(k, s) });
    });
    return { id: s.id, label: s.label, ua: isUaStore(s), code: s.code, route: s.route, cells };
  }).filter((r) => r.cells.length);
  rows.sort(byLabel);
  return {
    dir: only, dow: DAY_RU_FULL[n.dow], today: n.dmy,
    dirs: keys.map((k) => { const c = R.dirCfg(k, ctx); return { key: k, title: c.title, deadline: c.deadline || '', byDays: !!c.orderDays }; }),
    rows,
  };
}

// пошук точок
async function admStores(payload, env) {
  payload = payload || {};
  const q = String(payload.q || '').trim().toLowerCase();
  const dir = String(payload.dir || '');
  const { stores, isOrd } = await load(env);
  return stores.filter((s) => {
    if (dir && s.directions.indexOf(dir) < 0) return false;
    if (!q) return true;
    return (s.label + ' ' + s.address + ' ' + s.code).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 60).map((s) => ({
    id: s.id, label: s.label, ua: isUaStore(s), code: s.code, route: s.route,
    zone: s.zone, directions: s.directions,
    ordered: dir ? isOrd(dir, s) : false,
  }));
}

// Вкладка «Магазини», вигляд «Таблиця»: УСІ точки з бази колонками як у Довіднику ТТ (лише перегляд: до переключення правка - у Довіднику Google).
async function admStoresTable(env) {
  const rows = (await env.adm.allStores()).map((r) => ({
    id: r.store_id, active: r.active !== false, label: r.label, address: r.address, code: r.code || '', route: r.route || '', type: r.type || '',
    zone: r.zone || '', edrpou: r.edrpou || '', ua: isUaStore(r),
    directions: ['bread', 'nbhz', 'bakery', 'veg'].filter((k) => r[k]),
    addrBread: r.addr_bread || '', addrBakery: r.addr_bakery || '', addrVeg: r.addr_veg || '', addrNbhz: r.addr_nbhz || '', routeNbhz: r.route_nbhz || '',
    daysVeg: r.days_veg || '', daysBakery: r.days_bakery || '', note: r.note || '',
  }));
  rows.sort(byLabel);
  return { rows, total: rows.length, registryUrl: 'https://docs.google.com/spreadsheets/d/' + REGISTRY_ID + '/edit' };
}

// Картка магазину (вкладка «Магазини»): реквізити, компанія за ЄДРПОУ, по кожному напрямку - графік (дні тижня), що сьогодні
// (замовлення з бази або з листа Google), чи закрито, скільки лишилось на дозвіл. Лише читання.
const COMPANY = (s) => (isUaStore(s) ? 'ЮА маркет' : 'Фемелі');
async function admStoreCard(payload, env) {
  payload = payload || {};
  const { stores, settings, ctx, keys, isOrd, g } = await load(env);
  let store = stores.find((x) => x.id === String(payload.storeId)), active = true, note = '';
  if (!store) {
    const row = (await env.adm.allStores()).find((r) => r.store_id === String(payload.storeId));
    if (!row) throw new Error(STORE_NOT_FOUND);
    store = rowToStore(row); active = row.active !== false;
  }
  const full = (await env.adm.allStores()).find((r) => r.store_id === store.id) || {};
  const n = R.kyivNow(env.at);
  const dirs = [];
  for (const k of keys) {
    const cfg = R.dirCfg(k, ctx);
    const available = store.directions.indexOf(k) >= 0;
    const d = admDays(k, store, ctx);
    const hasTime = (k === 'bakery' || k === 'veg');
    let order = null, lateRows = [];
    if (available) {
      lateRows = await env.data.lateRows(k, store.id);
      const mine = (await env.adm.dayOrders(k, n.day)).filter((o) => o.store_id === store.id && o.lines.length);
      if (mine.length) {
        const rows = [];
        let qty = 0, time = '';
        mine.forEach((o) => { o.lines.forEach((l) => { rows.push({ row: l.id, name: String(l.name == null ? '' : l.name), qty: Number(l.qty) || 0 }); qty += Number(l.qty) || 0; }); if (hasTime) time = hmOf(o.created_at); });
        order = { src: 'db', n: rows.length, qty: round3(qty), time, canEdit: true, rows };
      } else if (g && g[k] && g[k].get && g[k].get(store.id)) {
        const v = g[k].get(store.id);
        order = { src: 'google', n: v.n, qty: round3(v.qty), time: hasTime ? v.time : '', canEdit: false, rows: [] };
      }
    }
    const pairCtx = { ...ctx, lateRows };
    dirs.push({
      dir: k, title: cfg.title, color: cfg.color, deadline: cfg.deadline || '', unit: cfg.unit || '', byDays: !!cfg.orderDays,
      available, enabled: R.dirEnabled(k, settings), days: cfg.orderDays ? R.storeDays(k, store) : [], daysLabel: d.label, next: d.next,
      dayOk: R.dayAllowed(k, store, pairCtx), closed: R.deadlinePassed(k, store.id, pairCtx), lateLeft: R.lateLeftMin(k, store.id, pairCtx), order,
    });
  }
  return {
    today: n.dmy,
    store: { id: store.id, active, label: store.label, address: store.address, code: store.code || '', route: store.route || '', zone: store.zone || '',
      type: store.type || '', edrpou: store.edrpou || '', ua: isUaStore(store), company: COMPANY(store), directions: store.directions,
      addrBread: store.addrBread || '', addrBakery: store.addrBakery || '', addrVeg: store.addrVeg || '', addrNbhz: store.addrNbhz || '', routeNbhz: store.routeNbhz || '',
      note: store.note || full.note || '' },
    dirs, registryUrl: 'https://docs.google.com/spreadsheets/d/' + REGISTRY_ID + '/edit',
  };
}

// --- крок 3б: admDirStores_, admStore_, admLogRead_. Замість сирого листа - замовлення дня з бази (env.adm.dayOrders).
const hmOf = (iso) => { const k = R.kyivNow(new Date(iso)); return pad(k.hh) + ':' + pad(k.mm); };
const round3 = (x) => Math.round(x * 1000) / 1000;
const STORE_NOT_FOUND = 'Торгову точку не знайдено. Оновіть сторінку.';   // findStore_ (Registry.gs)
async function safeLink(fn, dir) { if (!fn) return ''; try { return (await fn(dir)) || ''; } catch (e) { return ''; } }

// хто саме замовив по напрямку, а хто ні
async function admDirStores(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const { stores, ctx, g } = await load(env);
  const cfg = R.dirCfg(dir, ctx);
  const n = R.kyivNow(env.at);
  const hasTime = (dir === 'bakery' || dir === 'veg');
  const agg = {};
  (await env.adm.dayOrders(dir, n.day)).forEach((o) => {
    if (!o.lines.length) return;
    const a = agg[o.store_id] || (agg[o.store_id] = { n: 0, qty: 0, time: '' });
    o.lines.forEach((l) => { a.n++; a.qty += Number(l.qty) || 0; });
    if (hasTime) a.time = hmOf(o.created_at);                // замовлення за created_at - лишається останнє
  });
  // точки, що замовили через Apps Script (сирий лист Google): рядки, кількість і час - з листа; база має пріоритет
  const fromSheet = (g && g[dir] && g[dir].forEach) ? g[dir] : new Map();
  fromSheet.forEach((v, id) => { if (!agg[id]) agg[id] = { n: v.n, qty: v.qty, time: hasTime ? v.time : '' }; });
  const done = [], wait = [], off = [];
  stores.forEach((s) => {
    if (s.directions.indexOf(dir) < 0) return;
    const d = admDays(dir, s, ctx);
    const a = agg[s.id];
    const row = { id: s.id, label: s.label, ua: isUaStore(s), code: s.code, route: s.route,
      n: a ? a.n : 0, qty: a ? round3(a.qty) : 0, time: a ? a.time : '',
      days: d.label, next: d.next, dayOk: d.today };
    // не їхній день: показуємо окремо, а не ховаємо
    if (!d.today) { off.push(row); return; }
    if (a) done.push(row); else wait.push(row);
  });
  done.sort((a, b) => (b.time || '').localeCompare(a.time || '') || byLabel(a, b));
  wait.sort(byLabel);
  off.sort(byLabel);
  const links = env.links || {};
  return { dir, title: cfg.title, unit: cfg.unit, done, wait, off,
    byDays: !!cfg.orderDays, dow: DAY_RU_FULL[n.dow],
    xlsx: await safeLink(links.xlsx, dir), sheetUrl: await safeLink(links.sheetUrl, dir) };
}

// картка точки. row - id рядка замовлення в базі (для editOrder), sheet/firstRow - без сирого листа
async function admStore(payload, env) {
  payload = payload || {};
  const { stores, ctx, isOrd } = await load(env);
  const store = stores.find((s) => s.id === String(payload.storeId));
  if (!store) throw new Error(STORE_NOT_FOUND);
  const dir = String(payload.dir || store.directions[0]);
  const cfg = R.dirCfg(dir, ctx);
  const n = R.kyivNow(env.at);
  const [orders, lateRows] = await Promise.all([env.adm.dayOrders(dir, n.day), env.data.lateRows(dir, store.id)]);
  const rows = [];
  orders.filter((o) => o.store_id === store.id).forEach((o) => o.lines.forEach((l) => {
    rows.push({ row: l.id, name: String(l.name == null ? '' : l.name), qty: Number(l.qty) || 0 });
  }));
  let qty = 0;
  rows.forEach((x) => { qty += x.qty; });
  const pairCtx = { ...ctx, lateRows };
  return {
    id: store.id, label: store.label, ua: isUaStore(store), code: store.code,
    route: store.route, zone: store.zone, directions: store.directions,
    dir, dirTitle: cfg.title, unit: cfg.unit, today: n.dmy,
    sheet: '', firstRow: rows.length ? rows[0].row : 0,
    rows, qty: round3(qty),
    marked: isOrd(dir, store),
    dayOk: R.dayAllowed(dir, store, pairCtx),
    schedule: store.directions.map((k) => {
      const d = admDays(k, store, ctx);
      const c = R.dirCfg(k, ctx);
      return { dir: k, title: c.title, deadline: c.deadline || '', days: d.label, today: d.today, next: d.next };
    }),
    closed: R.deadlinePassed(dir, store.id, pairCtx),
    lateLeft: R.lateLeftMin(dir, store.id, pairCtx),
  };
}

// журнал у пульті: 30 останніх, нові першими
async function admLogRead(env) {
  const rows = await env.adm.logRows(30);
  return rows.map((x) => {
    const k = R.kyivNow(new Date(x.at));
    return { when: k.dmy + ' ' + pad(k.hh) + ':' + pad(k.mm), what: String(x.action || ''), details: String(x.details || '') };
  });
}

// --- крок 3в. Час збирання звіту (settings report_at_<dir>, ISO) -> 'HH:mm', якщо сьогодні за Києвом (reportAt_)
function reportAtOf(iso, at) {
  if (!iso) return '';
  const t = new Date(iso);
  if (isNaN(t.getTime())) return '';
  const k = R.kyivNow(t);
  return k.day === R.kyivNow(at).day ? pad(k.hh) + ':' + pad(k.mm) : '';
}

const REPORT_DIRS = ['bread', 'bakery', 'veg', 'nbhz'];
// Зібрати звіт напрямку просто зараз (admReport_). env.rebuild(dir, { force }) - reports/rebuild.js
async function admReport(payload, env) {
  payload = payload || {};
  const dir = String(payload.dir || '');
  const cfg = R.dirCfg(dir, { directions: await env.data.directions() });
  if (REPORT_DIRS.indexOf(dir) < 0) throw new Error('Невідомий напрямок');
  await env.rebuild(dir, { force: true });
  const iso = new Date(env.at).toISOString();
  try { await env.adm.setReportAt(dir, iso); } catch (e) { console.error('час звіту: ' + e.message); }        // markReport_
  try { await env.adm.adminLog('Зібрано звіт', cfg.title); } catch (e) { console.error('журнал: ' + e.message); }  // adminLog_
  return { at: reportAtOf(iso, env.at), xlsx: await safeLink((env.links || {}).xlsx, dir) };
}

module.exports = { admToday, admDays, admSchedule, admStores, admStoresTable, admStoreCard, admDirStores, admStore, admLogRead, admReport, reportAtOf, isUaStore, DAY_RU_FULL };