export async function adminPost(action, payload = {}) {
  const res = await fetch('/admin/api', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: `Ошибка связи (${res.status})` };
  }
  return data;
}

let onAuthExpired = null;
export function setAuthHandler(fn) {
  onAuthExpired = fn;
}

export async function apiCall(action, payload = {}) {
  const r = await adminPost(action, payload);
  if (r && r.ok) return r.data;
  if (r && r.error === 'AUTH') {
    if (onAuthExpired) onAuthExpired();
    throw new Error('Нужно войти заново');
  }
  throw new Error((r && r.error) || 'Ошибка связи');
}

export async function apiLogout() {
  try {
    await fetch('/admin/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    // ignore
  }
}

// Зеркалит server/src/prices.js normalizeWeightName для живого предпросмотра в форме
export function normalizeWeightName(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/(^|[\s(\/\-xх×*])(\d+(?:[.,]\d+)?)\s*(?:кг|kg)\b/giu, (_, p, num) => {
    const g = Math.round(parseFloat(num.replace(',', '.')) * 1000);
    return g > 0 ? `${p}${g} гр` : `${p}${num} кг`;
  });
  s = s.replace(/(^|[\s(\/\-xх×*])(\d+(?:[.,]\d+)?)\s*(?:гр\.?|г\.?|gr|g)(?=$|[\s)\/\-,;:.!?])/giu, (_, p, num) => {
    const val = parseFloat(num.replace(',', '.'));
    if (!(val > 0)) return `${p}${num} гр`;
    const g = val < 10 && /[.,]/.test(num) ? Math.round(val * 1000) : Math.round(val);
    return `${p}${g} гр`;
  });
  return s.replace(/\s+/g, ' ').trim();
}

export function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export function fmtDateShort(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : String(iso);
}
