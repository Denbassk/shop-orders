'use strict';
// Ежедневный бэкап базы: чистые функции (список таблиц, чтение, файл, проверки, хранение, восстановление).
// Запускатель — scripts/backup-db.cjs, восстановление — scripts/restore-table.cjs, инструкция — docs/backup-restore.md.

const zlib = require('zlib');
const crypto = require('crypto');

const FORMAT = 1;
const FILE_PREFIX = 'Замовлення_база_';

// Разовые ручные копии (payroll_payments_backup_before_restore, fpc_backup_2026_08_manual …) не сохраняем: в имени backup
// и нет первичного ключа. История, которую ведёт сам сайт (final_payroll_calculations_backup, inventory_*_backup), — с ключом, остаётся.
const isOneOffCopy = (name, pk) => /backup/.test(name) && !pk.length;
// Представления PostgREST показывает как таблицы; их данные — из таблиц, которые уже в бэкапе.
const VIEWS = new Set(['writeoffs_export_pending']);

function tablesFromOpenApi(spec) {
  const defs = spec && spec.definitions;
  if (!defs || !Object.keys(defs).length) throw new Error('PostgREST не вернул список таблиц');
  return Object.keys(defs)
    .filter((name) => !VIEWS.has(name))
    .sort()
    .map((name) => {
      const props = defs[name].properties || {};
      const columns = Object.keys(props);
      const pk = columns.filter((c) => /<pk\/>/.test((props[c] && props[c].description) || ''));
      return { name, columns, pk, order: pk.length ? pk : columns };
    })
    .filter((t) => !isOneOffCopy(t.name, t.pk))
    .map(({ pk, ...t }) => t);
}

