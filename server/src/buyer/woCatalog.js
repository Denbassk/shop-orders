// Excel «Каталог списань»: уся номенклатура випічки і кулінарії (таблиця products), з ціною списання без націнки і з націнкою.
// Це не звіт про списання: позиції беруться з асортименту, тому є й ті, що ніхто не списував, і «стоп» (продавцям у списанні показується весь асортимент).
// Ціна - собівартість (products.cost); з націнкою - та сама формула, що в списанні продавця (woPlus: +20%).
const { packXlsx, S, r2, uk, dmyOf, ReportError } = require('./woReport');
const { woPlus } = require('../api/writeoff');
const R = require('../rules');

const TITLE = 'Каталог списань випічки і кулінарії';
const HEAD = ['№', 'Категорія', 'Товар', 'Штрихкод', 'Ціна, грн', 'Ціна з націнкою, грн', 'Статус', 'Доступ по точках', 'Примітка'];
const WIDTHS = [5, 22, 58, 16, 12, 15, 11, 34, 26];
const NO_COST = 'немає собівартості - в списанні сума 0';

// p: рядок з buyerProducts: { name, barcode, category, cost, stop, access: { mode, stores } }; labels: Map(storeId -> назва точки)
function accessText(a, labels) {
  const names = ((a && a.stores) || []).map((id) => labels.get(String(id)) || String(id));
  if (a && a.mode === 'only') return 'лише: ' + names.join(', ');
  if (a && a.mode === 'except') return 'усім, крім: ' + names.join(', ');
  return 'усім';
}

// data - відповідь дії products закупниці: { products, stores: [{ id, label }] }
function buildCatalog(data) {
  const labels = new Map(((data && data.stores) || []).map((s) => [String(s.id), s.label]));
  const items = ((data && data.products) || []).map((p) => {
    const cost = Number(p.cost) || 0;
    return { name: String(p.name || '').trim(), category: String(p.category || '').trim() || 'Інше', barcode: String(p.barcode || '').trim(),
      price: r2(cost), price20: cost > 0 ? woPlus(cost) : 0, stop: !!p.stop, access: accessText(p.access, labels), noCost: !(cost > 0) };
  }).filter((x) => x.name).sort((a, b) => uk(a.category, b.category) || uk(a.name, b.name));
  return { items, total: items.length, noCost: items.filter((x) => x.noCost).length, stop: items.filter((x) => x.stop).length };
}

function catalogModel(rep, at) {
  const T = (t, s = S.def) => ({ t, s }), N = (n, s) => ({ n, s }), E = (s) => ({ s });
  const k = R.kyivNow(at);
  const m = [];
  m.push([T(TITLE, S.title)]);
  m.push([T('Позицій: ' + rep.total + (rep.stop ? ' (зі статусом «стоп»: ' + rep.stop + ')' : '') + ' · без собівартості: ' + rep.noCost, S.bold)]);
  m.push([T('Сформовано: ' + k.dmy + ' ' + k.time.slice(0, 5) + ' (за Києвом). Ціна - собівартість; «з націнкою» - +20%, як рахується сума списання продавця.', S.ital)]);
  m.push([]);
  m.push(HEAD.map((h) => T(h, S.head)));
  rep.items.forEach((x, i) => {
    const st = x.noCost ? S.itemRed : S.text;
    m.push([N(i + 1, S.qty), T(x.category, S.text), T(x.name, st), T(x.barcode, S.text),
      x.noCost ? E(S.text) : N(x.price, S.money), x.noCost ? E(S.text) : N(x.price20, S.money),
      T(x.stop ? 'стоп' : 'активна', S.text), T(x.access, S.text), T(x.noCost ? NO_COST : '', st)]);
  });
  return m;
}

// deps.load() -> відповідь дії products закупниці; deps.at - «зараз» для тестів
async function catalogReport(dir, p = {}, deps = {}) {
  if (dir !== 'bakery') throw new ReportError('Каталог списань є лише у випічки і кулінарії');
  if (!deps.load) throw new Error('Каталог списань: не задано джерело позицій');
  const at = deps.at || new Date();
  const rep = buildCatalog(await deps.load());
  if (!rep.total) throw new ReportError('В асортименті немає позицій');
  const k = R.kyivNow(at);
  return { name: 'Каталог списань ВК ' + dmyOf(k.day) + '.xlsx',
    buf: packXlsx([{ name: 'Каталог', model: catalogModel(rep, at), widths: WIDTHS, freeze: 5, repeat: 5 }]) };
}

module.exports = { buildCatalog, catalogModel, catalogReport };
