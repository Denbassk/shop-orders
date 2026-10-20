// Дані пульта з бази (окремо від data.js - менше конфліктів з Task 8): замовлення дня з рядками, «Журнал дій».
function createAdminData(sb) {
  const must = (what, r) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data || []; };
  // активні замовлення напрямку за день (основні й добавки) з рядками - замість хвоста сирого листа
  async function dayOrders(dir, day) {
    return must('orders', await sb.from('orders').select('id,store_id,is_addon,created_at,order_lines(id,line_no,name,qty)')
      .eq('dir', dir).eq('order_date', day).eq('status', 'active').order('created_at'))
      .map(({ order_lines, ...o }) => ({ ...o, lines: (order_lines || []).slice().sort((a, b) => a.line_no - b.line_no) }));
  }
  // «Журнал дій» (admin_log, міграція 000005): нові першими
  async function logRows(limit) {
    return must('admin_log', await sb.from('admin_log').select('at,action,details').order('at', { ascending: false }).limit(limit));
  }
  // час збирання звітів: settings 'report_at_<dir>' (як ScriptProperties report_at_<dir> у markReport_), ISO
  async function reportAts() {
    const out = {};
    must('settings', await sb.from('settings').select('key,value').like('key', 'report_at_%'))
      .forEach((r) => { out[r.key.slice('report_at_'.length)] = r.value; });
    return out;
  }
  async function setReportAt(dir, iso) {
    must('settings', await sb.from('settings').upsert({ key: 'report_at_' + dir, value: iso }));
  }
  // «Журнал дій» (adminLog_)
  async function adminLog(action, details) {
    must('admin_log', await sb.from('admin_log').insert({ action, details: String(details || '') }));
  }
  // скасування замовлень точки за день (admCancelOrder_): active -> cancelled, changed_at = зараз (вигрузка прибере рядки);
  // removed = рядки лише тих замовлень, які скасував саме цей UPDATE (паралельне скасування не рахується двічі)
  async function cancelDay(dir, storeId, day) {
    const rows = must('orders', await sb.from('orders').select('id,order_lines(id)')
      .eq('dir', dir).eq('store_id', storeId).eq('order_date', day).eq('status', 'active'));
    if (!rows.length) return 0;
    const done = must('orders', await sb.from('orders').update({ status: 'cancelled', changed_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id)).eq('status', 'active').select('id'));
    const hit = new Set(done.map((r) => r.id));
    return rows.filter((r) => hit.has(r.id)).reduce((n, r) => n + (r.order_lines || []).length, 0);
  }
  // налаштування без кешу (late_all, dirs_off): читання перед зміною
  async function getSetting(key) {
    const rows = must('settings', await sb.from('settings').select('value').eq('key', key).limit(1));
    return rows.length ? rows[0].value : null;
  }
  async function setSetting(key, value) {
    must('settings', await sb.from('settings').upsert({ key, value }));
  }
  // правка замовлення (admEditOrder_): рядки активних замовлень точки за день
  async function dayStoreLines(dir, storeId, day) {
    const rows = must('orders', await sb.from('orders').select('id,order_lines(id,name,qty)')
      .eq('dir', dir).eq('store_id', storeId).eq('order_date', day).eq('status', 'active'));
    return rows.flatMap((o) => (o.order_lines || []).map((l) => ({ id: l.id, order_pk: o.id, name: l.name, qty: Number(l.qty) })));
  }
  // зміна/видалення лише якщо стара кількість та сама (інакше false - «змінився»)
  async function setLineQty(id, oldQty, qty) {
    return must('order_lines', await sb.from('order_lines').update({ qty }).eq('id', id).eq('qty', oldQty).select('id')).length > 0;
  }
  async function deleteLine(id, oldQty) {
    return must('order_lines', await sb.from('order_lines').delete().eq('id', id).eq('qty', oldQty).select('id')).length > 0;
  }
  // змінені замовлення -> changed_at (вигрузка перебудує рядки точки); порожні -> cancelled
  async function touchOrders(ids, emptied) {
    if (!ids.length) return;
    const ts = new Date().toISOString();
    const keep = ids.filter((i) => !emptied.includes(i));
    if (keep.length) must('orders', await sb.from('orders').update({ changed_at: ts }).in('id', keep).eq('status', 'active'));
    if (emptied.length) must('orders', await sb.from('orders').update({ status: 'cancelled', changed_at: ts }).in('id', emptied).eq('status', 'active'));
  }
  return { dayOrders, logRows, reportAts, setReportAt, adminLog, cancelDay, getSetting, setSetting,
    dayStoreLines, setLineQty, deleteLine, touchOrders };
}

module.exports = { createAdminData };