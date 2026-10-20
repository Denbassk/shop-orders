// Лічильник невдалих входів (admin_fail з Admin.gs: { n, ts першої }) - рядок таблиці settings 'admin_fail:<роль>'.
const key = (role) => 'admin_fail:' + role;
function createSbFails(sb) {
  const chk = (r) => { if (r.error) throw new Error('settings: ' + r.error.message); return r.data; };
  return {
    get: async (role) => { const d = chk(await sb.from('settings').select('value').eq('key', key(role)).limit(1)) || []; return d.length ? d[0].value : undefined; },
    set: async (role, v) => { chk(await sb.from('settings').upsert({ key: key(role), value: v })); },
    del: async (role) => { chk(await sb.from('settings').delete().eq('key', key(role))); },
  };
}

module.exports = { createSbFails };