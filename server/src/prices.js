// Спільна робота з цінами: перевірка (0…100000, округлення до копійки) і розрахунок масової зміни.
// Те саме використовують закупниця (setProduct/addProduct, src/buyer/api.js) і пульт (src/admin/assortment.js) - межі й округлення лише тут.
const MONEY_MAX = 100000;
const PCT_MIN = -95;
const PCT_MAX = 500;
const round2 = (n) => Math.round(n * 100) / 100;

// '12,5' / ' 7 ' / 12.5 -> число; порожнє і нечислове - NaN (без перевірки меж)
function toNumber(raw) {
  const s = String(raw == null ? '' : raw).trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// Ціна або собівартість: число 0…MONEY_MAX, округлене до 0.01; інакше NaN (повідомлення формує викликач - у кожного воно своє)
function parseMoney(raw) {
  const v = toNumber(raw);
  return isFinite(v) && v >= 0 && v <= MONEY_MAX ? round2(v) : NaN;
}

// Масова зміна: mode 'pct' (відсоток від поточної ціни) або 'sum' (додати/відняти суму). products: [{id, name, price}].
// Повертає { rows: [{id, name, old, new}] - лише ті, де ціна справді змінилась, skipped: [{id, name, reason}] - позиції без ціни }.
// Будь-яка помилка (значення, вихід за межі) - виняток до того, як щось повернеться: частково рахувати не можна.
function planPriceChange(products, mode, value) {
  if (mode !== 'pct' && mode !== 'sum') throw new Error('Невірний спосіб зміни');
  const v = toNumber(value);
  if (!isFinite(v)) throw new Error('Невірне значення');
  if (v === 0) throw new Error('Змін немає');
  if (mode === 'pct' && (v < PCT_MIN || v > PCT_MAX)) throw new Error('Відсоток - від ' + PCT_MIN + ' до ' + PCT_MAX);
  if (mode === 'sum' && Math.abs(v) > MONEY_MAX) throw new Error('Сума - не більше ' + MONEY_MAX + ' за модулем');
  const rows = [], skipped = [];
  for (const p of products) {
    const old = Number(p.price);
    if (!(old > 0)) { skipped.push({ id: p.id, name: p.name, reason: 'без ціни' }); continue; }
    const next = round2(mode === 'pct' ? old * (1 + v / 100) : old + v) + 0;       // + 0: -0 -> 0
    if (!(next >= 0 && next <= MONEY_MAX)) throw new Error('Ціна «' + p.name + '» вийде за межі 0…' + MONEY_MAX);
    if (next !== old) rows.push({ id: p.id, name: p.name, old, new: next });
  }
  return { rows, skipped };
}

// '+5%', '-3.5%', '+2.5 грн' - для журналу
function fmtChange(mode, value) {
  const v = toNumber(value), s = (v > 0 ? '+' : '') + v;
  return mode === 'pct' ? s + '%' : s + ' грн';
}

module.exports = { MONEY_MAX, PCT_MIN, PCT_MAX, round2, parseMoney, planPriceChange, fmtChange };
