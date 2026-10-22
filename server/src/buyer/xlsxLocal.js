'use strict';
// Excel листа звіту для закупниці БЕЗ «3,», з УСІМ оформленням Google.
// Качаємо xlsx у Google (кольори, рамки, ширини, об'єднання - як у таблиці) і міняємо лише
// формат кількості «0.###» (ціле 3 -> «3,») на General у xl/styles.xml. app/ не чіпаємо.
// Відповідь не xlsx (сторінка входу, помилка) - повертаємо як є, xlsx.js покаже помилку.
// buildXlsx - запасний збирач з голих значень, зараз не використовується.
// BUYER_XLSX=google - файл Google без правки.
const zlib = require('zlib');

const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TOTAL_RE = /^(разом|всього|всего|загал|итого|ітого)/i;
const SP = /[ \u00a0\u202f]/g;
const XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

let clean = (s) => s;
try { const SH = require('./sheets'); if (typeof SH.clean === 'function') clean = SH.clean; } catch (e) { /* лише власне очищення */ }

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function colName(i) { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function esc(s) {
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sheetName(t) {
  const s = String(t || '').replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31);
  return s || 'Звіт';
}

// значення комірки -> { n } число | { s } текст | null
function toCell(v) {
  if (v && typeof v === 'object') v = v.v != null ? v.v : (v.value != null ? v.value : (v.text != null ? v.text : ''));
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v } : { s: String(v) };
  if (typeof v === 'boolean') return { s: v ? 'TRUE' : 'FALSE' };
  let s = String(v);
  try { s = String(clean(s)); } catch (e) { /* як є */ }
  if (s.trim() === '') return null;
  const t = s.trim().replace(/^(-?\d+),$/, '$1');
  if (/^-?(0|[1-9]\d{0,6})$/.test(t)) return { n: Number(t) };          // ціле до 7 цифр; довші - коди/штрихкоди, текстом
  let m = /^(-?)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+)$/.exec(t);             // «4 510»
  if (m) return { n: Number(m[1] + m[2].replace(SP, '')) };
  m = /^(-?)(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d{1,7}),(\d+)$/.exec(t);   // «2,5», «4 510,00»
  if (m && !/^0\d/.test(m[2])) return { n: Number(m[1] + m[2].replace(SP, '') + '.' + m[3]), money: m[3].length === 2 };
  return { s };
}

function rowCells(row) {
  if (Array.isArray(row)) return row;
  if (row && typeof row === 'object') return row.cells || row.values || row.c || row.row || [];
  return [];
}

function pickRows(r) {
  if (Array.isArray(r)) return r.map(rowCells);
  if (!r || typeof r !== 'object') throw new Error('немає даних листа');
  const head = [r.header, r.head, r.headers].find(Array.isArray);
  const body = [r.rows, r.values, r.data, r.cells, r.table].find(Array.isArray);
  if (!body) throw new Error('невідома форма даних листа: ' + Object.keys(r).join(','));
  const rows = body.map(rowCells);
  if (!head || !head.length) return rows;
  const heads = Array.isArray(head[0]) ? head.map(rowCells) : [head];
  if (rows.length && JSON.stringify(rows[0]) === JSON.stringify(heads[heads.length - 1])) return rows;
  return heads.concat(rows);
}

function zip(files) {
  const parts = []; const central = []; let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw); const crc = crc32(raw);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(0, 38); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += h.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

