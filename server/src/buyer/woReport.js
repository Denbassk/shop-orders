// Звіт про списання ВК за ДЕНЬ для друку: окремо по юрособі (Фемели Маркет, ЮА Маркет), файл xlsx.
// Дані - ті самі рядки таблиць списань юросіб, що читає вкладка «Списання» (src/buyer/writeoffs.js), лише читання.
// Групи: точка -> товари (однакові товари однієї точки з різних подач злито). Суми - за собівартістю і з націнкою
// (колонка «Сумма +…%» таблиці: до 19.10.2026 +15%, далі +20%, старі рядки не перераховувались - тому заголовок без відсотка).
const R = require('../rules');
const { zip, sheetName, colName } = require('./xlsxLocal');

class ReportError extends Error { constructor(m) { super(m); this.name = 'ReportError'; } }   // помилка для людини (400), решта - збій (502)

const FEM_ENTITY_HEAD = 'Списання випічки і кулінарії';
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const uk = (a, b) => String(a).localeCompare(String(b), 'uk');
const dmyOf = (day) => day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
const XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// rows - рядки parseRows (writeoffs.js): { id, day, store, code, cat, name, qty, price, sum, sum20, seller, entity }
function buildDayReport(rows, { entity, day }) {
  const f = (rows || []).filter((x) => x.day === day && x.entity === entity);
  if (!f.length) return null;
  const byStore = new Map();
  for (const x of f) {
    const key = x.store + '|' + x.code;
    let s = byStore.get(key);
    if (!s) byStore.set(key, s = { store: x.store, code: x.code, items: new Map(), sellers: [], docs: new Set() });
    s.docs.add(x.id);
    if (x.seller && x.seller !== '-' && !s.sellers.includes(x.seller)) s.sellers.push(x.seller);
    const ik = x.cat + '|' + x.name + '|' + r2(x.price);
    const it = s.items.get(ik) || { cat: x.cat, name: x.name, price: r2(x.price), qty: 0, sum: 0, sum20: 0 };
    it.qty += x.qty; it.sum += x.sum; it.sum20 += x.sum20;
    s.items.set(ik, it);
  }
  const stores = [...byStore.values()].sort((a, b) => uk(a.store, b.store) || uk(a.code, b.code)).map((s) => {
    const items = [...s.items.values()].map((i) => ({ ...i, qty: r3(i.qty), sum: r2(i.sum), sum20: r2(i.sum20) }))
      .sort((a, b) => uk(a.cat, b.cat) || uk(a.name, b.name));
    return { store: s.store, code: s.code, sellers: s.sellers, docs: s.docs.size, items,
      qty: r3(items.reduce((a, i) => a + i.qty, 0)), sum: r2(items.reduce((a, i) => a + i.sum, 0)), sum20: r2(items.reduce((a, i) => a + i.sum20, 0)) };
  });
  return { entity, day, stores,
    total: { qty: r3(stores.reduce((a, s) => a + s.qty, 0)), sum: r2(stores.reduce((a, s) => a + s.sum, 0)),
      sum20: r2(stores.reduce((a, s) => a + s.sum20, 0)), stores: stores.length, docs: new Set(f.map((x) => x.id)).size } };
}

// ---------- xlsx ----------
// стилі (індекси cellXfs)
const S = { def: 0, title: 1, bold: 2, store: 3, head: 4, text: 5, qty: 6, money: 7, tText: 8, tQty: 9, tMoney: 10, ital: 11 };
const STYLES = XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font>'
  + '<font><b/><sz val="14"/><name val="Arial"/></font><font><i/><sz val="9"/><name val="Arial"/></font></fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top>'
  + '<bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="12">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'                                                                                 // 0 def
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                                                   // 1 title
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                                                   // 2 bold
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>'                                     // 3 store
  + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'  // 4 head
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'  // 5 text
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>'  // 6 qty (General: 3, а не «3,»)
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>'  // 7 money
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'                                                   // 8 total text
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'  // 9 total qty
  + '<xf numFmtId="4" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>'                             // 10 total money
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'                                                                   // 11 italic
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const HEAD = ['Товар', 'Кількість', 'Собівартість', 'Сума', 'Сума з націнкою'];
const WIDTHS = [58, 11, 13, 11, 16];

