// Пульт: читання (екрани «Сегодня», «График», пошук точок). Перенос admToday_, admDays_, admSchedule_, admStores_ (app/Admin.gs).
// env = { at, data, reportAt? (dir) -> 'HH:mm' | '' }. «Замовила» - за orders у базі (store_id), як read.js продавця.
const R = require('../rules');
const { DIRECTIONS } = require('../directions');

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
  const isOrd = (k, s) => !!(ordered[k] && ordered[k].has(s.id));
  return { stores, settings, ctx, keys, isOrd };
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

module.exports = { admToday, admDays, admSchedule, admStores, isUaStore, DAY_RU_FULL };