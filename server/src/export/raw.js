// Вигрузка замовлень з бази в сирі листи Google. Перенос rawRow (Config.gs), apiAppend_/orderRowsInTail_/
// missingOrderLines_/fixAppendedFormatApi_ (AppendGuard.gs), deleteTodayRowsByKey_ (Orders.gs).
//
// Одиниця роботи - ГРУПА (точка, день) напрямку: усі її замовлення (основне + добавки) і рядки в листі.
//   - в групі є скасоване або змінене після вигрузки -> рядки групи в листі видаляються (знизу вгору), дописуються active;
//   - інакше дописуються лише рядки, яких у листі ще немає (множина «година|назва|кількість» - вбитий прогін не дублює).
// Позначка orders.exported_at = changed_at тієї версії, що вигружена (зміна після читання лишає замовлення невигруженим).
const R = require('../rules');
const { DIRECTIONS } = require('../directions');

const COLS = {               // 0-based індекси колонок сирого листа (rawCols_ з Admin.gs + адреса/час)
  bread:  { time: -1, addr: 2, name: 4, qty: 6, bc: 4 },
  nbhz:   { time: -1, addr: 2, name: 4, qty: 6, bc: 4 },
  bakery: { time: 1,  addr: 2, name: 5, qty: 7, bc: 5 },
  veg:    { time: 1,  addr: 2, name: 3, qty: 5, bc: 0 },
};
const LAST_COL = { bread: 'G', nbhz: 'G', bakery: 'H', veg: 'G' };
const money = (n) => Math.round(n * 100) / 100;

// ctx = { dateStr 'ДД.ММ.РРРР', timeStr, address, shortAddress, route, store }; p = { barcode, name, price, qty }
const RAW_ROW = {
  bread:  (ctx, p) => [ctx.dateStr, ctx.route, ctx.shortAddress, p.barcode, p.name, p.price, p.qty],
  nbhz:   (ctx, p) => [ctx.dateStr, ctx.route, ctx.shortAddress, p.barcode, p.name, p.price, p.qty],
  bakery: (ctx, p) => [ctx.dateStr, ctx.timeStr, ctx.address, (ctx.store && ctx.store.zone) || '', p.barcode, p.name, p.price, p.qty],
  veg:    (ctx, p) => [ctx.dateStr, ctx.timeStr, ctx.address, p.name, p.price, p.qty, money(p.price * p.qty)],
};
const rawRowOf = (dir, ctx, p) => RAW_ROW[dir](ctx, p);

const dmyOfDay = (day) => day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
const cell = (v) => (v == null ? '' : String(v));

