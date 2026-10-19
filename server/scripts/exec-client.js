// Виклик /exec (Apps Script) або нашого сервера: той самий конверт {action, payload} -> {ok, data|error}.
const LIVE_EXEC = 'https://script.google.com/macros/s/AKfycbzGY4--nMFFW5Fb-rsBbTqHX5718u0yC5FEKzo7TKXaqkZ4gHlwwWTbYjD4eFRXcJ5Z/exec';

async function call(url, action, payload = {}) {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, payload }), redirect: 'follow', signal: AbortSignal.timeout(90000),
  });
  const body = await res.json();
  return { body, ms: Date.now() - t0 };
}

module.exports = { LIVE_EXEC, call };
