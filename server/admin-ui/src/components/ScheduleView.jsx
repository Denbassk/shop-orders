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
          <h2 className="text-lg font-bold text-gd-ink">
            График заказов по точкам
          </h2>
          {data && (
            <p className="text-xs text-gd-muted">
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
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                dir === d.id
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'glass-panel text-gd-muted hover:border-gd-accent/50'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-3.5 glass-panel">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gd-muted" />
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
            <thead className="bg-gd-inner text-gd-muted uppercase border-b border-gd-line">
              <tr>
                <th className="px-4 py-3 font-bold">Торговая точка</th>
                <th className="px-4 py-3 font-bold">Маршрут</th>
                <th className="px-4 py-3 font-bold">Направления и дни заказа</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gd-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gd-inner">
                  <td className="px-4 py-3 font-bold text-gd-ink whitespace-nowrap">
                    {r.label}
                    {r.ua && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-gd-accent/12 text-gd-accent">
                        ЮА
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gd-muted whitespace-nowrap">
                    {r.route || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {r.cells.map((c) => (
                        <div
                          key={c.dir}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border ${
                            c.ordered
                              ? 'bg-gd-ok/15 border-gd-ok/30 text-gd-ok'
                              : c.today
                              ? 'bg-gd-accent/12 border-gd-accent/30 text-gd-accent'
                              : 'bg-gd-inner border-gd-line text-gd-muted'
                          }`}
                        >
                          <span className="font-bold">{c.title}:</span>
                          <span>{c.days}</span>
                          {c.ordered && <CheckCircle2 className="w-3.5 h-3.5 text-gd-ok" />}
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
                  <td colSpan={3} className="p-8 text-center text-gd-muted">
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
