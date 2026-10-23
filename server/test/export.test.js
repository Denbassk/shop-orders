// Вигрузка замовлень з бази в сирі листи Google: підмінний Google-клієнт (аркуші в пам'яті) і підмінна база.
const test = require('node:test');
const assert = require('node:assert/strict');

const { exportDir, exportAll, rawRowOf } = require('../src/export/raw');
const { resolveTarget, exportTargetMode, TEST_EXPORT_SPREADSHEET_ID } = require('../src/export/target');
const { createExportQueue } = require('../src/export/queue');
const { createApp } = require('../src/app');
const { DIRECTIONS } = require('../src/directions');

const DAY = '2026-10-19';
const DMY = '19.10.2026';
const AT = new Date('2026-10-19T12:54:08+03:00');

// ---------- підмінний Google: аркуші в пам'яті ----------
function colIdx(letter) { return letter.charCodeAt(0) - 65; }

function makeGoogle({ fail = {} } = {}) {
  const sheets = {};                      // `${spreadsheetId}|${title}` -> { id, rows: [[...]] }
  const log = [];
  const sheetOf = (id, a1) => {
    const m = String(a1).match(/^'((?:[^']|'')+)'!/);
    const title = m[1].replace(/''/g, "'");
    const key = id + '|' + title;
    if (!sheets[key]) sheets[key] = { id: Object.keys(sheets).length + 1, rows: [['шапка']] };
    return { key, sh: sheets[key], title };
  };
  const maybeFail = (op, id) => { if (fail[id] && fail[id].includes(op)) throw new Error('timeout of 30000ms exceeded'); };

  const g = {
    sheets, log,
    async getValues(id, a1, { formatted = false } = {}) {
      maybeFail('get', id);
      const { sh } = sheetOf(id, a1);
      const range = a1.split('!')[1];
      const m = range.match(/^([A-Z]):([A-Z])$/);
      const from = colIdx(m[1]), to = colIdx(m[2]);
      let rows = sh.rows.map((r) => r.slice(from, to + 1).map((v) => (v == null ? '' : v)));
      void formatted;
      // values.get обрізає порожній хвіст
      while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
      return rows;
    },
    async appendValues(id, a1, rows) {
      maybeFail('append', id);
      const { sh, title } = sheetOf(id, a1);
      const anchor = Number(a1.match(/!A(\d+)$/)[1]);
      if (anchor !== sh.rows.length) throw new Error(`якір append ${anchor} != останній заповнений рядок ${sh.rows.length}`);
      const first = sh.rows.length + 1;
      rows.forEach((r) => sh.rows.push(r.map((v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))));
      log.push(['append', id, title, rows.length]);
      return { updates: { updatedRange: `'${title}'!A${first}:H${first + rows.length - 1}`, updatedRows: rows.length } };
    },
    async sheetIdOf(id, title) { return sheetOf(id, `'${title}'!A1`).sh.id; },
    async batchUpdate(id, requests) {
      maybeFail('batch', id);
      for (const r of requests) {
        if (r.deleteDimension) {
          const { startIndex, endIndex } = r.deleteDimension.range;
          const sh = Object.values(sheets).find((s) => s.id === r.deleteDimension.range.sheetId);
          sh.rows.splice(startIndex, endIndex - startIndex);
          log.push(['delete', startIndex + 1, endIndex]);
        } else if (r.repeatCell) {
          log.push(['format', r.repeatCell.range.startColumnIndex + 1, r.repeatCell.cell.userEnteredFormat.numberFormat.type, r.repeatCell.range.endRowIndex - r.repeatCell.range.startRowIndex]);
        }
      }
      return {};
    },
  };
  return g;
}

// ---------- підмінна база ----------
const STORE = {
  id: 'test-e1', label: 'ТЕСТ e1', route: 'Харьков-17', routeNbhz: 'Новые Дома 2', zone: 'Новые дома',
  addrBread: 'м Харків вул Бучми 32', addrNbhz: 'Бучми 32 НБ', addrBakery: 'м. Харків вул. Танкопія, 16', addrVeg: 'м. Харків пров. Тарасівський, 10',
  directions: ['bread', 'nbhz', 'bakery', 'veg'], days: { veg: [], bakery: [] },
};
const STORE2 = { ...STORE, id: 'test-e2', label: 'ТЕСТ e2', addrBread: 'м Харків вул Інша 5', addrBakery: 'м. Харків вул. Інша, 5', addrVeg: 'м. Харків вул. Інша, 5', addrNbhz: 'Інша 5 НБ' };

