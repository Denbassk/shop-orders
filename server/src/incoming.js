// Вхідні ціни з приходів (BigQuery, таблиця incoming_transactions): що змінилось порівняно з прайсом products.
// Лише хліб Рома: у НБХЗ цін немає, овочі беруться з прайсу постачальника, випічка - власне виробництво (там собівартість, не прихід).
// Чисті функції + один запит до BigQuery через переданий клієнт (bq.query(sql, params) -> масив об'єктів).
const P = require('./prices');

// постачальник у приходах записаний двома юрособами; нове юрособа Роми = додати ім'я сюди (інакше його ціни не підтягнуться)
const INCOMING = {
  bread: { suppliers: ['ТОВ КВФ Рома', 'ТОВ Рома'], days: 45 },
};
const BIG_PCT = 30;           // зміна більша за ±30% - підозріла (акція, помилка накладної): у пульті не відмічена за замовчуванням

const TABLE = '`family-market-analytics.family_market.incoming_transactions`';
// остання ціна закупівлі за штрихкодом: останній день прихода, у межах дня - останній за часом/рядком
const SQL = `
SELECT barcode, product_name AS name, doc_date, ROUND(price_purchase, 2) AS price
FROM (
  SELECT barcode, product_name, doc_date, price_purchase,
    ROW_NUMBER() OVER (PARTITION BY barcode ORDER BY doc_date DESC, incoming_datetime DESC, line_number DESC) AS rn
  FROM ${TABLE}
  WHERE supplier IN UNNEST(@suppliers)
    AND doc_date >= DATE_SUB(CURRENT_DATE('Europe/Kyiv'), INTERVAL @days DAY)
    AND quantity > 0 AND price_purchase > 0
    AND barcode IS NOT NULL AND TRIM(barcode) != ''
)
WHERE rn = 1`;

async function fetchIncoming(bq, cfg) {
  const rows = await bq.query(SQL, { suppliers: cfg.suppliers, days: cfg.days });
  return rows
    .filter((r) => r.barcode != null && String(r.barcode).trim() !== '')
    .map((r) => ({ barcode: String(r.barcode).trim(), name: r.name || '', price: Number(r.price), docDate: String(r.doc_date || '') }));
}

// products: [{id, barcode, name, price, status, sort}], incoming: [{barcode, name, price, docDate}]
// -> { rows: [{id, barcode, name, old, new, pct, docDate, big, stop}] (лише змінені, у порядку списку закупниці), noIncoming }
function planIncoming(products, incoming) {
  const byBarcode = new Map();
  for (const x of incoming) {
    const price = P.round2(Number(x.price));
    const bc = String(x.barcode == null ? '' : x.barcode).trim();
    if (!bc || !(price > 0)) continue;
    const cur = byBarcode.get(bc);
    if (!cur || String(x.docDate) > String(cur.docDate)) byBarcode.set(bc, { price, docDate: x.docDate });
  }
  const list = products.slice().sort((a, b) => ((Number(a.sort) || 0) - (Number(b.sort) || 0)) || String(a.name).localeCompare(String(b.name), 'uk'));
  const rows = [];
  let noIncoming = 0;
  for (const p of list) {
    const bc = String(p.barcode || '').trim();
    if (!bc) continue;
    const inc = byBarcode.get(bc);
    if (!inc) { noIncoming++; continue; }
    const old = P.round2(Number(p.price) || 0);
    if (inc.price === old) continue;
    const pct = old > 0 ? Math.round((inc.price - old) / old * 1000) / 10 : null;
    rows.push({ id: p.id, barcode: bc, name: p.name, old, new: inc.price, pct, docDate: inc.docDate, big: pct == null || Math.abs(pct) > BIG_PCT, stop: p.status === 'stop' });
  }
  return { rows, noIncoming };
}

module.exports = { INCOMING, BIG_PCT, SQL, fetchIncoming, planIncoming };
