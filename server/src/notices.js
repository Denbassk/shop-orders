// Сервісне повідомлення продавцям (пульт -> банер угорі сайту продавця і, за потреби, одноразове вікно).
// settings.service_notice = [{ id, text, dir ('' = усі), until ('yyyy-MM-dd HH:MM' за Києвом), modal, at (ISO створення) }].
// «Діє» = зараз за Києвом раніше за until: після until запис просто ігнорується (як deadline_override), прибирається при наступному збереженні.
const R = require('./rules');
const { DIRECTIONS } = require('./directions');

const MAX_ACTIVE = 5;
const TEXT_MAX = 300;
const MAX_DAYS = 31;
const pad = (n) => ('0' + n).slice(-2);

// 'yyyy-MM-dd HH:MM' за Києвом - порівнюється як рядок
const stamp = (at) => { const n = R.kyivNow(at); return n.day + ' ' + pad(n.hh) + ':' + pad(n.mm); };

// '2026-11-03T23:59' (datetime-local) або '2026-11-03 23:59' -> 'yyyy-MM-dd HH:MM'; інакше ''
function parseUntil(raw) {
  const s = String(typeof raw === 'string' ? raw : '').trim().replace('T', ' ');
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(s);
  return m && R.isDay(m[1]) && R.isHM(m[2]) ? s : '';
}

function isActive(n, at) {
  return !!n && typeof n === 'object' && typeof n.id === 'string' && !!n.id && typeof n.text === 'string' && !!n.text.trim()
    && parseUntil(n.until) === n.until && stamp(at) < n.until;
}
const activeList = (list, at) => (Array.isArray(list) ? list.filter((n) => isActive(n, at)) : []);

// що бачить продавець (без at / until)
const forSeller = (list, at) => activeList(list, at).map((n) => ({ id: n.id, text: n.text, dir: n.dir || '', modal: !!n.modal }));

// нове повідомлення з пульту: перевірка і розрахунок; помилка - виняток до будь-якого запису
function makeNotice(p, at) {
  p = p || {};
  const text = String(p.text == null ? '' : p.text).replace(/\r\n/g, '\n').trim();
  if (!text) throw new Error('Введіть текст повідомлення');
  if (text.length > TEXT_MAX) throw new Error('Текст задовгий (до ' + TEXT_MAX + ' символів)');
  let dir = String(p.dir == null ? '' : p.dir);
  if (dir === 'all') dir = '';
  if (dir && !Object.prototype.hasOwnProperty.call(DIRECTIONS, dir)) throw new Error('Невідомий напрямок: "' + dir + '"');
  const until = parseUntil(p.until);
  if (!until) throw new Error('Невірний час закінчення');
  if (until <= stamp(at)) throw new Error('Час закінчення вже минув');
  if (R.dayDiff(R.kyivNow(at).day, until.slice(0, 10)) > MAX_DAYS) throw new Error('Повідомлення не може діяти довше за ' + MAX_DAYS + ' днів');
  return { id: at.getTime().toString(36), text, dir, until, modal: p.modal === true, at: at.toISOString() };
}

// «Хто побачив»: магазини, яких стосується повідомлення (усі або з цим напрямком; тестові точки 'test-…' не рахуються), і їхні відмітки.
// acks - рядки service_notice_ack ({notice_id, store_id, seen_at, ack_at}); відмітки магазинів, яких повідомлення не стосується, ігноруються.
const isTestStore = (s) => String(s.id).startsWith('test-');
function ackStats(n, stores, acks) {
  const rel = stores.filter((s) => !isTestStore(s) && (!n.dir || (s.directions || []).indexOf(n.dir) >= 0));
  const byStore = new Map((acks || []).filter((a) => a.notice_id === n.id).map((a) => [a.store_id, a]));
  const seenRows = rel.filter((s) => byStore.has(s.id)).map((s) => ({ store: s, ack: byStore.get(s.id) }));
  return { total: rel.length, seen: seenRows.length, acked: seenRows.filter((r) => r.ack.ack_at).length,
    missing: rel.filter((s) => !byStore.has(s.id)), seenRows };
}

module.exports = { ackStats, MAX_ACTIVE, TEXT_MAX, MAX_DAYS, stamp, parseUntil, isActive, activeList, forSeller, makeNotice };
