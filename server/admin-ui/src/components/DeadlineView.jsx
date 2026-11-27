import React, { useEffect, useState } from 'react';
import { confirmAction } from './Confirm';
import { Clock, Truck, RotateCcw, Save } from 'lucide-react';
import { apiCall } from '../api';

export default function DeadlineView({ initialDir = 'bread', todayData, onRefresh, toast }) {
  const dirs = todayData?.dirs || [];
  const [dir, setDir] = useState(initialDir || 'bread');

  useEffect(() => {
    if (initialDir) setDir(initialDir);
  }, [initialDir]);

  const current = dirs.find((d) => d.key === dir) || dirs[0];
  const todayIso = todayData?.day || new Date().toISOString().slice(0, 10);

  // Deadline form
  const [dlTime, setDlTime] = useState('');
  const [dlFrom, setDlFrom] = useState(todayIso);
  const [dlTo, setDlTo] = useState(todayIso);
  const [savingDl, setSavingDl] = useState(false);

  // Delivery lead form
  const [leadDays, setLeadDays] = useState('1');
  const [leadFrom, setLeadFrom] = useState(todayIso);
  const [leadTo, setLeadTo] = useState('');
  const [savingLead, setSavingLead] = useState(false);

  useEffect(() => {
    if (!current) return;
    setDlTime(current.deadlineOverride?.deadline || current.baseDeadline || current.deadline || '14:00');
    setDlFrom(current.deadlineOverride?.from || todayIso);
    setDlTo(current.deadlineOverride?.to || todayIso);

    setLeadDays(String(current.leadOverride?.days || 1));
    setLeadFrom(current.leadOverride?.from || todayIso);
    setLeadTo(current.leadOverride?.to || '');
  }, [dir, current?.key, todayIso]);

  const handleSaveDeadline = async (e) => {
    e.preventDefault();
    setSavingDl(true);
    try {
      const res = await apiCall('setDeadline', {
        dir,
        deadline: dlTime,
        from: dlFrom,
        to: dlTo || dlFrom,
      });
      toast(`Дедлайн «${res.title}» изменён на ${res.deadline}`, 'ok');
      await onRefresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingDl(false);
    }
  };

  const handleRevertDeadline = async () => {
    if (!(await confirmAction({ title: 'Вернуть базовый дедлайн?', text: 'Временный дедлайн будет снят для этого направления.', ok: 'Вернуть' }))) return;
    setSavingDl(true);
    try {
      const res = await apiCall('revertDeadline', { dir });
      toast(
        res.reverted
          ? `Возвращён базовый дедлайн: ${res.base || '—'}`
          : 'Временный дедлайн не был задан',
        'ok'
      );
      await onRefresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingDl(false);
    }
  };

  const handleSaveLead = async (e) => {
    e.preventDefault();
    setSavingLead(true);
    try {
      const res = await apiCall('setLead', {
        dir,
        days: Number(leadDays),
        from: leadFrom,
        to: leadTo || '',
      });
      toast(`Срок доставки «${res.title}»: через ${res.days} дн.`, 'ok');
      await onRefresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingLead(false);
    }
  };

  const handleRevertLead = async () => {
    if (!(await confirmAction({ title: 'Снять временный срок доставки?', text: 'Вернётся обычный срок доставки этого направления.', ok: 'Снять' }))) return;
    setSavingLead(true);
    try {
      const res = await apiCall('revertLead', { dir });
      toast(
        res.reverted ? 'Временный срок доставки снят' : 'Срок доставки не был задан',
        'ok'
      );
      await onRefresh();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingLead(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gd-ink">
            Время приёма и срок доставки
          </h2>
          <p className="text-xs text-gd-muted">
            Временный перенос дедлайна (на праздники/выходные) и подсказка даты доставки продавцам
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {dirs.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDir(d.key)}
              className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all ${
                dir === d.key
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'glass-panel text-gd-muted hover:border-gd-accent/50'
              }`}
            >
              {d.title}
            </button>
          ))}
        </div>
      </div>

      {current && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Card 1: Temporary Deadline */}
          <form onSubmit={handleSaveDeadline} className="rounded-2xl p-5 glass-panel space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gd-accent/12 text-gd-accent">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gd-ink">
                    Временный дедлайн приёма
                  </h3>
                  <p className="text-xs text-gd-muted">
                    Базовый в справочнике: <b>{current.baseDeadline || '—'}</b>
                  </p>
                </div>
              </div>

              {current.deadlineOverride && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gd-warn/15 text-gd-warn">
                  Активен: {current.deadlineOverride.deadline}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Время (ЧЧ:ММ)
                </label>
                <input
                  type="time"
                  required
                  value={dlTime}
                  onChange={(e) => setDlTime(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  С даты
                </label>
                <input
                  type="date"
                  required
                  value={dlFrom}
                  onChange={(e) => {
                    setDlFrom(e.target.value);
                    if (dlTo < e.target.value) setDlTo(e.target.value);
                  }}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  По дату (включ.)
                </label>
                <input
                  type="date"
                  required
                  min={dlFrom}
                  value={dlTo}
                  onChange={(e) => setDlTo(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gd-line">
              {current.deadlineOverride ? (
                <button
                  type="button"
                  disabled={savingDl}
                  onClick={handleRevertDeadline}
                  className="btn-secondary text-xs"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Вернуть базовый ({current.baseDeadline})</span>
                </button>
              ) : (
                <span className="text-xs text-gd-muted">Сейчас действует базовый дедлайн</span>
              )}

              <button type="submit" disabled={savingDl} className="btn-primary text-xs">
                <Save className="w-4 h-4" />
                <span>Сохранить дедлайн</span>
              </button>
            </div>
          </form>

          {/* Card 2: Delivery Lead Override */}
          <form onSubmit={handleSaveLead} className="rounded-2xl p-5 glass-panel space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gd-accent/12 text-gd-accent">
                  <Truck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gd-ink">
                    Срок доставки для продавцов
                  </h3>
                  <p className="text-xs text-gd-muted">
                    Показывает продавцу плашку «Доставка: вт 24.11»
                  </p>
                </div>
              </div>

              {current.leadOverride && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-gd-accent/12 text-gd-accent">
                  Через {current.leadOverride.days} дн.
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Через сколько дней
                </label>
                <select
                  value={leadDays}
                  onChange={(e) => setLeadDays(e.target.value)}
                  className="input-field"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? '1 день (на завтра)' : `${n} дн.`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  С даты
                </label>
                <input
                  type="date"
                  required
                  value={leadFrom}
                  onChange={(e) => setLeadFrom(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  По дату (пусто = бессрочно)
                </label>
                <input
                  type="date"
                  min={leadFrom}
                  value={leadTo}
                  onChange={(e) => setLeadTo(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gd-line">
              {current.leadOverride ? (
                <button
                  type="button"
                  disabled={savingLead}
                  onClick={handleRevertLead}
                  className="btn-secondary text-xs"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Убрать дату доставки</span>
                </button>
              ) : (
                <span className="text-xs text-gd-muted">Дата доставки сейчас не выводится</span>
              )}

              <button type="submit" disabled={savingLead} className="btn-primary text-xs">
                <Save className="w-4 h-4" />
                <span>Сохранить срок</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
