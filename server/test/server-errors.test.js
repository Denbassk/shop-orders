// «Сервісне меню»: помилки сервера (вигрузка, звіти, tick, пошта, списання) потрапляють у список помилок екрана «Здоров'я» пульта
// (settings.health_err) з зрозумілим «де» і текстом; однакова помилка підряд не множиться.
const test = require('node:test');
const assert = require('node:assert/strict');
const { noteError } = require('../src/admin/tools');
const { createExportQueue } = require('../src/export/queue');
const { collectTickErrors, errorText } = require('../src/errors');

function fakeAdm(initial = []) {
  const store = { v: initial };
  return { store, getSetting: async () => store.v, setSetting: async (k, v) => { store.v = v; } };
}

test('noteError: такий самий запис підряд не додається (де + текст), інший - додається, максимум 20', async () => {
  const adm = fakeAdm();
  await noteError(adm, 'вигрузка bread', 'Google тайм-аут', new Date('2026-10-22T10:00:00+03:00'));
  await noteError(adm, 'вигрузка bread', 'Google тайм-аут', new Date('2026-10-22T10:05:00+03:00'));
  assert.equal(adm.store.v.length, 1, 'повтор підряд пропущено');
  assert.equal(adm.store.v[0].count, 2, 'але лічильник повторів зріс');
  await noteError(adm, 'звіти veg', 'Google тайм-аут');
  assert.equal(adm.store.v.length, 2);
  for (let i = 0; i < 30; i++) await noteError(adm, 'x' + i, 'm' + i);
  assert.equal(adm.store.v.length, 20);
});

test('createExportQueue: onError отримує напрямок і помилку (раніше лише console.error)', async () => {
  const got = [];
  const timers = [];
  const q = createExportQueue({ run: async () => { throw new Error('Supabase лежить'); }, onError: (dir, e) => got.push([dir, e.message]), setTimer: (fn) => timers.push(fn) });
  q('bakery');
  timers[0]();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got, [['bakery', 'Supabase лежить']]);
});

test('collectTickErrors: помилки вигрузки, звітів, пошти і списань з відповіді tick -> {where, msg}', () => {
  const res = {
    export: { bread: { written: 1 }, nbhz: { error: 'Quota exceeded' }, veg: { error: 'Google вимкнено' } },
    reports: { bakery: { rows: 1, sheets: [] }, bread: { error: 'timeout' }, nbhz: { rows: 2, sheets: ['a'], downloadError: 'лист не знайдено', archive: { error: 'архів недоступний' } } },
    mail: { sent: 0, failed: 2, skipped: 0 },
    writeoffs: { error: 'wo_books порожні' },
  };
  const list = collectTickErrors(res);
  assert.deepEqual(list.map((x) => x.where), ['вигрузка nbhz', 'вигрузка veg', 'звіт bread', 'звіт nbhz (Завантаження)', 'архів НБХЗ', 'листи про дозвіл', 'списання']);
  assert.match(list[0].msg, /перевищено ліміт читань/, 'сире Quota exceeded перекладено зрозумілою мовою');
  assert.match(list.find((x) => x.where === 'листи про дозвіл').msg, /2/);
  assert.deepEqual(collectTickErrors({ export: {}, mail: { sent: 1, failed: 0 } }), []);
});

test('errorText: коротко і зрозуміло - тип помилки Google/Supabase, без стеків і довгих JSON', () => {
  assert.equal(errorText(new Error('Quota exceeded for quota metric \'Read requests\' and limit \'Read requests per minute per user\'')), 'Google: перевищено ліміт читань за хвилину (Sheets 60/хв) - зачекати і повторити');
  assert.equal(errorText(new Error('request to https://oauth2.googleapis.com/token failed, reason: getaddrinfo ENOTFOUND oauth2.googleapis.com')), 'Нема зв\'язку з Google (DNS/мережа) - перевірити інтернет сервера');
  assert.match(errorText(new Error('The caller does not have permission')), /Google: нема доступу/);
  assert.equal(errorText(new Error('timeout of 30000ms exceeded')), 'Google не відповів за 30 с (тайм-аут)');
  assert.equal(errorText(new Error('щось своє')), 'щось своє');
  assert.ok(errorText(new Error('x'.repeat(500))).length <= 300);
});
