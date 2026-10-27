// Excel «Звіт за період»: аркуші по точках, товарах, продавцях, категоріях і юрособах + «Підсумок».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSlices, buildSlicesXlsx, summaryModel, slicesReport } = require('../src/buyer/woSlices');
const { ReportError } = require('../src/buyer/woReport');
const { unzip } = require('../src/buyer/xlsxLocal');
const { buyerKey } = require('../src/buyer/link');
const { createApp } = require('../src/app');

const FEM = 'Фемели Маркет', UA = 'ЮА Маркет';
let n = 0;
const row = (over) => ({ id: 'd' + (++n), day: '2026-10-23', at: '2026-10-23', time: '10:00', store: 'Байрона, 138/1', code: '31',
  cat: 'Кулінарія', name: 'Салат А', qty: 1, price: 10, sum: 10, sum20: 12, seller: 'Фадеева', entity: FEM, ...over });
const ROWS = [
  row({ id: 'a', name: 'Салат А', qty: 2, price: 10, sum: 20, sum20: 24 }),
  row({ id: 'a', name: 'Хліб', cat: 'Випічка', qty: 3, price: 10, sum: 30, sum20: 36 }),
  row({ id: 'b', name: 'Салат А', qty: 1, price: 10, sum: 10, sum20: 12, seller: 'Іванова' }),
  row({ id: 'c', store: 'Зернова, 6/5', code: '38', name: 'Салат А', qty: 4, price: 10, sum: 40, sum20: 48, seller: 'Стасюк' }),
  row({ id: 'd', entity: UA, store: 'Танкопія, 16', code: '12', name: 'Борщ', qty: 2, price: 0, sum: 0, sum20: 0, seller: 'Лыч' }),   // без собівартості
  row({ id: 'e', entity: UA, store: 'Танкопія, 16', code: '12', name: 'Борщ', qty: 1, price: 24, sum: 24, sum20: 28.8, seller: 'Лыч', day: '2026-10-22' }),   // та сама позиція вже з собівартістю
  row({ id: 'f', day: '2026-10-10', name: 'Старе', qty: 9, price: 1, sum: 9, sum20: 10 }),
];
const inRange = (from, to) => ROWS.filter((x) => x.day >= from && x.day <= to);
const parts = (buf) => Object.fromEntries(unzip(buf).map((f) => [f.name, f.data.toString('utf8')]));

test('звіт за період: групи за собівартістю, склад груп, частка від загальної суми, підсумки', () => {
  const r = buildSlices(inRange('2026-10-22', '2026-10-23'), { from: '2026-10-22', to: '2026-10-23' });
  assert.deepEqual([r.total.qty, r.total.sum, r.total.sum20, r.total.docs, r.total.stores, r.total.rows], [13, 124, 148.8, 5, 3, 6]);
  const by = Object.fromEntries(r.slices.map((s) => [s.key, s]));
  assert.deepEqual(r.slices.map((s) => s.sheet), ['Точки', 'Товари', 'Продавці', 'Категорії', 'Юрособи']);
  assert.deepEqual(by.stores.groups.map((g) => [g.name, g.sum]), [['Байрона, 138/1 · №31', 60], ['Зернова, 6/5 · №38', 40], ['Танкопія, 16 · №12', 24]]);
  const bay = by.stores.groups[0];
  assert.deepEqual([bay.qty, bay.docs, bay.sum20, Math.round(bay.share * 1000) / 1000], [6, 2, 72, 0.484]);
  assert.deepEqual(bay.items.map((i) => [i.name, i.qty, i.sum]), [['Хліб', 3, 30], ['Салат А', 3, 30]].sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0], 'uk')));
  assert.deepEqual(by.products.groups.map((g) => [g.name, g.qty, g.sum]), [['Салат А', 7, 70], ['Хліб', 3, 30], ['Борщ', 3, 24]]);
  assert.deepEqual(by.products.groups[0].items.map((i) => i.name), ['Зернова, 6/5 · №38', 'Байрона, 138/1 · №31'], 'склад товару - точки');
  assert.deepEqual(by.sellers.groups.map((g) => g.name), ['Фадеева · Байрона, 138/1', 'Стасюк · Зернова, 6/5', 'Лыч · Танкопія, 16', 'Іванова · Байрона, 138/1']);
  assert.deepEqual(by.cats.groups.map((g) => g.name), ['Кулінарія', 'Випічка']);
  assert.deepEqual(by.entities.groups.map((g) => [g.name, g.sum]), [[FEM, 100], [UA, 24]]);
  assert.deepEqual(by.entities.groups[0].items.map((i) => i.name), ['Кулінарія', 'Випічка'], 'склад юрособи - категорії');
  for (const s of r.slices) assert.equal(Math.round(s.groups.reduce((a, g) => a + g.sum, 0) * 100) / 100, 124, s.key + ': групи в сумі = загальна сума');
  assert.equal(buildSlices([], { from: 'a', to: 'b' }), null);
});

