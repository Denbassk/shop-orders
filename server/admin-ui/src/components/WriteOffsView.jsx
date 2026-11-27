import React, { useEffect, useState } from 'react';
import { confirmAction } from './Confirm';
import {
  Trash2,
  LockOpen,
  Lock,
  ExternalLink,
  Store,
  Package,
  AlertCircle,
} from 'lucide-react';
import { apiCall, fmtMoney } from '../api';
import { Modal } from './Modal';


const ENTITY_TITLES = {
  '44413718': 'Фемели Маркет',
  '45672783': 'ЮА Маркет',
};
const entityLabel = (b) => ENTITY_TITLES[String(b?.edrpou || '').replace(/\D/g, '')] || b?.name || '';

const PERIODS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: 'week', label: '7 дней' },
  { id: 'month', label: 'Этот месяц' },
  { id: 'prev', label: 'Прошлый месяц' },
];

export default function WriteOffsView({ toast, onRefreshBrief }) {
  const [period, setPeriod] = useState('month');
  const [edrpou, setEdrpou] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [togglingOpen, setTogglingOpen] = useState(false);

  // Store write-offs modal
  const [storeModal, setStoreModal] = useState(null);
  const [deletingDocId, setDeletingDocId] = useState('');

  const load = async (p = period, e = edrpou) => {
    setLoading(true);
    try {
      const res = await apiCall('woStats', { period: p, edrpou: e });
      setData(res);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(period, edrpou);
  }, [period, edrpou]);

  const handleToggleOpen = async (on) => {
    const ok = await confirmAction(on
      ? { title: 'Открыть приём списаний до конца дня?', text: 'Все точки смогут подавать списания до конца дня, даже после дедлайна.', ok: 'Открыть' }
      : { title: 'Вернуть дедлайн списаний?', text: 'Приём списаний снова закроется по дедлайну.', ok: 'Вернуть дедлайн' });
    if (!ok) return;
    setTogglingOpen(true);
    try {
      await apiCall('woOpen', { on });
      toast(on ? 'Приём списаний открыт до конца дня' : 'Возвращён обычный режим списаний', 'ok');
      await load(period, edrpou);
      if (onRefreshBrief) onRefreshBrief();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setTogglingOpen(false);
    }
  };

  const openStoreDocs = async (storeId) => {
    try {
      const res = await apiCall('woStore', { storeId, period });
      setStoreModal(res);
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!(await confirmAction({
      title: 'Удалить акт списания?', text: 'Акт будет удалён безвозвратно.', ok: 'Удалить', danger: true,
    }))) return;
    setDeletingDocId(docId);
    try {
      const res = await apiCall('woDelete', { docId });
      toast(`Акт удалён (${res.store}, ${fmtMoney(res.total)} грн)`, 'ok');
      if (storeModal) {
        await openStoreDocs(storeModal.id);
      }
      await load(period, edrpou);
      if (onRefreshBrief) onRefreshBrief();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setDeletingDocId('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Period Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gd-ink">
            Списания выпечки и кулинарии
          </h2>
          {data && (
            <p className="text-xs text-gd-muted">
              Период: {data.from} — {data.to} · хранение актов: {data.keepDays} дн.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                period === p.id
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'glass-panel text-gd-muted hover:border-gd-accent/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Banner & Entity Filter */}
      {data && (
        <div className="rounded-2xl p-4 glass-panel flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEdrpou('')}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                edrpou === ''
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'bg-gd-inner text-gd-muted'
              }`}
            >
              Все юрлица
            </button>
            {(data.books || []).map((b) => (
              <button
                key={b.edrpou}
                type="button"
                onClick={() => setEdrpou(b.edrpou)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                  edrpou === b.edrpou
                    ? 'bg-gd-accent text-gd-on-accent'
                    : 'bg-gd-inner text-gd-muted'
                }`}
              >
                {entityLabel(b)} ({fmtMoney(b.sum)} грн)
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {data.openedAll ? (
              <button
                type="button"
                disabled={togglingOpen}
                onClick={() => handleToggleOpen(false)}
                className="btn-secondary text-xs border-gd-warn/60 text-gd-warn"
              >
                <Lock className="w-4 h-4" />
                <span>Вернуть дедлайн ({data.deadline})</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={togglingOpen}
                onClick={() => handleToggleOpen(true)}
                className="btn-secondary text-xs"
              >
                <LockOpen className="w-4 h-4 text-gd-accent" />
                <span>Открыть приём списаний до конца дня</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl glass-panel" />
          ))}
        </div>
      ) : (
        data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-2xl p-4 glass-panel">
                <div className="text-xs font-medium text-gd-muted">
                  Сумма списаний
                </div>
                <div className="text-2xl font-extrabold text-gd-ink mt-1">
                  {fmtMoney(data.total)} <span className="text-xs font-normal">грн</span>
                </div>
              </div>

              <div className="rounded-2xl p-4 glass-panel">
                <div className="text-xs font-medium text-gd-muted">
                  Актов / единиц
                </div>
                <div className="text-2xl font-extrabold text-gd-ink mt-1">
                  {data.docs} <span className="text-xs font-normal text-gd-muted">/ {data.qty} шт</span>
                </div>
              </div>

              <div className="rounded-2xl p-4 glass-panel">
                <div className="text-xs font-medium text-gd-muted">
                  Подали списания
                </div>
                <div className="text-2xl font-extrabold text-gd-ink mt-1">
                  {data.storesCount} <span className="text-xs font-normal text-gd-muted">из {data.storesAll} ТТ</span>
                </div>
              </div>

              <div className="rounded-2xl p-4 glass-panel">
                <div className="text-xs font-medium text-gd-muted">
                  Без себестоимости
                </div>
                <div
                  className={`text-2xl font-extrabold mt-1 ${
                    data.noCost?.length > 0
                      ? 'text-gd-warn'
                      : 'text-gd-ink'
                  }`}
                >
                  {data.noCost?.length || 0} <span className="text-xs font-normal text-gd-muted">поз.</span>
                </div>
              </div>
            </div>

            {/* Entity Google Books */}
            {data.books?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.books.map((b) => (
                  <a
                    key={b.edrpou}
                    href={b.url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-gd-accent" />
                    <span>
                      Таблица {entityLabel(b)}
                    </span>
                  </a>
                ))}
              </div>
            )}

            {/* Two Columns: By Store & Top Products */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-2xl glass-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-gd-line flex items-center gap-2 font-bold text-sm">
                  <Store className="w-4 h-4 text-gd-accent" />
                  <span>По торговым точкам ({data.stores?.length || 0})</span>
                </div>
                <div className="divide-y divide-gd-line max-h-96 overflow-y-auto">
                  {(data.stores || []).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openStoreDocs(s.id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gd-inner transition-colors"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-bold text-xs text-gd-ink truncate">
                          {s.label}
                        </div>
                        <div className="text-[11px] text-gd-muted">
                          Актов: {s.docs} · {s.qty} шт
                        </div>
                      </div>
                      <div className="font-extrabold text-xs text-gd-ink shrink-0">
                        {fmtMoney(s.sum)} грн
                      </div>
                    </button>
                  ))}
                  {!data.stores?.length && (
                    <div className="p-6 text-center text-xs text-gd-muted">За период списаний нет</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl glass-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-gd-line flex items-center gap-2 font-bold text-sm">
                  <Package className="w-4 h-4 text-gd-accent" />
                  <span>Топ-20 списываемых позиций</span>
                </div>
                <div className="divide-y divide-gd-line max-h-96 overflow-y-auto">
                  {(data.products || []).map((p, idx) => (
                    <div
                      key={`${p.name}-${idx}`}
                      className="flex items-center justify-between px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold text-gd-ink truncate">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-gd-muted">
                          {p.cat} · {p.qty} шт
                        </div>
                      </div>
                      <div className="font-extrabold text-gd-ink shrink-0">
                        {fmtMoney(p.sum)} грн
                      </div>
                    </div>
                  ))}
                  {!data.products?.length && (
                    <div className="p-6 text-center text-xs text-gd-muted">Данных нет</div>
                  )}
                </div>
              </div>
            </div>

            {data.noCost?.length > 0 && (
              <div className="rounded-2xl p-4 glass-panel text-xs space-y-1">
                <div className="font-bold text-gd-warn flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  <span>Позиции без себестоимости (идут с суммой 0 грн):</span>
                </div>
                <div className="text-gd-muted">
                  {data.noCost.join(', ')}
                </div>
              </div>
            )}
          </>
        )
      )}

      {/* Store Write-off Acts Modal */}
      <Modal
        open={!!storeModal}
        onClose={() => setStoreModal(null)}
        title={storeModal?.label || 'Акты списания'}
        subtitle={
          storeModal
            ? `${storeModal.from} — ${storeModal.to} · всего ${fmtMoney(storeModal.total)} грн`
            : ''
        }
        maxWidth="max-w-2xl"
      >
        {storeModal && (
          <div className="space-y-4">
            {(storeModal.docs || []).map((doc) => (
              <div
                key={doc.id}
                className="rounded-xl p-3.5 glass-sub space-y-2.5 border border-gd-line"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className="font-bold text-gd-ink">
                      Акт от {doc.date}
                    </span>
                    {doc.who && <span className="text-gd-muted ml-2">({doc.who})</span>}
                    <div className="font-extrabold text-gd-accent mt-0.5">
                      Итого: {fmtMoney(doc.total)} грн ({doc.qty} шт)
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={deletingDocId === doc.id}
                    onClick={() => handleDeleteDoc(doc.id)}
                    className="btn-danger px-2.5 py-1.5 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Удалить</span>
                  </button>
                </div>

                <div className="divide-y divide-gd-line text-xs">
                  {(doc.lines || []).map((l, i) => (
                    <div key={i} className="py-1.5 flex items-center justify-between gap-2">
                      <span className="text-gd-ink truncate">{l.name}</span>
                      <span className="font-semibold text-gd-muted shrink-0">
                        {l.qty} × {fmtMoney(l.price)} = <b>{fmtMoney(l.amount)} грн</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!storeModal.docs?.length && (
              <div className="p-6 text-center text-xs text-gd-muted">Актов нет</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
