// Вхідні ціни з приходів (BigQuery, таблиця incoming_transactions): що змінилось порівняно з прайсом products.
// Лише хліб Рома: у НБХЗ цін немає, овочі беруться з прайсу постачальника, випічка - власне виробництво (там собівартість, не прихід).
// Чисті функції + один запит до BigQuery через переданий клієнт (bq.query(sql, params) -> масив об'єктів).
const P = require('./prices');

// постачальник у приходах записаний двома юрособами; для bakery (випічка і кулінарія) шукаємо по штрихкодах товарів напрямку
const INCOMING = {
  bread: { suppliers: ['ТОВ КВФ Рома', 'ТОВ Рома'], days: 45 },
  bakery: { suppliers: [], namePrefixes: ['кулінарія', 'випічка', 'кулинария', 'выпечка'], days: 45 },
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

const SQL_BY_BARCODES = `
SELECT barcode, product_name AS name, doc_date, ROUND(price_purchase, 2) AS price
FROM (
  SELECT barcode, product_name, doc_date, price_purchase,
    ROW_NUMBER() OVER (PARTITION BY barcode ORDER BY doc_date DESC, incoming_datetime DESC, line_number DESC) AS rn
  FROM ${TABLE}
  WHERE (TRIM(barcode) IN UNNEST(@barcodes) OR EXISTS(SELECT 1 FROM UNNEST(@prefixes) AS pref WHERE STARTS_WITH(LOWER(TRIM(product_name)), pref)))
    AND doc_date >= DATE_SUB(CURRENT_DATE('Europe/Kyiv'), INTERVAL @days DAY)
    AND quantity > 0 AND price_purchase > 0
    AND barcode IS NOT NULL AND TRIM(barcode) != ''
)
WHERE rn = 1`;

async function fetchIncoming(bq, cfg, products = []) {
  let rows;
  if (cfg.suppliers && cfg.suppliers.length) {
    rows = await bq.query(SQL, { suppliers: cfg.suppliers, days: cfg.days });
  } else {
    const barcodes = [...new Set((products || []).map((p) => String(p.barcode || '').trim()).filter(Boolean))];
    const prefixes = Array.isArray(cfg.namePrefixes) ? cfg.namePrefixes : [];
    if (!barcodes.length && !prefixes.length) return [];
    rows = await bq.query(SQL_BY_BARCODES, { barcodes: barcodes.length ? barcodes : ['__NONE__'], prefixes: prefixes.length ? prefixes : ['__NONE__'], days: cfg.days });
  }
  return rows
    .filter((r) => r.barcode != null && String(r.barcode).trim() !== '')
    .map((r) => ({ barcode: String(r.barcode).trim(), name: r.name || '', price: Number(r.price), docDate: String(r.doc_date || '') }));
}

// products: [{id, barcode, name, price, status, sort}], incoming: [{barcode, name, price, docDate}]
// -> { rows: [{id, barcode, name, incName, nameDiff, old, new, pct, docDate, big, stop}], noIncoming }
function normMatchName(r){let t=String(r||'').replace(/\*/g,' ');if(typeof P.normalizeWeightName==='function')t=P.normalizeWeightName(t);return t.toLowerCase().replace(/[\x27\u2019\x60"]/g,'').replace(/\s+/g,' ').trim()}
function planIncoming(products, incoming, opts = {}) {
  const checkNames=Boolean(opts.checkNames),matchByName=Boolean(opts.matchByName),byBarcode=new Map(),byNormName=new Map();
  for(const x of incoming){const price=P.round2(Number(x.price)),bc=String(x.barcode==null?'':x.barcode).trim();if(!bc||!(price>0))continue;const item={barcode:bc,price,docDate:x.docDate,name:String(x.name||'').trim()},cur=byBarcode.get(bc);if(!cur||String(x.docDate)>String(cur.docDate))byBarcode.set(bc,item);if(matchByName&&item.name){const nk=normMatchName(item.name);if(nk){const curN=byNormName.get(nk);if(!curN||String(x.docDate)>String(curN.docDate))byNormName.set(nk,item)}}}
  const list = products.slice().sort((a, b) => ((Number(a.sort) || 0) - (Number(b.sort) || 0)) || String(a.name).localeCompare(String(b.name), 'uk'));
  const rows=[],missing=[];let noIncoming=0;
  for(const p of list){const bc=String(p.barcode||'').trim();if(!bc&&!matchByName)continue;let inc=bc?byBarcode.get(bc):null;if(!inc&&matchByName)inc=byNormName.get(normMatchName(p.name))||null;if(!inc){noIncoming++;if(matchByName)missing.push({id:p.id,name:p.name,barcode:bc,stop:p.status==='stop'});continue}
    const old=P.round2(Number(p.price)||0),incName=inc.name||'',incBarcode=inc.barcode||'',nameDiff=Boolean(checkNames&&incName&&incName!==String(p.name||'').trim()),barcodeDiff=Boolean(matchByName&&incBarcode&&incBarcode!==bc);if(inc.price===old&&!nameDiff&&!barcodeDiff)continue;const pct=old>0&&inc.price!==old?Math.round((inc.price-old)/old*1000)/10:null;rows.push({id:p.id,barcode:bc,...(matchByName?{incBarcode,barcodeDiff}:{}),name:p.name,incName,nameDiff,old,new:inc.price,pct,docDate:inc.docDate,big:inc.price!==old&&(pct==null||Math.abs(pct)>BIG_PCT),stop:p.status==='stop'})}
  return matchByName?{rows,noIncoming,missing}:{rows,noIncoming};
}

module.exports = { INCOMING, BIG_PCT, SQL, fetchIncoming, planIncoming };
