// Правила календаря, дедлайнів, дозволів, адрес. Перенос з app/Deadline.gs, VegDays.gs, LateRequest.gs,
// Config.gs (minOrderOf_), Address.gs, Registry.gs (canonKey_, statusKey_).
//
// Усі функції чисті: час і налаштування приходять у ctx, до бази й мережі вони не ходять.
//   ctx = { at: Date, settings: { dirs_off, late_all, ... }, lateRows: [late_requests], directions?: { [dir]: cfg } }
//   lateRows - рядки таблиці late_requests ({dir, store_id, requested_at, approved_at}), ISO-рядки або Date.
//   store - об'єкт у формі loadStores_() (id, label, address, addrBread..., days, directions).

const { DIRECTIONS } = require('./directions');

// Чи знімає дозвіл закупниці обмеження по дню тижня (див. dayAllowed). false - день це логістика маршруту.
const LATE_OVERRIDES_DAY = false;
const LATE_TTL_MIN = 30;      // скільки хвилин діє дозвіл після натискання
const LATE_Q_TTL_MIN = 120;   // скільки висить сам запит, якщо на нього не відповіли

// ============================================================
// ЧАС (Europe/Kyiv)
// ============================================================
const KYIV_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv', hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// { day: 'yyyy-MM-dd', dmy: 'ДД.ММ.РРРР', time: 'HH:mm:ss', hh, mm, ss, dow: 0 нд ... 6 сб }
function kyivNow(at) {
  const p = {};
  KYIV_FMT.formatToParts(at || new Date()).forEach((x) => { p[x.type] = x.value; });
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    dmy: `${p.day}.${p.month}.${p.year}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
    hh: +p.hour, mm: +p.minute, ss: +p.second,
    dow: WEEKDAY[p.weekday],
  };
}

const atOf = (ctx) => (ctx && ctx.at) || new Date();
const settingsOf = (ctx) => (ctx && ctx.settings) || {};
const msOf = (v) => (v == null ? NaN : (v instanceof Date ? v.getTime() : Date.parse(v)));

// ============================================================
// НАПРЯМКИ І НАЛАШТУВАННЯ
// ============================================================
function dirCfg(key, ctx) {
  const all = (ctx && ctx.directions) || DIRECTIONS;
  const c = all[key];
  if (!c) throw new Error('Невідомий напрямок: "' + key + '". Доступні: ' + Object.keys(all).join(', ') + '.');
  return c;
}

// { [dir]: true } з settings.dirs_off
function disabledDirections(settings) {
  const map = {};
  ((settings && settings.dirs_off) || []).forEach((k) => { map[k] = true; });
  return map;
}

function dirEnabled(key, settings) {
  return !disabledDirections(settings)[key];
}

// ============================================================
// ДЕДЛАЙНИ ТА ДОЗВОЛИ
// ============================================================
// Ручне відкриття прийому для ВСІХ точок на сьогодні: settings.late_all = { <dir>: 'yyyy-MM-dd' }
function lateAllowed(dirKey, ctx) {
  const v = (settingsOf(ctx).late_all || {})[dirKey];
  return !!v && v === kyivNow(atOf(ctx)).day;
}

function lateLeftMs(rows, field, ttlMin, at) {
  let ts = NaN;
  rows.forEach((r) => { const t = msOf(r[field]); if (!(t <= ts)) ts = t; });     // найновіша; NaN програє
  if (isNaN(ts)) return 0;
  const left = ttlMin * 60000 - (at.getTime() - ts);
  return left > 0 ? left : 0;
}

function lateRowsOf(dirKey, storeId, ctx) {
  return ((ctx && ctx.lateRows) || []).filter((r) => r.dir === dirKey && String(r.store_id) === String(storeId));
}

// 'none' | 'pending' | 'approved'
function lateStatus(dirKey, storeId, ctx) {
  if (!dirKey || !storeId) return 'none';
  const rows = lateRowsOf(dirKey, storeId, ctx), at = atOf(ctx);
  if (lateLeftMs(rows, 'approved_at', LATE_TTL_MIN, at) > 0) return 'approved';
  if (lateLeftMs(rows, 'requested_at', LATE_Q_TTL_MIN, at) > 0) return 'pending';
  return 'none';
}

// Скільки хвилин ще діє дозвіл (0 - не діє)
function lateLeftMin(dirKey, storeId, ctx) {
  const ms = lateLeftMs(lateRowsOf(dirKey, storeId, ctx), 'approved_at', LATE_TTL_MIN, atOf(ctx));
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function deadlinePassed(dirKey, storeId, ctx) {
  const cfg = dirCfg(dirKey, ctx);
  if (!cfg.deadline) return false;
  if (lateAllowed(dirKey, ctx)) return false;
  if (storeId && cfg.lateRequest && lateStatus(dirKey, storeId, ctx) === 'approved') return false;
  const n = kyivNow(atOf(ctx));
  const p = String(cfg.deadline).split(':');
  return (n.hh * 60 + n.mm) >= (+p[0] * 60 + +p[1]);
}

// ============================================================
// ГРАФІК ПО ДНЯХ ТИЖНЯ
// ============================================================
const DAY_KEYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];   // індекс = getDay()

// "Пн, Ср" -> [1, 3]
function parseDays(s) {
  const t = String(s || '').toLowerCase();
  const out = [];
  for (let i = 0; i < 7; i++) if (t.indexOf(DAY_KEYS[i]) >= 0) out.push(i);
  return out;
}

// День тижня за Києвом: 0 нд ... 6 сб
function todayDow(at) {
  return kyivNow(at).dow;
}

// Дні прийому цієї точки по цьому напрямку
function storeDays(dirKey, store) {
  return ((store.days || {})[dirKey]) || [];
}

// Чи можна цій точці замовляти цей напрямок сьогодні
function dayAllowed(dirKey, store, ctx) {
  const cfg = dirCfg(dirKey, ctx);
  if (!cfg.orderDays) return true;
  const days = storeDays(dirKey, store);
  if (!days.length) return true;                      // день не заданий - не обмежуємо
  if (LATE_OVERRIDES_DAY && cfg.lateRequest && lateStatus(dirKey, store.id, ctx) === 'approved') return true;
  return days.indexOf(todayDow(atOf(ctx))) >= 0;
}

const DAY_FULL = { 0: 'неділя', 1: 'понеділок', 2: 'вівторок', 3: 'середа',
                   4: 'четвер', 5: 'пʼятниця', 6: 'субота' };   // апостроф U+02BC, як у VegDays.gs

function dayNamesOf(dirKey, store) {
  return storeDays(dirKey, store).map((d) => DAY_FULL[d]).join(', ');
}

// Текст, який бачить продавець у чужий день
function dayOffText(dirKey, store, ctx) {
  const cfg = dirCfg(dirKey, ctx);
  const base = cfg.dayOffText || 'Сьогодні цей напрямок не приймає замовлень.';
  const days = dayNamesOf(dirKey, store);
  return days ? base + ' Ваші дні: ' + days + '.' : base;
}

// ============================================================
// МІНІМАЛЬНЕ ЗАМОВЛЕННЯ
// ============================================================
// 'ДД.ММ.РРРР' (або з / і -) -> 'yyyy-MM-dd' для порівняння дат; null, якщо не дата
function dmyToDay(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return null;
  const day = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(day + 'T00:00:00Z');
  return isNaN(d.getTime()) ? null : day;
}

// Мінімальне замовлення з урахуванням запланованої зміни: minOrderChanges [{from:'ДД.ММ.РРРР', value}].
// Діє з 00:00 цієї дати за Києвом; береться найновіша зі змін, що вже настали.
function minOrderOf(cfg, at) {
  let v = cfg.minOrder;
  if (cfg.minOrderChanges && cfg.minOrderChanges.length) {
    const today = kyivNow(at).day;
    let best = null;
    cfg.minOrderChanges.forEach((ch) => {
      const d = dmyToDay(ch.from);
      if (d && today >= d && (!best || d > best.d)) best = { d, value: ch.value };
    });
    if (best) v = best.value;
  }
  return v;
}

// ============================================================
// АДРЕСИ
// ============================================================
const ADDR_STOP = {
  'м': 1, 'мiсто': 1, 'місто': 1, 'г': 0, 'харків': 1, 'харьков': 1, 'харкiв': 1,
  'вул': 1, 'вулиця': 1, 'ул': 1, 'улица': 1, 'пр': 1, 'прт': 1, 'проспект': 1, 'просп': 1,
  'пров': 1, 'провулок': 1, 'пер': 1, 'переулок': 1, 'пл': 1, 'площа': 1, 'площадь': 1, 'шосе': 1, 'шоссе': 1,
};

// Хлібний скрипт зберігає адресу скорочено:
// "м. Харків вул. Астрономічна, 44 Г" -> "Астрономічна, 44 г"
function shortenAddress(address) {
  let s = String(address || '').trim();
  s = s.replace(/^м\.\s*Харків\s*/i, '');
  s = s.replace(/^(вул\.|вулиця|пр-т|проспект|просп\.|пров\.|провулок|пл\.|площа|шосе)\s*/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Ключ порівняння адрес. Повна і скорочена адреса дають ОДНАКОВИЙ ключ.
// Службові слова ріжемо тільки на початку рядка, щоб не втратити літеру корпусу ("44 г") наприкінці.
function addrKey(address) {
  const s = String(address || '').toLowerCase()
    .replace(/[’''`"]/g, '')
    .replace(/пр[\-\s]*т(?=[\s.,]|$)/g, 'прт')
    .replace(/[^a-zа-яіїєґё0-9\/]+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const t = s.split(' ');
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (i < 4 && ADDR_STOP[t[i]] === 1) continue;
    out.push(t[i]);
  }
  return out.join(' ');
}

// store_id = canonKey(адреса з Довідника)
function canonKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-zа-яіїєґ0-9]+/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Ключ точки в сирому листі напрямку (колонка C)
function statusKey(dirKey, store, ctx) {
  const cfg = dirCfg(dirKey, ctx);
  const a = store[cfg.addressAlias];
  return addrKey(cfg.shortAddr ? shortenAddress(a) : a);
}

module.exports = {
  LATE_OVERRIDES_DAY, LATE_TTL_MIN, LATE_Q_TTL_MIN, DAY_KEYS, DAY_FULL,
  kyivNow, dirCfg, disabledDirections, dirEnabled,
  lateAllowed, lateStatus, lateLeftMin, deadlinePassed,
  parseDays, todayDow, storeDays, dayAllowed, dayNamesOf, dayOffText,
  dmyToDay, minOrderOf,
  shortenAddress, addrKey, canonKey, statusKey,
};
