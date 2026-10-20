// Бойове оточення пульта: секрети з env, лічильник спроб у базі. Окремо від runtime.js (менше конфліктів з Task 8).
const { loadEnv } = require('../env');
const { supabase } = require('../db');
const { createData } = require('../data');
const { DIRECTIONS } = require('../directions');
const { createAuth, hashEnvName } = require('./auth');
const { createSbFails } = require('./fails');
const { createAdminApi } = require('./index');
const read = require('./read');

function createAdminRuntime() {
  loadEnv();
  const sb = supabase();
  const data = createData(sb);
  const roles = ['admin', ...Object.keys(DIRECTIONS).map((d) => 'buyer:' + d)];
  const hashes = Object.fromEntries(roles.map((r) => [r, process.env[hashEnvName(r)] || '']).filter(([, h]) => h));
  const auth = createAuth({ secret: process.env.ADMIN_JWT_SECRET || '', hashes, fails: createSbFails(sb) });
  const env = () => ({ at: new Date(), data });
  const api = createAdminApi({
    today: () => read.admToday(env()),
    schedule: (p) => read.admSchedule(p, env()),
    stores: (p) => read.admStores(p, env()),
  });
  return { auth, api };
}

module.exports = { createAdminRuntime };