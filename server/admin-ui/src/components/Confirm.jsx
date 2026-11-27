import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { Modal } from './Modal';

// Окно подтверждения в стиле пульта вместо window.confirm.
// Использование: if (!(await confirmAction({ title, text, note, ok: 'Выключить', danger: true }))) return;
// Хост <ConfirmHost/> монтируется один раз в App.
let show = null;

export function confirmAction(opts) {
  if (!show) return Promise.resolve(window.confirm(opts.text || opts.title));
  return new Promise((resolve) => show({ ...opts, resolve }));
}

export function ConfirmHost() {
  const [req, setReq] = useState(null);
  const okRef = useRef(null);

  useEffect(() => {
    show = (r) =>
      setReq((prev) => {
        if (prev) prev.resolve(false); // новый запрос отменяет предыдущий
        return r;
      });
    return () => {
      show = null;
    };
  }, []);

  useEffect(() => {
    if (req) okRef.current?.focus();
  }, [req]);

  const done = (v) => {
    if (!req) return;
    req.resolve(v);
    setReq(null);
  };

  const danger = !!req?.danger;
  const Icon = danger ? AlertTriangle : Info;

  return (
    <Modal
      open={!!req}
      onClose={() => done(false)}
      title={req?.title || 'Подтвердите действие'}
      maxWidth="max-w-sm"
      center
      bare
      className="gd-confirm"
    >
      <div className="px-6 pt-6 pb-5 flex flex-col items-center text-center gap-3">
        <div
          className={`w-12 h-12 rounded-full grid place-items-center border ${
            danger
              ? 'bg-gd-danger/15 text-gd-danger border-gd-danger/30'
              : 'bg-gd-accent/12 text-gd-accent border-gd-accent/25'
          }`}
        >
          <Icon className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-extrabold leading-snug text-gd-ink">
          {req?.title || 'Подтвердите действие'}
        </h3>
        {req?.text && (
          <p className="text-sm leading-relaxed text-gd-muted whitespace-pre-line">{req.text}</p>
        )}
        {req?.note && (
          <p className="w-full text-left text-xs leading-relaxed text-gd-warn rounded-2xl px-3.5 py-2.5 bg-gd-warn/12 border border-gd-warn/30">
            {req.note}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2.5 px-5 pb-5">
        <button type="button" className="btn-secondary py-3 text-sm" onClick={() => done(false)}>
          {req?.cancel || 'Отмена'}
        </button>
        <button
          ref={okRef}
          type="button"
          className={`${danger ? 'btn-danger' : 'btn-primary'} py-3 text-sm`}
          onClick={() => done(true)}
        >
          {req?.ok || 'Подтвердить'}
        </button>
      </div>
    </Modal>
  );
}
