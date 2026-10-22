// Листи Google на сторінці закупниці: каталог листів напрямку, вміст листа таблицею, посилання на xlsx одного листа.
// Лише читання (values.get, FORMATTED_VALUE - як бачить людина). Джерело - BUYER_SHEETS: live (бойові таблиці,
// за замовчуванням) або target (та сама ціль, що вигрузка; до Task 11 - тестова).
// group: report - звіти (немає листа - показуємо «немає»), extra - довідники і службові (немає - не показуємо).
const SUM = require('./summary');
const CATALOG = {
  bread: [
    { key: 'orders', sheet: 'Заказы', about: 'Для постачальника: по магазинах, ЄДРПОУ і номер ТТ', main: true },
    { key: 'summary', sheet: 'Данные Заказов', about: 'По маршрутах і позиціях, хто не замовив' },
    { key: 'routes', sheet: 'Маршруты и Магазины', about: 'Довідник: маршрути, магазини, номери ТТ', group: 'extra' },
    { key: 'check', sheet: '_Сверка_ТТ', about: 'Звірка точок з Довідником', group: 'extra' },
    { key: 'errors', sheet: '_Лог_Ошибок', about: 'Журнал помилок таблиці', group: 'extra' },
    { key: 'assort', sheet: 'Ассортимент', about: 'Лист асортименту в Google', group: 'extra' },
  ],
  nbhz: [
    { key: 'export', nbhz: true, about: 'Матриця ТТ × асортимент для заводу', main: true },
    { key: 'routes', sheet: 'Маршрути', about: 'Маршрути і адреси заводу', group: 'extra' },
    { key: 'check', sheet: '_Сверка_НБХЗ', about: 'Звірка точок НБХЗ', group: 'extra' },
    { key: 'assort', sheet: 'Ассортимент', about: 'Лист асортименту в Google', group: 'extra' },
  ],
  bakery: [
    { key: 'orders', sheet: 'Заказы ВК', about: 'По точках: що і скільки', main: true },
    { key: 'summary', sheet: 'Сводная ВК', about: 'По позиціях: разом штук і гривень' },
    { key: 'routes', sheet: 'Маршрути ВК', about: 'Для машини розвозки: маршрут, товар, точка' },
    { key: 'writeoffs', sheet: 'Списания', about: 'Списання', group: 'extra' },
    { key: 'deleted', sheet: 'Видалення замовлення', about: 'Журнал видалених замовлень', group: 'extra' },
    { key: 'addr', sheet: 'Адреса ТТ', about: 'Адреси точок', group: 'extra' },
    { key: 'errors', sheet: '_Лог_Ошибок', about: 'Журнал помилок таблиці', group: 'extra' },
    { key: 'assort', sheet: 'Ассортимент', about: 'Лист асортименту в Google', group: 'extra' },
  ],
  veg: [
    { key: 'orders', sheet: 'Замовлення Овочі', about: 'По точках', main: true },
    { key: 'summary', sheet: 'Зведена Овочі', about: 'По позиціях' },
    { key: 'settings', sheet: 'Налаштування', about: 'Налаштування таблиці овочів', group: 'extra' },
    { key: 'addr', sheet: 'Адреса ТТ', about: 'Адреси точок', group: 'extra' },
    { key: 'errors', sheet: '_Лог_Помилок_Овочі', about: 'Журнал помилок таблиці', group: 'extra' },
  ],
};
const NBHZ_RE = /^Вивантаження (\d{2})\.(\d{2})\.(\d{4})$/;
const NBHZ_DAYS = 3;
const MAX_ROWS = 3000, MAX_COLS = 60;
const BASE = 'https://docs.google.com/spreadsheets/d/';

