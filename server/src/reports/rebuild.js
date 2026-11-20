// Перебудова звітів напрямків з бази в таблицю-ціль (EXPORT_TARGET). Аналог refreshBakeryReports / refreshBreadReports /
// refreshVegReports / refreshNbhzExport (Apps Script): кожні 5 хв там, тут - з дебаунсом 30 с після вигрузки напрямку і в tick.
//   env = { data: { reportSnapshot }, google: { sheetMeta, batchUpdate, sheetList, [sheetDims, copySheetTo, getValues] }, target, at, archive? }
// Сигнатура змісту (рядки + довідник + асортимент) тримається в памʼяті процесу: tick не пише в Google, якщо нічого не змінилось
// і всі листи на місці. Лист, якого нема (видалили), перебудовується попри однакову сигнатуру.
const crypto = require('node:crypto');
const R = require('../rules');
const bakery = require('./bakery');
const bread = require('./bread');
const veg = require('./veg');
const nbhz = require('./nbhz');
const { rowsFromOrders } = require('./rows');
const { writeSheet } = require('./sheetWriter');
const { archiveDaily } = require('./nbhzArchive');

const DIRS = ['bakery', 'bread', 'veg', 'nbhz'];
const lastSig = {};          // spreadsheetId|dir -> сигнатура останньої перебудови
const running = {};          // spreadsheetId|dir -> проміс поточної перебудови (одна на напрямок одночасно)
const linkDay = {};          // spreadsheetId -> день, коли лист «Завантаження» хліба писався повністю

// Назва листа «Завантаження» НБХЗ: у бойовій таблиці НБХЗ вона своя, а в тестовій усі напрямки в одній книзі,
// де «Завантаження» вже займає хліб, - тому там «Завантаження НБХЗ».
const nbhzLinkName = (env) => (env.target.mode === 'live' ? nbhz.NBHZ_LINK_SHEET : nbhz.NBHZ_LINK_SHEET + ' НБХЗ');
const dmyOfDay = (day) => day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);

// Які листи напрямок веде (для перевірки «лист на місці»)
const SHEETS = {
  bakery: () => [bakery.BAKERY_ORDERS_SHEET, bakery.BAKERY_SUMMARY_SHEET, bakery.BAKERY_ROUTE_SHEET],
  bread: () => [bread.BREAD_ORDERS_SHEET, bread.BREAD_SUMMARY_SHEET, bread.BREAD_DOWNLOAD_SHEET],
  veg: () => [veg.VEG_ORDERS_SHEET, veg.VEG_SUMMARY_SHEET],
  nbhz: (env, day) => ['Вивантаження ' + dmyOfDay(day), nbhzLinkName(env)],
};

const projStore = (s) => [s.id, s.label, s.address, s.code, s.edrpou, s.zone, s.route, s.routeNbhz, s.addrBread, s.addrBakery, s.addrVeg, s.addrNbhz, s.directions, s.days];
const sizeOf = (plan) => ({ rows: plan.data.length, cols: plan.width });

async function writePlans(env, id, plans) {
  const sheets = [], sizes = {}, ids = {};
  for (const name of Object.keys(plans)) {
    ids[name] = (await writeSheet(env.google, id, name, plans[name])).sheetId;
    sheets.push(name); sizes[name] = sizeOf(plans[name]);
  }
  return { sheets, sizes, ids, plans };
}

async function writeBakery(env, id, rows, snap) {
  const { sheets, sizes, plans } = await writePlans(env, id, bakery.buildBakeryReports(rows, { stores: snap.stores, products: snap.products, now: env.at }));
  return { sheets, sizes, plans };
}

async function writeBread(env, id, rows, snap, day) {
  const { sheets, sizes, ids, plans } = await writePlans(env, id, bread.buildBreadReports(rows, { stores: snap.stores, now: env.at }));
  const out = { sheets, sizes, plans };
  // лист «Завантаження» (Export.gs): повний раз на день, далі лише час збирання; збій не ламає звіти
  try {
    const meta = await env.google.sheetMeta(id, bread.BREAD_DOWNLOAD_SHEET);
    if (!meta || linkDay[id] !== day) {
      const plan = bread.breadDownloadPlan({ spreadsheetId: id, ordersGid: ids[bread.BREAD_ORDERS_SHEET], summaryGid: ids[bread.BREAD_SUMMARY_SHEET], now: env.at });
      await writeSheet(env.google, id, bread.BREAD_DOWNLOAD_SHEET, plan);
      sizes[bread.BREAD_DOWNLOAD_SHEET] = sizeOf(plan);
      plans[bread.BREAD_DOWNLOAD_SHEET] = plan;
    } else {
      await env.google.batchUpdate(id, bread.breadDownloadStampRequests(meta.properties.sheetId, env.at));
      sizes[bread.BREAD_DOWNLOAD_SHEET] = { rows: 9, cols: 1 };
    }
    linkDay[id] = day;
    sheets.push(bread.BREAD_DOWNLOAD_SHEET);
  } catch (e) {
    console.error('Завантаження (хліб): ' + e.message);
    out.downloadError = e.message;
  }
  return out;
}

