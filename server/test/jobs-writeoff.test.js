// Шаг 8: tick вигружає списання (env.exportWriteoffs), runtime підключає чергу queueWoExport.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tick } = require('../src/jobs');

const AT = new Date('2026-10-19T12:00:00+03:00');
const baseEnv = (extra) => ({ at: AT, data: { unmailedLate: async () => [] }, mailer: { recipient: () => '' }, ...extra });
const exportAll = async () => ({ bread: 'ok' });

test('tick: списання вигружаються, результат у out.writeoffs', async () => {
  let n = 0;
  const out = await tick(baseEnv({ exportWriteoffs: async () => { n++; return { written: 3 }; } }), exportAll);
  assert.equal(n, 1);
  assert.deepEqual(out.writeoffs, { written: 3 });
  assert.deepEqual(out.export, { bread: 'ok' });
});

test('tick: збій вигрузки списань не ламає вигрузку замовлень і листи', async () => {
  const out = await tick(baseEnv({ exportWriteoffs: async () => { throw new Error('Google лежить'); } }), exportAll);
  assert.deepEqual(out.writeoffs, { error: 'Google лежить' });
  assert.deepEqual(out.export, { bread: 'ok' });
  assert.deepEqual(out.mail, { sent: 0, failed: 0, skipped: 0 });
});

test('tick: без exportWriteoffs - відповідь як раніше (ключа writeoffs нема)', async () => {
  const out = await tick(baseEnv({}), exportAll);
  assert.equal('writeoffs' in out, false);
});

test('runtime: черга queueWoExport у getEnv, вигрузка списань у tick', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/runtime.js'), 'utf8');
  assert.match(src, /require\('\.\/export\/writeoff'\)/);
  assert.match(src, /queueWoExport = createExportQueue\(/);
  assert.match(src, /queueExport, queueWoExport, defer/);
  assert.match(src, /exportWriteoffs: woExport/);
});