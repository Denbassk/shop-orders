// Excel «Звіт за період»: окремі аркуші по точках, товарах, продавцях, категоріях і юрособах (+ аркуш «Підсумок»).
// Дані - ті самі рядки таблиць списань юросіб, що читає вкладка «Списання» (src/buyer/writeoffs.js), лише читання.
// Фільтри ті самі, що на вкладці: період (пресет days або from/to), юрособа, категорія. Рядок групи - підсумок, нижче - з чого він складається.
const R = require('../rules');
const { packXlsx, S, r2, r3, uk, dmyOf, validDay, shiftDay, ReportError } = require('./woReport');

const TITLE = 'Списання випічки і кулінарії';
const NO_COST = ' (без собівартості)', PART_COST = ' (частково без собівартості)';
const storeKey = (x) => x.store + (x.code ? ' · №' + x.code : '');
// group - у що групуємо, item - з чого складається група
const SLICES = [
  { key: 'stores', sheet: 'Точки', nameHead: 'Точка', note: 'Склад кожної точки - товари', group: storeKey, item: (x) => x.name },
  { key: 'products', sheet: 'Товари', nameHead: 'Товар', note: 'Склад кожного товару - точки, де його списали', group: (x) => x.name, item: storeKey },
  { key: 'sellers', sheet: 'Продавці', nameHead: 'Продавець · точка', note: 'Склад кожного рядка - товари, які списав продавець', group: (x) => x.seller + ' · ' + x.store, item: (x) => x.name },
  { key: 'cats', sheet: 'Категорії', nameHead: 'Категорія', note: 'Склад кожної категорії - товари', group: (x) => x.cat, item: (x) => x.name },
  { key: 'entities', sheet: 'Юрособи', nameHead: 'Юрособа', note: 'Склад кожної юрособи - категорії', group: (x) => x.entity, item: (x) => x.cat },
];
const HEAD = ['№', null, 'Списано, шт', 'Подач', 'Собівартість, грн', 'З націнкою, грн', 'Частка, %'];
const WIDTHS = [5, 58, 13, 9, 17, 17, 11];

const isZero = (x) => x.qty > 0 && !(x.sum > 0);   // позиція без собівартості: кількість є, сума 0

function groupBy(rows, key, itemKey, totalSum) {
  const m = new Map();
  for (const x of rows) {
    const k = key(x);
    let g = m.get(k);
    if (!g) m.set(k, g = { name: k, qty: 0, sum: 0, sum20: 0, docs: new Set(), items: new Map() });
    g.qty += x.qty; g.sum += x.sum; g.sum20 += x.sum20; g.docs.add(x.id);
    const ik = itemKey(x);
    let it = g.items.get(ik);
    if (!it) g.items.set(ik, it = { name: ik, qty: 0, sum: 0, sum20: 0, docs: new Set(), rows: 0, zero: 0 });
    it.qty += x.qty; it.sum += x.sum; it.sum20 += x.sum20; it.docs.add(x.id); it.rows++; if (isZero(x)) it.zero++;
  }
  const byName = (a, b) => b.sum - a.sum || uk(a.name, b.name);
  return [...m.values()].sort(byName).map((g) => ({
    name: g.name, qty: r3(g.qty), sum: r2(g.sum), sum20: r2(g.sum20), docs: g.docs.size, share: totalSum > 0 ? g.sum / totalSum : 0,
    items: [...g.items.values()].sort(byName).map((it) => ({ name: it.name, qty: r3(it.qty), sum: r2(it.sum), sum20: r2(it.sum20), docs: it.docs.size,
      cost: !it.zero ? 'ok' : it.zero === it.rows ? 'none' : 'part' })),
  }));
}

