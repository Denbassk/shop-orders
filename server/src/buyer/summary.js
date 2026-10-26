// Зведення «Сьогодні» з листів Google: розбір звітів, які збирає Apps Script (формат - як у бойових таблицях 21.10.2026).
// Кожна функція отримує рядки листів (sheets.read().rows, null - листа немає) і повертає
// { unit, stats:[{k,v}], top:[{name,qty,sum}], groups:{title,list}, missing:[...]|null, missingTitle, note }.
const txt = (v) => String(v == null ? '' : v).trim();
function num(v) {
  const s = txt(v).replace(/[\s\u00a0]/g, '').replace(/(грн|шт|кг|%)$/i, '').replace(',', '.');
  return /^-?\d+(\.\d*)?$/.test(s) ? parseFloat(s) : null;
}
const fmt = (n) => (n == null ? '-' : (Math.round(n * 100) / 100).toLocaleString('uk-UA'));
const filled = (r) => (r || []).filter((v) => txt(v) !== '');
const DATE = /^\d{2}\.\d{2}\.\d{4}$/;
const norm = (s) => txt(s).toLowerCase().replace(/·\s*юа/g, '').replace(/[^a-zа-яіїєґ0-9]/gi, '');

function addTo(m, k, qty, sum) {
  const a = m.get(k) || { qty: 0, sum: null };
  a.qty += qty || 0;
  if (sum != null) a.sum = (a.sum || 0) + sum;
  m.set(k, a);
}
const top = (m, n = 10) => [...m.entries()]
  .map(([name, a]) => ({ name, qty: Math.round(a.qty * 1000) / 1000, sum: a.sum == null ? null : Math.round(a.sum * 100) / 100 }))
  .sort((x, y) => y.qty - x.qty).slice(0, n);

// «ТТ без замовлень (N):» і далі по одній адресі в рядку; або хвіст рядків з відступом (Данные Заказов)
function missingList(rows) {
  if (!rows) return null;
  const i = rows.findIndex((r) => /без\s+(замовлен|заказ)/i.test(r.join(' ')));
  const out = [];
  if (i >= 0) {
    for (let k = i + 1; k < rows.length; k++) {
      const f = filled(rows[k]);
      if (!f.length) continue;
      if (f.length !== 1) break;
      out.push(txt(f[0]));
    }
    return out;
  }
  for (let k = rows.length - 1; k > 0; k--) {
    const r = rows[k];
    if (filled(r).length === 1 && /^\s+\S/.test(String(r[0]))) out.unshift(txt(r[0])); else break;
  }
  return out.length ? out : null;
}
function coverage(rows) {
  for (const r of rows || []) { const m = /ТТ із замовленнями:\s*(\d+)\s*з\s*(\d+)/i.exec(r.join(' ')); if (m) return [+m[1], +m[2]]; }
  return null;
}
function totalRow(rows, re, qi, si) {
  const r = (rows || []).find((x) => re.test(txt(x[0])));
  return r ? { qty: num(r[qi]), sum: num(r[si]) } : { qty: null, sum: null };
}
const covText = (c, n) => (c ? c[0] + ' з ' + c[1] : String(n == null ? '-' : n));

function bread({ orders, summary }) {
  if (!orders) throw new Error('Немає листа «Заказы» - звіт ще не зібрано');
  const stores = new Set(), routes = new Map(), prods = new Map();
  let lines = 0, qty = 0;
  orders.forEach((r) => {
    if (!DATE.test(txt(r[0]))) return;
    const q = num(r[5]) || 0;
    lines++; qty += q; stores.add(txt(r[2]));
    addTo(routes, txt(r[1]) || 'Без маршруту', q);
    addTo(prods, txt(r[4]), q);
  });
  const missing = missingList(summary);
  return { unit: 'шт',
    stats: [{ k: 'точок замовило', v: stores.size + (missing ? ' з ' + (stores.size + missing.length) : '') },
      { k: 'штук', v: fmt(qty) }, { k: 'рядків', v: String(lines) }, { k: 'маршрутів', v: String(routes.size) }],
    top: top(prods), groups: { title: 'По маршрутах', list: top(routes, 60) }, missing, missingTitle: 'Не замовили' };
}

