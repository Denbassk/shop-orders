import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  RefreshCw,
  ScrollText,
} from 'lucide-react';
import { apiCall } from '../api';

export function HealthView({ toast, onLevelChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiCall('health', {});
      setData(res);
      if (onLevelChange) onLevelChange(res.level === 'ok' ? 0 : 1);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleClearErrors = async () => {
    if (clearing) return;
    if (!window.confirm('Очистить журнал ошибок? Это нельзя отменить.')) return;
    setClearing(true);
    try {
      await apiCall('healthClear', {});
      toast('Список ошибок очищен', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setClearing(false);
    }
  };

  const levelBadge = (lv) => {
    if (lv === 'bad')
      return <XCircle className="w-4 h-4 text-gd-danger shrink-0" />;
    if (lv === 'warn')
      return <AlertTriangle className="w-4 h-4 text-gd-warn shrink-0" />;
    return <CheckCircle2 className="w-4 h-4 text-gd-ok shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gd-ink">
            Здоровье системы
          </h2>
          {data && (
            <p className="text-xs text-gd-muted">
              {data.summary} · {data.sys?.version}
            </p>
          )}
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Обновить</span>
        </button>
      </div>

      {loading ? (
        <div className="h-56 rounded-2xl glass-panel animate-pulse" />
      ) : (
        data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(data.dirs || []).map((d) => (
                <div
                  key={d.key}
                  className="rounded-2xl p-4 glass-panel flex items-start gap-3"
                >
                  {levelBadge(d.level)}
                  <div>
                    <div className="font-bold text-sm text-gd-ink">
                      {d.title}
                    </div>
                    <div className="text-xs text-gd-muted mt-0.5">
                      {d.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 glass-panel space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-gd-muted">
                Фоновые процессы
              </div>
              {(data.triggers || []).map((t, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs">
                  {levelBadge(t.level)}
                  <div>
                    <div className="font-bold text-gd-ink">{t.name}</div>
                    <div className="text-gd-muted">{t.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 glass-panel space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-gd-ink">
                  Последние ошибки ({data.errors?.length || 0})
                </div>
                {data.errors?.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearErrors}
                    disabled={clearing}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Очистить</span>
                  </button>
                )}
              </div>

              {data.errors?.length > 0 ? (
                <div className="divide-y divide-gd-line text-xs">
                  {data.errors.map((e, i) => (
                    <div key={i} className="py-2.5">
                      <div className="flex items-center justify-between text-gd-muted">
                        <span className="font-bold text-gd-danger">
                          {e.where}
                        </span>
                        <span>{e.at}</span>
                      </div>
                      <div className="text-gd-ink mt-0.5">{e.msg}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gd-muted">Ошибок не зафиксировано</div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

export function LogView({ toast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiCall('log', {});
      setRows(res || []);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-gd-accent" />
          <h2 className="text-lg font-bold text-gd-ink">
            Журнал действий пульта
          </h2>
        </div>
        <button type="button" onClick={load} disabled={loading} className="btn-secondary text-xs">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Обновить</span>
        </button>
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl glass-panel animate-pulse" />
      ) : (
        <div className="rounded-2xl glass-panel divide-y divide-gd-line overflow-hidden">
          {rows.map((r, i) => (
            <div key={i} className="px-4 py-3 text-xs space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-gd-ink">{r.what}</span>
                <span className="font-mono text-gd-muted shrink-0">{r.when}</span>
              </div>
              {r.details && (
                <div className="text-gd-muted">{r.details}</div>
              )}
            </div>
          ))}
          {!rows.length && (
            <div className="p-8 text-center text-xs text-gd-muted">Записей пока нет</div>
          )}
        </div>
      )}
    </div>
  );
}
