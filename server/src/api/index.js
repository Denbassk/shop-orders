// Диспетчер /api: той самий конверт, що api() у app/Code.gs -> { ok: true, data } | { ok: false, error }
const read = require('./read');
const submit = require('./submit');
const writeoff = require('./writeoff');

function createApi(getEnv, log = console.error) {
  return async function api(action, payload) {
    payload = payload || {};
    try {
      let data;
      switch (action) {
        case 'bootstrap': data = await read.apiBootstrap(getEnv()); break;
        case 'products':  data = await read.apiProducts(payload, getEnv()); break;
        case 'refresh':   data = await read.apiRefresh(payload, getEnv()); break;
        case 'submitOrder': data = await submit.apiSubmitOrder(payload, getEnv()); break;
        case 'requestLate': data = await submit.apiRequestLate(payload, getEnv()); break;
        // списання випічки і кулінарії - api/writeoff.js (WriteOff.gs)
        case 'woProducts': data = await writeoff.apiWoProducts(payload, getEnv()); break;
        case 'woSubmit':   data = await writeoff.apiWoSubmit(payload, getEnv()); break;
        case 'woMine':     data = await writeoff.apiWoMine(payload, getEnv()); break;
        case 'woDelete':   data = await writeoff.apiWoDelete(payload, getEnv()); break;
        default: throw new Error('Невідома дія: ' + action);
      }
      return { ok: true, data };
    } catch (err) {
      log(action + ': ' + ((err && err.stack) || err));
      return { ok: false, error: String((err && err.message) || err) };
    }
  };
}

module.exports = { createApi };
