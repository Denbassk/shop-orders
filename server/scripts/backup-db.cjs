'use strict';
// Ежедневный бэкап базы Supabase на Google Диск (.github/workflows/server-backup.yml). Логика — scripts/backup-db-lib.cjs,
// восстановление — docs/backup-restore.md.
//   node scripts/backup-db.cjs              — на Диск, в подпапку «База — ежедневно» папки DRIVE_BACKUP_FOLDER_ID
//   node scripts/backup-db.cjs --out <папка> — в локальную папку (проверка без Диска)
// Замечания (не прочиталась таблица, файл не сошёлся, пропали строки) — выход с кодом 1: GitHub пришлёт письмо.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const lib = require('./backup-db-lib.cjs');

const SUBFOLDER = 'Замовлення — база щодня';

function need(names) {
  for (const k of names) if (!process.env[k]) { console.error(`Не задана переменная ${k}`); process.exit(1); }
}

function dirStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const meta = (f) => path.join(dir, f + '.meta.json');
  return {
    async list() {
      return fs.readdirSync(dir).filter((f) => f.startsWith(lib.FILE_PREFIX) && f.endsWith('.json.gz')).map((f) => {
        let description = null;
        try { description = fs.readFileSync(meta(f), 'utf8'); } catch {}
        return { id: f, name: f, createdTime: fs.statSync(path.join(dir, f)).mtime.toISOString(), description };
      });
    },
    async upload(name, buffer, description) {
      fs.writeFileSync(path.join(dir, name), buffer);
      fs.writeFileSync(meta(name), description);
      return { id: name, name, createdTime: new Date().toISOString(), description };
    },
    async download(id) { return fs.readFileSync(path.join(dir, id)); },
    async trash(id) { fs.rmSync(path.join(dir, id)); fs.rmSync(meta(id), { force: true }); },
  };
}

async function driveStore() {
  const { google } = require('googleapis');
  const { Readable } = require('stream');
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth });
  const parent = process.env.DRIVE_BACKUP_FOLDER_ID;

  const found = await drive.files.list({
    q: `'${parent}' in parents and name = '${SUBFOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true,
  });
  let folder = found.data.files[0] && found.data.files[0].id;
  if (!folder) {
    const made = await drive.files.create({
      requestBody: { name: SUBFOLDER, mimeType: 'application/vnd.google-apps.folder', parents: [parent] },
      fields: 'id', supportsAllDrives: true,
    });
    folder = made.data.id;
    console.log(`Создана папка «${SUBFOLDER}»`);
  }

  return {
    async list() {
      const out = [];
      let pageToken;
      do {
        const r = await drive.files.list({
          q: `'${folder}' in parents and name contains '${lib.FILE_PREFIX}' and trashed = false`,
          fields: 'nextPageToken, files(id, name, createdTime, description)', pageSize: 100, pageToken,
          supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        out.push(...r.data.files);
        pageToken = r.data.nextPageToken;
      } while (pageToken);
      return out;
    },
    async upload(name, buffer, description) {
      const r = await drive.files.create({
        requestBody: { name, parents: [folder], description, mimeType: 'application/gzip' },
        media: { mimeType: 'application/gzip', body: Readable.from(buffer) },
        fields: 'id, name, createdTime, description', supportsAllDrives: true,
      });
      return r.data;
    },
    async download(id) {
      const r = await drive.files.get({ fileId: id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
      return Buffer.from(r.data);
    },
    // В корзину, а не насовсем: Диск сам очистит её через 30 дней.
    async trash(id) { await drive.files.update({ fileId: id, requestBody: { trashed: true }, supportsAllDrives: true }); },
  };
}

(async () => {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > 0 ? process.argv[outIdx + 1] : null;
  need(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (!outDir) need(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'DRIVE_BACKUP_FOLDER_ID']);

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const getSpec = async () => {
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
    if (!r.ok) throw new Error(`список таблиц: HTTP ${r.status}`);
    return r.json();
  };
  const store = outDir ? dirStore(outDir) : await driveStore();

  const res = await lib.runBackup({ sb, getSpec, store, log: (m) => console.log('  ' + m) });
  const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
  console.log(`Файл ${res.name}: ${Object.keys(res.counts).length} таблиц, ${total} строк, ${(res.size / 1024).toFixed(0)} КБ`);
  if (res.deleted.length) console.log(`В корзину (старше 30 дней): ${res.deleted.join(', ')}`);
  if (res.problems.length) {
    console.error('ЗАМЕЧАНИЯ — старые копии не удалялись:');
    for (const p of res.problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('Готово, файл проверен.');
})().catch((e) => { console.error('Бэкап не сделан:', e.message); process.exit(1); });
