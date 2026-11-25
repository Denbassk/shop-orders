import React, { useState } from 'react';
import {
  Users,
  FileSpreadsheet,
  LockOpen,
  Lock,
  Clock,
  Package,
  Power,
  AlertTriangle,
  ArrowRight,
  Trash2,
  CheckCircle2,
  Truck,
} from 'lucide-react';
import { apiCall, fmtMoney, fmtDateShort } from '../api';

const DIR_LABELS = {
  bread: 'Хлеб Рома',
  nbhz: 'Хлеб НБХЗ',
  bakery: 'Выпечка',
  veg: 'Овощи',
};

export default function TodayView({
  todayData,
  woBrief,
  onRefresh,
  onOpenDirOrders,
  onOpenAssort,
  onOpenDeadline,
  onOpenIncoming,
  onOpenWriteOffs,
  toast,
}) {
  const [busyDir, setBusyDir] = useState('');
  const [dismissedSig, setDismissedSig] = useState(() => {
    try { return localStorage.getItem('pult_bq_banner_dismissed') || ''; } catch { return ''; }
  });

  if (!todayData) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-56 rounded-2xl glass-panel" />
        ))}
      </div>
    );
  }

  const incomingEntries = Object.entries(todayData.incoming || {}).filter(
    ([, info]) => info && info.n > 0
  );
  const incomingSig = incomingEntries.map(([k, i]) => `${k}:${i.n}:${i.big || 0}`).join('|');
  const showIncomingBanner = incomingEntries.length > 0 && incomingSig !== dismissedSig;
  const dismissIncomingBanner = () => {
    setDismissedSig(incomingSig);
    try { localStorage.setItem('pult_bq_banner_dismissed', incomingSig); } catch {}
  };

  const runDirAction = async (dirKey, fn, successMsg) => {
    setBusyDir(dirKey);
    try {
      await fn();
      if (successMsg) toast(successMsg, 'ok');
      await onRefresh();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setBusyDir('');
    }
  };

  return (
    <div className="space-y-5">
      {/* BigQuery Incoming Price Changes Alert */}
      {showIncomingBanner && (
        <div className="rounded-2xl p-4 border border-amber-400/70 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-amber-950 dark:text-amber-200">
                Изменились входные цены в приходах BigQuery
              </div>
              <div className="text-xs text-amber-800 dark:text-amber-200/80 mt-0.5 flex flex-wrap gap-2">
                {incomingEntries.map(([k, info]) => (
                  <span key={k} className="font-medium">
                    {DIR_LABELS[k] || k}: <b>{info.n}</b> поз.
                    {info.big > 0 ? ` (из них ${info.big} >30%)` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {incomingEntries.map(([k]) => (
              <button
                key={k}
                type="button"
                onClick={() => onOpenIncoming(k)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 transition-colors"
              >
                <span>Проверить {DIR_LABELS[k] || k}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ))}
            <button
              type="button"
              onClick={dismissIncomingBanner}
              title="Скрыть уведомление до следующих изменений"
              className="px-2.5 py-2 rounded-xl text-xs font-semibold text-amber-800 hover:bg-amber-500/15 dark:text-amber-200/75 dark:hover:bg-amber-400/15 transition-colors"
            >
              Скрыть
            </button>
          </div>
        </div>
      )}

      {/* Direction Cards Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {(todayData.dirs || []).map((d) => {
          const pct = d.total > 0 ? Math.min(100, Math.round((d.ordered / d.total) * 100)) : 0;
          const busy = busyDir === d.key;

          return (
            <div
              key={d.key}
              className={`rounded-2xl p-5 glass-panel flex flex-col justify-between gap-4 transition-all ${
                !d.enabled ? 'opacity-75' : ''
              }`}
            >
              {/* Header */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                        {d.title}
                      </h2>
                      {!d.enabled && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Выключено
                        </span>
                      )}
                      {d.enabled && d.openedAll && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/35">
                          Открыт всем до конца дня
                        </span>
                      )}
                      {d.enabled && !d.openedAll && d.closed && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-400/35">
                          Приём закрыт
                        </span>
                      )}
                      {d.enabled && !d.openedAll && !d.closed && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-900 border border-teal-300 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-400/35">
                          Приём открыт
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-cyan-200/70 mt-1">
                      <span>
                        Дедлайн: <b className="text-slate-900 dark:text-white">{d.deadline || '—'}</b>
                        {d.deadlineOverride && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300 font-semibold">
                            врем. (база {d.baseDeadline})
                          </span>
                        )}
                      </span>
                      {d.reportAt ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Отчёт в {d.reportAt}
                        </span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400">Отчёт не собирался</span>
                      )}
                      {d.leadOverride && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-300 font-semibold">
                          <Truck className="w-3.5 h-3.5" />
                          Доставка: {(typeof d.delivery === 'object' && d.delivery ? (d.delivery.full || d.delivery.short || d.delivery.day) : d.delivery) || `${d.leadOverride.days} дн.`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Counter */}
                  <div className="text-right shrink-0">
                    {d.noDayToday ? (
                      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Сегодня не день заказа
                      </div>
                    ) : (
                      <>
                        <div className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                          {d.ordered}
                          <span className="text-sm font-semibold text-slate-500 dark:text-cyan-200/60">
                            {' '}
                            / {d.total}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-slate-500 dark:text-cyan-200/60">
                          {pct}% заказали
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {!d.noDayToday && (
                  <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-[#07111f] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-teal-500 to-cyan-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {/* Waiting Stores Preview */}
                {!d.noDayToday && d.waiting && d.waiting.length > 0 && (
                  <div className="text-xs text-slate-600 dark:text-slate-300/85 bg-slate-100/90 dark:bg-[#081322]/75 rounded-xl px-3 py-2 border border-slate-200/80 dark:border-cyan-400/10">
                    <span className="font-semibold text-slate-800 dark:text-cyan-200">
                      Ждём ({d.total - d.ordered}):{' '}
                    </span>
                    {d.waiting.slice(0, 6).join(', ')}
                    {d.waiting.length > 6 && ` и ещё ${d.waiting.length - 6}…`}
                  </div>
                )}

                {d.offDay > 0 && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Не их день сегодня: {d.offDay} точек (всего подключено {d.all})
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/80 dark:border-cyan-400/10">
                <button
                  type="button"
                  onClick={() => onOpenDirOrders(d.key)}
                  className="btn-primary px-3.5 py-2 text-xs"
                >
                  <Users className="w-4 h-4" />
                  <span>Кто заказал</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runDirAction(
                      d.key,
                      () => apiCall('report', { dir: d.key }),
                      `Отчёт «${d.title}» собран`
                    )
                  }
                  className="btn-secondary px-3 py-2 text-xs"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-600 dark:text-teal-300" />
                  <span>Собрать отчёт</span>
                </button>

                {d.openedAll ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runDirAction(
                        d.key,
                        () => apiCall('closeAll', { dir: d.key }),
                        `Обычный режим возвращён: ${d.title}`
                      )
                    }
                    className="btn-secondary px-3 py-2 text-xs border-amber-400/60 text-amber-900 dark:text-amber-300"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Вернуть режим</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runDirAction(
                        d.key,
                        () => apiCall('openAll', { dir: d.key }),
                        `Приём открыт всем до конца дня: ${d.title}`
                      )
                    }
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    <LockOpen className="w-4 h-4" />
                    <span>Открыть всем</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onOpenDeadline(d.key)}
                  className="btn-secondary px-3 py-2 text-xs"
                  title="Временный дедлайн и срок доставки"
                >
                  <Clock className="w-4 h-4" />
                  <span>Время</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenAssort(d.key)}
                  className="btn-secondary px-3 py-2 text-xs"
                  title="Ассортимент и цены"
                >
                  <Package className="w-4 h-4" />
                  <span>Ассортимент</span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const nextOn = !d.enabled;
                    if (
                      !nextOn &&
                      !window.confirm(`Выключить направление «${d.title}» у всех продавцов?`)
                    ) {
                      return;
                    }
                    runDirAction(
                      d.key,
                      () => apiCall('setDirEnabled', { dir: d.key, on: nextOn }),
                      nextOn ? `Направление включено: ${d.title}` : `Направление выключено: ${d.title}`
                    );
                  }}
                  className={`ml-auto p-2 rounded-xl border text-xs transition-colors ${
                    d.enabled
                      ? 'border-slate-300 text-slate-500 hover:text-rose-600 hover:border-rose-300 dark:border-cyan-400/15 dark:text-slate-400 dark:hover:text-rose-300'
                      : 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                  }`}
                  title={d.enabled ? 'Выключить направление' : 'Включить направление'}
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Write-offs Brief Card */}
      {woBrief && (
        <div className="rounded-2xl p-5 glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300 shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Списания выпечки и кулинарии
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    woBrief.openedAll
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-300'
                      : woBrief.closed
                      ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      : 'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-300'
                  }`}
                >
                  {woBrief.openedAll
                    ? 'Открыто до конца дня'
                    : woBrief.closed
                    ? `Закрыто (дедлайн ${woBrief.deadline})`
                    : `Открыто до ${woBrief.deadline}`}
                </span>
              </div>
              <div className="text-xs text-slate-600 dark:text-cyan-200/75 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Сегодня: <b>{woBrief.todayDocs}</b> актов ({woBrief.todayStores} ТТ) на{' '}
                  <b className="text-slate-900 dark:text-white">{fmtMoney(woBrief.todaySum)} грн</b>
                </span>
                <span>
                  За месяц: <b className="text-slate-900 dark:text-white">{fmtMoney(woBrief.monthSum)} грн</b>
                </span>
              </div>
            </div>
          </div>

          <button type="button" onClick={onOpenWriteOffs} className="btn-secondary shrink-0">
            <span>Открыть списания</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