let seq = 0;
function order(over = {}) {
  seq++;
  return {
    id: 'id-' + seq, order_id: 'o-' + seq, dir: 'bread', store_id: STORE.id, order_date: DAY, status: 'active', is_addon: false,
    created_at: '2026-10-19T12:54:08+03:00', changed_at: '2026-10-19T12:54:08+03:00', exported_at: null,
    lines: [
      { line_no: 1, barcode: '4820041526446', name: 'Пиріжок зі смородиною 0,075кг', price: 12.48, qty: 3 },
      { line_no: 2, barcode: '4820041525098', name: 'Хліб Орільський 1/2 нарізаний 0,275 кг', price: 14.76, qty: 2 },
    ],
    ...over,
  };
}

function makeData(orders, stores = [STORE, STORE2]) {
  const d = {
    orders,
    async exportSnapshot(dir) {
      const dirty = (o) => o.dir === dir && (!o.exported_at || Date.parse(o.exported_at) < Date.parse(o.changed_at));
      const keys = new Set(orders.filter(dirty).map((o) => o.store_id + '|' + o.order_date));
      return { orders: orders.filter((o) => o.dir === dir && keys.has(o.store_id + '|' + o.order_date)), stores };
    },
    async markExported(items) {
      items.forEach((it) => { orders.find((o) => o.id === it.id).exported_at = it.exported_at; });
    },
  };
  return d;
}

const ID = { bread: 'T-TEST', nbhz: 'T-TEST', bakery: 'T-TEST', veg: 'T-TEST' };
function envOf(orders, google, over = {}) {
  return { data: makeData(orders), google, target: { mode: 'test', spreadsheetId: () => 'T-TEST' }, at: AT, ...over };
}
const rowsOf = (g, dir, id = 'T-TEST') => g.sheets[id + '|' + DIRECTIONS[dir].rawSheet].rows.slice(1);
void ID;

// ---------- формат рядків (rawRow з Config.gs) ----------
test('bread: рядки у форматі rawRow, exported_at поставлено, формат як fixAppendedFormatApi_', async () => {
  const g = makeGoogle();
  const o = order();
  const r = await exportDir('bread', envOf([o], g));
  assert.deepEqual(r, { written: 2, deleted: 0, skipped: 0 });
  assert.deepEqual(rowsOf(g, 'bread'), [
    [DMY, 'Харьков-17', 'Бучми 32', '4820041526446', 'Пиріжок зі смородиною 0,075кг', 12.48, 3],
    [DMY, 'Харьков-17', 'Бучми 32', '4820041525098', 'Хліб Орільський 1/2 нарізаний 0,275 кг', 14.76, 2],
  ].map((x) => { x[2] = require('../src/rules').shortenAddress(STORE.addrBread); return x; }));
  assert.equal(o.exported_at, o.changed_at, 'exported_at = версія changed_at, що вигружена');
  const fmt = g.log.filter((l) => l[0] === 'format');
  assert.deepEqual(fmt, [['format', 1, 'DATE', 2], ['format', 4, 'TEXT', 2]], 'дата і штрихкод текстом (колонка B - маршрут, не час)');
});

test('bread/nbhz: штрихкод пишеться з апострофом, порожній - без', async () => {
  const g = makeGoogle();
  const seen = [];
  const orig = g.appendValues;
  g.appendValues = async (id, a1, rows) => { seen.push(rows); return orig(id, a1, rows); };
  const o = order({ dir: 'nbhz', lines: [{ line_no: 1, barcode: '', name: 'Хліб Гусарик 0,450г', price: 0, qty: 1 }, { line_no: 2, barcode: '482', name: 'X', price: 1, qty: 1 }] });
  await exportDir('nbhz', envOf([o], g));
  assert.equal(seen[0][0][3], '');
  assert.equal(seen[0][1][3], "'482");
  assert.equal(rowsOf(g, 'nbhz')[0][1], 'Новые Дома 2', 'маршрут НБХЗ - routeNbhz');
});

