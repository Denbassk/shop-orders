'use strict';
// Готовит SQL для восстановления одной таблицы из файла бэкапа (см. docs/backup-restore.md).
//   node scripts/restore-table.cjs <База_….json.gz> <таблица> [--eq кол=знач] [--from кол=знач] [--to кол=знач] [--chunk N]
//   node scripts/restore-table.cjs <База_….json.gz> --list     — какие таблицы в файле и сколько строк
// Пишет restore_<таблица>_<время>_partN.sql рядом с файлом бэкапа. Рабочие таблицы SQL не трогает.

const fs = require('fs');
const path = require('path');
const lib = require('./backup-db-lib.cjs');

function opts(argv) {
  const o = { eq: [], from: [], to: [], chunk: 3000, pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--eq' || a === '--from' || a === '--to') o[a.slice(2)].push(argv[++i]);
    else if (a === '--chunk') o.chunk = Number(argv[++i]);
    else if (a === '--list') o.list = true;
    else o.pos.push(a);
  }
  return o;
}

const o = opts(process.argv.slice(2));
const [file, table] = o.pos;
if (!file || (!table && !o.list)) {
  console.error('Использование: node scripts/restore-table.cjs <файл.json.gz> <таблица> [--eq кол=знач] [--from …] [--to …] | --list');
  process.exit(1);
}
const body = lib.readBackup(fs.readFileSync(file));
console.log(`Бэкап от ${body.created_at}`);
if (o.list) {
  for (const [name, t] of Object.entries(body.tables)) console.log(`  ${name}: ${t.rows.length}`);
  process.exit(0);
}
if (!body.tables[table]) { console.error(`В файле нет таблицы ${table}. Список: --list`); process.exit(1); }

const rows = lib.filterRows(body.tables[table].rows, o);
const stamp = lib.kyivParts(new Date(body.created_at));
const parts = lib.buildRestoreSql({ table, rows, stamp, chunk: o.chunk });
const base = path.join(path.dirname(file), `restore_${table}_${stamp}`);
const prefix = path.basename(base) + '_part';
const stale = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(prefix) && f.endsWith('.sql'));
if (stale.length) {
  // Иначе новая part1 смешалась бы со старыми part2… от прошлого запуска.
  console.error(`Рядом уже есть ${stale.join(', ')} — удалите или переложите их и запустите снова.`);
  process.exit(1);
}
parts.forEach((sql, i) => fs.writeFileSync(`${base}_part${i + 1}.sql`, sql));
console.log(`Строк: ${rows.length} из ${body.tables[table].rows.length}. Файлов SQL: ${parts.length} — ${base}_part1.sql …`);
console.log(`Таблица в базе после выполнения: public."restore_${table}_${stamp.replace(/-/g, '_')}"`);
