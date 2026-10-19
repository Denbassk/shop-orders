// Модель листа за планом звіту: те, що дають наші запити writerFor(...) після застосування (див. sheetModel.applyRequests).
const { newSheet, applyRequests } = require('./sheetModel');
const { writerFor } = require('./sheetWriter');

function modelOfPlan(plan, sheetId = 7) {
  const w = writerFor({ properties: { sheetId, gridProperties: { rowCount: 1000, columnCount: 26 } } }, plan.data, plan.width);
  plan.apply(w);
  return applyRequests(newSheet('ours', sheetId), w.requests());
}

module.exports = { modelOfPlan };