// Овочі: основні листи показують лише СЬОГОДНІ і першим tick-ом наступного ранку перебудовуються на новий день. Постачальник
// дивиться звіт уранці в день доставки (інцидент 19.11.2026: замовлення середи «зникли» у четвер о 7:00, лишились лише в сирому).
// Тому кожна збірка дня із замовленнями пише ще й датовані копії «<лист> ДД.ММ.РРРР» (дата замовлення); день без замовлень (усе
// скасовано) прибирає свою датовану копію; копії старші за VEG_DATED_KEEP_DAYS видаляються. Збій датованих листів основні не ламає.
const VEG_DATED_KEEP_DAYS = 7;
const VEG_YESTERDAY_UNTIL_H = 12;     // до 12:00 за Києвом основні листи овочів без сьогоднішніх замовлень показують вчорашні
const VEG_DATED_RE = new RegExp('^(' + [veg.VEG_ORDERS_SHEET, veg.VEG_SUMMARY_SHEET].join('|') + ') (\\d{2})\\.(\\d{2})\\.(\\d{4})$');
const dayNumOf = (y, m, d) => Date.UTC(+y, +m - 1, +d) / 86400000;

async function vegDated(env, id, rows, plans, day) {
  const dmy = dmyOfDay(day);
  const names = [veg.VEG_ORDERS_SHEET, veg.VEG_SUMMARY_SHEET];
  const written = [];
  if (rows.length) {
    for (const n of names) { await writeSheet(env.google, id, n + ' ' + dmy, plans[n]); written.push(n + ' ' + dmy); }
  }
  const today = dayNumOf(day.slice(0, 4), day.slice(5, 7), day.slice(8, 10));
  const drop = (await env.google.sheetList(id)).filter((s) => {
    const m = String(s.title).match(VEG_DATED_RE);
    if (!m) return false;
    const age = Math.round(today - dayNumOf(m[4], m[3], m[2]));
    return age >= VEG_DATED_KEEP_DAYS || (age === 0 && !rows.length);
  });
  if (drop.length) await env.google.batchUpdate(id, drop.map((s) => ({ deleteSheet: { sheetId: s.sheetId } })));
  return { written, removed: drop.map((s) => s.title) };
}

async function writeVeg(env, id, rows, snap, day) {
  const dayAt = day === R.kyivNow(env.at).day ? null : new Date(day + 'T12:00:00Z');
  const { sheets, sizes, plans } = await writePlans(env, id, veg.buildVegReports(rows, { stores: snap.stores, now: env.at, dayAt }));
  const out = { sheets, sizes, plans };
  // показ учорашніх (dayAt): датовану копію вчора вже записала збірка того дня - не переписуємо її з червоним «доставка СЬОГОДНІ»
  if (!dayAt) {
    try { out.dated = await vegDated(env, id, rows, plans, day); }
    catch (e) { console.error('Овочі, датовані листи: ' + e.message); out.datedError = e.message; }
  }
  return out;
}

async function writeNbhz(env, id, rows, snap, day) {
  // старі листи «Вивантаження дд.мм.рррр» -> таблиця-архів, раз на день; помилка не ламає вигрузку
  const archive = await archiveDaily({ google: env.google, spreadsheetId: id, archiveId: env.archive && env.archive.spreadsheetId, day });
  const exp = nbhz.buildNbhzExport(rows, { stores: snap.stores, products: snap.products, now: env.at });
  const { sheetId } = await writeSheet(env.google, id, exp.name, exp.plan);
  const linkName = nbhzLinkName(env);
  const link = nbhz.nbhzLinkPlan({ spreadsheetId: id, gid: sheetId, now: env.at });
  await writeSheet(env.google, id, linkName, link);
  return { sheets: [exp.name, linkName], sizes: { [exp.name]: sizeOf(exp.plan), [linkName]: sizeOf(link) }, plans: { [exp.name]: exp.plan, [linkName]: link }, archive };
}

// Запис звітів напрямку з уже готових робочих рядків (rows) і довідника (snap = { stores, products }) у таблицю id.
// Спільна для перебудови з бази (rebuildLocked) і для тіньового прогону з бойових сирих рядків (shadow.js).
function writeDir(dir, env, id, rows, snap, day) {
  return dir === 'bakery' ? writeBakery(env, id, rows, snap)
    : dir === 'bread' ? writeBread(env, id, rows, snap, day)
    : dir === 'veg' ? writeVeg(env, id, rows, snap, day)
    : writeNbhz(env, id, rows, snap, day);
}

