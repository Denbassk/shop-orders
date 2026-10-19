#!/usr/bin/env node
// Читання (лише читання!) сирих листів напрямків: шапка + кілька рядків. Нічого не пише.
//   node scripts/peek-raw.js [dir] [--tail N]
const { DIRECTIONS } = require('../src/directions');
const { getValues, batchUpdate, sheetsClient, a1q } = require('../src/google');

(async () => {
  const args = process.argv.slice(2);
  const tailI = args.indexOf('--tail');
  const tail = tailI >= 0 ? +args[tailI + 1] : 3;
  const only = args.find((a) => DIRECTIONS[a]);
  for (const k of Object.keys(DIRECTIONS)) {
    if (only && only !== k) continue;
    const cfg = DIRECTIONS[k];
    const meta = await sheetsClient().spreadsheets.get({ spreadsheetId: cfg.spreadsheetId, fields: 'sheets.properties(title,sheetId,gridProperties)' });
    const t = meta.data.sheets.find((s) => s.properties.title === cfg.rawSheet);
    console.log(`\n== ${k}: ${cfg.rawSheet} ${t ? JSON.stringify(t.properties.gridProperties) : 'ЛИСТА НЕМАЄ'}`);
    if (!t) continue;
    const head = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A1:J1'), { formatted: true });
    console.log('шапка:', JSON.stringify(head[0]));
    const colA = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, 'A:A'));
    const last = colA.length;                       // values.get обрізає порожній хвіст
    const from = Math.max(2, last - tail + 1);
    const all = await getValues(cfg.spreadsheetId, a1q(cfg.rawSheet, `A${from}:J${last}`), { formatted: true });
    console.log(`заповнено до рядка ${last}; останні ${all.length} (як бачить людина):`);
    all.forEach((r) => console.log('  ', JSON.stringify(r)));
  }
})().catch((e) => { console.error('ПОМИЛКА:', e.message); process.exitCode = 1; });
void batchUpdate;
