const test = require('node:test');
const assert = require('node:assert/strict');

const R = require('../src/rules');
const fx = require('./fixtures/addr-keys.json');

// 19.10.2026 - літній час (UTC+3), 20.12.2026 - зимовий (UTC+2).
const kyiv = (iso) => new Date(iso);          // iso з явним зсувом, напр. '2026-10-19T12:59:00+03:00'
const ctxAt = (iso, extra = {}) => ({ at: kyiv(iso), settings: {}, lateRows: [], ...extra });

const store = (o = {}) => ({ id: 's1', label: 'Т1', address: 'м. Харків вул. Бучми, 32', days: { veg: [], bakery: [] }, directions: [], ...o });

// ---------- час ----------
test('kyivNow: день, година, хвилина, день тижня за Києвом (не UTC)', () => {
  const n = R.kyivNow(kyiv('2026-10-19T23:30:15+03:00'));          // 20:30:15 UTC, ще 19-те в Києві
  assert.equal(n.day, '2026-10-19');
  assert.equal(n.dmy, '19.10.2026');
  assert.equal(n.time, '23:30:15');
  assert.equal(n.hh, 23); assert.equal(n.mm, 30);
  assert.equal(n.dow, 1);                                          // понеділок
  const m = R.kyivNow(new Date('2026-10-19T21:30:00Z'));           // 00:30 20-го в Києві
  assert.equal(m.day, '2026-10-20'); assert.equal(m.hh, 0); assert.equal(m.dow, 2);
  assert.equal(R.kyivNow(kyiv('2026-12-20T00:05:00+02:00')).dow, 0);   // неділя, зима
});

// ---------- дедлайн ----------
test('deadlinePassed: ВК 13:00 - 12:59 false, 13:00 true (літо і зима)', () => {
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt('2026-10-19T12:59:00+03:00')), false);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt('2026-10-19T13:00:00+03:00')), true);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt('2026-12-15T12:59:59+02:00')), false);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt('2026-12-15T13:00:00+02:00')), true);
  assert.equal(R.deadlinePassed('nbhz', 's1', ctxAt('2026-10-19T17:29:00+03:00')), false);
  assert.equal(R.deadlinePassed('nbhz', 's1', ctxAt('2026-10-19T17:30:00+03:00')), true);
});

test('deadlinePassed: late_all на сьогодні відкриває, на інший день - ні', () => {
  const at = '2026-10-19T14:00:00+03:00';
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt(at)), true);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt(at, { settings: { late_all: { bakery: '2026-10-19' } } })), false);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt(at, { settings: { late_all: { bakery: '2026-10-18' } } })), true);
  assert.equal(R.deadlinePassed('bakery', 's1', ctxAt(at, { settings: { late_all: { veg: '2026-10-19' } } })), true,
    'відкритий інший напрямок не відкриває цей');
});

test('lateAllowed: лише збіг дня', () => {
  assert.equal(R.lateAllowed('veg', ctxAt('2026-10-19T10:00:00+03:00', { settings: { late_all: { veg: '2026-10-19' } } })), true);
  assert.equal(R.lateAllowed('veg', ctxAt('2026-10-19T10:00:00+03:00', { settings: {} })), false);
  assert.equal(R.lateAllowed('veg', { at: kyiv('2026-10-19T10:00:00+03:00') }), false, 'ctx без settings не падає');
});

// ---------- дозвіл закупниці ----------
const row = (o) => ({ dir: 'bakery', store_id: 's1', requested_at: null, approved_at: null, ...o });

test('дозвіл 30 хв: діє до 31-ї хвилини, потім знову закрито', () => {
  const approved = '2026-10-19T13:05:00+03:00';
  const lateRows = [row({ requested_at: '2026-10-19T13:03:00+03:00', approved_at: approved })];
  const at = (hhmmss) => ctxAt(`2026-10-19T${hhmmss}+03:00`, { lateRows });

  assert.equal(R.lateStatus('bakery', 's1', at('13:05:30')), 'approved');
  assert.equal(R.deadlinePassed('bakery', 's1', at('13:05:30')), false);
  assert.equal(R.deadlinePassed('bakery', 's1', at('13:34:59')), false);
  assert.equal(R.lateLeftMin('bakery', 's1', at('13:34:59')), 1);
  assert.equal(R.lateLeftMin('bakery', 's1', at('13:05:00')), 30);
  assert.equal(R.lateLeftMin('bakery', 's1', at('13:20:01')), 15, 'ceil: 14 хв 59 с -> 15');
  assert.equal(R.deadlinePassed('bakery', 's1', at('13:35:00')), true, '30 хвилин минуло');
  assert.equal(R.lateLeftMin('bakery', 's1', at('13:35:00')), 0);
  assert.notEqual(R.lateStatus('bakery', 's1', at('13:36:00')), 'approved');
});

