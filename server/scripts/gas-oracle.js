// Оригінальний код Apps Script (app/*.gs), виконаний у vm: еталон для звірки перенесених правил.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadOracle(files = ['Config.gs', 'Address.gs', 'Registry.gs', 'VegDays.gs', 'Archive.gs']) {
  const ctx = vm.createContext({ console, Date, Math, JSON, Object, String, Number, Array });
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
  ctx.DIRECTIONS = vm.runInContext('DIRECTIONS', ctx);   // const не стає властивістю контексту
  return ctx;
}

module.exports = { loadOracle };
