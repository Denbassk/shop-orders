// Сирі замовлення ВК за обраний ДЕНЬ: файл xlsx з рядками листа «_Сырые_Заказы_ВК» (а для старих днів - листа «_Архів»).
// Лише читання листів. Рядок листа = позиція від точки (дата, час, адреса, маршрут, штрихкод, товар, ціна, кількість);
// колонки лишаємо як у листі, нічого не перераховуємо (окрім підсумкового рядка «Разом»).
const R = require('../rules');
const { DIRECTIONS } = require('../directions');
const { zip, sheetName } = require('./xlsxLocal');
const { ReportError } = require('./woReport');

const ARCH_SHEET = '_Архів';
const XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const dmyOf = (day) => day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[\s ]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

function esc(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function validDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
// у «_Архів» час записаний як 30.12.1899 (збій формату) - такий час не показуємо
const timeOf = (v) => (/^\d{1,2}:\d{2}/.test(String(v || '').trim()) ? String(v).trim() : '');

// values - значення листа (перший рядок - шапка); рядки потрібного дня -> { head, rows }
function pickDay(values, dmy) {
  const head = (values && values[0]) || [];
  const rows = (values || []).slice(1).filter((r) => r && String(r[0] || '').trim() === dmy)
    .map((r) => [dmy, timeOf(r[1]), String(r[2] || '').trim(), String(r[3] || '').trim(), String(r[4] || '').trim(), String(r[5] || '').trim(), num(r[6]), num(r[7])]);
  return { head, rows };
}

// ---------- xlsx ----------
const S = { def: 0, title: 1, bold: 2, head: 3, text: 4, num: 5, money: 6, tText: 7, tNum: 8 };
const STYLES = XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="9">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
const WIDTHS = [11, 9, 44, 16, 15, 52, 9, 11];
const colName = (i) => String.fromCharCode(65 + i);

function sheetModel({ title, day, colD, rows }) {
  const T = (t, s = S.def) => ({ t, s }), N = (n, s) => ({ n, s }), E = (s) => ({ s });
  const out = [[T(title, S.title)], [T('Дата: ' + dmyOf(day), S.bold)], []];
  out.push(['Дата', 'Час', 'Адреса ТТ', colD, 'Штрих-код', 'Номенклатура', 'Ціна', 'Кількість'].map((h) => T(h, S.head)));
  let qty = 0;
  for (const r of rows) {
    qty += r[7] || 0;
    out.push([T(r[0], S.text), T(r[1], S.text), T(r[2], S.text), T(r[3], S.text), T(r[4], S.text), T(r[5], S.text),
      r[6] == null ? E(S.text) : N(r[6], S.money), r[7] == null ? E(S.text) : N(r[7], S.num)]);
  }
  out.push([T('Разом: рядків ' + rows.length, S.tText), E(S.tText), E(S.tText), E(S.tText), E(S.tText), E(S.tText), E(S.tText), N(r3(qty), S.tNum)]);
  return out;
}

function buildXlsx(model, tabName) {
  const xmlRows = model.map((cells, ri) => {
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
    + '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + WIDTHS.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + xmlRows + '</sheetData>'
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
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
      + '<sheets><sheet name="' + esc(sheetName(tabName)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="' + REL + '/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

// deps.read(sheetName) -> values (A:H, FORMATTED_VALUE); за замовчуванням - бойова таблиця напрямку через Google
async function rawReport(dir, p = {}, deps = {}) {
  if (dir !== 'bakery') throw new ReportError('Сирі замовлення за день є лише у випічки і кулінарії');
  const day = String(p.date || '');
  if (!validDay(day)) throw new ReportError('Невірна дата звіту');
  const today = R.kyivNow(deps.at || new Date()).day;
  if (day > today) throw new ReportError('Дата звіту у майбутньому');
  const cfg = DIRECTIONS.bakery, dmy = dmyOf(day);
  const read = deps.read || ((sheet) => {
    const g = require('../google');
    return g.getValues(cfg.spreadsheetId, g.a1q(sheet, 'A:H'), { formatted: true });
  });
  let got = pickDay(await read(cfg.rawSheet), dmy), from = 'raw';
  if (!got.rows.length) { got = pickDay(await read(ARCH_SHEET), dmy); from = 'arch'; }   // старіші дні - лише в «_Архів»
  if (!got.rows.length) throw new ReportError('Сирих замовлень за ' + dmy + ' немає');
  const colD = String(got.head[3] || '').trim() || (from === 'arch' ? 'Категорія' : 'Маршрут');
  const title = 'Сирі замовлення · ' + cfg.title;
  return { name: 'Сирі замовлення ВК ' + dmy + '.xlsx', rows: got.rows.length, source: from,
    buf: buildXlsx(sheetModel({ title, day, colD, rows: got.rows }), 'Сирі ' + dmy) };
}

module.exports = { rawReport, pickDay, sheetModel, buildXlsx, validDay, r2 };
