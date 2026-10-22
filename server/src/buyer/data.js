// Дані сторінки закупниці, яких немає в пульті: запити дозволу за день (late_requests).
function dayLateOf(sb) {
  return async function dayLate(dir, day) {
    const { data, error } = await sb.from('late_requests').select('store_id,status,requested_at,approved_at').eq('dir', dir).eq('req_date', day);
    if (error) throw new Error('late_requests: ' + error.message);
    return data || [];
  };
}

module.exports = { dayLateOf };