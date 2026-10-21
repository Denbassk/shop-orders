// Скачати Excel листа звіту через сервер: Google віддає xlsx лише тому, хто має доступ до таблиці,
// тому файл бере сервісний акаунт (Bearer), а закупниці доступ до Google не потрібен. Посилання - admin/links.js (admXlsxUrl_).
const R = require('../rules');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'];

function createXlsx({ links, token, fetchFn = fetch, at = () => new Date(), titleOf = (d) => d }) {
  return async function xlsxOf(dir) {
    const url = await links.xlsx(dir);
    if (!url) throw new Error('Звіт ще не зібрано або лист не знайдено');
    const t = await token();
    const r = await fetchFn(url, { headers: { Authorization: 'Bearer ' + t }, redirect: 'follow' });
    if (!r || !r.ok) throw new Error('Google не віддав файл (' + ((r && r.status) || '?') + ')');
    return { name: titleOf(dir) + ' ' + R.kyivNow(at()).dmy + '.xlsx', buf: Buffer.from(await r.arrayBuffer()) };
  };
}

function googleToken(google, credentials) {
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  return async () => { const c = await auth.getClient(); const x = await c.getAccessToken(); return (x && x.token) || x; };
}

module.exports = { createXlsx, googleToken, SCOPES };