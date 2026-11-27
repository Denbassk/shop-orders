import React, { useState } from 'react';
import { confirmAction } from './Confirm';
import {
  Users,
  FileSpreadsheet,
  LockOpen,
  Lock,
  Clock,
  Package,
  Power,
  Loader2,
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
        <div className="rounded-2xl p-4 border border-gd-warn/70 bg-gd-warn/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-gd-warn/20 text-gd-warn shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-gd-warn">
                Изменились входные цены в приходах BigQuery
              </div>
              <div className="text-xs text-gd-warn mt-0.5 flex flex-wrap gap-2">
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
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold btn-primary transition-colors"
              >
                <span>Проверить {DIR_LABELS[k] || k}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ))}
            <button
              type="button"
              onClick={dismissIncomingBanner}
              title="Скрыть уведомление до следующих изменений"
              className="px-2.5 py-2 rounded-xl text-xs font-semibold text-gd-warn hover:bg-gd-warn/15 transition-colors"
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
                      <h2 className="text-lg font-bold text-gd-ink">
                        {d.title}
                      </h2>
                      {!d.enabled && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gd-inner text-gd-muted">
                          Выключено
                        </span>
                      )}
                      {d.enabled && d.openedAll && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gd-ok/15 text-gd-ok border border-gd-ok/30">
                          Открыт всем до конца дня
                        </span>
                      )}
                      {d.enabled && !d.openedAll && d.closed && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gd-danger/15 text-gd-danger border border-gd-danger/30">
                          Приём закрыт
                        </span>
                      )}
                      {d.enabled && !d.openedAll && !d.closed && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gd-accent/12 text-gd-accent border border-gd-accent/30">
                          Приём открыт
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gd-muted mt-1">
                      <span>
                        Дедлайн: <b className="text-gd-ink">{d.deadline || '—'}</b>
                        {d.deadlineOverride && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gd-warn/15 text-gd-warn font-semibold">
                            врем. (база {d.baseDeadline})
                          </span>
                        )}
                      </span>
                      {d.reportAt ? (
                        <span className="inline-flex items-center gap-1 text-gd-ok font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Отчёт в {d.reportAt}
                        </span>
                      ) : (
                        <span className="text-gd-muted">Отчёт не собирался</span>
                      )}
                      {d.leadOverride && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gd-accent/12 text-gd-accent font-semibold">
                          <Truck className="w-3.5 h-3.5" />
                          Доставка: {(typeof d.delivery === 'object' && d.delivery ? (d.delivery.full || d.delivery.short || d.delivery.day) : d.delivery) || `${d.leadOverride.days} дн.`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Counter */}
                  <div className="text-right shrink-0">
                    {d.noDayToday ? (
                      <div className="text-xs font-semibold text-gd-muted">
                        Сегодня не день заказа
                      </div>
                    ) : (
                      <>
                        <div className="text-2xl font-extrabold tracking-tight text-gd-ink">
                          {d.ordered}
                          <span className="text-sm font-semibold text-gd-muted">
                            {' '}
                            / {d.total}
                          </span>
                        </div>
                        <div className="text-[11px] font-medium text-gd-muted">
                          {pct}% заказали
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                {!d.noDayToday && (
                  <div className="w-full h-2.5 rounded-full bg-gd-inner overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-gd-accent to-gd-accent/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}

                {/* Waiting Stores Preview */}
                {!d.noDayToday && d.waiting && d.waiting.length > 0 && (
                  <div className="text-xs text-gd-muted bg-gd-inner rounded-xl px-3 py-2 border border-gd-line">
                    <span className="font-semibold text-gd-ink">
                      Ждём ({d.total - d.ordered}):{' '}
                    </span>
                    {d.waiting.slice(0, 6).join(', ')}
                    {d.waiting.length > 6 && ` и ещё ${d.waiting.length - 6}…`}
                  </div>
                )}

                {d.offDay > 0 && (
                  <div className="text-[11px] text-gd-muted">
                    Не их день сегодня: {d.offDay} точек (всего подключено {d.all})
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gd-line">
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
                  <FileSpreadsheet className="w-4 h-4 text-gd-accent" />
                  <span>Собрать отчёт</span>
                </button>

                {d.openedAll ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Вернуть обычный режим: ${d.title}?`,
                        text: 'Приём снова закроется по дедлайну. Точки, которые ещё не заказали, после дедлайна заказать не смогут.',
                        ok: 'Вернуть режим',
                      });
                      if (ok)
                        runDirAction(
                          d.key,
                          () => apiCall('closeAll', { dir: d.key }),
                          `Обычный режим возвращён: ${d.title}`
                        );
                    }}
                    className="btn-secondary px-3 py-2 text-xs border-gd-warn/60 text-gd-warn"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Вернуть режим</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: `Открыть приём всем: ${d.title}?`,
                        text: 'Все точки смогут заказывать до конца дня, даже после дедлайна.',
                        ok: 'Открыть всем',
                      });
                      if (ok)
                        runDirAction(
                          d.key,
                          () => apiCall('openAll', { dir: d.key }),
                          `Приём открыт всем до конца дня: ${d.title}`
                        );
                    }}
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
                  onClick={async () => {
                    const nextOn = !d.enabled;
                    const lateNote =
                      nextOn && d.closed && !d.openedAll
                        ? `Дедлайн сегодня (${d.deadline || '—'}) уже прошёл: после включения приём останется закрытым. Чтобы точки заказали сегодня, нажмите «Открыть всем».`
                        : '';
                    const ok = await confirmAction(
                      nextOn
                        ? {
                            title: `Включить «${d.title}»?`,
                            text: 'Направление снова появится у продавцов.',
                            note: lateNote,
                            ok: 'Включить',
                          }
                        : {
                            title: `Выключить «${d.title}»?`,
                            text: 'Направление пропадёт у всех продавцов, заказать его будет нельзя, пока не включите обратно.',
                            ok: 'Выключить',
                            danger: true,
                          }
                    );
                    if (!ok) return;
                    runDirAction(
                      d.key,
                      () => apiCall('setDirEnabled', { dir: d.key, on: nextOn }),
                      nextOn
                        ? lateNote
                          ? `Направление включено: ${d.title}. Приём сегодня закрыт — для заказов нажмите «Открыть всем»`
                          : `Направление включено: ${d.title}`
                        : `Направление выключено: ${d.title}`
                    );
                  }}
                  className={`ml-auto ${d.enabled ? 'btn-secondary' : 'btn-primary'} px-3 py-2 text-xs`}
                  title={d.enabled ? 'Выключить направление у всех продавцов' : 'Включить направление'}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                  <span>{d.enabled ? 'Выключить' : 'Включить'}</span>
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
            <div className="p-2.5 rounded-xl bg-gd-danger/15 text-gd-danger shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-gd-ink">
                  Списания выпечки и кулинарии
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                    woBrief.openedAll
                      ? 'bg-gd-ok/15 text-gd-ok'
                      : woBrief.closed
                      ? 'bg-gd-inner text-gd-muted'
                      : 'bg-gd-accent/12 text-gd-accent'
                  }`}
                >
                  {woBrief.openedAll
                    ? 'Открыто до конца дня'
                    : woBrief.closed
                    ? `Закрыто (дедлайн ${woBrief.deadline})`
                    : `Открыто до ${woBrief.deadline}`}
                </span>
              </div>
              <div className="text-xs text-gd-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
                <span>
                  Сегодня: <b>{woBrief.todayDocs}</b> актов ({woBrief.todayStores} ТТ) на{' '}
                  <b className="text-gd-ink">{fmtMoney(woBrief.todaySum)} грн</b>
                </span>
                <span>
                  За месяц: <b className="text-gd-ink">{fmtMoney(woBrief.monthSum)} грн</b>
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
