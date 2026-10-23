// Слой данных списань (data.js) на підмінному Supabase: фільтри і форма відповіді. Справжню базу не чіпає.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createData } = require('../src/data');

function fakeSb(respond) {
  const calls = [];
  const sb = {
    from(table) {
      const q = { table, ops: [] }; calls.push(q);
      const b = new Proxy({}, { get(_, k) {
        if (k === 'then') return (res, rej) => Promise.resolve(respond(q)).then(res, rej);
        return (...a) => { q.ops.push([k, ...a]); return b; };
      } });
      return b;
    },
    rpc(name, args) { const q = { rpc: name, args }; calls.push(q); return Promise.resolve(respond(q)); },
  };
  return { sb, calls };
}
const has = (q, op, ...a) => q.ops.some((o) => o[0] === op && JSON.stringify(o.slice(1, 1 + a.length)) === JSON.stringify(a));
const NOW = Date.parse('2026-10-19T09:00:00Z');

test('woResult: лише невидалені (після видалення той самий docId подається знову, як oid_wo_)', async () => {
  const { sb, calls } = fakeSb(() => ({ data: [{ result: { docId: 'abc12345' } }], error: null }));
  const d = createData(sb, { now: () => NOW });
  assert.deepEqual(await d.woResult('abc12345'), { docId: 'abc12345' });
  assert.equal(calls[0].table, 'writeoffs');
  assert.ok(has(calls[0], 'eq', 'doc_id', 'abc12345'));
  assert.ok(has(calls[0], 'is', 'deleted_at', null));
  const e = createData(fakeSb(() => ({ data: [], error: null })).sb);
  assert.equal(await e.woResult('abc12345'), null);
});

test('submitWriteoffTx -> rpc submit_writeoff_tx({p})', async () => {
  const { sb, calls } = fakeSb(() => ({ data: { ok: true, duplicate: false }, error: null }));
  const r = await createData(sb).submitWriteoffTx({ doc_id: 'x' });
  assert.deepEqual(r, { ok: true, duplicate: false });
  assert.equal(calls[0].rpc, 'submit_writeoff_tx');
  assert.deepEqual(calls[0].args, { p: { doc_id: 'x' } });
});

test('woDocsOfStore: точка, невидалені, wo_date >= since (архів: d < сьогодні-31 іде геть); writeoff_lines -> lines', async () => {
  const { sb, calls } = fakeSb(() => ({ data: [{ id: 'u1', doc_id: 'd1', writeoff_lines: [{ line_no: 1 }] }, { id: 'u2', doc_id: 'd2' }], error: null }));
  const r = await createData(sb).woDocsOfStore('st1', '2026-09-18');
  assert.ok(has(calls[0], 'eq', 'store_id', 'st1'));
  assert.ok(has(calls[0], 'is', 'deleted_at', null));
  assert.ok(has(calls[0], 'gte', 'wo_date', '2026-09-18'));
  assert.deepEqual(r, [{ id: 'u1', doc_id: 'd1', lines: [{ line_no: 1 }] }, { id: 'u2', doc_id: 'd2', lines: [] }]);
});

test('woFind: невидалене з рядками або null', async () => {
  const { sb, calls } = fakeSb(() => ({ data: [{ id: 'u1', writeoff_lines: [{ line_no: 1 }] }], error: null }));
  assert.deepEqual(await createData(sb).woFind('d1'), { id: 'u1', lines: [{ line_no: 1 }] });
  assert.ok(has(calls[0], 'eq', 'doc_id', 'd1'));
  assert.ok(has(calls[0], 'is', 'deleted_at', null));
  assert.equal(await createData(fakeSb(() => ({ data: [], error: null })).sb).woFind('d1'), null);
});

test('woMarkDeleted: deleted_at = changed_at = зараз, лише якщо ще не видалено; паралельне -> false', async () => {
  const { sb, calls } = fakeSb(() => ({ data: [{ id: 'u1' }], error: null }));
  assert.equal(await createData(sb, { now: () => NOW }).woMarkDeleted('u1'), true);
  const up = calls[0].ops.find((o) => o[0] === 'update')[1];
  assert.deepEqual(up, { deleted_at: '2026-10-19T09:00:00.000Z', changed_at: '2026-10-19T09:00:00.000Z' });
  assert.ok(has(calls[0], 'eq', 'id', 'u1'));
  assert.ok(has(calls[0], 'is', 'deleted_at', null));
  assert.equal(await createData(fakeSb(() => ({ data: [], error: null })).sb).woMarkDeleted('u1'), false);
});

test('adminLog -> insert admin_log {action, details}; помилка бази - з назвою таблиці', async () => {
  const { sb, calls } = fakeSb(() => ({ data: null, error: null }));
  await createData(sb).adminLog('Продавець видалив списання', 'текст');
  assert.equal(calls[0].table, 'admin_log');
  assert.deepEqual(calls[0].ops.find((o) => o[0] === 'insert')[1], { action: 'Продавець видалив списання', details: 'текст' });
  const bad = createData(fakeSb(() => ({ data: null, error: { message: 'relation "admin_log" does not exist' } })).sb);
  await assert.rejects(bad.adminLog('a', 'b'), /admin_log: relation/);
});