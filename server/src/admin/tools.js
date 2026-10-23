// Інструменти пульта (app/AdminTools.gs): «Здоров'я» (admHealth_, admHealthClear_, healthNoteError_) і картка точки (admCard_).
// Тригерів, буфера, замків і ScriptProperties на сервері немає - ці частини не переносяться.
// cardSave - Task 11 (Довідник ТТ лишається головним для бою).
const { DIRECTIONS } = require('../directions');
const R = require('../rules');

const STARTED = new Date();          // змінюється при кожному деплої/перезапуску - так видно, що пульт новий
const serverStart = () => { const k = R.kyivNow(STARTED); return k.dmy + ' ' + k.time.slice(0, 5); };
const { STORE_NOT_FOUND } = require('./write');

const HEALTH_STALE_MIN = 20;                  // з app/*.gs
const HEALTH_ERR_KEY = 'health_err';                 // settings: [{ at: 'дд.мм HH:mm', where, msg }], нові першими, до 20
const BREAD_EDRPOU = '44413718';
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' });
const hmOf = (d) => hmFmt.format(d);
const dmOf = (d) => dmFmt.format(d).replace('/', '.');
const minOf = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };

async function admHealth(env) {
  const at = env.at, day = R.kyivNow(at).day, now = minOf(hmOf(at)), todayDM = dmOf(at);
  const settings = (await env.data.settings()) || {};
  let status = null, ats = {};
  try { status = await env.data.orderedToday(day); } catch (e) { status = null; }
  try { ats = (await env.adm.reportAts()) || {}; } catch (e) { ats = {}; }
  const rank = { ok: 0, off: 0, warn: 1, bad: 2 };
  let worst = 'ok', problems = 0;
  const bump = (lv) => { if (rank[lv] > rank[worst]) worst = lv; if (rank[lv] > 0) problems++; };

  const dirs = Object.keys(DIRECTIONS).map((k) => {
    const cfg = DIRECTIONS[k];
    const d = ats[k] ? new Date(ats[k]) : null;
    const rep = d && !isNaN(d) && R.kyivNow(d).day === day ? hmOf(d) : '';
    const ordered = status ? (status[k] ? status[k].size : 0) : -1;
    const age = rep ? now - minOf(rep) : null;
    const dl = cfg.deadline ? minOf(cfg.deadline) : 24 * 60;
    let lv = 'ok', text;
    if (ordered < 0) { lv = 'bad'; text = 'Не читается база заказов'; }
    else if (!R.dirEnabled(k, settings)) { lv = 'off'; text = 'Направление выключено'; }
    else if (ordered > 0 && !rep) { lv = 'bad'; text = 'Есть заказы (' + ordered + ' точек), а отчёт сегодня не собирался'; }
    else if (ordered > 0 && age > HEALTH_STALE_MIN && now <= dl + 60) {
      lv = 'warn'; text = 'Отчёт собран ' + age + ' мин назад, в ' + rep + ' · заказали ' + ordered;
    }
    else text = (rep ? 'Отчёт в ' + rep : 'Отчёт сегодня не собирался') + ' · заказали ' + ordered;
    bump(lv);
    return { key: k, title: cfg.title, level: lv, text };
  });

  const errors = (Array.isArray(settings[HEALTH_ERR_KEY]) ? settings[HEALTH_ERR_KEY] : [])
    .map((e) => ({ ...e, today: String(e.at || '').indexOf(todayDM) === 0 }));
  if (errors.some((e) => e.today)) bump('warn');
  // «Тригери» на сервері - це автоперевірка /jobs/tick (GitHub cron кожні 10 хв, вікно 07:00-22:00 за Києвом); час останнього tick пише runtime
  const nowKyiv = R.kyivNow(at), inWindow = nowKyiv.hh >= 7 && nowKyiv.hh < 22;
  const lt = settings.last_tick ? new Date(settings.last_tick) : null;
  const ltMin = lt && !isNaN(lt) ? Math.round((at.getTime() - lt.getTime()) / 60000) : null;
  let tl = 'ok', tt;
  if (ltMin === null) { tl = inWindow ? 'warn' : 'ok'; tt = 'tick ще не запускалась' + (inWindow ? ' - перевірити GitHub cron (secret JOBS_SECRET, workflow server-tick у гілці main)' : ' (поза вікном 07-22)'); }
  else if (inWindow && ltMin > 25) { tl = 'warn'; tt = 'остання перевірка ' + ltMin + ' хв тому - cron GitHub не працює? Невигружені замовлення і звіти не підхоплюються'; }
  else tt = 'остання перевірка ' + ltMin + ' хв тому' + (ltMin <= 25 ? '' : ' (поза вікном 07-22)');
  bump(tl);
  if (settings.test_mode) bump('bad');
  return {
    time: hmOf(at), level: worst,
    summary: worst === 'ok' ? 'Всё работает' : 'Требует внимания: ' + problems,
    dirs, triggers: [{ name: 'Автоперевірка сервера (tick кожні 10 хв)', level: tl, text: tt }], errors,
    sys: { version: 'Node (Fly) · сервер запущено ' + serverStart(), test: !!settings.test_mode, keys: Object.keys(settings).length, pct: 0, sess: 0 },
  };
}

async function admHealthClear(env) {
  await env.adm.setSetting(HEALTH_ERR_KEY, []);
  try { await env.adm.adminLog('Очищено список помилок', ''); } catch (e) { (env.log || console.error)('adminLog: ' + e.message); }
  return { ok: true };
}

// healthNoteError_: ніколи не кидає
async function noteError(adm, where, msg, at = new Date()) {
  try {
    const cur = await adm.getSetting(HEALTH_ERR_KEY);
    const arr = Array.isArray(cur) ? cur.slice() : [];
    const base = String(msg).slice(0, 300), top = arr[0];
    if (top && top.where === String(where) && (top.raw || top.msg) === base) {      // така сама помилка підряд: не множимо, а лічимо повтори
      const n = (top.count || 1) + 1;
      arr[0] = { ...top, raw: base, count: n, at: dmOf(at) + ' ' + hmOf(at), msg: base + ' (×' + n + ')' };
    } else arr.unshift({ at: dmOf(at) + ' ' + hmOf(at), where: String(where), msg: base });
    await adm.setSetting(HEALTH_ERR_KEY, arr.slice(0, 20));
  } catch (e) { /* як в оригіналі - мовчки */ }
}

// Картка точки (admCard_) з бази: row (рядок Довідника) у базі нема. Поля й перевірки - admin/stores.js
async function admCard(payload, env) {
  const r = await env.adm.storeRow(String(payload.storeId || ''));
  if (!r) throw new Error(STORE_NOT_FOUND);
  return { ...require('./stores').cardOf(r), editable: !!env.storeEdit || /^test/i.test(r.store_id) };
}

module.exports = { HEALTH_STALE_MIN, HEALTH_ERR_KEY, admHealth, admHealthClear, noteError, admCard };