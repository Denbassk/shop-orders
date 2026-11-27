import React, { useEffect, useState } from 'react';
import {
  Search,
  LayoutGrid,
  Table as TableIcon,
  Plus,
  ExternalLink,
  Save,
  MapPin,
  Building2,
} from 'lucide-react';
import { apiCall } from '../api';
import { Modal } from './Modal';

const DAYS_LIST = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const ZONES_LIST = ['Салтовка', 'Новые дома', 'Центр', 'не возится'];
const ENTITIES = [
  { key: 'family', label: 'Фемели Маркет', edrpou: '44413718' },
  { key: 'ua', label: 'ЮА Маркет', edrpou: '45672783' },
];
const entityByEdrpou = (val) => {
  const digits = String(val || '').replace(/\D/g, '');
  return ENTITIES.find((e) => e.edrpou === digits)?.key || 'other';
};

export default function StoresView({ toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [view, setView] = useState('cards'); // cards | table
  const [showInactive, setShowInactive] = useState(false);
  const [entityFilter, setEntityFilter] = useState('all'); // all | family | ua

  // Store Card Modal
  const [cardModal, setCardModal] = useState(null); // { summary, edit }
  const [editFields, setEditFields] = useState({});
  const [savingCard, setSavingCard] = useState(false);

  // Add Store Modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    address: '',
    label: '',
    code: '',
    route: '',
    routeNbhz: '',
    zone: '',
    edrpou: '44413718',
    bread: true,
    nbhz: false,
    bakery: true,
    veg: true,
    daysVeg: '',
    daysBakery: '',
    note: '',
  });
  const [savingAdd, setSavingAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiCall('storesTable', {});
      setData(res);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openStoreDetail = async (storeId) => {
    try {
      const [summary, edit] = await Promise.all([
        apiCall('storeCard', { storeId }),
        apiCall('card', { storeId }),
      ]);
      setCardModal({ summary, edit });
      setEditFields({ ...edit.f });
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const toggleDayInStr = (str, day) => {
    const parts = String(str || '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    const next = parts.includes(day) ? parts.filter((d) => d !== day) : [...parts, day];
    return DAYS_LIST.filter((d) => next.includes(d)).join(', ');
  };

  const handleSaveCard = async (e) => {
    e.preventDefault();
    if (!cardModal?.edit) return;
    const orig = cardModal.edit.f;
    const set = {};
    Object.keys(editFields).forEach((k) => {
      if (String(editFields[k]) !== String(orig[k])) {
        set[k] = editFields[k];
      }
    });
    if (!Object.keys(set).length) {
      toast('Изменений нет', 'info');
      return;
    }

    setSavingCard(true);
    try {
      const res = await apiCall('cardSave', {
        storeId: cardModal.edit.id,
        set,
        orig,
      });
      toast(`Карточка сохранена (изменений: ${res.changed})`, 'ok');
      setCardModal(null);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingCard(false);
    }
  };

  const handleAddStore = async (e) => {
    e.preventDefault();
    setSavingAdd(true);
    try {
      const res = await apiCall('cardAdd', addForm);
      toast(`Точка «${res.label}» добавлена`, 'ok');
      setAddOpen(false);
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingAdd(false);
    }
  };

  const rows = (data?.rows || []).filter((r) => {
    if (!showInactive && !r.active) return false;
    if (entityFilter === 'ua' && !r.ua) return false;
    if (entityFilter === 'family' && r.ua) return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return `${r.label} ${r.address} ${r.code} ${r.route} ${r.zone}`.toLowerCase().includes(term);
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gd-ink">
            Торговые точки ({rows.length})
          </h2>
          <p className="text-xs text-gd-muted">
            Реквизиты, маршруты, графики направлений и заказы за сегодня
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data?.registryUrl && (
            <a
              href={data.registryUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-xs"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Справочник ТТ (Google)</span>
            </a>
          )}

          {data?.storeEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="btn-primary text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Новая точка</span>
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="rounded-2xl p-4 glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gd-muted" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию, адресу, коду, зоне или маршруту..."
            className="input-field pl-10"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="input-field py-1.5 text-xs w-auto"
            aria-label="Фильтр по юрлицу"
          >
            <option value="all">Все юрлица</option>
            <option value="family">Фемели Маркет</option>
            <option value="ua">ЮА Маркет</option>
          </select>

          <label className="flex items-center gap-2 text-xs font-medium text-gd-muted cursor-pointer px-2">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            <span>Выключенные</span>
          </label>

          <div className="inline-flex rounded-xl p-1 bg-gd-inner border border-gd-line">
            <button
              type="button"
              onClick={() => setView('cards')}
              className={`p-1.5 rounded-lg transition-colors ${
                view === 'cards'
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'text-gd-muted hover:bg-gd-inner'
              }`}
              title="Плитки"
              aria-label="Плитки"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`p-1.5 rounded-lg transition-colors ${
                view === 'table'
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'text-gd-muted hover:bg-gd-inner'
              }`}
              title="Таблица"
              aria-label="Таблица"
            >
              <TableIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 rounded-2xl glass-panel" />
          ))}
        </div>
      ) : view === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openStoreDetail(s.id)}
              className={`text-left rounded-2xl p-4 glass-panel hover:border-gd-accent/60 transition-all flex flex-col justify-between gap-2.5 ${
                !s.active ? 'opacity-60' : ''
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-sm text-gd-ink">
                    {s.label}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                      s.ua
                        ? 'bg-gd-accent/12 text-gd-accent'
                        : 'bg-gd-inner text-gd-muted'
                    }`}
                  >
                    {s.ua ? 'ЮА маркет' : 'Фемелі'}
                  </span>
                </div>
                <div className="text-xs text-gd-muted mt-0.5 truncate">
                  {s.address}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {s.code && (
                  <span className="px-2 py-0.5 rounded bg-gd-inner text-gd-muted font-mono">
                    #{s.code}
                  </span>
                )}
                {s.route && (
                  <span className="px-2 py-0.5 rounded bg-gd-inner text-gd-muted">
                    М-т: {s.route}
                  </span>
                )}
                {s.zone && (
                  <span className="px-2 py-0.5 rounded bg-gd-accent/12 text-gd-accent">
                    {s.zone}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl glass-panel overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gd-inner text-gd-muted uppercase border-b border-gd-line">
              <tr>
                <th className="px-3.5 py-3">Название</th>
                <th className="px-3.5 py-3">Код</th>
                <th className="px-3.5 py-3">Юрлицо</th>
                <th className="px-3.5 py-3">Маршрут</th>
                <th className="px-3.5 py-3">Зона</th>
                <th className="px-3.5 py-3">Дни овощи / выпечка</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gd-line">
              {rows.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => openStoreDetail(s.id)}
                  className="cursor-pointer hover:bg-gd-inner"
                >
                  <td className="px-3.5 py-2.5 font-bold text-gd-ink">
                    {s.label}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-gd-muted">
                    {s.code || '—'}
                  </td>
                  <td className="px-3.5 py-2.5">{s.ua ? 'ЮА маркет' : 'Фемелі'}</td>
                  <td className="px-3.5 py-2.5">{s.route || '—'}</td>
                  <td className="px-3.5 py-2.5">{s.zone || '—'}</td>
                  <td className="px-3.5 py-2.5 text-gd-muted">
                    {[s.daysVeg && `Ов: ${s.daysVeg}`, s.daysBakery && `Вып: ${s.daysBakery}`]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Store Card & Edit Modal */}
      <Modal
        open={!!cardModal}
        onClose={() => setCardModal(null)}
        title={cardModal?.summary?.store?.label || 'Карточка точки'}
        subtitle={
          cardModal?.summary?.store
            ? `${cardModal.summary.store.address} · ${cardModal.summary.store.company}`
            : ''
        }
        maxWidth="max-w-2xl"
        footer={
          cardModal && (
            <>
              <button type="button" onClick={() => setCardModal(null)} className="btn-secondary">
                Закрыть
              </button>
              {cardModal.edit?.editable && (
                <button
                  type="submit"
                  form="store-card-form"
                  disabled={savingCard}
                  className="btn-primary"
                >
                  <Save className="w-4 h-4" />
                  <span>Сохранить карточку</span>
                </button>
              )}
            </>
          )
        }
      >
        {cardModal && (
          <div className="space-y-5">
            {/* Today's status by directions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(cardModal.summary.dirs || []).map((d) => (
                <div key={d.dir} className="rounded-xl p-3 glass-sub text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-gd-ink">
                    <span>{d.title}</span>
                    {d.order ? (
                      <span className="text-gd-ok">
                        Заказано: {d.order.qty} {d.unit}
                      </span>
                    ) : d.available ? (
                      <span className="text-gd-muted">Нет заказа</span>
                    ) : (
                      <span className="text-gd-muted">Не подключено</span>
                    )}
                  </div>
                  {d.available && (
                    <div className="text-[11px] text-gd-muted">
                      График: {d.daysLabel}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!cardModal.edit?.editable && (
              <div className="rounded-xl p-3 text-xs bg-gd-warn/15 text-gd-warn border border-gd-warn/30">
                Редактирование боевых точек в пульте сейчас отключено (источник правды — Справочник ТТ в Google). Тестовые точки (id с «test») доступны для правки.
              </div>
            )}

            <form id="store-card-form" onSubmit={handleSaveCard} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Название в пульте</label>
                  <input
                    type="text"
                    disabled={!cardModal.edit?.editable}
                    value={editFields.label || ''}
                    onChange={(e) => setEditFields({ ...editFields, label: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Учётный номер (код)</label>
                  <input
                    type="text"
                    disabled={!cardModal.edit?.editable}
                    value={editFields.code || ''}
                    onChange={(e) => setEditFields({ ...editFields, code: e.target.value })}
                    className="input-field font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Маршрут</label>
                  <input
                    type="text"
                    disabled={!cardModal.edit?.editable}
                    value={editFields.route || ''}
                    onChange={(e) => setEditFields({ ...editFields, route: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Зона ВК</label>
                  <select
                    disabled={!cardModal.edit?.editable}
                    value={editFields.zone || ''}
                    onChange={(e) => setEditFields({ ...editFields, zone: e.target.value })}
                    className="input-field"
                  >
                    <option value="">— не задана —</option>
                    {ZONES_LIST.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Юрлицо</label>
                  <select
                    disabled={!cardModal.edit?.editable}
                    value={entityByEdrpou(editFields.edrpou)}
                    onChange={(e) => {
                      const found = ENTITIES.find((x) => x.key === e.target.value);
                      if (found) setEditFields({ ...editFields, edrpou: found.edrpou });
                    }}
                    className="input-field"
                  >
                    {ENTITIES.map((ent) => (
                      <option key={ent.key} value={ent.key}>
                        {ent.label} ({ent.edrpou})
                      </option>
                    ))}
                    {entityByEdrpou(editFields.edrpou) === 'other' && (
                      <option value="other">Другое ({editFields.edrpou || 'не задано'})</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">ЕГРПОУ (8 цифр)</label>
                  <input
                    type="text"
                    disabled={!cardModal.edit?.editable}
                    value={editFields.edrpou || ''}
                    onChange={(e) => setEditFields({ ...editFields, edrpou: e.target.value })}
                    className="input-field font-mono"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                {[
                  ['active', 'Активна'],
                  ['bread', 'Хлеб Рома'],
                  ['nbhz', 'Хлеб НБХЗ'],
                  ['bakery', 'Выпечка'],
                  ['veg', 'Овощи'],
                ].map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!cardModal.edit?.editable}
                      checked={!!editFields[k]}
                      onChange={(e) => setEditFields({ ...editFields, [k]: e.target.checked })}
                      className="rounded"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <div className="text-xs font-bold mb-1.5">Дни заказа: Выпечка</div>
                  <div className="flex flex-wrap gap-1">
                    {DAYS_LIST.map((d) => {
                      const active = String(editFields.daysBakery || '').includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!cardModal.edit?.editable}
                          onClick={() =>
                            setEditFields({
                              ...editFields,
                              daysBakery: toggleDayInStr(editFields.daysBakery, d),
                            })
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            active
                              ? 'bg-gd-accent text-gd-on-accent border-gd-accent'
                              : 'bg-gd-inner border-gd-line'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold mb-1.5">Дни заказа: Овощи</div>
                  <div className="flex flex-wrap gap-1">
                    {DAYS_LIST.map((d) => {
                      const active = String(editFields.daysVeg || '').includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={!cardModal.edit?.editable}
                          onClick={() =>
                            setEditFields({
                              ...editFields,
                              daysVeg: toggleDayInStr(editFields.daysVeg, d),
                            })
                          }
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            active
                              ? 'bg-gd-accent text-gd-on-accent border-gd-accent'
                              : 'bg-gd-inner border-gd-line'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Примечание</label>
                <input
                  type="text"
                  disabled={!cardModal.edit?.editable}
                  value={editFields.note || ''}
                  onChange={(e) => setEditFields({ ...editFields, note: e.target.value })}
                  className="input-field"
                />
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* Add Store Modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Новая торговая точка"
        maxWidth="max-w-xl"
        footer={
          <>
            <button type="button" onClick={() => setAddOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              form="add-store-form"
              disabled={savingAdd}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Создать точку</span>
            </button>
          </>
        }
      >
        <form id="add-store-form" onSubmit={handleAddStore} className="space-y-3">
          <div>
            <label className="block text-xs font-bold mb-1">Адрес (обязательно) *</label>
            <input
              type="text"
              required
              value={addForm.address}
              onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
              placeholder="ул. Сумская, 100"
              className="input-field"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Короткое название</label>
              <input
                type="text"
                value={addForm.label}
                onChange={(e) => setAddForm({ ...addForm, label: e.target.value })}
                placeholder="Сумская 100"
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Код (цифры)</label>
              <input
                type="text"
                value={addForm.code}
                onChange={(e) => setAddForm({ ...addForm, code: e.target.value })}
                className="input-field font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Маршрут</label>
              <input
                type="text"
                value={addForm.route}
                onChange={(e) => setAddForm({ ...addForm, route: e.target.value })}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">Зона ВК</label>
              <select
                value={addForm.zone}
                onChange={(e) => setAddForm({ ...addForm, zone: e.target.value })}
                className="input-field"
              >
                <option value="">—</option>
                {ZONES_LIST.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1">Юрлицо</label>
              <select
                value={entityByEdrpou(addForm.edrpou)}
                onChange={(e) => {
                  const found = ENTITIES.find((x) => x.key === e.target.value);
                  if (found) setAddForm({ ...addForm, edrpou: found.edrpou });
                }}
                className="input-field"
              >
                {ENTITIES.map((ent) => (
                  <option key={ent.key} value={ent.key}>
                    {ent.label} ({ent.edrpou})
                  </option>
                ))}
                {entityByEdrpou(addForm.edrpou) === 'other' && (
                  <option value="other">Другое ({addForm.edrpou || 'не задано'})</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold mb-1">ЕГРПОУ</label>
              <input
                type="text"
                value={addForm.edrpou}
                onChange={(e) => setAddForm({ ...addForm, edrpou: e.target.value })}
                className="input-field font-mono"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            {[
              ['bread', 'Хлеб Рома'],
              ['nbhz', 'Хлеб НБХЗ'],
              ['bakery', 'Выпечка'],
              ['veg', 'Овощи'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!addForm[k]}
                  onChange={(e) => setAddForm({ ...addForm, [k]: e.target.checked })}
                  className="rounded"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </form>
      </Modal>
    </div>
  );
}