test('bakery: дата, час (Київ, з created_at), повна адреса, зона, штрихкод, назва, ціна, кількість; формат дати, часу, штрихкоду', async () => {
  const g = makeGoogle();
  const o = order({ dir: 'bakery', lines: [{ line_no: 1, barcode: '2938080086820', name: 'Кулінарія Борщ український 0,450гр', price: 48, qty: 2 }] });
  await exportDir('bakery', envOf([o], g));
  assert.deepEqual(rowsOf(g, 'bakery'), [[DMY, '12:54:08', STORE.addrBakery, 'Новые дома', '2938080086820', 'Кулінарія Борщ український 0,450гр', 48, 2]]);
  assert.deepEqual(g.log.filter((l) => l[0] === 'format'), [['format', 1, 'DATE', 1], ['format', 2, 'TIME', 1], ['format', 5, 'TEXT', 1]]);
});

test('veg: дата, час, адреса, назва, ціна, кількість, сума в G; без форматування штрихкоду', async () => {
  const g = makeGoogle();
  const o = order({ dir: 'veg', lines: [{ line_no: 1, barcode: '', name: 'Помідор рожевий', price: 88, qty: 1.5 }, { line_no: 2, barcode: '', name: 'Яблуко Україна', price: 28.1, qty: 3 }] });
  await exportDir('veg', envOf([o], g));
  assert.deepEqual(rowsOf(g, 'veg'), [
    [DMY, '12:54:08', STORE.addrVeg, 'Помідор рожевий', 88, 1.5, 132],
    [DMY, '12:54:08', STORE.addrVeg, 'Яблуко Україна', 28.1, 3, 84.3],
  ]);
  assert.deepEqual(g.log.filter((l) => l[0] === 'format').map((l) => l[1]), [1, 2]);
});

test('rawRowOf: ціна × кількість для veg округлюється до копійок', () => {
  const ctx = { dateStr: DMY, timeStr: '10:00:00', address: 'A', shortAddress: 'A', route: '', store: STORE };
  assert.equal(rawRowOf('veg', ctx, { name: 'x', price: 0.1, qty: 3 })[6], 0.3);
});

// ---------- ідемпотентність ----------
test('повтор після «вбитого» прогону (рядки в листі, позначки нема) -> рядків не побільшало, позначка ставиться', async () => {
  const g = makeGoogle();
  const o = order();
  await exportDir('bread', envOf([o], g));
  const before = JSON.stringify(rowsOf(g, 'bread'));
  o.exported_at = null;                                    // «вбили» процес до позначки
  const r = await exportDir('bread', envOf([o], g));
  assert.deepEqual(r, { written: 0, deleted: 0, skipped: 1 });
  assert.equal(JSON.stringify(rowsOf(g, 'bread')), before);
  assert.equal(o.exported_at, o.changed_at);
});

test('частково записане (є 1 з 2 рядків) -> дописується лише відсутній', async () => {
  const g = makeGoogle();
  const o = order();
  await exportDir('bread', envOf([o], g));
  g.sheets['T-TEST|' + DIRECTIONS.bread.rawSheet].rows.pop();      // зник другий рядок
  o.exported_at = null;
  const r = await exportDir('bread', envOf([o], g));
  assert.equal(r.written, 1);
  assert.equal(rowsOf(g, 'bread').length, 2);
});

test('нічого невигруженого -> нічого не читається і не пишеться', async () => {
  const g = makeGoogle();
  const o = order({ exported_at: '2026-10-19T12:54:08+03:00' });
  const r = await exportDir('bread', envOf([o], g));
  assert.deepEqual(r, { written: 0, deleted: 0, skipped: 0 });
  assert.deepEqual(g.log, []);
});