// rows - рядки parseRows (writeoffs.js) вже відфільтровані за період/юрособу/категорію
function buildSlices(rows, { from, to, entity = '', cat = '' }) {
  const f = rows || [];
  if (!f.length) return null;
  const tot = f.reduce((a, x) => { a.qty += x.qty; a.sum += x.sum; a.sum20 += x.sum20; return a; }, { qty: 0, sum: 0, sum20: 0 });
  const zero = f.filter(isZero);
  const total = { qty: r3(tot.qty), sum: r2(tot.sum), sum20: r2(tot.sum20), docs: new Set(f.map((x) => x.id)).size,
    stores: new Set(f.map((x) => x.store)).size, rows: f.length, zeroRows: zero.length, zeroNames: [...new Set(zero.map((x) => x.name))].sort(uk) };
  return { from, to, entity, cat, total,
    slices: SLICES.map((d) => ({ key: d.key, sheet: d.sheet, nameHead: d.nameHead, note: d.note, groups: groupBy(f, d.group, d.item, tot.sum) })) };
}

const periodText = (r) => (r.from === r.to ? dmyOf(r.from) : dmyOf(r.from) + ' – ' + dmyOf(r.to));
const filtersText = (r) => 'Юрособа: ' + (r.entity || 'усі') + ' · Категорія: ' + (r.cat || 'усі');
const kyivStamp = (at) => { const k = R.kyivNow(at); return k.dmy + ' ' + k.time.slice(0, 5); };

function sliceModel(rep, sl) {
  const T = (t, s = S.def) => ({ t, s }), N = (n, s) => ({ n, s }), E = (s) => ({ s });
  const m = [];
  m.push([T(TITLE + ' - ' + sl.sheet, S.title)]);
  m.push([T('Період: ' + periodText(rep) + ' · ' + filtersText(rep), S.bold)]);
  m.push([T(sl.note + '. Рядок групи - підсумок, нижче - з чого він складається. Частка - від загальної собівартості.', S.ital)]);
  m.push([]);
  m.push(HEAD.map((h, i) => T(i === 1 ? sl.nameHead : h, S.head)));
  sl.groups.forEach((g, i) => {
    m.push([N(i + 1, S.gRank), T(g.name, S.store), N(g.qty, S.gQty), N(g.docs, S.gQty), N(g.sum, S.gMoney), N(g.sum20, S.gMoney), N(g.share, S.gPct)]);
    for (const it of g.items) {
      const mark = it.cost === 'none' ? NO_COST : it.cost === 'part' ? PART_COST : '';
      m.push([E(S.text), T(it.name + mark, it.cost === 'ok' ? S.item : S.itemRed), N(it.qty, S.qty), N(it.docs, S.qty), N(it.sum, S.money), N(it.sum20, S.money), E(S.text)]);
    }
  });
  const t = rep.total;
  m.push([E(S.tText), T('РАЗОМ', S.tText), N(t.qty, S.tQty), N(t.docs, S.tQty), N(t.sum, S.tMoney), N(t.sum20, S.tMoney), N(t.sum > 0 ? 1 : 0, S.tPct)]);
  return m;
}

function summaryModel(rep, at) {
  const T = (t, s = S.def) => ({ t, s }), N = (n, s) => ({ n, s }), t = rep.total;
  const m = [];
  m.push([T(TITLE + ' - звіт за період', S.title)]);
  m.push([T('Період: ' + periodText(rep), S.bold)]);
  m.push([T(filtersText(rep), S.bold)]);
  m.push([T('Сформовано: ' + kyivStamp(at) + ' (за Києвом)', S.ital)]);
  m.push([]);
  m.push([T('Показник', S.head), T('Значення', S.head)]);
  m.push([T('Собівартість, грн (основна сума)', S.kvKey), N(t.sum, S.kvMoney)]);
  m.push([T('З націнкою, грн', S.kvKey), N(t.sum20, S.kvMoney)]);
  m.push([T('Списано, шт', S.kvKey), N(t.qty, S.kvVal)]);
  m.push([T('Подач (документів)', S.kvKey), N(t.docs, S.kvVal)]);
  m.push([T('Точок списували', S.kvKey), N(t.stores, S.kvVal)]);
  m.push([T('Рядків списань', S.kvKey), N(t.rows, S.kvVal)]);
  if (t.zeroRows) m.push([T('Рядків без собівартості (сума 0)', S.kvKey), N(t.zeroRows, S.kvVal)]);
  m.push([]);
  m.push([T('Аркуші', S.bold)]);
  for (const sl of rep.slices) m.push([T(sl.sheet, S.kvKey), T(sl.note, S.def)]);
  m.push([]);
  m.push([T('Як читати', S.bold)]);
  for (const line of [
    '«Списано, шт» - скільки одиниць товару списали.',
    '«Подач» - скільки окремих списань (документів), які надіслали продавці.',
    '«Собівартість, грн» - сума за собівартістю, основна.',
    '«З націнкою, грн» - та сама сума з націнкою (+20%, до 19.10.2026 було +15%; старі рядки не перераховувались).',
    '«Частка, %» - частка групи в загальній собівартості за період.',
  ]) m.push([T(line, S.def)]);
  if (t.zeroNames.length) {
    m.push([]);
    m.push([T('Позиції без собівартості - їхні суми 0, тому підсумки занижені:', S.itemRed)]);
    for (const n of t.zeroNames.slice(0, 30)) m.push([T('• ' + n, S.def)]);
  }
  return m;
}