// модель: рядки комірок [{ t: 'текст' | n: число | '' , s: стиль }], порожня комірка зі стилем - { s }
function sheetModel(rep) {
  const rows = [];
  const T = (t, s = S.def) => ({ t, s }), N = (n, s) => ({ n, s }), E = (s) => ({ s });
  rows.push([T(FEM_ENTITY_HEAD, S.title)]);
  rows.push([T('Юрособа: ' + rep.entity, S.bold)]);
  rows.push([T('Дата списання: ' + dmyOf(rep.day), S.bold)]);
  rows.push([]);
  for (const s of rep.stores) {
    rows.push([T(s.store + (s.code ? ' · №' + s.code : ''), S.store), E(S.store), E(S.store), E(S.store), E(S.store)]);
    if (s.sellers.length) rows.push([T('Подали: ' + s.sellers.join(', '), S.ital)]);
    rows.push(HEAD.map((h) => T(h, S.head)));
    for (const i of s.items) rows.push([T(i.name + (i.price > 0 ? '' : ' (без собівартості)'), S.text), N(i.qty, S.qty), N(i.price, S.money), N(i.sum, S.money), N(i.sum20, S.money)]);
    rows.push([T('Разом по точці', S.tText), N(s.qty, S.tQty), E(S.tText), N(s.sum, S.tMoney), N(s.sum20, S.tMoney)]);
    rows.push([]);
  }
  rows.push([T('ВСЬОГО за день', S.tText), N(rep.total.qty, S.tQty), E(S.tText), N(rep.total.sum, S.tMoney), N(rep.total.sum20, S.tMoney)]);
  rows.push([T('Точок: ' + rep.total.stores + ' · подач: ' + rep.total.docs, S.ital)]);
  rows.push([]);
  rows.push([T('Відповідальний: ______________________________        Підпис: ____________________', S.def)]);
  return rows;
}

function buildDayXlsx(rep) {
  const xmlRows = sheetModel(rep).map((cells, ri) => {
    const xs = cells.map((c, ci) => {
      const ref = colName(ci) + (ri + 1), st = ' s="' + c.s + '"';
      if ('n' in c) return '<c r="' + ref + '"' + st + '><v>' + c.n + '</v></c>';
      if (c.t === undefined || c.t === '') return '<c r="' + ref + '"' + st + '/>';
      return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.t) + '</t></is></c>';
    });
    return xs.length ? '<row r="' + (ri + 1) + '">' + xs.join('') + '</row>' : '';
  }).join('');
  const sheet = XH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>'
    + '<cols>' + WIDTHS.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + xmlRows + '</sheetData>'
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>'
    + '<headerFooter><oddFooter>&amp;RСтор. &amp;P з &amp;N</oddFooter></headerFooter>'
    + '</worksheet>';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    { name: '[Content_Types].xml', data: XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: XH + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + REL + '">'
      + '<sheets><sheet name="' + esc(sheetName(rep.entity + ' ' + dmyOf(rep.day))) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// ---------- запит ----------
function validDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
const shiftDay = (day, back) => new Date(Date.parse(day + 'T12:00:00Z') - back * 864e5).toISOString().slice(0, 10);

// deps.load(arch, fresh) -> { list, meta: { books, errors } } (за замовчуванням - таблиці списань Google, свіжо)
async function dayReport(dir, p = {}, deps = {}) {
  if (dir !== 'bakery') throw new ReportError('Звіт про списання є лише у випічки і кулінарії');
  const day = String(p.date || ''), entity = String(p.entity || '').trim();
  if (!validDay(day)) throw new ReportError('Невірна дата звіту');
  const today = R.kyivNow(deps.at || new Date()).day;
  if (day > today) throw new ReportError('Дата звіту у майбутньому');
  const load = deps.load || ((arch, fresh) => require('./writeoffs').loadRows(require('../google'), arch, fresh));
  const { list, meta } = await load(day < shiftDay(today, 30), true);   // старші за 31 день - лише в листі «Архив»
  const books = (meta && meta.books) || [], errors = (meta && meta.errors) || [];
  if (!books.includes(entity)) {
    throw new ReportError(errors.length ? 'Таблиці списань недоступні: ' + errors.join('; ') : 'Невідома юрособа: ' + (entity || '(не вказано)'));
  }
  const bad = errors.filter((e) => e.startsWith(entity + ':'));
  if (bad.length) throw new ReportError('Не вдалося прочитати списання: ' + bad.join('; '));
  const rep = buildDayReport(list, { entity, day });
  if (!rep) throw new ReportError('Списань за ' + dmyOf(day) + ' по «' + entity + '» немає');
  return { name: 'Списання ВК ' + entity + ' ' + dmyOf(day) + '.xlsx', buf: buildDayXlsx(rep) };
}

module.exports = { buildDayReport, buildDayXlsx, sheetModel, dayReport, ReportError };
