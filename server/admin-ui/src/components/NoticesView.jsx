import React, { useEffect, useState } from 'react';
import { confirmAction } from './Confirm';
import { Megaphone, Plus, Eye, Trash2, CheckCircle2, Clock } from 'lucide-react';
import { apiCall } from '../api';
import { Modal } from './Modal';

export default function NoticesView({ toast, onCountChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // New notice form
  const [text, setText] = useState('');
  const [dir, setDir] = useState('');
  const [until, setUntil] = useState('');
  const [modalFlag, setModalFlag] = useState(true);
  const [adding, setAdding] = useState(false);
  const [offBusy, setOffBusy] = useState(false);

  // Who saw modal
  const [whoData, setWhoData] = useState(null);
  const [whoFilter, setWhoFilter] = useState('all'); // all | none | seen | ack

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiCall('noticeList', {});
      setData(res);
      if (onCountChange) onCountChange((res.notices || []).length);
      if (!until && res.day) {
        setUntil(`${res.day}T21:00`);
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (!(await confirmAction({
      title: 'Опубликовать сообщение продавцам?',
      text: text.trim(),
      ok: 'Опубликовать',
    }))) return;
    setAdding(true);
    try {
      await apiCall('noticeAdd', {
        text: text.trim(),
        dir,
        until,
        modal: modalFlag,
      });
      toast('Сообщение опубликовано продавцам', 'ok');
      setText('');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setAdding(false);
    }
  };

  const handleOff = async (id) => {
    if (offBusy) return;
    if (!(await confirmAction({
      title: 'Снять сообщение?', text: 'Продавцы перестанут видеть это сообщение.', ok: 'Снять', danger: true,
    }))) return;
    setOffBusy(true);
    try {
      await apiCall('noticeOff', { id });
      toast('Сообщение выключено', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setOffBusy(false);
    }
  };

  const openWho = async (id) => {
    try {
      const res = await apiCall('noticeWho', { id });
      setWhoData(res);
      setWhoFilter('all');
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const whoRows = (whoData?.rows || []).filter((r) => {
    if (whoFilter === 'all') return true;
    return r.status === whoFilter;
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gd-ink">
          Сообщения продавцам
        </h2>
        <p className="text-xs text-gd-muted">
          Объявления в приложении заказа с контролем прочтения по каждой торговой точке
        </p>
      </div>

      {/* Create Notice Form */}
      <form onSubmit={handleAdd} className="rounded-2xl p-5 glass-panel space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-gd-ink">
          <Megaphone className="w-4 h-4 text-gd-accent" />
          <span>Новое объявление</span>
        </div>

        <div>
          <textarea
            rows={3}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Текст сообщения для продавцов..."
            className="input-field resize-y"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-bold mb-1 text-gd-muted">
              Кому показать
            </label>
            <select value={dir} onChange={(e) => setDir(e.target.value)} className="input-field">
              <option value="">Всем продавцам</option>
              <option value="bread">Только Хлеб Рома</option>
              <option value="nbhz">Только Хлеб НБХЗ</option>
              <option value="bakery">Только Выпечка</option>
              <option value="veg">Только Овощи</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold mb-1 text-gd-muted">
              Показывать до (Киев)
            </label>
            <input
              type="datetime-local"
              required
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="input-field"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={modalFlag}
                onChange={(e) => setModalFlag(e.target.checked)}
                className="rounded"
              />
              <span>Всплывающее окно («Понятно»)</span>
            </label>

            <button type="submit" disabled={adding} className="btn-primary text-xs shrink-0">
              <Plus className="w-4 h-4" />
              <span>Отправить</span>
            </button>
          </div>
        </div>
      </form>

      {/* Active Notices List */}
      {loading ? (
        <div className="h-40 rounded-2xl glass-panel animate-pulse" />
      ) : (
        <div className="space-y-3">
          {(data?.notices || []).map((n) => (
            <div
              key={n.id}
              className="rounded-2xl p-4 glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gd-accent/12 text-gd-accent">
                    {n.dirTitle}
                  </span>
                  <span className="text-xs text-gd-muted">
                    до {n.until.replace('T', ' ')}
                  </span>
                  {n.modal && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gd-warn/15 text-gd-warn">
                      Модальное окно
                    </span>
                  )}
                </div>

                <p className="text-sm font-medium text-gd-ink whitespace-pre-wrap">
                  {n.text}
                </p>

                {n.total != null && (
                  <div className="text-xs text-gd-muted">
                    Увидели: <b>{n.seen}</b> из <b>{n.total}</b> ТТ
                    {n.modal && ` · нажали «Понятно»: ${n.acked}`}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => openWho(n.id)}
                  className="btn-secondary text-xs"
                >
                  <Eye className="w-4 h-4" />
                  <span>Кто увидел</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOff(n.id)}
                  disabled={offBusy}
                  aria-label="Выключить сообщение"
                  className="btn-danger px-3 py-2 text-xs"
                  title="Выключить сообщение"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}

          {!data?.notices?.length && (
            <div className="rounded-2xl p-8 glass-panel text-center text-sm text-gd-muted">
              Активных сообщений продавцам сейчас нет
            </div>
          )}
        </div>
      )}

      {/* Who Saw Modal */}
      <Modal
        open={!!whoData}
        onClose={() => setWhoData(null)}
        title="Статус прочтения по точкам"
        subtitle={
          whoData
            ? `Увидели ${whoData.seen} из ${whoData.total} · подтвердили ${whoData.acked}`
            : ''
        }
        maxWidth="max-w-2xl"
      >
        {whoData && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: `Все (${whoData.rows.length})` },
                {
                  id: 'none',
                  label: `Не видели (${whoData.rows.filter((r) => r.status === 'none').length})`,
                },
                {
                  id: 'seen',
                  label: `Открыли (${whoData.rows.filter((r) => r.status === 'seen').length})`,
                },
                {
                  id: 'ack',
                  label: `Подтвердили (${whoData.rows.filter((r) => r.status === 'ack').length})`,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setWhoFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                    whoFilter === f.id
                      ? 'bg-gd-accent text-gd-on-accent'
                      : 'bg-gd-inner text-gd-muted'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-gd-line divide-y divide-gd-line max-h-80 overflow-y-auto">
              {whoRows.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                >
                  <span className="font-bold text-gd-ink">{r.label}</span>
                  {r.status === 'ack' ? (
                    <span className="inline-flex items-center gap-1 text-gd-ok font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Подтверждено ({r.seenAt})
                    </span>
                  ) : r.status === 'seen' ? (
                    <span className="inline-flex items-center gap-1 text-gd-accent font-semibold">
                      <Clock className="w-3.5 h-3.5" />
                      Увидели ({r.seenAt})
                    </span>
                  ) : (
                    <span className="text-gd-danger font-semibold">
                      Не видели
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
