// Скачати Excel ОДНОГО листа звіту через сервер: Google віддає xlsx лише тому, хто має доступ до таблиці,
// тому файл бере сервісний акаунт (Bearer), а закупниці доступ до Google не потрібен.
// Новий шлях - sheets.xlsxUrl(dir, key) (src/buyer/sheets.js); старий - links.xlsx(dir) (admin/links.js).
const R = require('../rules');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly'];
const HAS_DATE = /\d{2}\.\d{2}\.\d{4}$/;

function createXlsx({ sheets, links, token, fetchFn = fetch, at = () => new Date(), titleOf = (d) => d }) {
  return async function xlsxOf(dir, key) {
    let url, title;
    if (sheets) ({ url, title } = await sheets.xlsxUrl(dir, key));
    else { url = await links.xlsx(dir); title = titleOf(dir); }
    if (!url) throw new Error('Звіт ще не зібрано або лист не знайдено');
    const t = await token();
    const r = await fetchFn(url, { headers: { Authorization: 'Bearer ' + t }, redirect: 'follow' });
    if (!r || !r.ok) throw new Error('Google не віддав файл (' + ((r && r.status) || '?') + ')');
    const type = String((r.headers && r.headers.get && r.headers.get('content-type')) || '');
    if (/text\/html/i.test(type)) throw new Error('Google повернув сторінку входу замість файлу: сервісний акаунт не має доступу до таблиці');
    const name = (HAS_DATE.test(title) ? title : title + ' ' + R.kyivNow(at()).dmy) + '.xlsx';
    return { name, buf: Buffer.from(await r.arrayBuffer()) };
  };
}

function googleToken(google, credentials) {
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  return async () => { const c = await auth.getClient(); const x = await c.getAccessToken(); return (x && x.token) || x; };
}

module.exports = { createXlsx, googleToken, SCOPES };