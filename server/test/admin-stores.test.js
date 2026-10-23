// Правка і додавання точок у пульті: валідація як в admCardSave_, захист «до переходу», конфлікт полів, дубль адреси і ключів у сирих листах.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/admin/stores');
const T = require('../src/admin/tools');

const ROW = (over = {}) => ({ store_id: 'вул а 1', active: true, label: 'Магазин 1', address: 'вул. А, 1', code: '12', route: 'М1', type: 'Магазин',
  addr_bread: 'вул. А, 1', addr_bakery: 'вул. А, 1', addr_veg: 'вул. А, 1', addr_nbhz: 'вул. А, 1', route_nbhz: 'Н2', zone: 'Центр', edrpou: '',
  bread: true, nbhz: false, bakery: true, veg: true, days_veg: 'Ср,Пн', days_bakery: '', note: '', sort: 10, ...over });

function mkEnv(rows = [ROW()], extra = {}) {
  const st = { rows: rows.map((r) => ({ ...r })), log: [], inserted: [], patches: [] };
  const env = { storeEdit: false, ...extra, adm: {
    storeRow: async (id) => st.rows.find((r) => r.store_id === id) || null,
    allStores: async () => st.rows,
    updateStore: async (id, patch) => { const r = st.rows.find((x) => x.store_id === id); if (!r) return false; st.patches.push([id, patch]); Object.assign(r, patch); return true; },
    insertStore: async (row) => { st.inserted.push(row); st.rows.push(row); },
    maxStoreSort: async () => Math.max(0, ...st.rows.map((r) => r.sort)),
    adminLog: async (a, d) => { st.log.push([a, d]); } } };
  return { env, st };
}
const on = (rows, extra) => mkEnv(rows, { storeEdit: true, ...extra });

test('card: поля з реальних колонок stores (прапорці напрямків, дні текстом по порядку тижня)', async () => {
  const { env } = mkEnv();
  const c = await T.admCard({ storeId: 'вул а 1' }, env);
  assert.deepEqual(c.f, { active: true, label: 'Магазин 1', code: '12', route: 'М1', bread: true, bakery: true, veg: true, note: '', nbhz: false,
    routeNbhz: 'Н2', daysVeg: 'Пн, Ср', daysBakery: '', zone: 'Центр', edrpou: '' });
  assert.equal(c.address, 'вул. А, 1');
  await assert.rejects(T.admCard({ storeId: 'нема' }, env), /не знайдено/);
});

test('захист: до переходу бойові точки не правляться; тестова точка - можна; зі storeEdit - можна', async () => {
  const { env, st } = mkEnv([ROW(), ROW({ store_id: 'test-x', label: 'Тест' })]);
  await assert.rejects(S.admCardSave({ storeId: 'вул а 1', set: { code: '99' } }, env), /Довіднику ТТ/);
  await assert.rejects(S.admCardAdd({ address: 'Нова 5', bread: true }, env), /Довіднику ТТ/);
  assert.equal(st.patches.length + st.inserted.length, 0, 'нічого не записано');
  assert.deepEqual(await S.admCardSave({ storeId: 'test-x', set: { code: '99' } }, env), { changed: 1 });
  const ok = on();
  assert.deepEqual(await S.admCardSave({ storeId: 'вул а 1', set: { code: '99' } }, ok.env), { changed: 1 });
});

test('cardSave: змінює лише змінене, дні нормалізує, пише в журнал «було → стало»', async () => {
  const { env, st } = on();
  const r = await S.admCardSave({ storeId: 'вул а 1', set: { label: ' Нова назва ', code: '12', daysBakery: 'Сб, Пн', routeNbhz: 'Н9', veg: false, active: false } }, env);
  assert.equal(r.changed, 5, 'code не змінився - не рахується');
  assert.deepEqual(st.patches[0][1], { label: 'Нова назва', days_bakery: 'Пн, Сб', route_nbhz: 'Н9', veg: false, active: false });
  assert.equal(st.log[0][0], 'Змінено картку точки');
  assert.match(st.log[0][1], /Назва: Магазин 1 → Нова назва/);
  assert.match(st.log[0][1], /Овочі: так → ні/);
  assert.deepEqual(await S.admCardSave({ storeId: 'вул а 1', set: { code: '12' } }, env), { changed: 0 }, 'без змін - не пишемо');
});

