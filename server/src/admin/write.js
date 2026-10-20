// Дії пульта, що змінюють дані: перенос admCancelOrder_ / admOpenStore_ / admOpenAll_ / admCloseAll_ / admSetDirEnabled_
// (app/Admin.gs, Config.gs setDirEnabled_, Deadline.gs allowLate_/closeLate_, LateRequest.gs approveLate_).
// Замок листа (dirLockAcquire_) не потрібен: скасування - один UPDATE у базі, рядки з листа прибирає вигрузка (export/raw.js).
// clearMark не перенесено: окремої позначки немає, «вже замовила» = активне замовлення в базі (записується транзакцією).
const { DIRECTIONS } = require('../directions');
const R = require('../rules');

const STORE_NOT_FOUND = 'Торгову точку не знайдено. Оновіть сторінку.';

function cfgOf(dir) {
  const cfg = Object.prototype.hasOwnProperty.call(DIRECTIONS, dir) ? DIRECTIONS[dir] : null;
  if (!cfg) throw new Error('Невідомий напрямок: "' + dir + '"');
  return cfg;
}
async function storeOf(id, env) {
  const s = (await env.data.stores()).find((x) => x.id === String(id));
  if (!s) throw new Error(STORE_NOT_FOUND);
  return s;
}
const dayOf = (env) => R.kyivNow(env.at).day;
const logErr = (env, msg) => (env.log || console.error)(msg);
async function logSafe(env, action, details) {
  try { await env.adm.adminLog(action, details); } catch (e) { logErr(env, 'adminLog: ' + ((e && e.message) || e)); }
}

async function admCancelOrder(payload, env) {
  const store = await storeOf(payload.storeId, env);
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const removed = await env.adm.cancelDay(dir, store.id, dayOf(env));
  try { env.queueExport(dir); } catch (e) { logErr(env, 'queueExport: ' + ((e && e.message) || e)); }
  await logSafe(env, 'Скасовано замовлення', cfg.title + ' / ' + store.label + ' - рядків ' + removed);
  return { removed };
}

async function admOpenStore(payload, env) {
  const store = await storeOf(payload.storeId, env);
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  await env.data.approveLate(dir, store.id, dayOf(env), env.at);
  await logSafe(env, 'Відкрито прийом точці', cfg.title + ' / ' + store.label + ' - на ' + R.LATE_TTL_MIN + ' хв');
  return { left: R.LATE_TTL_MIN };                       // щойно видано: lateLeftMin_ = ceil(30 хв)
}

async function admOpenAll(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const v = { ...((await env.adm.getSetting('late_all')) || {}) };
  v[dir] = dayOf(env);
  await env.adm.setSetting('late_all', v);
  await logSafe(env, 'Відкрито прийом усім', cfg.title + ' - до кінця дня');
  return { ok: true };
}

async function admCloseAll(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const v = { ...((await env.adm.getSetting('late_all')) || {}) };
  delete v[dir];
  await env.adm.setSetting('late_all', v);
  await logSafe(env, 'Повернуто звичайний режим', cfg.title);
  return { ok: true };
}

// Увімкнути/вимкнути напрямок ЦІЛКОМ - зникає з меню всіх продавців. Існуючі замовлення і звіти не чіпає.
async function admSetDirEnabled(payload, env) {
  const dir = String(payload.dir || '');
  const cfg = cfgOf(dir);
  const on = !!payload.on;
  const cur = await env.adm.getSetting('dirs_off');
  const list = (Array.isArray(cur) ? cur : []).filter((k) => k !== dir);
  if (!on) list.push(dir);
  await env.adm.setSetting('dirs_off', list);
  await logSafe(env, on ? 'Увімкнено напрямок' : 'Вимкнено напрямок', cfg.title);
  return { ok: true, enabled: on };
}

module.exports = { STORE_NOT_FOUND, admCancelOrder, admOpenStore, admOpenAll, admCloseAll, admSetDirEnabled };