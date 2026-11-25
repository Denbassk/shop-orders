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
    try {
      await apiCall('healthClear', {});
      toast('Список ошибок очищен', 'ok');
      await load();
    } catch (err) {
      toast(err.message, 'err');
    }
  };

  const levelBadge = (lv) => {
    if (lv === 'bad')
      return <XCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />;
    if (lv === 'warn')
      return <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />;
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Здоровье системы
          </h2>
          {data && (
            <p className="text-xs text-slate-500 dark:text-cyan-200/65">
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
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      {d.title}
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      {d.text}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 glass-panel space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-cyan-300/60">
                Фоновые процессы
              </div>
              {(data.triggers || []).map((t, idx) => (
                <div key={idx} className="flex items-start gap-2.5 text-xs">
                  {levelBadge(t.level)}
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white">{t.name}</div>
                    <div className="text-slate-600 dark:text-slate-300">{t.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 glass-panel space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  Последние ошибки ({data.errors?.length || 0})
                </div>
                {data.errors?.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearErrors}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Очистить</span>
                  </button>
                )}
              </div>

              {data.errors?.length > 0 ? (
                <div className="divide-y divide-slate-200 dark:divide-cyan-400/10 text-xs">
                  {data.errors.map((e, i) => (
                    <div key={i} className="py-2.5">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-bold text-rose-700 dark:text-rose-300">
                          {e.where}
                        </span>
                        <span>{e.at}</span>
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 mt-0.5">{e.msg}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500">Ошибок не зафиксировано</div>
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
          <ScrollText className="w-5 h-5 text-teal-600 dark:text-teal-300" />
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
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
        <div className="rounded-2xl glass-panel divide-y divide-slate-200 dark:divide-cyan-400/10 overflow-hidden">
          {rows.map((r, i) => (
            <div key={i} className="px-4 py-3 text-xs space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-900 dark:text-white">{r.what}</span>
                <span className="font-mono text-slate-500 shrink-0">{r.when}</span>
              </div>
              {r.details && (
                <div className="text-slate-600 dark:text-slate-300">{r.details}</div>
              )}
            </div>
          ))}
          {!rows.length && (
            <div className="p-8 text-center text-xs text-slate-500">Записей пока нет</div>
          )}
        </div>
      )}
    </div>
  );
}