function buildSlicesXlsx(rep, at = new Date()) {
  const sheets = [{ name: 'Підсумок', model: summaryModel(rep, at), widths: [38, 22] }];
  for (const sl of rep.slices) sheets.push({ name: sl.sheet, model: sliceModel(rep, sl), widths: WIDTHS, freeze: 5, repeat: 5 });
  return packXlsx(sheets);
}

// p: { days | from, to, entity, cat }; deps.load(arch, fresh) -> { list, meta: { books, errors } }; deps.at - «зараз» для тестів
async function slicesReport(dir, p = {}, deps = {}) {
  if (dir !== 'bakery') throw new ReportError('Звіт про списання є лише у випічки і кулінарії');
  const at = deps.at || new Date(), today = R.kyivNow(at).day;
  let from, to;
  if (p.from || p.to) {
    from = String(p.from || p.to); to = String(p.to || p.from);
    if (!validDay(from) || !validDay(to)) throw new ReportError('Невірна дата періоду');
    if (from > to) { const t = from; from = to; to = t; }
    if (to > today) throw new ReportError('Дата періоду у майбутньому');
    if (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z') > 800 * 864e5) throw new ReportError('Період задовгий (до 800 днів)');
  } else {
    const days = [1, 7, 31, 90].includes(+p.days) ? +p.days : 7;
    from = shiftDay(today, days - 1); to = today;
  }
  const entity = String(p.entity || '').trim(), cat = String(p.cat || '').trim();
  const load = deps.load || ((arch, fresh) => require('./writeoffs').loadRows(require('../google'), arch, fresh));
  const { list, meta } = await load(from < shiftDay(today, 30), true);   // старші за 31 день - лише в листі «Архив»
  const books = (meta && meta.books) || [], errors = (meta && meta.errors) || [];
  if (errors.length) throw new ReportError('Не вдалося прочитати списання: ' + errors.join('; '));
  if (entity && !books.includes(entity)) throw new ReportError('Невідома юрособа: ' + entity);
  const rows = (list || []).filter((x) => x.day && x.day >= from && x.day <= to && (!entity || x.entity === entity) && (!cat || x.cat === cat));
  const rep = buildSlices(rows, { from, to, entity, cat });
  if (!rep) throw new ReportError('Списань за ' + (from === to ? dmyOf(from) : dmyOf(from) + ' - ' + dmyOf(to)) + ' немає');
  const name = ['Списання ВК за період', from === to ? dmyOf(from) : dmyOf(from) + '-' + dmyOf(to), entity, cat].filter(Boolean).join(' ').replace(/[\\/:*?"<>|]/g, ' ') + '.xlsx';
  return { name, buf: buildSlicesXlsx(rep, at) };
}

module.exports = { buildSlices, buildSlicesXlsx, sliceModel, summaryModel, slicesReport, SLICES };
