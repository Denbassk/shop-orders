// Локальні секрети: server/.env, інакше %USERPROFILE%\.secrets\shop-orders-sb.env. На Fly - лише fly secrets.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadEnv() {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const f = path.join(os.homedir(), '.secrets', 'shop-orders-sb.env');
  if (!process.env.SUPABASE_URL && fs.existsSync(f)) dotenv.config({ path: f, quiet: true });
}

module.exports = { loadEnv };
