// Express-сервер shop-orders: /health, POST /api (дії продавця), GET /ok (кнопка "Дозволити" з листа).
const express = require('express');

// opts.api - (action, payload) => Promise<конверт>; opts.approve - (query) => Promise<{status, html}>.
// За замовчуванням бойові, створюються при першому запиті.
function createApp(opts = {}) {
  const app = express();
  app.disable('x-powered-by');

  let rt = null;
  const runtime = () => {
    if (!rt) rt = require('./runtime').createRuntime();
    return rt;
  };
  let api = opts.api;
  const getApi = () => {
    if (!api) api = require('./api').createApi(runtime().getEnv);
    return api;
  };
  const approve = opts.approve || ((query) => runtime().approve(query));

  app.get('/health', (req, res) => {
    res.json({ ok: true, region: process.env.FLY_REGION || null, time: new Date().toISOString() });
  });

  // Застосунок шле JSON з Content-Type: text/plain (як до Apps Script); розбираємо самі, як doPost:
  // не JSON -> порожнє тіло -> "Невідома дія: undefined"
  app.post('/api', express.text({ type: () => true, limit: '1mb' }), async (req, res) => {
    let body = {};
    try { body = JSON.parse(req.body) || {}; } catch (e) { body = {}; }
    res.json(await getApi()(body.action, body.payload));
  });

  app.get('/ok', async (req, res, next) => {
    try {
      const { status, html } = await approve(req.query);
      res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(html);
    } catch (e) { next(e); }
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('помилка запиту:', err && err.message);
    res.status(500).json({ ok: false, error: 'Помилка сервера' });
  });
  return app;
}

if (require.main === module) {
  const port = +process.env.PORT || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`shop-orders слухає :${port}`));
}

module.exports = { createApp };
