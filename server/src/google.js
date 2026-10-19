// Клієнт Google Sheets через сервісний акаунт. Кожен запит - з тайм-аутом 30 с:
// таблиця, що висить, не має тримати процес (Review Focus 2 плану).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { google } = require('googleapis');

const TIMEOUT_MS = 30000;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let _sheets = null;

function loadCredentials() {
  if (process.env.GOOGLE_SA_JSON) return JSON.parse(process.env.GOOGLE_SA_JSON);
  const file = process.env.GOOGLE_SA_FILE || path.join(os.homedir(), '.secrets', 'shop-orders-sa.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sheetsClient() {
  if (!_sheets) {
    const auth = new google.auth.GoogleAuth({ credentials: loadCredentials(), scopes: SCOPES });
    _sheets = google.sheets({ version: 'v4', auth });
  }
  return _sheets;
}

const REQ = { timeout: TIMEOUT_MS, retry: false };

// Значення діапазону. За замовчуванням - сирі (як apiValues_ в Apps Script: числа числами,
// галочки true/false); formatted=true - як бачить людина.
async function getValues(spreadsheetId, a1, { formatted = false } = {}) {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId, range: a1,
    valueRenderOption: formatted ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  }, REQ);
  return res.data.values || [];
}

async function batchUpdate(spreadsheetId, requests) {
  const res = await sheetsClient().spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } }, REQ);
  return res.data;
}

async function appendValues(spreadsheetId, a1, rows) {
  const res = await sheetsClient().spreadsheets.values.append({
    spreadsheetId, range: a1, valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  }, REQ);
  return res.data;
}

// Назва першого листа таблиці (для діапазонів без явної назви листа).
async function firstSheetTitle(spreadsheetId) {
  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId, fields: 'sheets.properties.title',
  }, REQ);
  return res.data.sheets[0].properties.title;
}

const a1q = (sheet, range) => `'${String(sheet).replace(/'/g, "''")}'!${range}`;

module.exports = { sheetsClient, getValues, batchUpdate, appendValues, firstSheetTitle, a1q, TIMEOUT_MS };
