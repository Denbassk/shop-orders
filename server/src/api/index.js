// Диспетчер /api: той самий конверт, що api() у app/Code.gs -> { ok: true, data } | { ok: false, error }
const read = require('./read');

function createApi(getEnv, log = console.error) {
  return async function api(action, payload) {
    payload = payload || {};
    try {
      let data;
      switch (action) {
        case 'bootstrap': data = await read.apiBootstrap(getEnv()); break;
        case 'products':  data = await read.apiProducts(payload, getEnv()); break;
        case 'refresh':   data = await read.apiRefresh(payload, getEnv()); break;
        // submitOrder, requestLate - Task 4; woProducts, woSubmit, woMine, woDelete - Task 8
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
