// Бойове оточення пульта: секрети з env, лічильник спроб у базі. Окремо від runtime.js (менше конфліктів з Task 8).
const { loadEnv } = require('../env');
const { supabase } = require('../db');
const { DIRECTIONS } = require('../directions');
const { createAuth, hashEnvName } = require('./auth');
const { createSbFails } = require('./fails');
const { createAdminApi } = require('./index');

function createAdminRuntime() {
  loadEnv();
  const sb = supabase();
  const roles = ['admin', ...Object.keys(DIRECTIONS).map((d) => 'buyer:' + d)];
  const hashes = Object.fromEntries(roles.map((r) => [r, process.env[hashEnvName(r)] || '']).filter(([, h]) => h));
  const auth = createAuth({ secret: process.env.ADMIN_JWT_SECRET || '', hashes, fails: createSbFails(sb) });
  const api = createAdminApi({});                     // дії - з кроку 3
  return { auth, api };
}

module.exports = { createAdminRuntime };