const STYLES = XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function buildXlsx(rows, title) {
  const widths = []; const xmlRows = [];
  (rows || []).forEach((row, ri) => {
    const cells = rowCells(row).map(toCell);
    const first = cells.find((c) => c && c.s);
    const bold = ri === 0 || !!(first && TOTAL_RE.test(first.s.trim()));
    const xs = [];
    cells.forEach((c, ci) => {
      if (!c) return;
      const len = 'n' in c ? String(c.n).length + 2 : c.s.length;
      widths[ci] = Math.max(widths[ci] || 0, len);
      const st = (bold ? 1 : 0) + (c.money ? 2 : 0);
      const sa = st ? ' s="' + st + '"' : '';
      const ref = colName(ci) + (ri + 1);
      xs.push('n' in c ? '<c r="' + ref + '"' + sa + '><v>' + c.n + '</v></c>'
        : '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.s) + '</t></is></c>');
    });
    xmlRows.push('<row r="' + (ri + 1) + '">' + xs.join('') + '</row>');
  });
  let cols = '';
  if (widths.length) {
    const cs = [];
    for (let i = 0; i < widths.length; i++) cs.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.min(60, Math.max(6, (widths[i] || 6) + 1)) + '" customWidth="1"/>');
    cols = '<cols>' + cs.join('') + '</cols>';
  }
  const sheet = XH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + cols + '<sheetData>' + xmlRows.join('') + '</sheetData></worksheet>';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return zip([
    { name: '[Content_Types].xml', data: XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="' + R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: XH + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + R + '">'
      + '<sheets><sheet name="' + esc(sheetName(title)) + '" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="' + R + '/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="' + R + '/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

function asResponse(buf) {
  if (typeof Response === 'function') {
    const res = new Response(buf, { status: 200, headers: { 'content-type': CT, 'content-length': String(buf.length) } });
    res.buffer = async () => buf;
    return res;
  }
  return { ok: true, status: 200, headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? CT : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), buffer: async () => buf };
}

const TRAIL = /^[#0,]*\.#+$/;   // 0.###, #,##0.### - роздільник видно і в цілих
function fixStyles(xml) {
  let n = 0;
  const out = String(xml).replace(/formatCode="([^"]*)"/g, (m, code) => (TRAIL.test(code) ? (n++, 'formatCode="General"') : m));
  return { xml: out, n };
}

function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('не zip');
  const cnt = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const files = [];
  for (let i = 0; i < cnt; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('зламаний zip');
    const method = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.subarray(ds, ds + cs);
    const data = method === 0 ? Buffer.from(raw) : (method === 8 ? zlib.inflateRawSync(raw) : null);
    if (!data) throw new Error('метод стиснення ' + method);
    files.push({ name, data });
    p += 46 + nl + xl + cl;
  }
  return files;
}

function fixXlsx(buf) {
  const files = unzip(buf);
  const st = files.find((x) => x.name === 'xl/styles.xml');
  if (!st) return buf;
  const r = fixStyles(st.data.toString('utf8'));
  if (!r.n) return buf;
  st.data = Buffer.from(r.xml, 'utf8');
  return zip(files);
}

function reply(res, buf) {
  const h = {};
  if (res.headers && typeof res.headers.forEach === 'function') res.headers.forEach((v, k) => { if (!/^content-(length|encoding)$/i.test(k)) h[String(k).toLowerCase()] = v; });
  else h['content-type'] = (res.headers && res.headers.get && res.headers.get('content-type')) || CT;
  if (typeof Response === 'function') { const r = new Response(buf, { status: res.status || 200, headers: h }); r.buffer = async () => buf; return r; }
  return { ok: true, status: res.status || 200, headers: { get: (k) => (h[String(k).toLowerCase()] != null ? h[String(k).toLowerCase()] : null) },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), buffer: async () => buf };
}

// fetchFn для createXlsx: файл Google + General замість 0.###. sheets/dir/key лишені для сумісності виклику.
function fetchFor(sheets, dir, key, realFetch) {
  const get = realFetch || ((u, o) => fetch(u, o));
  return async (url, opts) => {
    const res = await get(url, opts);
    if (!res || !res.ok || typeof res.arrayBuffer !== 'function') return res;
    const buf = Buffer.from(await res.arrayBuffer());
    let out = buf;
    if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
      try { out = fixXlsx(buf); } catch (e) { console.warn('[xlsxLocal] не вдалось прибрати «3,», файл як є:', e && e.message); out = buf; }
    }
    return reply(res, out);
  };
}

module.exports = { CT, crc32, colName, toCell, sheetName, pickRows, buildXlsx, zip, unzip, fixStyles, fixXlsx, fetchFor };