// Читает таблицу постранично (PostgREST отдаёт не больше 1000 строк) и сверяет число строк с подсчётом после чтения.
// Не сошлось (в таблицу писали во время чтения) — читает заново.
async function fetchTable(sb, table, { pageSize = 1000, attempts = 3 } = {}) {
  let rows = [], count = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    rows = [];
    for (let from = 0; ; from += pageSize) {
      let q = sb.from(table.name).select('*');
      for (const c of table.order) q = q.order(c, { ascending: true });
      const { data, error } = await q.range(from, from + pageSize - 1);
      if (error) throw new Error(`${table.name}: ${error.message}`);
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    const res = await sb.from(table.name).select('*', { count: 'exact', head: true });
    if (res.error) throw new Error(`${table.name}: ${res.error.message}`);
    count = res.count;
    if (count === rows.length) return rows;
  }
  throw new Error(`${table.name}: прочитано ${rows.length} строк, а в таблице ${count} — число так и не сошлось`);
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function buildBackup(tables, createdAt = new Date()) {
  const body = { format: FORMAT, created_at: createdAt.toISOString(), tables: {} };
  const counts = {};
  for (const t of tables) {
    body.tables[t.name] = { columns: t.columns, rows: t.rows };
    counts[t.name] = t.rows.length;
  }
  const buffer = zlib.gzipSync(Buffer.from(JSON.stringify(body), 'utf8'), { level: 9 });
  return { buffer, sha256: sha256(buffer), counts };
}

function readBackup(buffer) {
  return JSON.parse(zlib.gunzipSync(buffer).toString('utf8'));
}

// Проверка скачанного обратно файла: та же контрольная сумма, читается, число строк по каждой таблице совпадает.
function verifyBackup(buffer, expected) {
  const problems = [];
  if (sha256(buffer) !== expected.sha256) problems.push('контрольная сумма скачанного файла не совпала с отправленным');
  let body;
  try { body = readBackup(buffer); } catch (e) { problems.push(`файл не удалось прочитать: ${e.message}`); return problems; }
  for (const [name, n] of Object.entries(expected.counts)) {
    const got = body.tables && body.tables[name] ? body.tables[name].rows.length : null;
    if (got !== n) problems.push(`${name}: в файле ${got === null ? 'нет таблицы' : got + ' строк'}, ожидалось ${n}`);
  }
  return problems;
}

function sanityProblems(counts) {
  return ['stores', 'products'].filter((t) => !counts[t]).map((t) => `${t}: порожньо або нема таблиці - бекап підозрілий`);
}

// Сравнение с прошлым бэкапом: пропала таблица, опустела или заметно уменьшилась (≥ 20% и ≥ 50 строк).
// Иначе ошибочное массовое удаление за 30 дней «вытеснило» бы все хорошие копии без единого сигнала.
function dropProblems(prev, counts) {
  if (!prev) return [];
  const out = [];
  for (const [name, before] of Object.entries(prev)) {
    if (!(name in counts)) { out.push(`${name}: таблицы больше нет (было ${before} строк)`); continue; }
    const now = counts[name];
    if (before >= 10 && now === 0) out.push(`${name}: таблица опустела (было ${before} строк)`);
    else if (before - now >= 50 && now <= before * 0.8) out.push(`${name}: было ${before} строк, стало ${now}`);
  }
  return out;
}

function kyivParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

function fileName(date) { return `${FILE_PREFIX}${kyivParts(date)}.json.gz`; }

// Удаляются файлы старше `days` дней, но всегда остаются `keep` последних: если бэкап долго падал, старые не исчезнут.
function filesToDelete(files, now, { days = 30, keep = 7 } = {}) {
  const ours = files.filter((f) => f.name.startsWith(FILE_PREFIX))
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  const limit = now.getTime() - days * 86400000;
  return ours.slice(keep).filter((f) => new Date(f.createdTime).getTime() <= limit);
}

function countsFromDescription(file) {
  try { const c = JSON.parse(file.description).counts; return c && typeof c === 'object' ? c : null; } catch { return null; }
}

// Полный запуск. store — Диск или папка: list() → [{id,name,createdTime,description}], upload(name, buffer, description),
// download(id) → Buffer, trash(id). Файл загружается всегда, даже с замечаниями (неполная копия лучше никакой);
// старые файлы удаляются только если замечаний нет.
async function runBackup({ sb, getSpec, store, now = new Date(), log = () => {}, retention = {} }) {
  const problems = [];
  const tables = [];
  for (const t of tablesFromOpenApi(await getSpec())) {
    try {
      const rows = await fetchTable(sb, t);
      tables.push({ ...t, rows });
      log(`${t.name}: ${rows.length}`);
    } catch (e) { problems.push(`не прочитана таблица ${e.message}`); }
  }
  const backup = buildBackup(tables.map(({ name, columns, rows }) => ({ name, columns, rows })), now);
  const name = fileName(now);

  const before = (await store.list()).filter((f) => f.name.startsWith(FILE_PREFIX))
    .sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
  const uploaded = await store.upload(name, backup.buffer, JSON.stringify({ format: FORMAT, sha256: backup.sha256, counts: backup.counts }));
  log(`загружен ${name}, ${backup.buffer.length} байт`);

  problems.push(...verifyBackup(await store.download(uploaded.id), backup));
  problems.push(...sanityProblems(backup.counts));
  const prev = before.map(countsFromDescription).find(Boolean) || null;
  problems.push(...dropProblems(prev, backup.counts));

  const deleted = [];
  if (!problems.length) {
    for (const f of filesToDelete([...before, uploaded], now, retention)) { await store.trash(f.id); deleted.push(f.name); }
  }
  return { name, size: backup.buffer.length, counts: backup.counts, problems, deleted };
}

// ---------- восстановление ----------

function quoteIdent(name) {
  if (!/^[\p{L}\p{N}_]+$/u.test(name)) throw new Error(`Странное имя таблицы: ${name}`);
  return `"${name}"`;
}

function dollarTag(text) {
  for (let i = 0; ; i++) {
    const tag = `$bk${i || ''}$`;
    if (!text.includes(tag)) return tag;
  }
}

// SQL для SQL Editor: строки из бэкапа кладутся в отдельную таблицу restore_<таблица>_<время>, типы — по рабочей таблице.
// Большие выборки делятся на части (не больше chunk строк и ~maxBytes, чтобы SQL Editor принял файл):
// первая часть создаёт таблицу, остальные добавляют строки.
function buildRestoreSql({ table, rows, stamp, chunk = 3000, maxBytes = 1_000_000 }) {
  const src = `public.${quoteIdent(table)}`;
  const dst = `public.${quoteIdent(`restore_${table}_${String(stamp).replace(/-/g, '_')}`)}`;
  const groups = [[]];
  let size = 0;
  for (const r of rows) {
    const len = JSON.stringify(r).length + 1;
    const cur = groups[groups.length - 1];
    if (cur.length && (cur.length >= chunk || size + len > maxBytes)) { groups.push([]); size = 0; }
    groups[groups.length - 1].push(r);
    size += len;
  }
  let first = 1;
  return groups.map((g, i) => {
    const json = JSON.stringify(g);
    const tag = dollarTag(json);
    const select = `select * from jsonb_populate_recordset(null::${src}, ${tag}${json}${tag}::jsonb)`;
    const head = `-- Восстановление ${table} из бэкапа ${stamp}: часть ${i + 1} из ${groups.length}, строки ${first}–${first + g.length - 1}
`;
    first += g.length;
    return head + (i === 0 ? `create table ${dst} as ${select};
` : `insert into ${dst} ${select};
`);
  });
}

function parsePairs(list, columns) {
  return (list || []).map((s) => {
    const i = s.indexOf('=');
    if (i < 1) throw new Error(`Ожидалось колонка=значение: ${s}`);
    const col = s.slice(0, i);
    if (columns && !columns.has(col)) throw new Error(`Нет колонки ${col}`);
    return [col, s.slice(i + 1)];
  });
}

// Отбор строк для восстановления: --eq колонка=значение, --from/--to колонка=значение (включительно, сравнение как текст —
// подходит для дат ГГГГ-ММ-ДД и кодов).
function filterRows(rows, { eq, from, to } = {}) {
  const columns = new Set(rows.flatMap((r) => Object.keys(r)));
  const E = parsePairs(eq, columns), F = parsePairs(from, columns), T = parsePairs(to, columns);
  const s = (v) => (v === null || v === undefined ? null : String(v));
  return rows.filter((r) => E.every(([c, v]) => s(r[c]) === v)
    && F.every(([c, v]) => s(r[c]) !== null && s(r[c]) >= v)
    && T.every(([c, v]) => s(r[c]) !== null && s(r[c]).slice(0, v.length) <= v));
}

module.exports = {
  FILE_PREFIX, tablesFromOpenApi, fetchTable, buildBackup, readBackup, verifyBackup, sanityProblems, dropProblems,
  fileName, kyivParts, filesToDelete, runBackup, buildRestoreSql, filterRows,
};
