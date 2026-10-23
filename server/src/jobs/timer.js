// Власний таймер tick усередині сервера: не залежить від GitHub cron (він запускається нерегулярно: після злиття в main
// за 6 годин відпрацював 1 раз із ~36). Працює лише на увімкненій машині (fly.toml: min_machines_running = 1).
// Вікно те саме, що в .github/workflows/server-tick.yml: 07:00-22:10 за Києвом.
const R = require('../rules');

const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;     // після старту/деплою - одразу підхопити недовигружене, не чекати 10 хв

function inWindow(at) {
  const k = R.kyivNow(at);
  return k.hh >= 7 && (k.hh < 22 || (k.hh === 22 && k.mm < 10));
}

// Одночасні виклики (таймер + POST /jobs/tick від GitHub) діляють один запуск: tick не йде двічі паралельно
function singleFlight(fn) {
  let cur = null;
  return () => {
    if (!cur) cur = Promise.resolve().then(fn).finally(() => { cur = null; });
    return cur;
  };
}

function startTickTimer({ tick, now = () => new Date(), intervalMs = INTERVAL_MS, firstRunMs = FIRST_RUN_MS, log = console,
  setIntervalFn = setInterval, setTimeoutFn = setTimeout }) {
  const run = async () => {
    if (!inWindow(now())) return { skipped: 'поза вікном 07:00-22:10' };
    try { return await tick(); } catch (e) { log.error('tick (таймер): ' + ((e && e.message) || e)); return { error: (e && e.message) || String(e) }; }
  };
  const timer = setIntervalFn(run, intervalMs);
  const first = firstRunMs > 0 ? setTimeoutFn(run, firstRunMs) : null;
  if (timer && timer.unref) timer.unref();
  if (first && first.unref) first.unref();
  return { run, stop: () => { clearInterval(timer); if (first) clearTimeout(first); } };
}

module.exports = { inWindow, singleFlight, startTickTimer, INTERVAL_MS };