test('дозвіл не поширюється на іншу точку і напрямок', () => {
  const lateRows = [row({ approved_at: '2026-10-19T13:05:00+03:00' })];
  const c = ctxAt('2026-10-19T13:10:00+03:00', { lateRows });
  assert.equal(R.deadlinePassed('bakery', 's2', c), true);
  assert.equal(R.lateStatus('veg', 's1', c), 'none');   // у овочів дедлайн 18:00 - ще відкрито, але дозволу в них немає
  assert.equal(R.deadlinePassed('bakery', 's1', c), false);
  assert.equal(R.deadlinePassed('bakery', undefined, c), true, 'без storeId дозвіл не діє');
});

test('lateStatus: pending 120 хв, none після; approved важливіший за pending', () => {
  const lateRows = [row({ requested_at: '2026-10-19T14:00:00+03:00' })];
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T14:01:00+03:00', { lateRows })), 'pending');
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T15:59:59+03:00', { lateRows })), 'pending');
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T16:00:00+03:00', { lateRows })), 'none');
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T14:01:00+03:00', { lateRows: [] })), 'none');
  assert.equal(R.lateStatus('', 's1', ctxAt('2026-10-19T14:01:00+03:00', { lateRows })), 'none');
  // як у Apps Script: дозвіл прострочився, а запит ще живий -> знову 'pending'
  const both = [row({ requested_at: '2026-10-19T14:00:00+03:00', approved_at: '2026-10-19T14:05:00+03:00' })];
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T14:10:00+03:00', { lateRows: both })), 'approved');
  assert.equal(R.lateStatus('bakery', 's1', ctxAt('2026-10-19T14:40:00+03:00', { lateRows: both })), 'pending');
});

test('дозвіл ігнорується, якщо напрямок без lateRequest', () => {
  const directions = { x: { key: 'x', deadline: '10:00', lateRequest: false } };
  const lateRows = [row({ dir: 'x', approved_at: '2026-10-19T10:05:00+03:00' })];
  assert.equal(R.deadlinePassed('x', 's1', ctxAt('2026-10-19T10:10:00+03:00', { directions, lateRows })), true);
});

test('невідомий напрямок - помилка з текстом Apps Script', () => {
  assert.throws(() => R.dirCfg('nope'), /Невідомий напрямок: "nope"\. Доступні: bread, nbhz, bakery, veg\./);
});

// ---------- дні тижня ----------
test('dayAllowed: овочі "Пн, Ср"; день рахується за Києвом', () => {
  const s = store({ days: { veg: [1, 3], bakery: [1, 2, 3, 4, 5] } });
  assert.equal(R.dayAllowed('veg', s, ctxAt('2026-10-19T09:00:00+03:00')), true);    // пн
  assert.equal(R.dayAllowed('veg', s, ctxAt('2026-10-20T09:00:00+03:00')), false);   // вт
  assert.equal(R.dayAllowed('veg', s, ctxAt('2026-10-21T00:10:00+03:00')), true,
    '00:10 середи за Києвом (21:10 UTC вівторка) - вже середа');
  assert.equal(R.dayAllowed('bakery', s, ctxAt('2026-10-24T09:00:00+03:00')), false);   // сб
  assert.equal(R.dayAllowed('bakery', s, ctxAt('2026-10-23T09:00:00+03:00')), true);    // пт
});

test('dayAllowed: без днів - без обмежень; напрямок без orderDays - завжди; дозвіл день не знімає', () => {
  assert.equal(R.dayAllowed('veg', store(), ctxAt('2026-10-20T09:00:00+03:00')), true);
  assert.equal(R.dayAllowed('bread', store({ days: { bread: [1] } }), ctxAt('2026-10-20T09:00:00+03:00')), true);
  const s = store({ days: { veg: [1] } });
  const lateRows = [row({ dir: 'veg', approved_at: '2026-10-20T08:55:00+03:00' })];
  assert.equal(R.dayAllowed('veg', s, ctxAt('2026-10-20T09:00:00+03:00', { lateRows })), false, 'LATE_OVERRIDES_DAY=false');
  assert.equal(R.LATE_OVERRIDES_DAY, false);
});

test('dayOffText: дослівно', () => {
  const s = store({ days: { veg: [1, 3], bakery: [1, 2, 3, 4, 5] } });
  assert.equal(R.dayOffText('veg', s), 'Вибачте, не ваш день для замовлення. Ваші дні: понеділок, середа.');
  assert.equal(R.dayOffText('bakery', s),
    'Кулінарія у суботу та неділю не працює. Ваші дні: понеділок, вівторок, середа, четвер, пʼятниця.');
  assert.equal(R.dayOffText('veg', store({ days: { veg: [0, 6] } })),
    'Вибачте, не ваш день для замовлення. Ваші дні: неділя, субота.');
  assert.equal(R.dayOffText('veg', store()), 'Вибачте, не ваш день для замовлення.');
  assert.equal(R.dayOffText('bread', store()), 'Сьогодні цей напрямок не приймає замовлень.');
  assert.equal('пʼятниця'.charCodeAt(1), 0x2bc, 'апостроф U+02BC, як у VegDays.gs');
});

