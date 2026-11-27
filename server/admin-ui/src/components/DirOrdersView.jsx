import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Search,
  LockOpen,
  ExternalLink,
  FileSpreadsheet,
  Edit3,
  Trash2,
  Save,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { apiCall } from '../api';
import { Modal } from './Modal';

export default function DirOrdersView({ dir, onChangeDir, onBack, toast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('done');
  const [q, setQ] = useState('');
  const [openingId, setOpeningId] = useState('');

  // Store order detail modal
  const [storeOrder, setStoreOrder] = useState(null);
  const [editQtys, setEditQtys] = useState({});
  const [savingOrder, setSavingOrder] = useState(false);

  const dirRef = useRef(dir);
  dirRef.current = dir;

  const load = async () => {
    const reqDir = dir;
    setLoading(true);
    try {
      const res = await apiCall('dirStores', { dir: reqDir });
      if (dirRef.current !== reqDir) return;
      setData(res);
    } catch (e) {
      if (dirRef.current !== reqDir) return;
      toast(e.message, 'err');
    } finally {
      if (dirRef.current === reqDir) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dir]);

  const openStoreForLate = async (store) => {
    setOpeningId(store.id);
    try {
      const r = await apiCall('openStore', { dir, storeId: store.id });
      toast(`Приём открыт для «${store.label}» на ${r.left || 30} мин`, 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setOpeningId('');
    }
  };

  const openOrderModal = async (storeId) => {
    try {
      const st = await apiCall('store', { dir, storeId });
      setStoreOrder(st);
      const map = {};
      (st.rows || []).forEach((r) => {
        map[r.row] = String(r.qty);
      });
      setEditQtys(map);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const handleSaveOrder = async () => {
    if (!storeOrder) return;
    const changes = (storeOrder.rows || [])
      .map((r) => ({
        row: r.row,
        name: r.name,
        oldQty: Number(r.qty),
        qty: Number(String(editQtys[r.row] ?? r.qty).replace(',', '.')),
      }))
      .filter((x) => Number.isFinite(x.qty) && x.qty !== x.oldQty);

    if (!changes.length) {
      toast('Изменений нет', 'info');
      return;
    }

    setSavingOrder(true);
    try {
      const r = await apiCall('editOrder', {
        dir,
        storeId: storeOrder.id,
        changes,
      });
      toast(`Сохранено изменений: ${r.changed}`, 'ok');
      setStoreOrder(null);
      await load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSavingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!storeOrder) return;
    if (!window.confirm(`Отменить весь заказ точки «${storeOrder.label}»?`)) return;
    setSavingOrder(true);
    try {
      const r = await apiCall('cancelOrder', { dir, storeId: storeOrder.id });
      toast(`Заказ отменён (строк: ${r.removed})`, 'ok');
      setStoreOrder(null);
      await load();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSavingOrder(false);
    }
  };

  const list = data ? data[subTab] || [] : [];
  const filtered = list.filter((s) =>
    `${s.label} ${s.code || ''} ${s.route || ''}`.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Header & Direction Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onBack} className="btn-secondary px-3 py-2">
            <ArrowLeft className="w-4 h-4" />
            <span>Сегодня</span>
          </button>
          <div>
            <h2 className="text-lg font-bold text-gd-ink">
              {data?.title || 'Заказы по направлению'}
            </h2>
            {data && (
              <p className="text-xs text-gd-muted">
                Сегодня {data.dow} · единица измерения: {data.unit || 'шт'}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'bread', label: 'Хлеб Рома' },
            { id: 'nbhz', label: 'Хлеб НБХЗ' },
            { id: 'bakery', label: 'Выпечка' },
            { id: 'veg', label: 'Овощи' },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onChangeDir(d.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                dir === d.id
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'glass-panel text-gd-muted hover:border-gd-accent/50'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Links + Sub-tabs + Search */}
      <div className="rounded-2xl p-4 glass-panel space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'done', label: `Заказали (${data?.done?.length ?? 0})` },
              { id: 'wait', label: `Ждём (${data?.wait?.length ?? 0})` },
              ...(data?.byDays ? [{ id: 'off', label: `Не их день (${data?.off?.length ?? 0})` }] : []),
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all ${
                  subTab === t.id
                    ? 'bg-gd-accent text-gd-on-accent'
                    : 'bg-gd-inner text-gd-muted hover:bg-gd-raised'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {data?.xlsx && (
              <a
                href={data.xlsx}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                <FileSpreadsheet className="w-4 h-4 text-gd-ok" />
                <span>Скачать Excel</span>
              </a>
            )}
            {data?.sheetUrl && (
              <a
                href={data.sheetUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Google Таблица</span>
              </a>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gd-muted" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию точки, коду или маршруту..."
            className="input-field pl-10"
          />
        </div>
      </div>

      {/* Stores List */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-2xl glass-panel" />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl glass-panel divide-y divide-gd-line overflow-hidden">
          {filtered.map((s) => (
            <div
              key={s.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 hover:bg-gd-inner transition-colors"
            >
              <div
                className="min-w-0 flex-1 cursor-pointer"
                onClick={() => openOrderModal(s.id)}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm text-gd-ink">
                    {s.label}
                  </span>
                  {s.ua && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gd-accent/12 text-gd-accent">
                      ЮА маркет
                    </span>
                  )}
                  {s.route && (
                    <span className="text-xs text-gd-muted">
                      Маршрут: {s.route}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gd-muted mt-0.5 flex flex-wrap gap-3">
                  <span>График: {s.days}</span>
                  {s.next && !s.dayOk && <span>Следующий заказ: {s.next}</span>}
                  {s.time && (
                    <span className="inline-flex items-center gap-1 text-gd-accent font-medium">
                      <Clock className="w-3 h-3" /> {s.time}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {subTab === 'done' && (
                  <>
                    <div className="text-right mr-2">
                      <div className="text-sm font-extrabold text-gd-ink">
                        {s.qty} {data?.unit || ''}
                      </div>
                      <div className="text-[11px] text-gd-muted">
                        {s.n} поз.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openOrderModal(s.id)}
                      className="btn-secondary px-3 py-1.5 text-xs"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Состав</span>
                    </button>
                  </>
                )}

                {subTab === 'wait' && (
                  <>
                    <button
                      type="button"
                      disabled={openingId === s.id}
                      onClick={() => openStoreForLate(s)}
                      className="btn-secondary px-3 py-1.5 text-xs"
                    >
                      <LockOpen className="w-3.5 h-3.5 text-gd-accent" />
                      <span>Открыть на 30 мин</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openOrderModal(s.id)}
                      className="btn-secondary px-2.5 py-1.5 text-xs"
                    >
                      Карточка
                    </button>
                  </>
                )}

                {subTab === 'off' && (
                  <button
                    type="button"
                    disabled={openingId === s.id}
                    onClick={() => openStoreForLate(s)}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    <LockOpen className="w-3.5 h-3.5" />
                    <span>Разрешить вне графика</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          {!filtered.length && (
            <div className="p-8 text-center text-sm text-gd-muted">
              Список пуст
            </div>
          )}
        </div>
      )}

      {/* Store Order Detail & Editor Modal */}
      <Modal
        open={!!storeOrder}
        onClose={() => setStoreOrder(null)}
        title={storeOrder?.label || 'Заказ точки'}
        subtitle={
          storeOrder
            ? `${storeOrder.dirTitle} · ${storeOrder.today} · ${
                storeOrder.lateLeft > 0
                  ? `разрешение активно ещё ${storeOrder.lateLeft} мин`
                  : storeOrder.closed
                  ? 'приём закрыт'
                  : 'приём открыт'
              }`
            : ''
        }
        maxWidth="max-w-2xl"
        footer={
          storeOrder && (
            <>
              {storeOrder.rows?.length > 0 && (
                <button
                  type="button"
                  disabled={savingOrder}
                  onClick={handleCancelOrder}
                  className="btn-danger mr-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Отменить заказ</span>
                </button>
              )}
              {storeOrder.closed && (
                <button
                  type="button"
                  disabled={savingOrder}
                  onClick={async () => {
                    await openStoreForLate(storeOrder);
                    await openOrderModal(storeOrder.id);
                  }}
                  className="btn-secondary"
                >
                  <LockOpen className="w-4 h-4" />
                  <span>Открыть на 30 мин</span>
                </button>
              )}
              {storeOrder.rows?.length > 0 && (
                <button
                  type="button"
                  disabled={savingOrder}
                  onClick={handleSaveOrder}
                  className="btn-primary"
                >
                  <Save className="w-4 h-4" />
                  <span>Сохранить изменения</span>
                </button>
              )}
            </>
          )
        }
      >
        {storeOrder && (
          <div className="space-y-4">
            {storeOrder.rows?.length > 0 ? (
              <div className="rounded-xl border border-gd-line overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gd-inner text-xs uppercase text-gd-muted">
                    <tr>
                      <th className="text-left px-3.5 py-2.5">Позиция</th>
                      <th className="text-right px-3.5 py-2.5 w-32">Кол-во ({storeOrder.unit})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gd-line">
                    {storeOrder.rows.map((r) => (
                      <tr key={r.row}>
                        <td className="px-3.5 py-2.5 font-medium text-gd-ink">
                          {r.name}
                        </td>
                        <td className="px-3.5 py-2 text-right">
                          <input
                            type="number"
                            step={dir === 'veg' ? '0.1' : '1'}
                            min="0"
                            value={editQtys[r.row] ?? r.qty}
                            onChange={(e) =>
                              setEditQtys((prev) => ({ ...prev, [r.row]: e.target.value }))
                            }
                            className="input-field py-1.5 px-2.5 text-right font-bold w-28 inline-block"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center rounded-xl glass-sub text-sm text-gd-muted">
                Активных строк заказа в базе на сегодня нет.
              </div>
            )}

            <div className="text-xs text-gd-muted">
              Подсказка: чтобы убрать отдельную позицию из заказа, поставьте количество <b>0</b> и нажмите «Сохранить изменения».
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
