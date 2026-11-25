import React, { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  AlertTriangle,
  Check,
  RefreshCw,
  ChevronDown,
  Info,
} from 'lucide-react';
import { apiCall, fmtMoney, fmtDateShort } from '../api';

export default function IncomingView({ initialDir = 'bread', toast, onApplied }) {
  const [dir, setDir] = useState(initialDir === 'bakery' ? 'bakery' : 'bread');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [applyNames, setApplyNames] = useState(false);
  const [applyBarcodes, setApplyBarcodes] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (initialDir === 'bread' || initialDir === 'bakery') {
      setDir(initialDir);
    }
  }, [initialDir]);

  const load = async (targetDir = dir) => {
    setLoading(true);
    try {
      const res = await apiCall('incomingPreview', { dir: targetDir });
      setData(res);
      // По умолчанию выбираем те, где изменение <= 30% (большие скачки >30% требуют ручной галочки)
      const auto = new Set();
      (res.rows || []).forEach((r) => {
        if (!r.big) auto.add(r.id);
      });
      setSelected(auto);
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(dir);
  }, [dir]);

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (!data?.rows) return;
    if (selected.size === data.rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.rows.map((r) => r.id)));
    }
  };

  const handleApply = async () => {
    if (!data?.rows) return;
    const rows = data.rows
      .filter((r) => selected.has(r.id))
      .map((r) => ({ id: r.id, old: r.old, new: r.new }));

    if (!rows.length) {
      toast('Отметьте хотя бы одну позицию', 'err');
      return;
    }

    setApplying(true);
    try {
      const res = await apiCall('incomingApply', {
        dir,
        applyNames,
        applyBarcodes,
        rows,
      });
      toast(`Обновлено позиций из приходов: ${res.changed}`, 'ok');
      await load(dir);
      if (onApplied) onApplied();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setApplying(false);
    }
  };

  const rows = data?.rows || [];
  const missing = data?.missing || [];

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">
            Сверка цен с приходами BigQuery
          </h2>
          <p className="text-xs text-slate-500 dark:text-cyan-200/65">
            Сравнение актуального ассортимента с последними приходными накладными за 45 дней
          </p>
        </div>

        <div className="flex items-center gap-2">
          {[
            { id: 'bread', label: 'Хлеб Рома' },
            { id: 'bakery', label: 'Кулинария и выпечка' },
          ].map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDir(d.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                dir === d.id
                  ? 'bg-teal-600 text-white dark:bg-teal-400 dark:text-slate-950'
                  : 'glass-panel text-slate-700 dark:text-slate-300 hover:border-teal-400/50'
              }`}
            >
              {d.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => load(dir)}
            disabled={loading}
            className="btn-secondary px-3 py-2 text-xs"
            title="Обновить из BigQuery"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      {data && !loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-slate-500 dark:text-cyan-200/65">
              Найдено расхождений
            </div>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {data.n || 0} <span className="text-xs font-normal text-slate-500">поз.</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-slate-500 dark:text-cyan-200/65">
              Скачки &gt; 30%
            </div>
            <div
              className={`text-2xl font-extrabold mt-1 ${
                data.big > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {data.big || 0} <span className="text-xs font-normal text-slate-500">поз.</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-slate-500 dark:text-cyan-200/65">
              Сумма было → стало
            </div>
            <div className="text-sm font-extrabold text-slate-900 dark:text-white mt-2">
              {fmtMoney(data.sumOld)} →{' '}
              <span className="text-teal-700 dark:text-teal-300">{fmtMoney(data.sumNew)} грн</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-slate-500 dark:text-cyan-200/65">
              Без прихода (45 дн.)
            </div>
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white mt-1">
              {data.noIncoming || 0} <span className="text-xs font-normal text-slate-500">поз.</span>
            </div>
          </div>
        </div>
      )}

      {/* Missing in incoming for 45 days (<details>) */}
      {!loading && missing.length > 0 && (
        <details className="rounded-2xl glass-panel group overflow-hidden">
          <summary className="flex items-center justify-between px-4 py-3.5 cursor-pointer select-none text-sm font-bold text-slate-800 dark:text-cyan-100 hover:bg-slate-50 dark:hover:bg-cyan-950/30">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-sky-600 dark:text-cyan-400" />
              <span>Без прихода за 45 дней ({missing.length} поз.)</span>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 pt-1 border-t border-slate-200 dark:border-cyan-400/10 max-h-64 overflow-y-auto divide-y divide-slate-200/70 dark:divide-cyan-400/10">
            {missing.map((m) => (
              <div
                key={m.id}
                className="py-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-800 dark:text-slate-200 truncate font-medium">
                    {m.name}
                  </span>
                  {m.stop && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300 font-bold text-[10px]">
                      стоп
                    </span>
                  )}
                </div>
                <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">
                  {m.barcode || 'без ШК'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Options & Apply Controls */}
      {!loading && rows.length > 0 && (
        <div className="rounded-2xl p-4 glass-panel flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={applyBarcodes}
                onChange={(e) => setApplyBarcodes(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
              />
              <span>Также обновить несовпадающие штрихкоды из приходов BigQuery</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={applyNames}
                onChange={(e) => setApplyNames(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
              />
              <span>Также обновить названия из приходов BigQuery</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button type="button" onClick={selectAll} className="btn-secondary text-xs">
              {selected.size === rows.length ? 'Снять все' : `Выбрать все (${rows.length})`}
            </button>

            <button
              type="button"
              disabled={applying || selected.size === 0}
              onClick={handleApply}
              className="btn-primary text-xs"
            >
              <ArrowDownToLine className="w-4 h-4" />
              <span>Применить выбранные ({selected.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Rows Table / List */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-2xl glass-panel" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl p-10 glass-panel text-center space-y-2">
          <div className="text-base font-bold text-slate-900 dark:text-white">
            Все цены совпадают с приходами BigQuery
          </div>
          <p className="text-xs text-slate-500 dark:text-cyan-200/65">
            Расхождений по этому направлению сейчас нет.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl glass-panel divide-y divide-slate-200 dark:divide-cyan-400/10 overflow-hidden">
          {rows.map((r) => {
            const checked = selected.has(r.id);
            const up = r.new > r.old;
            return (
              <div
                key={r.id}
                onClick={() => toggleRow(r.id)}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-indigo-50/70 dark:bg-indigo-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-cyan-950/25'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {/* Distinct Indigo Selection Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(r.id);
                    }}
                    className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                      checked
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                        : 'border-slate-400 bg-white dark:bg-[#081322] dark:border-slate-500'
                    }`}
                    aria-label="Выбрать позицию"
                  >
                    {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">
                        {r.name}
                      </span>

                      {r.big && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-400/40">
                          <AlertTriangle className="w-3 h-3" />
                          &gt;30%
                        </span>
                      )}

                      {r.stop && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-300">
                          Стоп
                        </span>
                      )}

                      {r.barcodeDiff && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300">
                          ШК: {r.barcode || 'нет'} → {r.incBarcode}
                        </span>
                      )}
                    </div>

                    {r.nameDiff && (
                      <div className="text-xs text-sky-700 dark:text-cyan-300 mt-0.5">
                        В приходе: «{r.incName}»
                      </div>
                    )}

                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-3">
                      <span>ШК: {r.barcode || '—'}</span>
                      {r.docDate && <span>Приход от {fmtDateShort(r.docDate)}</span>}
                    </div>
                  </div>
                </div>

                {/* Price Change Right Block */}
                <div className="flex items-center justify-end gap-3 shrink-0 pl-8 sm:pl-0">
                  <div className="text-right">
                    <div className="text-xs text-slate-500 line-through">
                      {fmtMoney(r.old)} грн
                    </div>
                    <div className="text-base font-extrabold text-slate-900 dark:text-white">
                      {fmtMoney(r.new)} грн
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-1 rounded-xl text-xs font-extrabold min-w-[64px] text-center ${
                      up
                        ? 'bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-300'
                        : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-300'
                    }`}
                  >
                    {r.pct > 0 ? `+${r.pct}%` : `${r.pct}%`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
