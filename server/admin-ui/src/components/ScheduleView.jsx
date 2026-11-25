import React, { useEffect, useState } from 'react';
import { Search, CheckCircle2 } from 'lucide-react';
import { apiCall } from '../api';

export default function ScheduleView({ toast }) {
  const [dir, setDir] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    apiCall('schedule', { dir })
      .then((res) => {
        if (!cancel) setData(res);
      })
      .catch((e) => {
        if (!cancel) toast(e.message, 'err');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [dir]);

  const rows = (data?.rows || []).filter((r) =>
    `${r.label} ${r.code || ''} ${r.route || ''}`.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            График заказов по точкам
          </h2>
          {data && (
            <p className="text-xs text-slate-500 dark:text-cyan-200/65">
              Сегодня {data.dow}, {data.today} · показаны доступные дни и статус на сегодня
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: '', label: 'Все направления' },
            { id: 'bread', label: 'Хлеб Рома' },
            { id: 'nbhz', label: 'Хлеб НБХЗ' },
            { id: 'bakery', label: 'Выпечка' },
            { id: 'veg', label: 'Овощи' },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDir(d.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                dir === d.id
                  ? 'bg-teal-600 text-white dark:bg-teal-400 dark:text-slate-950'
                  : 'glass-panel text-slate-700 dark:text-slate-300 hover:border-teal-400/50'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-3.5 glass-panel">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию точки, коду или маршруту..."
            className="input-field pl-10"
          />
        </div>
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl glass-panel animate-pulse" />
      ) : (
        <div className="rounded-2xl glass-panel overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100/90 dark:bg-[#081322] text-slate-600 dark:text-cyan-200/75 uppercase border-b border-slate-200 dark:border-cyan-400/15">
              <tr>
                <th className="px-4 py-3 font-bold">Торговая точка</th>
                <th className="px-4 py-3 font-bold">Маршрут</th>
                <th className="px-4 py-3 font-bold">Направления и дни заказа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-cyan-400/10">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-cyan-950/20">
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {r.label}
                    {r.ua && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-900 dark:bg-sky-500/20 dark:text-sky-300">
                        ЮА
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {r.route || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {r.cells.map((c) => (
                        <div
                          key={c.dir}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border ${
                            c.ordered
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950 dark:bg-emerald-500/15 dark:border-emerald-400/40 dark:text-emerald-200'
                              : c.today
                              ? 'bg-teal-50 border-teal-300 text-teal-950 dark:bg-teal-500/15 dark:border-teal-400/35 dark:text-teal-200'
                              : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-[#081322] dark:border-slate-700 dark:text-slate-400'
                          }`}
                        >
                          <span className="font-bold">{c.title}:</span>
                          <span>{c.days}</span>
                          {c.ordered && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />}
                          {!c.today && c.next && (
                            <span className="opacity-75">({c.next})</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-slate-500">
                    Точки не найдены
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
