// «Сервісне меню» (екран «Здоров'я» пульта): помилки сервера з фонових задач - вигрузка, звіти, пошта, списання. Формат запису -
// settings.health_err [{ at, where, msg }] (admin/tools.js noteError). Тут: розбір відповіді /jobs/tick у список помилок і короткий
// зрозумілий текст замість сирого повідомлення бібліотеки.

// errorText: тип помилки Google/Supabase одним рядком (без стеків і довгих JSON), до 300 символів
function errorText(e) {
  const m = String((e && e.message) || e || '');
  if (/Quota exceeded/i.test(m)) return 'Google: перевищено ліміт читань за хвилину (Sheets 60/хв) - зачекати і повторити';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|fetch failed/i.test(m)) return 'Нема зв\'язку з Google (DNS/мережа) - перевірити інтернет сервера';
  if (/does not have permission|PERMISSION_DENIED|forbidden|Forbidden/i.test(m)) return 'Google: нема доступу до таблиці - перевірити, що таблиця відкрита сервісному акаунту (Редактор). ' + m.slice(0, 120);
  if (/timeout of \d+ms|ETIMEDOUT|timed out|тайм-аут/i.test(m)) return 'Google не відповів за 30 с (тайм-аут)';
  if (/Requested entity was not found|Unable to parse range/i.test(m)) return 'Google: лист або діапазон не знайдено - ' + m.slice(0, 160);
  if (/JWT|invalid_grant|invalid_client|unauthorized_client/i.test(m)) return 'Google: ключ сервісного акаунта не приймається - ' + m.slice(0, 160);
  return m.slice(0, 300);
}

// Помилки з відповіді tick ({ export, reports, mail, writeoffs }) -> [{ where, msg }]
function collectTickErrors(res) {
  const out = [];
  const add = (where, msg) => out.push({ where, msg: errorText(msg) });
  Object.entries((res && res.export) || {}).forEach(([dir, r]) => { if (r && r.error) add('вигрузка ' + dir, r.error); });
  const rep = (res && res.reports) || {};
  if (rep.error) add('звіти', rep.error);
  Object.entries(rep).forEach(([dir, r]) => {
    if (!r || typeof r !== 'object' || dir === 'error') return;
    if (r.error) add('звіт ' + dir, r.error);
    if (r.downloadError) add('звіт ' + dir + ' (Завантаження)', r.downloadError);
    if (r.archive && r.archive.error) add('архів НБХЗ', r.archive.error);
    if (r.archive && r.archive.failed && r.archive.failed.length) add('архів НБХЗ', r.archive.failed.map((f) => f.name + ': ' + f.error).join('; '));
  });
  const mail = (res && res.mail) || {};
  if (mail.error) add('листи про дозвіл', mail.error);
  else if (mail.failed) out.push({ where: 'листи про дозвіл', msg: 'Не відправлено листів: ' + mail.failed + ' (довідправить наступний tick; перевірити SMTP_USER/SMTP_PASS)' });
  if (res && res.writeoffs && res.writeoffs.error) add('списання', res.writeoffs.error);
  return out;
}

module.exports = { errorText, collectTickErrors };