test('звіт за період: позиція без собівартості (сума 0) і «частково» - позначені, перелік у підсумку', () => {
  const r = buildSlices(inRange('2026-10-22', '2026-10-23'), { from: '2026-10-22', to: '2026-10-23' });
  assert.deepEqual([r.total.zeroRows, r.total.zeroNames], [1, ['Борщ']]);
  const borsch = r.slices.find((s) => s.key === 'stores').groups.find((g) => g.name.startsWith('Танкопія')).items[0];
  assert.equal(borsch.cost, 'part', 'один рядок з нулем, один - з ціною');
  const only = buildSlices([ROWS[4]], { from: '2026-10-23', to: '2026-10-23' });
  assert.equal(only.slices[0].groups[0].items[0].cost, 'none');
  assert.equal(only.slices[0].groups[0].share, 0, 'сума 0 - частка 0, не NaN');
  const cells = summaryModel(only, new Date('2026-10-23T12:00:00Z')).flat().map((c) => c.t || '');
  assert.ok(cells.some((t) => t.includes('Позиції без собівартості')) && cells.includes('• Борщ'));
});

test('xlsx звіту за період: 6 аркушів з назвами, шапка закріплена і друкується на кожній сторінці, числа - числами, підписи колонок', () => {
  const rep = buildSlices(inRange('2026-10-22', '2026-10-23'), { from: '2026-10-22', to: '2026-10-23', entity: '', cat: '' });
  const p = parts(buildSlicesXlsx(rep, new Date('2026-10-23T12:00:00Z')));
  const wb = p['xl/workbook.xml'];
  for (const nm of ['Підсумок', 'Точки', 'Товари', 'Продавці', 'Категорії', 'Юрособи']) assert.ok(wb.includes('name="' + nm + '"'), nm);
  for (let i = 1; i <= 6; i++) assert.ok(p['xl/worksheets/sheet' + i + '.xml'], 'sheet' + i);
  assert.equal((wb.match(/_xlnm\.Print_Titles/g) || []).length, 5, 'шапка друкується на кожній сторінці п’яти аркушів');
  assert.ok(wb.includes("'Точки'!$5:$5"));
  const st = p['xl/worksheets/sheet2.xml'];
  assert.ok(st.includes('<pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/>'));
  for (const t of ['Списання випічки і кулінарії - Точки', 'Період: 22.10.2026 – 23.10.2026 · Юрособа: усі · Категорія: усі', 'Списано, шт', 'Подач', 'Собівартість, грн', 'З націнкою, грн', 'Частка, %', 'РАЗОМ', 'Байрона, 138/1 · №31'])
    assert.ok(st.includes(t), t);
  assert.ok(p['xl/worksheets/sheet1.xml'].includes('Сформовано: 23.10.2026 15:00 (за Києвом)'));
  assert.ok(p['xl/worksheets/sheet1.xml'].includes('Як читати') && p['xl/worksheets/sheet1.xml'].includes('+15%'));
  assert.ok(p['xl/worksheets/sheet6.xml'].includes('Юрособа') && p['xl/worksheets/sheet6.xml'].includes(UA));
  for (let i = 1; i <= 6; i++) assert.ok(!/undefined|NaN/.test(p['xl/worksheets/sheet' + i + '.xml']), 'sheet' + i);
  const nums = [...st.matchAll(/<c r="[A-Z]+\d+"(?: s="\d+")?><v>([^<]+)<\/v><\/c>/g)].map((m) => Number(m[1]));
  assert.ok(nums.includes(60) && nums.includes(72) && nums.every(Number.isFinite));
  assert.ok(st.includes('Борщ (частково без собівартості)') || p['xl/worksheets/sheet2.xml'].includes('частково без собівартості'));
  assert.ok(p['xl/styles.xml'].includes('formatCode="0.0%"'));
});

