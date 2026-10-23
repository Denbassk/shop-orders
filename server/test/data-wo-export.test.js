// data.js: вибірка невигружених списань і позначка вигрузки (підмінний Supabase).
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
  };
  return { sb, calls };
}
const has = (q, op, ...a) => q.ops.some((o) => o[0] === op && JSON.stringify(o.slice(1, 1 + a.length)) === JSON.stringify(a));

test('woExportSnapshot: id з writeoffs_export_pending -> подачі з рядками за submitted_at; порожньо - без другого запиту', async () => {
  const { sb, calls } = fakeSb((q) => (q.table === 'writeoffs_export_pending'
    ? { data: [{ id: 'u1' }], error: null }
    : { data: [{ id: 'u1', doc_id: 'd1', deleted_at: null, writeoff_lines: [{ line_no: 1 }] }], error: null }));
  const r = await createData(sb).woExportSnapshot();
  assert.deepEqual(r, [{ id: 'u1', doc_id: 'd1', deleted_at: null, lines: [{ line_no: 1 }] }]);
  assert.equal(calls[1].table, 'writeoffs');
  assert.ok(has(calls[1], 'in', 'id', ['u1']));
  assert.ok(has(calls[1], 'order', 'submitted_at'));
  assert.ok(calls[1].ops.find((o) => o[0] === 'select')[1].includes('deleted_at'));
  const e = fakeSb(() => ({ data: [], error: null }));
  assert.deepEqual(await createData(e.sb).woExportSnapshot(), []);
  assert.equal(e.calls.length, 1);
});

test('woMarkExported: exported_at = changed_at лише для тієї ж версії (зміна після читання лишає невигруженим)', async () => {
  const { sb, calls } = fakeSb(() => ({ data: null, error: null }));
  await createData(sb).woMarkExported([{ id: 'u1', changed_at: '2026-10-19T09:15:00+00:00' }]);
  assert.deepEqual(calls[0].ops.find((o) => o[0] === 'update')[1], { exported_at: '2026-10-19T09:15:00+00:00' });
  assert.ok(has(calls[0], 'eq', 'id', 'u1'));
  assert.ok(has(calls[0], 'eq', 'changed_at', '2026-10-19T09:15:00+00:00'));
});