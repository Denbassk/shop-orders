// Бойове оточення пульта: секрети з env, лічильник спроб у базі. Окремо від runtime.js (менше конфліктів з Task 8).
const { loadEnv } = require('../env');
const { supabase } = require('../db');
const { createData } = require('../data');
const { DIRECTIONS } = require('../directions');
const googleApi = require('../google');
const { resolveTarget, exportTargetMode } = require('../export/target');
const { rebuildReports } = require('../reports/rebuild');
const { createAuth, hashEnvName } = require('./auth');
const { createSbFails } = require('./fails');
const { createAdminApi } = require('./index');
const { createAdminData } = require('./data');
const { createLinks } = require('./links');
const read = require('./read');
const write = require('./write');

function createAdminRuntime(opts = {}) {
  loadEnv();
  const sb = supabase();
  const data = createData(sb);
  const adm = createAdminData(sb);
  // пульт читає налаштування без 10-секундного кешу: після перемикання екран одразу показує новий стан
  const dataFresh = { ...data, settings: () => createData(sb).settings() };
  const roles = ['admin', ...Object.keys(DIRECTIONS).map((d) => 'buyer:' + d)];
  const hashes = Object.fromEntries(roles.map((r) => [r, process.env[hashEnvName(r)] || '']).filter(([, h]) => h));
  const auth = createAuth({ secret: process.env.ADMIN_JWT_SECRET || '', hashes, fails: createSbFails(sb) });

  // звіти і посилання - у ту саму ціль, що вигрузка (EXPORT_TARGET; до Task 11 - тестова таблиця)
  const target = resolveTarget(exportTargetMode());
  const links = createLinks({ target, sheetIdOf: googleApi.sheetIdOf });
  const reportEnv = () => ({ data, google: googleApi, target, at: new Date(), archive: { spreadsheetId: process.env.NBHZ_ARCHIVE_SPREADSHEET_ID || '' } });
  const rebuild = (dir, o) => rebuildReports(dir, reportEnv(), o);

  const env = () => {
    const at = new Date();
    let ats = null;                                   // час збирання звітів - один запит на виклик
    return { at, data: dataFresh, adm, links, rebuild, queueExport: opts.queueExport || (() => {}),
      reportAt: async (k) => { ats = ats || adm.reportAts(); return read.reportAtOf((await ats)[k], at); } };
  };
  const api = createAdminApi({
    today: () => read.admToday(env()),
    schedule: (p) => read.admSchedule(p, env()),
    stores: (p) => read.admStores(p, env()),
    dirStores: (p) => read.admDirStores(p, env()),
    store: (p) => read.admStore(p, env()),
    log: () => read.admLogRead(env()),
    report: (p) => read.admReport(p, env()),
    cancelOrder: (p) => write.admCancelOrder(p, env()),
    openStore: (p) => write.admOpenStore(p, env()),
    openAll: (p) => write.admOpenAll(p, env()),
    closeAll: (p) => write.admCloseAll(p, env()),
    setDirEnabled: (p) => write.admSetDirEnabled(p, env()),
    editOrder: (p) => write.admEditOrder(p, env()),
    batch: (p) => write.admBatch(p, (a, q) => api(a, q)),
  });
  return { auth, api };
}

module.exports = { createAdminRuntime };