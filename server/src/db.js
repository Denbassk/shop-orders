// Клієнт Supabase (service_role: браузер у базу напряму не ходить) і мапінг рядка stores -> об'єкт loadStores_.
const { createClient } = require('@supabase/supabase-js');
const { parseDays } = require('./rules');

let _sb = null;

function supabase() {
  if (!_sb) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Не задано SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    }
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _sb;
}

// Рядок таблиці stores -> об'єкт рівно в формі loadStores_() (Registry.gs)
function rowToStore(r) {
  return {
    id: r.store_id, label: r.label, address: r.address, code: r.code, route: r.route, type: r.type,
    addrBread: r.addr_bread, addrBakery: r.addr_bakery, addrVeg: r.addr_veg, addrNbhz: r.addr_nbhz,
    routeNbhz: r.route_nbhz, zone: r.zone, edrpou: r.edrpou,
    days: { veg: parseDays(r.days_veg), bakery: parseDays(r.days_bakery) },
    directions: [r.bread && 'bread', r.nbhz && 'nbhz', r.bakery && 'bakery', r.veg && 'veg'].filter(Boolean),
    note: r.note,
  };
}

async function loadStores() {
  const { data, error } = await supabase().from('stores').select('*').eq('active', true).order('sort');
  if (error) throw new Error('stores: ' + error.message);
  return data.map(rowToStore);
}

module.exports = { supabase, rowToStore, loadStores };