async function sheetsOnPlace(env, id, names) {
  if (!env.google.sheetList) return true;
  const have = new Set((await env.google.sheetList(id)).map((s) => s.title));
  return names.every((n) => have.has(n));
}

async function rebuildLocked(dir, env, { force }) {
  const k = R.kyivNow(env.at);
  const day = k.day;
  // refreshNbhzExport: вночі (до 6:00 і після 20:59) не смикаємо
  if (dir === 'nbhz' && !force && (k.hh < 6 || k.hh > 20)) return { skipped: 'ніч', rows: 0 };

  let snap = await env.data.reportSnapshot(dir, day);
  let rows = rowsFromOrders(dir, snap.orders, snap.orderStores, day);
  // Овочі: доставка - наступного дня, постачальник дивиться звіт уранці в день доставки. Поки за сьогодні нема жодного замовлення
  // овочів, основні листи показують ВЧОРАШНІ замовлення (дата в заголовку); перше замовлення дня перемикає на сьогодні.
  // Інцидент 19.11.2026: о 7:06 звіт перебудувався на четвер (порожній), замовлення середи лишились лише в сирому листі.
  // Лише до VEG_YESTERDAY_UNTIL_H (ранок дня доставки): пізніше вчорашні можна прийняти за замовлення на завтра і повезти вдруге
  // (середа вдень до перших замовлень, четвер увечері) - тоді лист порожній з підказкою про датовані листи.
  let reportDay = day;
  if (dir === 'veg' && !rows.length && k.hh < VEG_YESTERDAY_UNTIL_H) {
    const y = R.kyivNow(new Date(Date.parse(day + 'T12:00:00Z') - 86400000)).day;
    const ySnap = await env.data.reportSnapshot(dir, y);
    const yRows = rowsFromOrders(dir, ySnap.orders, ySnap.orderStores, y);
    if (yRows.length) { reportDay = y; snap = ySnap; rows = yRows; }
  }
  const spreadsheetId = env.target.spreadsheetId(dir);
  // Немає замовлень за день (вихідний, усе скасовано) - звіт будується порожнім («ще немає»), а не пропускається: інакше після
  // скасування останнього замовлення в листах лишились би вчорашні/скасовані рядки. Apps Script тут виходив (refreshBakeryReports:
  // if (!rows.length) return) - щоб не брати глобальний замок; на сервері замка нема, а сигнатура з датою пише порожній звіт раз.

  const sig = crypto.createHash('sha1').update(JSON.stringify([day, reportDay, rows, snap.stores.map(projStore),
    (snap.products || []).map((p) => [p.name, p.status, p.category])])).digest('hex');
  const key = spreadsheetId + '|' + dir;
  if (!force && lastSig[key] === sig && await sheetsOnPlace(env, spreadsheetId, SHEETS[dir](env, day))) return { skipped: 'без змін', rows: rows.length };

  const { sizes, plans, ...res } = await writeDir(dir, env, spreadsheetId, rows, snap, reportDay);
  lastSig[key] = sig;                                  // лише після успіху всіх листів
  if (env.markReport) { try { await env.markReport(dir, env.at); } catch (e) { console.error('час збирання звіту ' + dir + ': ' + e.message); } }   // markReport_ -> settings report_at_<dir>
  return { rows: rows.length, ...res, ...(reportDay !== day ? { reportDay } : {}), target: env.target.mode };
}

// force - перебудувати навіть без змін (ручний запуск)
function rebuildReports(dir, env, { force = false } = {}) {
  if (!DIRS.includes(dir)) throw new Error('невідомий напрямок звіту: ' + dir);
  const key = env.target.spreadsheetId(dir) + '|' + dir;
  const prev = running[key] || Promise.resolve();
  const next = prev.catch(() => {}).then(() => rebuildLocked(dir, env, { force }));
  running[key] = next.catch(() => {});
  return next;
}
const rebuildBakeryReports = (env, o) => rebuildReports('bakery', env, o);

// Усі напрямки по черзі; збій одного не зупиняє інші: { bakery: {...}, bread: { error } ... }
async function rebuildAllReports(env, o) {
  const out = {};
  for (const dir of DIRS) {
    try { out[dir] = await rebuildReports(dir, env, o); }
    catch (e) { out[dir] = { error: e.message }; console.error(`звіти ${dir}: ${e.message}`); }
  }
  return out;
}

// Після вигрузки напрямку - поставити перебудову його звітів у чергу (черга з дебаунсом: десятки замовлень = одна перебудова)
function exportThenReports(exportFn, queueReports) {
  return async (dir) => {
    const res = await exportFn(dir);
    if (DIRS.includes(dir)) queueReports(dir);
    return res;
  };
}

module.exports = { DIRS, SHEETS, nbhzLinkName, writeDir, rebuildReports, rebuildBakeryReports, rebuildAllReports, exportThenReports };
