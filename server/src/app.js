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
  const approveForm = opts.approveForm || ((query) => runtime().approveForm(query));

  // POST /jobs/tick (x-jobs-secret): вигрузка всіх напрямків + довідправка листів про дозвіл. Викликає cron у GitHub Actions.
  const tick = opts.tick || (() => runtime().tick());
  app.post('/jobs/tick', async (req, res, next) => {
    try {
      const secret = opts.jobsSecret !== undefined ? opts.jobsSecret : process.env.JOBS_SECRET;
      if (!secret) return res.status(503).json({ ok: false, error: 'JOBS_SECRET не задано' });
      const got = String(req.get('x-jobs-secret') || '');
      const a = Buffer.from(got), b = Buffer.from(secret);
      if (a.length !== b.length || !require('node:crypto').timingSafeEqual(a, b)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      res.json({ ok: true, ...(await tick()) });
    } catch (e) { next(e); }
  });

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

  // GET лише показує форму з кнопкою; дозвіл видає POST (поштові сканери відкривають лише GET)
  const sendPage = (res, { status, html }) =>
    res.status(status).set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).type('html').send(html);

  app.get('/ok', async (req, res, next) => {
    try { sendPage(res, await approveForm(req.query)); } catch (e) { next(e); }
  });

  app.post('/ok', express.urlencoded({ extended: false, limit: '8kb' }), async (req, res, next) => {
    try { sendPage(res, await approve(req.body)); } catch (e) { next(e); }
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