test('xlsx звіту за період: індекси стилів існують у styles.xml, шапка і заливка груп не збивають стилі звіту за день', () => {
  const rep = buildSlices(inRange('2026-10-22', '2026-10-23'), { from: '2026-10-22', to: '2026-10-23' });
  const p = parts(buildSlicesXlsx(rep));
  const count = Number(p['xl/styles.xml'].match(/<cellXfs count="(\d+)"/)[1]);
  assert.equal((p['xl/styles.xml'].match(/<xf /g) || []).length, count + 1, 'cellStyleXfs 1 + cellXfs');
  for (let i = 1; i <= 6; i++) {
    const used = [...p['xl/worksheets/sheet' + i + '.xml'].matchAll(/ s="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(used.length && used.every((x) => x < count), 'sheet' + i + ' max ' + Math.max(...used) + ' з ' + count);
  }
});

// ---------- slicesReport ----------
const AT = new Date('2026-10-23T14:00:00+03:00');
const loadOk = (list = ROWS, books = [FEM, UA], errors = []) => async (arch, fresh) => { loadOk.arch = arch; loadOk.fresh = fresh; return { list, meta: { books, errors } }; };

test('slicesReport: пресет днів, довільні дати, фільтри юрособи і категорії; назва файлу; читає таблиці свіжо', async () => {
  const f = await slicesReport('bakery', { from: '2026-10-22', to: '2026-10-23' }, { load: loadOk(), at: AT });
  assert.equal(f.name, 'Списання ВК за період 22.10.2026-23.10.2026.xlsx');
  assert.equal(loadOk.fresh, true); assert.equal(loadOk.arch, false);
  assert.ok(Buffer.isBuffer(f.buf) && f.buf.readUInt32LE(0) === 0x04034b50);
  assert.ok(!parts(f.buf)['xl/worksheets/sheet2.xml'].includes('Старе'), 'старіший день не потрапляє');
  const d7 = await slicesReport('bakery', { days: '7' }, { load: loadOk(), at: AT });
  assert.equal(d7.name, 'Списання ВК за період 17.10.2026-23.10.2026.xlsx');
  const one = await slicesReport('bakery', { from: '2026-10-23', entity: UA, cat: 'Кулінарія' }, { load: loadOk(), at: AT });
  assert.equal(one.name, 'Списання ВК за період 23.10.2026 ЮА Маркет Кулінарія.xlsx');
  const sh = parts(one.buf)['xl/worksheets/sheet2.xml'];
  assert.ok(sh.includes('Юрособа: ЮА Маркет · Категорія: Кулінарія') && sh.includes('Танкопія') && !sh.includes('Байрона'));
  const rev = await slicesReport('bakery', { from: '2026-10-23', to: '2026-10-22' }, { load: loadOk(), at: AT });
  assert.equal(rev.name, 'Списання ВК за період 22.10.2026-23.10.2026.xlsx', 'перевернутий діапазон');
});

test('slicesReport: період глибше 31 дня читає й архів', async () => {
  await slicesReport('bakery', { from: '2026-10-10', to: '2026-10-10' }, { load: loadOk(), at: AT });
  assert.equal(loadOk.arch, false);
  await assert.rejects(slicesReport('bakery', { from: '2026-08-01', to: '2026-08-02' }, { load: loadOk(), at: AT }), /немає/);
  assert.equal(loadOk.arch, true);
});

test('slicesReport: помилки з людським текстом (ReportError)', async () => {
  const d = { load: loadOk(), at: AT };
  const bad = (p, re, dir = 'bakery', deps = d) => assert.rejects(slicesReport(dir, p, deps), (e) => e instanceof ReportError && re.test(e.message), JSON.stringify(p));
  await bad({ days: 7 }, /лише у випічки/, 'veg');
  await bad({ from: '2026-13-01' }, /Невірна дата/);
  await bad({ from: '2026-10-24' }, /майбутньому/);
  await bad({ from: '2020-01-01', to: '2026-10-23' }, /задовгий/);
  await bad({ from: '2026-10-23', entity: 'Хтось' }, /Невідома юрособа/);
  await bad({ from: '2026-10-20', to: '2026-10-20' }, /Списань за 20\.10\.2026 немає/);
  await bad({ from: '2026-10-23' }, /Не вдалося прочитати списання: ЮА Маркет: немає доступу/, 'bakery', { load: loadOk(ROWS, [FEM], ['ЮА Маркет: немає доступу']), at: AT });
});

// ---------- HTTP ----------
async function withApp(opts, fn) {
  const srv = createApp(opts).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  try { await fn('http://127.0.0.1:' + srv.address().port); } finally { await new Promise((r) => srv.close(r)); }
}
const S = 'unit-secret';

test('http: GET /buyer/bakery/<ключ>/writeoff-slices/bakery -> xlsx; параметри періоду і фільтрів доходять; чужий напрямок і ключ 404; ReportError 400; збій 502; звіт за день працює як раніше', async () => {
  const calls = [];
  let mode = 'ok';
  const buyerWoSlices = async (dir, p) => {
    calls.push([dir, p]);
    if (mode === 'user') throw new ReportError('Списань за період немає');
    if (mode === 'boom') throw new Error('Google впав');
    return { name: 'Списання ВК за період 22.10.2026-23.10.2026.xlsx', buf: Buffer.from('PKsl') };
  };
  const buyerWoReport = async (dir, p) => ({ name: 'Списання ВК ' + p.entity + '.xlsx', buf: Buffer.from('PKday') });
  await withApp({ buyerLinkSecret: S, buyerWoSlices, buyerWoReport }, async (b) => {
    const base = b + '/buyer/bakery/' + buyerKey('bakery', S) + '/';
    const q = '?from=2026-10-22&to=2026-10-23&entity=' + encodeURIComponent(UA) + '&cat=' + encodeURIComponent('Кулінарія');
    let r = await fetch(base + 'writeoff-slices/bakery' + q);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    assert.ok(r.headers.get('content-disposition').includes(encodeURIComponent('Списання ВК за період 22.10.2026-23.10.2026.xlsx')));
    assert.equal(await r.text(), 'PKsl');
    assert.deepEqual(calls[0], ['bakery', { days: '', from: '2026-10-22', to: '2026-10-23', entity: UA, cat: 'Кулінарія', slice: '' }]);
    assert.equal((await fetch(base + 'writeoff-slices/veg' + q)).status, 404);
    assert.equal((await fetch(b + '/buyer/bakery/' + buyerKey('hlib', S) + '/writeoff-slices/bakery' + q)).status, 404);
    r = await fetch(base + 'writeoff-report/bakery?date=2026-10-23&entity=' + encodeURIComponent(UA));
    assert.equal(await r.text(), 'PKday');
    mode = 'user';
    r = await fetch(base + 'writeoff-slices/bakery' + q);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'Списань за період немає');
    mode = 'boom';
    assert.equal((await fetch(base + 'writeoff-slices/bakery' + q)).status, 502);
  });
});

// ---------- окремі звіти з кнопок у кутах карток ----------
test('окремий звіт (slice): один аркуш без «Підсумок», назва з назвою звіту; невідомий звіт - помилка', async () => {
  const f = await slicesReport('bakery', { from: '2026-10-22', to: '2026-10-23', slice: 'products' }, { load: loadOk(), at: AT });
  assert.equal(f.name, 'Списання ВК Товари 22.10.2026-23.10.2026.xlsx');
  const p = parts(f.buf);
  assert.ok(p['xl/worksheets/sheet1.xml'] && !p['xl/worksheets/sheet2.xml']);
  assert.ok(p['xl/workbook.xml'].includes('name="Товари"') && !p['xl/workbook.xml'].includes('Підсумок'));
  assert.ok(p['xl/worksheets/sheet1.xml'].includes('Салат А') && p['xl/worksheets/sheet1.xml'].includes('Склад кожного товару'));
  assert.ok(p['xl/workbook.xml'].includes("'Товари'!$5:$5"), 'шапка друкується на кожній сторінці');
  const all = await slicesReport('bakery', { from: '2026-10-22', to: '2026-10-23' }, { load: loadOk(), at: AT });
  assert.ok(parts(all.buf)['xl/worksheets/sheet6.xml'], 'без slice - усі аркуші, як раніше');
  await assert.rejects(slicesReport('bakery', { from: '2026-10-22', slice: 'nope' }, { load: loadOk(), at: AT }), (e) => e instanceof ReportError && /Невідомий звіт: nope/.test(e.message));
});

test('окремий звіт «Подачі»: усі подачі періоду, нові зверху, склад - товари; шапка подачі з датою, точкою, продавцем', async () => {
  const rep = buildSlices(inRange('2026-10-22', '2026-10-23'), { from: '2026-10-22', to: '2026-10-23' }, 'docs');
  const g = rep.slices[0].groups;
  assert.equal(rep.slices[0].sheet, 'Подачі');
  assert.equal(g.length, 5, 'усі 5 подач (a, b, c, d, e), не лише 30 останніх');
  assert.equal(g[0].name.slice(0, 5), '23.10');
  assert.ok(g.some((x) => x.name === '23.10 10:00 · Байрона, 138/1 · №31 · Фадеева · Фемели Маркет'));
  const a = g.find((x) => x.name.includes('Фадеева'));
  assert.deepEqual(a.items.map((i) => [i.name, i.qty, i.sum]), [['Хліб', 3, 30], ['Салат А', 2, 20]]);
  assert.equal(a.docs, 1);
  const p = parts((await slicesReport('bakery', { from: '2026-10-22', to: '2026-10-23', slice: 'docs' }, { load: loadOk(), at: AT })).buf);
  assert.ok(p['xl/worksheets/sheet1.xml'].includes('Подача: дата · точка · продавець'));
});

// ---------- сторінка закупниці ----------
test('сторінка ВК: у куті кожного звіту своя мала кнопка «⬇ Excel» (стара загальна іконка і меню прибрані), запит несе slice, період і фільтри', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  for (const k of ['stores', 'products', 'sellers', 'cats', 'entities', 'docs']) assert.ok(html.includes("woList({ key: '" + k + "',"), k);
  for (const s of ['class="btn dark sm wox"', "onclick=\"woSliceDl(\\'' + o.key + '\\')\"", '⬇ Excel</button>', 'function woSliceDl(key)', "'&slice=' + encodeURIComponent(key)", "'days=' + WO.days",
    "'&entity=' + encodeURIComponent(WO.entity)", "'&cat=' + encodeURIComponent(WO.cat)", "'/writeoff-slices/'", 'function woFetchFile', 'WOREP.busy'])
    assert.ok(html.includes(s), s);
  assert.match(html, /\.btn\.sm\.wox\{position:absolute;top:8px;right:12px/);
  assert.match(html, /\.wolist\{display:flex;flex-direction:column;height:440px/);
  for (const gone of ['wxb', 'wxm', 'woMenu', 'ICO_DL', 'woSlices()']) assert.ok(!html.includes(gone), 'прибрано: ' + gone);
  assert.ok(!html.includes('Поки працює стара система'), 'застаріла підказка прибрана');
});

test('сторінка ВК: заголовки колонок і цифри в списках вирівняні по центру', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'buyer', 'index.html'), 'utf8');
  assert.ok(html.includes('.wocol>*,.wos>:nth-child(n+3),.wi>:nth-child(n+3){text-align:center}'));
  assert.ok(!html.includes('.wi>:nth-child(n+3){text-align:right}'));
});
