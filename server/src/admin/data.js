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
  return { dayOrders, logRows };
}

module.exports = { createAdminData };