test('добавка з тими самими позиціями, що й основне: дописується (множина рахується по групі)', async () => {
  const g = makeGoogle();
  const main = order();
  await exportDir('bread', envOf([main], g));
  const addon = order({ is_addon: true, created_at: '2026-10-19T16:30:00+03:00', changed_at: '2026-10-19T16:30:00+03:00' });
  const r = await exportDir('bread', envOf([main, addon], g));
  assert.deepEqual(r, { written: 2, deleted: 0, skipped: 0 });
  assert.equal(rowsOf(g, 'bread').length, 4);
  const r2 = await exportDir('bread', envOf([main, { ...addon, exported_at: null }], g));
  assert.equal(r2.written, 0, 'повторний прогін добавки не дублює');
  assert.equal(rowsOf(g, 'bread').length, 4);
});

// ---------- скасування і зміни ----------
test('скасоване після вигрузки -> рядки точки за день видалено, інші точки й дні не чіпані', async () => {
  const g = makeGoogle();
  const a = order(), b = order({ store_id: STORE2.id }), prevDay = order({ order_date: '2026-10-18' });
  await exportDir('bread', envOf([a, b, prevDay], g));
  assert.equal(rowsOf(g, 'bread').length, 6);
  a.status = 'cancelled'; a.changed_at = '2026-10-19T13:10:00+03:00';
  const r = await exportDir('bread', envOf([a, b, prevDay], g));
  assert.deepEqual(r, { written: 0, deleted: 2, skipped: 0 });
  const left = rowsOf(g, 'bread');
  assert.equal(left.length, 4);
  assert.ok(left.filter((x) => x[0] === DMY).every((x) => x[2].toLowerCase().includes('інша')), 'сьогодні лишилась лише друга точка');
  assert.equal(left.filter((x) => x[0] === '18.10.2026').length, 2, 'вчорашній день не чіпано');
  assert.equal(a.exported_at, a.changed_at);
});

test('видалення йде знизу вгору відрізками (deleteDimension), сусідні рядки склеєні', async () => {
  const g = makeGoogle();
  const a = order(), b = order({ store_id: STORE2.id }), a2 = order({ is_addon: true, created_at: '2026-10-19T16:00:00+03:00', changed_at: '2026-10-19T16:00:00+03:00' });
  await exportDir('bread', envOf([a, b], g));
  await exportDir('bread', envOf([a, b, a2], g));            // рядки: a(2), b(2), a2(2) -> у листі a в рядках 2-3 і 6-7
  g.log.length = 0;
  a.status = 'cancelled'; a.changed_at = '2026-10-19T17:00:00+03:00';
  a2.status = 'cancelled'; a2.changed_at = '2026-10-19T17:00:00+03:00';
  await exportDir('bread', envOf([a, b, a2], g));
  assert.deepEqual(g.log.filter((l) => l[0] === 'delete'), [['delete', 6, 7], ['delete', 2, 3]]);
  assert.equal(rowsOf(g, 'bread').length, 2);
});

test('replace: старе скасовано + нове active -> у листі лише нові рядки точки', async () => {
  const g = makeGoogle();
  const old = order();
  await exportDir('bread', envOf([old], g));
  old.status = 'cancelled'; old.changed_at = '2026-10-19T17:00:00+03:00';
  const fresh = order({ lines: [{ line_no: 1, barcode: '1', name: 'Новий товар', price: 10, qty: 5 }], created_at: '2026-10-19T17:00:00+03:00', changed_at: '2026-10-19T17:00:00+03:00' });
  const r = await exportDir('bread', envOf([old, fresh], g));
  assert.deepEqual(r, { written: 1, deleted: 2, skipped: 0 });
  assert.deepEqual(rowsOf(g, 'bread').map((x) => x[4]), ['Новий товар']);
});

test('змінене після вигрузки (exported_at < changed_at, active) -> рядки точки перебудовано', async () => {
  const g = makeGoogle();
  const o = order();
  await exportDir('bread', envOf([o], g));
  o.lines = [{ line_no: 1, barcode: '1', name: 'Інша позиція', price: 10, qty: 7 }];
  o.changed_at = '2026-10-19T14:00:00+03:00';
  const r = await exportDir('bread', envOf([o], g));
  assert.deepEqual(r, { written: 1, deleted: 2, skipped: 0 });
  assert.deepEqual(rowsOf(g, 'bread').map((x) => [x[4], x[6]]), [['Інша позиція', 7]]);
  assert.equal(o.exported_at, o.changed_at);
});

