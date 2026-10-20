// Диспетчер пульта: конверт adminApi (app/Admin.gs) -> { ok: true, data, ms } | { ok: false, error, ms }.
// Вхід (login) і перевірка cookie - у маршруті /admin/api (app.js); сюди доходять лише дії після входу.
function createAdminApi(handlers, { log = console.error } = {}) {
  return async function adminApi(action, payload) {
    const t0 = Date.now();
    payload = payload || {};
    try {
      const fn = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
      if (!fn) throw new Error('Невідома дія: ' + action);
      const data = await fn(payload);
      return { ok: true, data, ms: Date.now() - t0 };
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg !== 'AUTH') log('adminApi ' + action + ': ' + ((err && err.stack) || err));
      return { ok: false, error: msg, ms: Date.now() - t0 };
    }
  };
}

module.exports = { createAdminApi };