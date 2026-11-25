import React, { useEffect, useState } from 'react';
import { X, Search, Check } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, maxWidth = 'max-w-xl', children, footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full ${maxWidth} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white border border-slate-300 shadow-2xl dark:bg-[#0d1c30] dark:border-cyan-400/25 dark:shadow-[0_24px_60px_rgba(0,0,0,0.75)] overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-cyan-400/15">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-cyan-200/65 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-cyan-950/60 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-cyan-400/15 bg-slate-50/90 dark:bg-[#091423]/90 flex flex-wrap items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Выбор доступа к позиции по точкам: 'all' | 'only' | 'except'
export function AccessSelector({ stores = [], value, onChange }) {
  const [q, setQ] = useState('');
  const mode = value?.mode || 'all';
  const selected = new Set(value?.stores || []);

  const filtered = stores.filter((s) =>
    s.label.toLowerCase().includes(q.trim().toLowerCase())
  );

  const setMode = (m) => {
    onChange({ mode: m, stores: m === 'all' ? [] : Array.from(selected) });
  };

  const toggleStore = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ mode, stores: Array.from(next) });
  };

  const selectAllFiltered = () => {
    const next = new Set(selected);
    filtered.forEach((s) => next.add(s.id));
    onChange({ mode, stores: Array.from(next) });
  };

  const clearAll = () => {
    onChange({ mode, stores: [] });
  };

  return (
    <div className="space-y-3 rounded-xl p-3.5 glass-sub">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-cyan-300/75">
        Доступность по торговым точкам *
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { id: 'all', label: 'Всем точкам' },
          { id: 'only', label: 'Только выбранным' },
          { id: 'except', label: 'Всем, кроме...' },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setMode(opt.id)}
            className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              mode === opt.id
                ? 'bg-teal-600 text-white border-teal-600 dark:bg-teal-500/25 dark:text-teal-200 dark:border-teal-400/50'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100 dark:bg-[#091526] dark:text-slate-300 dark:border-cyan-400/15'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode !== 'all' && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск точки..."
                className="input-field pl-10 py-1.5 text-xs"
              />
            </div>
            <button
              type="button"
              onClick={selectAllFiltered}
              className="btn-secondary px-2.5 py-1.5 text-xs"
            >
              Все
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="btn-secondary px-2.5 py-1.5 text-xs"
            >
              Сброс
            </button>
          </div>

          <div className="text-xs font-medium text-slate-600 dark:text-cyan-200/75">
            Выбрано точек: <span className="font-bold text-teal-600 dark:text-teal-300">{selected.size}</span>
          </div>

          <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 dark:divide-cyan-400/10 rounded-xl border border-slate-300 dark:border-cyan-400/15 bg-white dark:bg-[#07101d]">
            {filtered.map((s) => {
              const checked = selected.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStore(s.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-slate-100 dark:hover:bg-cyan-950/40 transition-colors"
                >
                  <span className="text-slate-800 dark:text-slate-200 truncate pr-2">{s.label}</span>
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                      checked
                        ? 'bg-indigo-600 border-indigo-600 text-white dark:bg-teal-400 dark:border-teal-400 dark:text-slate-950'
                        : 'border-slate-400 dark:border-slate-600'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3 stroke-[3]" />}
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <div className="p-3 text-xs text-center text-slate-500">Точки не найдены</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