// ---- нормалізація комірок листа (dmyOfCell_, hmOfCell_, lineKey_) ----
function dmyOfSheetCell(v) {
  if (typeof v === 'number') return R.kyivNow(new Date(Math.round((Math.floor(v) - 25569) * 86400000) + 43200000)).dmy;
  const m = cell(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? m[1].padStart(2, '0') + '.' + m[2].padStart(2, '0') + '.' + m[3] : cell(v).trim();
}
function hmOfCell(v) {
  const m = cell(v).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
}
function lineKey(hm, name, qty) {
  return hm + '|' + cell(name).trim().toLowerCase() + '|' + (Number(cell(qty).replace(',', '.')) || 0);
}

// ---- рядки замовлень групи ----
function rowsOfOrder(dir, o, store) {
  const cfg = DIRECTIONS[dir];
  const address = store[cfg.addressAlias] || '';
  const ctx = {
    dateStr: dmyOfDay(o.order_date),
    timeStr: R.kyivNow(new Date(o.created_at)).time,
    address,
    shortAddress: R.shortenAddress(address),
    route: store[cfg.routeAlias || 'route'] || store.route || '',
    store,
  };
  const bcCol = COLS[dir].bc;
  return o.lines.slice().sort((a, b) => a.line_no - b.line_no).map((l) => {
    const row = rawRowOf(dir, ctx, { barcode: l.barcode || '', name: l.name, price: Number(l.price), qty: Number(l.qty) });
    if (bcCol && row[bcCol - 1] !== '') row[bcCol - 1] = "'" + String(row[bcCol - 1]);   // апостроф не дає перетворити штрихкод на число
    return row;
  });
}

const mutex = {};     // dir -> ланцюг промісів
function withMutex(dir, fn) {
  const prev = mutex[dir] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  mutex[dir] = next.catch(() => {});
  return next;
}

function parseUpdatedRange(res) {
  const r = res && res.updates && res.updates.updatedRange;
  const m = String(r || '').match(/!\$?[A-Z]+(\d+)(?::\$?[A-Z]+(\d+))?$/);
  if (!m) return null;
  const first = Number(m[1]), last = Number(m[2] || m[1]);
  return { first, count: last - first + 1 };
}

// Рядки групи в листі: { nums: [1-based], keys: {hm|назва|к-ть: скільки} }
async function groupRowsInSheet(env, dir, spreadsheetId, sheetName, dmy, addrKey) {
  const g = env.google, c = COLS[dir], last = LAST_COL[dir];
  const a1 = (r) => `'${sheetName.replace(/'/g, "''")}'!${r}`;
  const [disp, dates] = await Promise.all([
    g.getValues(spreadsheetId, a1(`A:${last}`), { formatted: true }),
    g.getValues(spreadsheetId, a1('A:A')),
  ]);
  const out = { nums: [], keys: {}, last: Math.max(dates.length, 1) };   // last - останній заповнений рядок колонки A (якір append)
  for (let i = 1; i < disp.length; i++) {            // 0 - шапка
    const r = disp[i];
    const d = dmyOfSheetCell(dates[i] && dates[i][0] !== undefined && typeof dates[i][0] === 'number' ? dates[i][0] : r[0]);
    if (d !== dmy) continue;
    if (R.addrKey(cell(r[c.addr])) !== addrKey) continue;
    const hm = c.time >= 0 ? hmOfCell(r[c.time]) : '';
    const k = lineKey(hm, r[c.name], r[c.qty]);
    out.keys[k] = (out.keys[k] || 0) + 1;
    out.nums.push(i + 1);
  }
  return out;
}

function deleteRequests(sheetId, nums) {
  nums = nums.slice().sort((a, b) => a - b);
  const ranges = [];
  let start = nums[0], prev = nums[0];
  for (let j = 1; j < nums.length; j++) {
    if (nums[j] === prev + 1) { prev = nums[j]; continue; }
    ranges.push([start, prev]); start = nums[j]; prev = nums[j];
  }
  ranges.push([start, prev]);
  ranges.reverse();                                  // знизу вгору: номери вище не зсуваються
  return ranges.map((r) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r[0] - 1, endIndex: r[1] } } }));
}

// формат після append - як fixAppendedFormatApi_: дата, час (якщо в B час), штрихкод текстом
function formatRequests(sheetId, first, count, firstRow, bcCol) {
  const fmt = (col, nf) => ({ repeatCell: {
    range: { sheetId, startRowIndex: first - 1, endRowIndex: first - 1 + count, startColumnIndex: col - 1, endColumnIndex: col },
    cell: { userEnteredFormat: { numberFormat: nf } }, fields: 'userEnteredFormat.numberFormat' } });
  const req = [fmt(1, { type: 'DATE', pattern: 'dd.mm.yyyy' })];
  if (/^\d{1,2}:\d{2}/.test(cell(firstRow[1]))) req.push(fmt(2, { type: 'TIME', pattern: 'hh:mm:ss' }));
  if (bcCol) req.push(fmt(bcCol, { type: 'TEXT' }));
  return req;
}

