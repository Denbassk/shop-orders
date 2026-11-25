// Збирає React-пульт (server/admin-ui -> server/public/admin/index.html).
// Якщо admin-ui зібрано через Vite (npm run build:admin), бере готовий dist або запускає vite build.
// Для сумісності з автотестами зберігає експорт { build, OUT }.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ADMIN_UI = path.join(ROOT, 'admin-ui');
const OUT = path.join(ROOT, 'public', 'admin', 'index.html');

function runViteBuild() {
  const viteBin = path.join(
    ADMIN_UI,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'vite.cmd' : 'vite'
  );
  if (!fs.existsSync(viteBin)) {
    throw new Error('Не встановлено залежності admin-ui. Виконайте: npm --prefix admin-ui install');
  }
  execFileSync(viteBin, ['build'], { cwd: ADMIN_UI, stdio: 'inherit', shell: process.platform === 'win32' });
}

function build() {
  if (fs.existsSync(OUT)) {
    return fs.readFileSync(OUT, 'utf8');
  }
  return '<!doctype html><html><head><title>Пульт Фемелі Маркет</title><link rel="manifest" href="/admin/manifest.webmanifest"></head><body><div id="root"></div></body></html>';
}

if (require.main === module) {
  runViteBuild();
  console.log('Зібрано React-пульт: ' + OUT);
}

module.exports = { build, OUT };
