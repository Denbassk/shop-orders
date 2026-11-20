// Пульт: «Новые позиции в прайсе» для овощей - перегляд і додавання позицій, яких ще нема в асортименті (admin/vegNew.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DIRECTIONS } = require('../src/directions');
const V = require('../src/admin/vegNew');

const AT = new Date('2026-11-19T11:00:00+02:00');
const PRICE_ROWS = [
  { name: 'Картопля', price: 17 },
  { name: 'Морква', price: 19 },
  { name: 'Мандарин (Муркот)', price: 110 },
];

function mk(products, priceRows = PRICE_ROWS, o = {}) {
  const st = { rows: products, added: [], log: [] };
  const env = {
    at: AT, log: () => {},
    vegPriceRows: async () => priceRows,
    adm: {
      dirProducts: async () => st.rows.map((r) => ({ ...r })),
      addProduct: async (row) => {
        st.added.push(row);
        if (o.failOn && st.added.length === o.failOn) throw new Error('products: збій запису');
        st.rows.push({ ...row });
      },
      adminLog: async (a, d) => { st.log.push([a, d]); },
    },
  };
  return { env, st };
}

test('vegNewPreview: позиції прайсу, яких ще нема в products (за назвою), за абеткою', async () => {
  const { env } = mk([{ id: 'Морква', name: 'Морква', price: 18, status: 'active', sort: 0 }]);
  const r = await V.admVegNewPreview({ dir: 'veg' }, env);
  assert.equal(r.dir, 'veg');
  assert.deepEqual(r.rows, [{ name: 'Картопля', price: 17 }, { name: 'Мандарин (Муркот)', price: 110 }]);
  assert.equal(r.n, 2);
});

test('vegNewPreview: назва з прайсу збігається з products навіть при інших дужках/пробілах (nameKey)', async () => {
  const { env } = mk([{ id: 'x', name: 'Мандарин  (Муркот)', price: 100, status: 'stop', sort: 1000 }]);
  const r = await V.admVegNewPreview({ dir: 'veg' }, env);
  assert.deepEqual(r.rows.map((x) => x.name), ['Картопля', 'Морква']);
});

test('vegNewApply: додає вибрані позиції зі статусом "стоп", sort після наявних активних, один запис у журнал', async () => {
  const { env, st } = mk([{ id: 'p1', name: 'Буряк', price: 18, status: 'active', sort: 2 }]);
  const r = await V.admVegNewApply({ dir: 'veg', access: { mode: 'all' }, names: ['Картопля', 'Мандарин (Муркот)'] }, env);
  assert.equal(r.added, 2);
  assert.deepEqual(st.added, [
    { dir: 'veg', id: 'Картопля', name: 'Картопля', price: 17, status: 'stop', sort: 3, access_mode: 'all', access_stores: [] },
    { dir: 'veg', id: 'Мандарин (Муркот)', name: 'Мандарин (Муркот)', price: 110, status: 'stop', sort: 4, access_mode: 'all', access_stores: [] },
  ]);
  assert.deepEqual(st.log, [['Додано в асортимент', DIRECTIONS.veg.title + ': з прайсу (стоп, доступ - усім точкам) - 2 поз.: Картопля; Мандарин (Муркот)']]);
});

test('vegNewApply: порожній вибір, дубль, забагато - помилки до запису', async () => {
  const go = (p) => V.admVegNewApply({ dir: 'veg', access: { mode: 'all' }, ...p }, mk([]).env);
  await assert.rejects(go({ names: [] }), { message: 'Оберіть позиції' });
  await assert.rejects(go({}), { message: 'Оберіть позиції' });
  await assert.rejects(go({ names: ['Картопля', 'картопля'] }), { message: 'Позиція вказана двічі' });
  await assert.rejects(go({ names: Array.from({ length: 201 }, (_, i) => 'x' + i) }), /не більше 200/);
});

test('vegNewApply: позиції вже нема серед нових (з\'явилась у products або зникла з прайсу з моменту перегляду)', async () => {
  const { env } = mk([{ id: 'Картопля', name: 'Картопля', price: 17, status: 'active', sort: 0 }]);
  await assert.rejects(V.admVegNewApply({ dir: 'veg', access: { mode: 'all' }, names: ['Картопля'] }, env), /вже немає серед нових/);
  await assert.rejects(V.admVegNewApply({ dir: 'veg', access: { mode: 'all' }, names: ['Таке не знайдеш'] }, mk([]).env), /вже немає серед нових/);
});

test('vegNewApply: збій посеред запису - у журналі лише додане, помилка нагору', async () => {
  const { env, st } = mk([], PRICE_ROWS, { failOn: 2 });
  await assert.rejects(V.admVegNewApply({ dir: 'veg', access: { mode: 'all' }, names: ['Картопля', 'Морква'] }, env), /збій запису/);
  assert.deepEqual(st.log, [['Додано в асортимент', DIRECTIONS.veg.title + ': з прайсу (стоп, доступ - усім точкам) - 1 поз. (збій на «Морква», решту не додано): Картопля']]);
});

test('runtime: vegNewPreview / vegNewApply підключено до пульту', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'runtime.js'), 'utf8');
  for (const s of ['vegNewPreview: (p) => vegNew.admVegNewPreview(p, env())', 'vegNewApply: (p) => vegNew.admVegNewApply(p, env())']) assert.ok(src.includes(s), s);
});

test('пульт: экран «Ассортимент» овощей - блок «Новые позиции в прайсе» с кнопкой проверки и добавлением на стопе', () => {
  const html = require('../scripts/build-admin').build();
  const tail = html.slice(html.indexOf('shop-orders: ассортимент и цены'));
  for (const s of ['Новые позиции в прайсе', 'function vnPreview(', "call('vegNewPreview'", 'function askVnApply(', "call('vegNewApply'",
    'Добавить отмеченные (на стопе)', 'продавцы их не увидят, пока вы сами не снимете стоп']) assert.ok(tail.includes(s), s);
  const draw = tail.slice(tail.indexOf('function drawAssort('), tail.indexOf('function asMode('));
  assert.ok(draw.includes('if (d.priceLocked)') && draw.includes('vnPreview()'), 'блок новых позиций показывается только когда цены из прайса (овощи)');
});
