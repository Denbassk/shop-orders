// Express-сервер shop-orders. Каркас: /health і заглушка /api (дії підуть у Task 3+).
const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Застосунок шле JSON з Content-Type: text/plain (як до Apps Script) - приймаємо обидва
  app.use(express.json({ type: ['application/json', 'text/plain'], limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ ok: true, region: process.env.FLY_REGION || null, time: new Date().toISOString() });
  });

  app.post('/api', (req, res) => {
    res.json({ ok: false, error: 'Невідома дія' });
  });

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

  // некоректний JSON у тілі тощо: той самий конверт, без стека
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.json({ ok: false, error: 'Невідома дія' });
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
