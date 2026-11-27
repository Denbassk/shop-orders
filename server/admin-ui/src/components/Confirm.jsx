import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

// Окно подтверждения в стиле пульта вместо window.confirm.
// Использование: if (!(await confirmAction({ title, text, ok: 'Выключить', danger: true }))) return;
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

  return (
    <Modal
      open={!!req}
      onClose={() => done(false)}
      title={req?.title || 'Подтвердите действие'}
      maxWidth="max-w-md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => done(false)}>
            {req?.cancel || 'Отмена'}
          </button>
          <button
            ref={okRef}
            type="button"
            className={req?.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => done(true)}
          >
            {req?.ok || 'Подтвердить'}
          </button>
        </>
      }
    >
      {req?.text && <p className="text-sm text-gd-ink whitespace-pre-line">{req.text}</p>}
      {req?.note && (
        <p className="text-xs text-gd-warn rounded-xl px-3 py-2 bg-gd-warn/12 border border-gd-warn/30">
          {req.note}
        </p>
      )}
    </Modal>
  );
}
