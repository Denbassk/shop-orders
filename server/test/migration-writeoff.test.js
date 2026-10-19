// Міграція 000005 (списання): статична перевірка файлу. Базу не чіпає - застосовує власник (supabase db push).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261019000005_writeoff.sql');
const raw = () => fs.readFileSync(FILE, 'utf8');
const norm = () => raw().replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

test('міграція 000005: writeoffs, writeoff_lines, admin_log з RLS; products.cost; без drop', () => {
  const s = norm();
  for (const t of ['writeoffs', 'writeoff_lines', 'admin_log']) {
    assert.match(s, new RegExp('create table public\\.' + t + ' \\('), t);
    assert.match(s, new RegExp('alter table public\\.' + t + ' enable row level security'), 'RLS ' + t);
  }
  assert.match(s, /alter table public\.products add column if not exists cost numeric/);
  assert.doesNotMatch(s, /drop table|drop column|truncate/);
});

test('міграція 000005: doc_id унікальний лише серед невидалених (після видалення можна подати знову - як oid_wo_)', () => {
  assert.match(norm(), /create unique index \w+ on public\.writeoffs \(doc_id\) where deleted_at is null/);
});

test('submit_writeoff_tx: лише service_role; повтор і гонка -> duplicate', () => {
  const s = norm();
  assert.match(s, /create or replace function public\.submit_writeoff_tx\(p jsonb\) returns jsonb/);
  assert.match(s, /revoke all on function public\.submit_writeoff_tx\(jsonb\) from public, anon, authenticated/);
  assert.match(s, /grant execute on function public\.submit_writeoff_tx\(jsonb\) to service_role/);
  assert.match(s, /'duplicate', true/);
  assert.match(s, /unique_violation/);
});

test('submit_writeoff_tx читає всі поля, які шле api/writeoff.js', () => {
  const s = raw();
  for (const k of ['doc_id', 'store_id', 'store_label', 'store_code', 'edrpou', 'wo_date', 'seller', 'total', 'submitted_at', 'result', 'lines'])
    assert.ok(s.includes("p->>'" + k + "'") || s.includes("p->'" + k + "'"), 'p.' + k);
  for (const k of ['line_no', 'product_id', 'barcode', 'category', 'name', 'qty', 'price', 'amount', 'amount_plus'])
    assert.ok(s.includes("l->>'" + k + "'"), 'line.' + k);
});