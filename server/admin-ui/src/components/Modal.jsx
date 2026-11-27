import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Check } from 'lucide-react';

// Стек открытых модалок: Esc закрывает только верхнюю.
const modalStack = [];

// Портал в body: main.gd-stage-frame имеет backdrop-filter и иначе становится
// точкой отсчёта для position:fixed (модалка уезжала по высоте main).
export function Portal({ children }) {
  return createPortal(children, document.body);
}

// center: окно по центру и на телефоне (короткие подтверждения); иначе на телефоне - парящая карточка у низа
export function Modal({ open, onClose, title, subtitle, maxWidth = 'max-w-xl', children, footer, center = false, bare = false, className = '' }) {
  const titleId = useId();
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = {};
    modalStack.push(token);
    const prevFocus = document.activeElement;
    boxRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === token) {
        e.stopImmediatePropagation();
        closeRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const i = modalStack.indexOf(token);
      if (i >= 0) modalStack.splice(i, 1);
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className={`fixed inset-0 z-50 flex ${center ? 'items-center' : 'items-end sm:items-center'} justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4`}>
      <div
        className="fixed inset-0 bg-[rgb(var(--gd-dark-shadow)/45%)] dark:bg-black/55 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare ? title : undefined}
        tabIndex={-1}
        className={`gd-modal relative z-10 w-full ${maxWidth} max-h-[88svh] sm:max-h-[92vh] flex flex-col rounded-3xl overflow-hidden outline-none ${className}`}
      >
        {bare ? children : (<>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gd-line">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base sm:text-lg font-bold text-gd-ink truncate">
              {title}
            </h3>
            {subtitle && <p className="text-xs text-gd-muted mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            className="p-1.5 rounded-full text-gd-muted hover:bg-gd-inner hover:text-gd-ink"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-gd-line bg-gd-inner flex flex-wrap items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
        </>)}
      </div>
    </div>,
    document.body
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
      <div className="text-xs font-bold uppercase tracking-wider text-gd-muted">
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
                ? 'bg-gd-accent text-gd-on-accent border-gd-accent'
                : 'bg-gd-inner text-gd-muted border-gd-line hover:bg-gd-raised'
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
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gd-muted" />
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

          <div className="text-xs font-medium text-gd-muted">
            Выбрано точек: <span className="font-bold text-gd-accent">{selected.size}</span>
          </div>

          <div className="max-h-44 overflow-y-auto divide-y divide-gd-line rounded-xl border border-gd-line bg-gd-inner">
            {filtered.map((s) => {
              const checked = selected.has(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStore(s.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-gd-raised transition-colors"
                >
                  <span className="text-gd-ink truncate pr-2">{s.label}</span>
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                      checked
                        ? 'bg-gd-accent border-gd-accent text-gd-on-accent'
                        : 'border-gd-line'
                    }`}
                  >
                    {checked && <Check className="w-3 h-3 stroke-[3]" />}
                  </span>
                </button>
              );
            })}
            {!filtered.length && (
              <div className="p-3 text-xs text-center text-gd-muted">Точки не найдены</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