test('скасоване і ніколи не вигружене -> у лист не пишемо, лише позначка', async () => {
  const g = makeGoogle();
  const o = order({ status: 'cancelled' });
  const r = await exportDir('bread', envOf([o], g));
  assert.deepEqual(r, { written: 0, deleted: 0, skipped: 1 });
  assert.equal(o.exported_at, o.changed_at);
  assert.equal(rowsOf(g, 'bread').length, 0);
});

test('рядки іншого дня тієї ж адреси не чіпаються при скасуванні', async () => {
  const g = makeGoogle();
  const yesterday = order({ order_date: '2026-10-18', exported_at: '2026-10-18T10:00:00+03:00', changed_at: '2026-10-18T10:00:00+03:00' });
  const sheet = DIRECTIONS.bread.rawSheet;
  g.sheets['T-TEST|' + sheet] = { id: 9, rows: [['шапка'], ['18.10.2026', 'Харьков-17', require('../src/rules').shortenAddress(STORE.addrBread), '1', 'вчора', 1, 1]] };
  const today = order();
  await exportDir('bread', envOf([yesterday, today], g));
  today.status = 'cancelled'; today.changed_at = '2026-10-19T13:00:00+03:00';
  await exportDir('bread', envOf([yesterday, today], g));
  assert.deepEqual(rowsOf(g, 'bread').map((x) => x[4]), ['вчора']);
});

// ---------- збої Google, паралельність ----------
test('Google кидає тайм-аут на bakery -> bread вигружено, bakery невигружений, наступний прогін дописує', async () => {
  const g = makeGoogle({ fail: {} });
  const orders = [order({ dir: 'bread' }), order({ dir: 'bakery', lines: [{ line_no: 1, barcode: '1', name: 'Борщ', price: 48, qty: 2 }] })];
  // «bakery» висить: помилка на append для його вкладки
  const orig = g.appendValues;
  let down = true;
  g.appendValues = async (id, a1, rows) => {
    if (down && a1.includes(DIRECTIONS.bakery.rawSheet)) throw new Error('timeout of 30000ms exceeded');
    return orig(id, a1, rows);
  };
  const env = envOf(orders, g);
  const res = await exportAll(env);
  assert.equal(res.bread.written, 2);
  assert.match(res.bakery.error, /timeout/);
  assert.equal(orders[0].exported_at, orders[0].changed_at);
  assert.equal(orders[1].exported_at, null, 'bakery лишився невигруженим');
  down = false;
  const res2 = await exportAll(env);
  assert.deepEqual([res2.bread.written, res2.bakery.written], [0, 1]);
  assert.equal(orders[1].exported_at, orders[1].changed_at);
});

test('два exportDir одного напрямку одночасно -> мʼютекс, рядки не дублюються', async () => {
  const g = makeGoogle();
  const orig = g.appendValues;
  g.appendValues = async (...a) => { await new Promise((r) => setTimeout(r, 30)); return orig(...a); };
  const o = order();
  const env = envOf([o], g);
  const [r1, r2] = await Promise.all([exportDir('bread', env), exportDir('bread', env)]);
  assert.equal(r1.written + r2.written, 2);
  assert.equal(rowsOf(g, 'bread').length, 2);
});

test('exportAll: усі напрямки; помилка одного не ламає інші; вигрузка пропускається, якщо нічого немає', async () => {
  const g = makeGoogle();
  const res = await exportAll(envOf([], g));
  assert.deepEqual(Object.keys(res), ['bread', 'nbhz', 'bakery', 'veg']);
  assert.ok(Object.values(res).every((r) => r.written === 0 && !r.error));
});

