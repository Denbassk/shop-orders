#!/usr/bin/env node
// Звірка: statusKey(dir, store) для точок з бази проти адрес, які Apps Script реально записав у колонку C
// сирих листів (робочий лист + _Архів). Нічого не пише. Використання: node scripts/check-keys.js
const { loadEnv } = require('../src/env');
loadEnv();
const { getValues, a1q } = require('../src/google');
const { loadStores } = require('../src/db');
const { DIRECTIONS } = require('../src/directions');
const { addrKey, statusKey } = require('../src/rules');

const dmy = (v) => {                                      // серійне число Google або текст -> ДД.ММ.РРРР
  if (typeof v === 'number') {
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000) + 43200000);
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }
  return String(v || '').trim().slice(0, 10);
};

async function readCol(spreadsheetId, sheet) {
  try { return await getValues(spreadsheetId, a1q(sheet, 'A1:C')); }
  catch (e) { return e.message.includes('Unable to parse range') ? [] : Promise.reject(e); }
}

(async () => {
  const stores = await loadStores();
  let totalStores = 0, totalMatched = 0;
  for (const [dir, cfg] of Object.entries(DIRECTIONS)) {
    const rows = [];
    for (const sheet of [cfg.rawSheet, '_Архів']) {
      const r = await readCol(cfg.spreadsheetId, sheet);
      r.forEach((x) => rows.push({ sheet, date: dmy(x[0]), addr: String(x[2] == null ? '' : x[2]).trim() }));
    }
    const data = rows.filter((r) => /^\d\d\.\d\d\.\d{4}$/.test(r.date) && r.addr);
    const keys = new Map();                              // ключ -> { n, example }
    data.forEach((r) => {
      const k = addrKey(r.addr);
      const o = keys.get(k) || { n: 0, example: r.addr };
      o.n++; keys.set(k, o);
    });
    const days = [...new Set(data.map((r) => r.date))];
    const dirStores = stores.filter((s) => s.directions.includes(dir));
    const matched = dirStores.filter((s) => keys.has(statusKey(dir, s)));
    const storeKeys = new Set(dirStores.map((s) => statusKey(dir, s)));
    const orphans = [...keys.entries()].filter(([k]) => !storeKeys.has(k));
    totalStores += dirStores.length; totalMatched += matched.length;
    console.log(`\n== ${dir}: рядків ${data.length}, днів ${days.length}, унікальних адрес у листі ${keys.size}`);
    console.log(`   точок з напрямком ${dirStores.length}, ключ знайдено в листі: ${matched.length}`);
    dirStores.filter((s) => !keys.has(statusKey(dir, s)))
      .forEach((s) => console.log(`   не знайдено в листі: ${s.label} | ключ "${statusKey(dir, s)}"`));
    orphans.forEach(([k, o]) => console.log(`   в листі є, точки нема: "${k}" (${o.n} рядків, напр. "${o.example}")`));
  }
  console.log(`\nпідсумок: ${totalMatched} з ${totalStores} пар (точка × напрямок) підтверджено реальними рядками`);
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exit(1); });
