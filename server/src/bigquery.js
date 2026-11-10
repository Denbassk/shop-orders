// Клієнт BigQuery через сервісний акаунт сервера (лише читання: scope bigquery.readonly).
// Права акаунта: роль «BigQuery Job User» на проєкті і «BigQuery Data Viewer» на таблиці incoming_transactions.
// query(sql, params) -> масив об'єктів { колонка: значення }; FLOAT/INTEGER - числами, решта - рядками.
const SCOPES = ['https://www.googleapis.com/auth/bigquery.readonly'];
const TIMEOUT_MS = 30000;

// відповідь jobs.query / getQueryResults (schema + rows[].f[].v) -> масив об'єктів
function flatten(data) {
  const fields = (data && data.schema && data.schema.fields) || [];
  return ((data && data.rows) || []).map((row) => {
    const o = {};
    fields.forEach((f, i) => {
      const v = row.f[i] ? row.f[i].v : null;
      o[f.name] = v == null ? null : (f.type === 'FLOAT' || f.type === 'FLOAT64' || f.type === 'INTEGER' || f.type === 'INT64') ? Number(v) : v;
    });
    return o;
  });
}

// { suppliers: ['a','b'], days: 45 } -> queryParameters (масив рядків = ARRAY<STRING>, число = INT64, рядок = STRING)
function toParameters(params) {
  return Object.entries(params || {}).map(([name, v]) => {
    if (Array.isArray(v)) return { name, parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: v.map((x) => ({ value: String(x) })) } };
    if (typeof v === 'number') return { name, parameterType: { type: 'INT64' }, parameterValue: { value: String(Math.trunc(v)) } };
    return { name, parameterType: { type: 'STRING' }, parameterValue: { value: String(v) } };
  });
}

function createBq({ google, credentials, projectId = 'family-market-analytics', location = 'EU' }) {
  let client = null;
  const api = () => {
    if (!client) client = google.bigquery({ version: 'v2', auth: new google.auth.GoogleAuth({ credentials, scopes: SCOPES }) });
    return client;
  };
  async function query(sql, params) {
    const bq = api();
    const r = await bq.jobs.query({ projectId, requestBody: { query: sql, useLegacySql: false, location, timeoutMs: TIMEOUT_MS, maxResults: 1000,
      parameterMode: 'NAMED', queryParameters: toParameters(params) } }, { timeout: TIMEOUT_MS + 10000, retry: false });
    let data = r.data;
    for (let i = 0; !data.jobComplete && i < 6; i++) {          // довгий запит: чекаємо результат (до ~3 хв)
      data = (await bq.jobs.getQueryResults({ projectId, jobId: data.jobReference.jobId, location, timeoutMs: TIMEOUT_MS, maxResults: 1000 }, { timeout: TIMEOUT_MS + 10000, retry: false })).data;
    }
    if (!data.jobComplete) throw new Error('BigQuery: запит не завершився вчасно');
    if (data.pageToken) throw new Error('BigQuery: результат більший за 1000 рядків');
    return flatten(data);
  }
  return { query };
}

// спільний клієнт сервера: ключ сервісного акаунта - той самий, що для Google Sheets (src/google.js); створюється при першому запиті
let shared = null;
function defaultBq() {
  if (!shared) shared = createBq({ google: require('googleapis').google, credentials: require('./google').loadCredentials() });
  return shared;
}

module.exports = { flatten, toParameters, createBq, defaultBq, SCOPES };