// env = { data: {exportSnapshot, markExported}, google: {getValues, appendValues, batchUpdate, sheetIdOf}, target, at }
async function exportDirLocked(dir, env) {
  const cfg = DIRECTIONS[dir];
  const spreadsheetId = env.target.spreadsheetId(dir);
  const sheetName = cfg.rawSheet;
  const { orders, stores } = await env.data.exportSnapshot(dir);
  const res = { written: 0, deleted: 0, skipped: 0 };
  if (!orders.length) return res;

  const storeBy = Object.fromEntries(stores.map((s) => [s.id, s]));
  const groups = new Map();
  for (const o of orders) {
    const k = o.store_id + '|' + o.order_date;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }

  for (const list of groups.values()) {
    const dirty = list.filter((o) => !o.exported_at || Date.parse(o.exported_at) < Date.parse(o.changed_at));
    const store = storeBy[list[0].store_id];
    if (!store) { console.error(`вигрузка ${dir}: точки ${list[0].store_id} нема в stores - пропущено`); res.skipped++; continue; }
    const active = list.filter((o) => o.status === 'active').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const wanted = active.flatMap((o) => rowsOfOrder(dir, o, store));
    const rebuild = dirty.some((o) => o.status === 'cancelled' || o.exported_at);

    const dmy = dmyOfDay(list[0].order_date);
    const addr = store[cfg.addressAlias] || '';
    const key = R.addrKey(cfg.shortAddr ? R.shortenAddress(addr) : addr);
    const touched = wanted.length > 0 || rebuild;

    let wrote = 0, removed = 0;
    if (touched) {
      // читання листа і sheetId (кеш процесу) - паралельно: на гарячому шляху кожен запит до Google на рахунку
      let [present, sheetId] = await Promise.all([
        groupRowsInSheet(env, dir, spreadsheetId, sheetName, dmy, key),
        env.google.sheetIdOf(spreadsheetId, sheetName),
      ]);
      if (rebuild && present.nums.length) {
        await env.google.batchUpdate(spreadsheetId, deleteRequests(sheetId, present.nums));
        removed = present.nums.length;
        present = { nums: [], keys: {}, last: Math.max(present.last - removed, 1) };   // видалені рядки були вище кінця таблиці
      }
      // що з wanted ще немає в листі (множина по групі)
      const used = {}, missing = [];
      const c = COLS[dir];
      for (const row of wanted) {
        const hm = c.time >= 0 ? hmOfCell(row[c.time]) : '';
        const k = lineKey(hm, row[c.name], row[c.qty]);
        used[k] = (used[k] || 0) + 1;
        if (used[k] > (present.keys[k] || 0)) missing.push(row);
      }
      if (missing.length) {
        const ap = await env.google.appendValues(spreadsheetId, `'${sheetName.replace(/'/g, "''")}'!A${present.last}`, missing);
        const at = parseUpdatedRange(ap);
        if (!at) throw new Error('Google не повернув діапазон запису - рядки не підтверджено');
        wrote = missing.length;
        try { await env.google.batchUpdate(spreadsheetId, formatRequests(sheetId, at.first, at.count, missing[0], c.bc)); }
        catch (e) { console.error(`формат після append ${dir}: ${e.message}`); }        // рядки вже в листі - не перевигружаємо
      }
    }

    await env.data.markExported(dirty.map((o) => ({ id: o.id, exported_at: o.changed_at })));
    res.written += wrote;
    res.deleted += removed;
    if (!wrote && !removed) res.skipped++;
  }
  return res;
}

// Один запуск на напрямок одночасно (в межах процесу).
function exportDir(dir, env) { return withMutex(dir, () => exportDirLocked(dir, env)); }

// Усі напрямки паралельно; збій одного не зупиняє інші: { dir: {written,deleted,skipped} | {error} }
async function exportAll(env) {
  const dirs = Object.keys(DIRECTIONS);
  const settled = await Promise.allSettled(dirs.map((d) => exportDir(d, env)));
  const out = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') out[dirs[i]] = s.value;
    else { out[dirs[i]] = { error: String((s.reason && s.reason.message) || s.reason) }; console.error(`вигрузка ${dirs[i]}: ${out[dirs[i]].error}`); }
  });
  return out;
}

module.exports = { exportDir, exportAll, rawRowOf, dmyOfSheetCell, hmOfCell };