// ---------- ціль вигрузки ----------
test('EXPORT_TARGET: за замовчуванням test; тестова таблиця не збігається з жодною бойовою; live лише при точному "live"', () => {
  assert.equal(exportTargetMode({}), 'test');
  assert.equal(exportTargetMode({ EXPORT_TARGET: '' }), 'test');
  assert.equal(exportTargetMode({ EXPORT_TARGET: 'LIVE ' }), 'test');
  assert.equal(exportTargetMode({ EXPORT_TARGET: 'live' }), 'live');
  const t = resolveTarget('test');
  const live = resolveTarget('live');
  for (const k of Object.keys(DIRECTIONS)) {
    assert.equal(t.spreadsheetId(k), TEST_EXPORT_SPREADSHEET_ID);
    assert.equal(live.spreadsheetId(k), DIRECTIONS[k].spreadsheetId);
    assert.notEqual(t.spreadsheetId(k), DIRECTIONS[k].spreadsheetId);
  }
  assert.match(TEST_EXPORT_SPREADSHEET_ID, /^[A-Za-z0-9_-]{30,}$/);
});

test('у режимі test усі записи йдуть у тестову таблицю, у бойові id Google не звертається', async () => {
  const g = makeGoogle();
  const calls = [];
  for (const m of ['getValues', 'appendValues', 'batchUpdate', 'sheetIdOf']) {
    const orig = g[m];
    g[m] = async (id, ...a) => { calls.push(id); return orig(id, ...a); };
  }
  const orders = ['bread', 'nbhz', 'bakery', 'veg'].map((dir) => order({ dir }));
  await exportAll({ data: makeData(orders), google: g, target: resolveTarget('test'), at: AT });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((id) => id === TEST_EXPORT_SPREADSHEET_ID), [...new Set(calls)].join(','));
});

// ---------- черга з дебаунсом ----------
test('queueExport: кілька викликів за 2 с -> один запуск на напрямок через 2 с; інші напрямки окремо', async () => {
  const timers = [];
  const ran = [];
  const q = createExportQueue({ run: async (dir) => { ran.push(dir); }, delayMs: 2000, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  q('bread'); q('bread'); q('bread'); q('veg');
  assert.deepEqual(timers.map((t) => t.ms), [2000, 2000]);
  assert.deepEqual(ran, []);
  timers.forEach((t) => t.fn());
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ran, ['bread', 'veg']);
  q('bread');                                               // після запуску можна планувати знову
  assert.equal(timers.length, 3);
});

test('queueExport: помилка запуску логується і не валить процес; наступний виклик планується', async () => {
  const timers = [];
  const orig = console.error; const errs = []; console.error = (m) => errs.push(String(m));
  try {
    const q = createExportQueue({ run: async () => { throw new Error('google down'); }, delayMs: 1, setTimer: (fn) => { timers.push(fn); return 1; } });
    q('bread');
    timers[0]();
    await new Promise((r) => setImmediate(r));
    assert.ok(errs.some((e) => e.includes('google down')));
    q('bread');
    assert.equal(timers.length, 2);
  } finally { console.error = orig; }
});

// ---------- POST /jobs/tick ----------
async function withTick(opts, fn) {
  const server = createApp({ api: async () => ({}), ...opts }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('POST /jobs/tick: без/з неправильним x-jobs-secret -> 403, нічого не запускається; з правильним -> результат', async () => {
  let runs = 0;
  const tick = async () => { runs++; return { export: { bread: { written: 1, deleted: 0, skipped: 0 } }, mail: { sent: 0, failed: 0, skipped: 0 } }; };
  await withTick({ tick, jobsSecret: 's3cret' }, async (base) => {
    assert.equal((await fetch(base + '/jobs/tick', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': 'wrong' } })).status, 403);
    assert.equal((await fetch(base + '/jobs/tick', { method: 'GET', headers: { 'x-jobs-secret': 's3cret' } })).status, 404);
    assert.equal(runs, 0);
    const ok = await fetch(base + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': 's3cret' } });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.ok, true);
    assert.equal(j.export.bread.written, 1);
    assert.equal(runs, 1);
  });
});

test('POST /jobs/tick: JOBS_SECRET не задано -> 503 (не відкритий для всіх)', async () => {
  await withTick({ tick: async () => ({}), jobsSecret: '' }, async (base) => {
    assert.equal((await fetch(base + '/jobs/tick', { method: 'POST', headers: { 'x-jobs-secret': '' } })).status, 503);
  });
});