test('cardSave: валідація (назва, номер, ЄДРПОУ, зона, дні) і порожній набір', async () => {
  const { env } = on();
  const bad = (set, re) => assert.rejects(S.admCardSave({ storeId: 'вул а 1', set }, env), re);
  await bad({}, /Змін немає/);
  await bad({ нічого: 1 }, /Змін немає/);
  await bad({ label: '  ' }, /Назва не може бути порожньою/);
  await bad({ code: '12a' }, /тільки цифри/);
  await bad({ edrpou: '1234567' }, /8 цифр/);
  await bad({ zone: 'Марс' }, /Невідома зона: Марс/);
  await bad({ daysVeg: 'Пн, Зв' }, /Невідомий день: Зв/);
  await S.admCardSave({ storeId: 'вул а 1', set: { edrpou: '45672783', zone: 'Салтовка', code: '' } }, env);
});

test('cardSave: поле, яке змінили з іншого місця (orig не збігається) - помилка, нічого не записано', async () => {
  const { env, st } = on();
  await assert.rejects(S.admCardSave({ storeId: 'вул а 1', orig: { label: 'Стара', daysVeg: 'Пн, Ср' }, set: { label: 'Х' } }, env), /«Назва» вже змінили \(зараз: Магазин 1\)/);
  await assert.rejects(S.admCardSave({ storeId: 'вул а 1', orig: { bread: false }, set: { bread: true } }, env), /«Хліб Рома» вже змінили/);
  assert.equal(st.patches.length, 0);
  await S.admCardSave({ storeId: 'вул а 1', orig: { label: 'Магазин 1', daysVeg: 'Ср, Пн' }, set: { label: 'Х' } }, env);
  await assert.rejects(S.admCardSave({ storeId: 'нема', set: { code: '1' } }, env), /не знайдено/);
});

test('cardAdd: id з адреси, адреси напрямків за замовчуванням = основна, sort = максимум + 10, журнал', async () => {
  const { env, st } = on();
  const r = await S.admCardAdd({ address: 'м. Харків, вул. Нова, 5', label: 'Нова 5', code: '77', route: 'М2', bakery: true, veg: true, daysVeg: 'Вт, Пт', zone: 'Центр', addrVeg: 'Нова 5 овочі' }, env);
  assert.deepEqual(r, { id: 'м харків вул нова 5', label: 'Нова 5' });
  const row = st.inserted[0];
  assert.equal(row.sort, 20);
  assert.equal(row.active, true);
  assert.deepEqual([row.addr_bread, row.addr_bakery, row.addr_veg, row.addr_nbhz], ['м. Харків, вул. Нова, 5', 'м. Харків, вул. Нова, 5', 'Нова 5 овочі', 'м. Харків, вул. Нова, 5']);
  assert.deepEqual([row.bread, row.nbhz, row.bakery, row.veg, row.days_veg, row.days_bakery, row.type], [false, false, true, true, 'Вт, Пт', '', 'Магазин']);
  assert.match(st.log[0][1], /Нова 5 .*Випічка, Овочі/);
  const d = await S.admCardAdd({ address: 'Без назви 1', nbhz: true }, env);
  assert.equal(d.label, 'Без назви 1', 'назва за замовчуванням - адреса');
});

test('cardAdd: адреса обов\'язкова, напрямок обов\'язковий, дубль адреси (і вимкнена точка), збіг ключа в сирому листі напрямку', async () => {
  const { env, st } = on();
  const bad = (p, re) => assert.rejects(S.admCardAdd(p, env), re);
  await bad({ address: '  ', bread: true }, /Адреса обов'язкова/);
  await bad({ address: '!!!', bread: true }, /літери або цифри/);
  await bad({ address: 'Нова 6' }, /хоча б один напрямок/);
  await bad({ address: 'ВУЛ. А,  1', bread: true }, /вже є: Магазин 1/);
  await bad({ address: 'Вул А 1 к2', bread: true, code: 'x' }, /тільки цифри/);
  st.rows[0].active = false;
  await bad({ address: 'вул. а 1', bread: true }, /вимкнена - увімкніть/);
  st.rows[0].active = true;
  // інша адреса точки, але адреса для овочів збігається з існуючою овочевою ключем
  await bad({ address: 'Зовсім інша 9', veg: true, addrVeg: 'вул. А, 1' }, /«Овочі» збігається з точкою «Магазин 1»/);
  assert.equal(st.inserted.length, 0);
  await S.admCardAdd({ address: 'Зовсім інша 9', veg: true, addrVeg: 'вул. А, 2' }, env);
  assert.equal(st.inserted.length, 1);
});