test('parseDays / DAY_KEYS', () => {
  assert.deepEqual(R.parseDays('Пн, Ср'), [1, 3]);
  assert.deepEqual(R.parseDays('Ср, Нд'), [0, 3]);
  assert.deepEqual(R.parseDays(null), []);
});

// ---------- мінімалка ----------
test('minOrderOf: зміна з 01.10.2026 діє з 00:00 за Києвом', () => {
  const cfg = R.dirCfg('bread');
  assert.equal(R.minOrderOf(cfg, kyiv('2026-09-30T12:00:00+03:00')), 350);
  assert.equal(R.minOrderOf(cfg, new Date('2026-09-30T20:59:59Z')), 350);   // 23:59:59 за Києвом
  assert.equal(R.minOrderOf(cfg, new Date('2026-09-30T21:00:00Z')), 400);   // 00:00:00 01.10
  assert.equal(R.minOrderOf(cfg, kyiv('2026-10-19T09:00:00+03:00')), 400);
  assert.equal(R.minOrderOf(R.dirCfg('veg'), kyiv('2026-10-19T09:00:00+03:00')), 500);
  assert.equal(R.minOrderOf(R.dirCfg('bakery'), kyiv('2026-10-19T09:00:00+03:00')), 0);
});

test('minOrderOf: береться найновіша з настали, майбутня ігнорується', () => {
  const cfg = { minOrder: 100, minOrderChanges: [
    { from: '01.12.2026', value: 300 }, { from: '01.10.2026', value: 200 }, { from: '01.01.2027', value: 999 },
  ] };
  assert.equal(R.minOrderOf(cfg, kyiv('2026-09-01T10:00:00+03:00')), 100);
  assert.equal(R.minOrderOf(cfg, kyiv('2026-11-01T10:00:00+02:00')), 200);
  assert.equal(R.minOrderOf(cfg, kyiv('2026-12-15T10:00:00+02:00')), 300);
});

// ---------- настройки ----------
test('dirEnabled / disabledDirections з settings.dirs_off', () => {
  const settings = { dirs_off: ['veg'] };
  assert.equal(R.dirEnabled('veg', settings), false);
  assert.equal(R.dirEnabled('bread', settings), true);
  assert.equal(R.dirEnabled('veg', {}), true);
  assert.deepEqual(R.disabledDirections(settings), { veg: true });
});

// ---------- адреси ----------
test('shortenAddress / addrKey / canonKey: приклади з Address.gs', () => {
  assert.equal(R.shortenAddress('м. Харків вул. Астрономічна, 44 Г'), 'Астрономічна, 44 г');
  assert.equal(R.shortenAddress(''), '');
  assert.equal(R.addrKey('м. Харків вул. Астрономічна, 44 Г'), 'астрономічна 44 г');
  assert.equal(R.addrKey('Астрономічна, 44 г'), 'астрономічна 44 г', 'повна і коротка - один ключ');
  assert.equal(R.addrKey('м. Харків пр-т Байрона, 156'), 'байрона 156');
  assert.equal(R.canonKey('м. Харків вул. Бучми, 32'), 'м харків вул бучми 32');
});

test('еталон Apps Script: shortenAddress і addrKey на всіх унікальних адресах точок', () => {
  assert.ok(fx.addresses.length >= 39);
  for (const a of fx.addresses) {
    assert.equal(R.shortenAddress(a.address), a.short, `short: ${a.address}`);
    assert.equal(R.addrKey(a.address), a.addrKey, `addrKey: ${a.address}`);
    assert.equal(R.addrKey(R.shortenAddress(a.address)), a.addrKeyShort, `addrKey(short): ${a.address}`);
  }
});

test('еталон Apps Script: canonKey і statusKey для всіх точок × 4 напрямки', () => {
  assert.equal(fx.stores.length, 39);
  let n = 0;
  for (const rec of fx.stores) {
    assert.equal(R.canonKey(rec.store.address), rec.store.id, `store_id: ${rec.store.address}`);
    assert.equal(R.canonKey(rec.store.address), rec.canon);
    for (const d of Object.keys(rec.status)) {
      assert.equal(R.statusKey(d, rec.store), rec.status[d], `${d}: ${rec.store.label}`);
      n++;
    }
  }
  assert.equal(n, 39 * 4);
});

test('5 адрес для читача: приклади з бойового Довідника', () => {
  const pick = ['м. Харків вул. Астрономічна, 44 Г', 'м. Харків пр-т Байрона, 156',
    'м. Харків вул. Амосова, 5А', 'м. Харків вул. Бучми, 32Б1', 'м. Харків вул. Роганська, 130/4'];
  for (const p of pick) {
    const rec = fx.addresses.find((a) => a.address === p);
    assert.ok(rec, `нема в еталоні: ${p}`);
    assert.equal(R.addrKey(R.shortenAddress(p)), rec.addrKeyShort);
  }
});