function nbhz({ exportRows, routes, title }) {
  if (!exportRows || !exportRows.length) throw new Error('Вивантаження за сьогодні ще немає');
  const head = exportRows[0];
  const body = exportRows.slice(1).filter((r) => txt(r[1]));
  const prods = new Map(), rmap = new Map();
  let qty = 0;
  body.forEach((r) => {
    let rq = 0;
    for (let c = 2; c < head.length; c++) { const q = num(r[c]) || 0; if (q) addTo(prods, txt(head[c]), q); rq += q; }
    qty += rq;
    addTo(rmap, txt(r[0]) || 'Без маршруту', rq);
  });
  let missing = null, all = null;
  if (routes) {
    const list = routes.slice(1).filter((r) => txt(r[2]));
    all = list.length;
    const have = new Set(body.map((r) => norm(r[1])));
    missing = list.filter((r) => !have.has(norm(r[2]))).map((r) => txt(r[2]) + (txt(r[0]) ? ' · ' + txt(r[0]) : ''));
  }
  return { unit: 'шт',
    stats: [{ k: 'точок у вивантаженні', v: body.length + (all ? ' з ' + all : '') }, { k: 'штук', v: fmt(qty) },
      { k: 'позицій', v: String(prods.size) }, { k: 'маршрутів', v: String(rmap.size) }],
    top: top(prods), groups: { title: 'По маршрутах', list: top(rmap, 60) }, missing,
    missingTitle: 'Немає у вивантаженні', note: title || '' };
}

function bakery({ orders, summary, routes }) {
  if (!orders) throw new Error('Немає листа «Заказы ВК» - звіт ще не зібрано');
  const cov = coverage(orders);
  const tot = totalRow(orders, /^ЗАГАЛЬНИЙ ПІДСУМОК/i, 2, 3);
  const prods = new Map(), cats = [];
  if (summary) {
    const names = summary.map((r) => txt(r[0]));
    summary.forEach((r, i) => {
      const n = txt(r[0]), q = num(r[1]);
      if (!n || q == null || /^ЗАГАЛОМ/i.test(n)) return;
      if (names.some((x, j) => j > i && x.startsWith(n + ' '))) cats.push({ name: n, qty: q, sum: num(r[2]) });
      else addTo(prods, n, q, num(r[2]));
    });
  }
  const rl = (routes || []).filter((r) => /^ВСЬОГО\s+/i.test(txt(r[0])))
    .map((r) => ({ name: txt(r[0]).replace(/^ВСЬОГО\s+/i, ''), qty: num(r[2]) || 0, sum: null }));
  let missing = missingList(orders);
  if (!missing && cov && cov[0] === cov[1]) missing = [];
  return { unit: 'шт',
    stats: [{ k: 'точок замовило', v: covText(cov) }, { k: 'штук', v: fmt(tot.qty) }, { k: 'гривень', v: fmt(tot.sum) }]
      .concat(cats.map((c) => ({ k: c.name.toLowerCase() + ', шт', v: fmt(c.qty) }))),
    top: top(prods), groups: { title: 'Розвозка по маршрутах', list: rl }, missing, missingTitle: 'Не замовили' };
}

// Колонки кількості і суми беремо із шапки листа: з 26.10.2026 «Сума, грн» стоїть перед «Кількість, кг» (раніше навпаки)
function vegCols(rows) {
  const h = (rows || []).find((r) => (r || []).some((v) => /^Кількість/i.test(txt(v))) && (r || []).some((v) => /^Сума/i.test(txt(v))));
  if (!h) return { qi: 3, si: 4 };
  return { qi: h.findIndex((v) => /^Кількість/i.test(txt(v))), si: h.findIndex((v) => /^Сума/i.test(txt(v))) };
}
function veg({ orders, summary }) {
  if (!orders) throw new Error('Немає листа «Замовлення Овочі» - звіт ще не зібрано');
  const cov = coverage(orders);
  const oc = vegCols(orders), sc = vegCols(summary);
  const tot = totalRow(orders, /^ЗАГАЛЬНИЙ ПІДСУМОК/i, oc.qi, oc.si);
  const prods = new Map();
  (summary || []).forEach((r) => { if (num(r[0]) != null && txt(r[1])) addTo(prods, txt(r[1]), num(r[sc.qi]), num(r[sc.si])); });
  let missing = missingList(orders);
  if (!missing && cov && cov[0] === cov[1]) missing = [];
  return { unit: 'кг',
    stats: [{ k: 'точок замовило', v: covText(cov) }, { k: 'кг', v: fmt(tot.qty) }, { k: 'гривень', v: fmt(tot.sum) },
      { k: 'позицій', v: String(prods.size) }],
    top: top(prods), groups: null, missing, missingTitle: 'Не замовили' };
}

module.exports = { bread, nbhz, bakery, veg, num, missingList, coverage };