function colName(n) {
  let s = '';
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// «3,» -> «3»: формат чисел у звітах ВК показує кому після цілого
function clean(v) {
  const x = v == null ? '' : String(v);
  return /^-?\d[\d\s\u00a0]*,$/.test(x.trim()) ? x.trim().slice(0, -1) : x;
}

// прибрати порожній хвіст рядків і колонок, вирівняти ширину
function trim(values) {
  const rows = (values || []).map((r) => (r || []).map(clean));
  while (rows.length && rows[rows.length - 1].every((v) => v.trim() === '')) rows.pop();
  let w = 0;
  rows.forEach((r) => { for (let i = r.length - 1; i >= 0; i--) if (r[i].trim() !== '') { w = Math.max(w, i + 1); break; } });
  return { width: w, rows: rows.map((r) => { const x = r.slice(0, w); while (x.length < w) x.push(''); return x; }) };
}

function createBuyerSheets({ google, sourceId, mode = 'live', ttlMs = 60000, now = () => Date.now() }) {
  const cache = new Map();
  async function cached(key, fn) {
    const c = cache.get(key);
    if (c && now() - c.t < ttlMs) return c.v;
    const v = await fn();
    cache.set(key, { t: now(), v });
    return v;
  }

  async function list(dir, { fresh = false } = {}) {
    const cat = CATALOG[dir];
    if (!cat) return { dir, mode, url: '', sheets: [] };
    if (fresh) cache.delete('list|' + dir);
    return cached('list|' + dir, async () => {
      const id = sourceId(dir);
      const tabs = await google.sheetList(id);
      const byTitle = new Map(tabs.map((t) => [t.title, t]));
      const out = [];
      cat.forEach((c) => {
        const group = c.group || 'report';
        if (c.nbhz) {
          const days = tabs.map((t) => ({ t, m: NBHZ_RE.exec(t.title) })).filter((x) => x.m)
            .map((x) => ({ t: x.t, d: x.m[3] + x.m[2] + x.m[1] }))
            .sort((a, b) => b.d.localeCompare(a.d)).slice(0, NBHZ_DAYS);
          if (!days.length) out.push({ key: c.key, title: 'Вивантаження', about: c.about, main: !!c.main, group, missing: true });
          days.forEach((x, i) => out.push({ key: c.key + ':' + x.t.title.slice(-10), title: x.t.title, sheet: x.t.title,
            gid: x.t.sheetId, about: c.about, main: !!c.main && i === 0, group, rows: x.t.rowCount, cols: x.t.columnCount }));
          return;
        }
        const t = byTitle.get(c.sheet);
        if (t) out.push({ key: c.key, title: c.sheet, sheet: c.sheet, gid: t.sheetId, about: c.about, main: !!c.main, group,
          rows: t.rowCount, cols: t.columnCount });
        else if (group === 'report') out.push({ key: c.key, title: c.sheet, about: c.about, main: !!c.main, group, missing: true });
      });
      return { dir, mode, url: BASE + id + '/edit', sheets: out };
    });
  }

  async function entry(dir, key) {
    const l = await list(dir);
    const e = key ? l.sheets.find((s) => s.key === String(key)) : l.sheets.find((s) => s.main && !s.missing);
    if (!e || e.missing) throw new Error('Лист не знайдено' + (e ? ': ' + e.title : '') + '. Можливо, звіт ще не зібрано.');
    return e;
  }

  async function read(dir, key, { fresh = false } = {}) {
    const e = await entry(dir, key);
    if (fresh) cache.delete('sheet|' + dir + '|' + e.key);
    return cached('sheet|' + dir + '|' + e.key, async () => {
      const rows = Math.min(e.rows || MAX_ROWS, MAX_ROWS);
      const cols = Math.min(e.cols || 26, MAX_COLS);
      const values = await google.getValues(sourceId(dir), google.a1q(e.sheet, 'A1:' + colName(cols - 1) + rows), { formatted: true });
      const t = trim(values);
      return { dir, key: e.key, title: e.title, about: e.about, width: t.width, rows: t.rows,
        cut: (values || []).length >= MAX_ROWS, at: new Date(now()).toISOString() };
    });
  }

  async function xlsxUrl(dir, key) {
    const e = await entry(dir, key);
    return { url: BASE + sourceId(dir) + '/export?format=xlsx&gid=' + e.gid, title: e.title };
  }

  // Зведення для вкладки «Сьогодні» (src/buyer/summary.js); лист, якого немає, - null
  async function summary(dir, { fresh = false } = {}) {
    const l = await list(dir, { fresh });
    const get = async (key) => { if (!key) return null; try { return (await read(dir, key, { fresh })).rows; } catch (e) { return null; } };
    const firstOf = (p) => l.sheets.find((x) => x.key.startsWith(p) && !x.missing);
    let out;
    try {
      if (dir === 'bread') out = SUM.bread({ orders: await get('orders'), summary: await get('summary') });
      else if (dir === 'nbhz') { const e = firstOf('export:'); out = SUM.nbhz({ exportRows: await get(e && e.key), routes: await get('routes'), title: e ? e.title : '' }); }
      else if (dir === 'bakery') out = SUM.bakery({ orders: await get('orders'), summary: await get('summary'), routes: await get('routes') });
      else if (dir === 'veg') out = SUM.veg({ orders: await get('orders'), summary: await get('summary') });
      else out = { stats: [], top: [], groups: null, missing: null };
    } catch (e) { out = { stats: [], top: [], groups: null, missing: null, note: e.message }; }
    return { dir, mode, at: new Date(now()).toISOString(), url: l.url, ...out };
  }

  return { list, read, xlsxUrl, summary };
}

module.exports = { createBuyerSheets, CATALOG, colName, trim, clean };