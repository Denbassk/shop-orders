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
      if (onApplied) Promise.resolve(onApplied()).catch(() => {});
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
          <h2 className="text-lg font-bold text-gd-ink">
            Сверка цен с приходами BigQuery
          </h2>
          <p className="text-xs text-gd-muted">
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
              className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all ${
                dir === d.id
                  ? 'bg-gd-accent text-gd-on-accent'
                  : 'glass-panel text-gd-muted hover:border-gd-accent/50'
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
            <div className="text-xs font-medium text-gd-muted">
              Найдено расхождений
            </div>
            <div className="text-2xl font-extrabold text-gd-ink mt-1">
              {data.n || 0} <span className="text-xs font-normal text-gd-muted">поз.</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-gd-muted">
              Скачки &gt; 30%
            </div>
            <div
              className={`text-2xl font-extrabold mt-1 ${
                data.big > 0
                  ? 'text-gd-danger'
                  : 'text-gd-ink'
              }`}
            >
              {data.big || 0} <span className="text-xs font-normal text-gd-muted">поз.</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-gd-muted">
              Сумма было → стало
            </div>
            <div className="text-sm font-extrabold text-gd-ink mt-2">
              {fmtMoney(data.sumOld)} →{' '}
              <span className="text-gd-accent">{fmtMoney(data.sumNew)} грн</span>
            </div>
          </div>

          <div className="rounded-2xl p-4 glass-panel">
            <div className="text-xs font-medium text-gd-muted">
              Без прихода (45 дн.)
            </div>
            <div className="text-2xl font-extrabold text-gd-ink mt-1">
              {data.noIncoming || 0} <span className="text-xs font-normal text-gd-muted">поз.</span>
            </div>
          </div>
        </div>
      )}

      {/* Missing in incoming for 45 days (<details>) */}
      {!loading && missing.length > 0 && (
        <details className="rounded-2xl glass-panel group overflow-hidden">
          <summary className="flex items-center justify-between px-4 py-3.5 cursor-pointer select-none text-sm font-bold text-gd-ink hover:bg-gd-inner">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-gd-accent" />
              <span>Без прихода за 45 дней ({missing.length} поз.)</span>
            </div>
            <ChevronDown className="w-4 h-4 text-gd-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 pt-1 border-t border-gd-line max-h-64 overflow-y-auto divide-y divide-gd-line/70">
            {missing.map((m) => (
              <div
                key={m.id}
                className="py-2 flex items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gd-ink truncate font-medium">
                    {m.name}
                  </span>
                  {m.stop && (
                    <span className="px-1.5 py-0.5 rounded bg-gd-danger/15 text-gd-danger font-bold text-[10px]">
                      стоп
                    </span>
                  )}
                </div>
                <span className="font-mono text-gd-muted shrink-0">
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
            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-gd-ink">
              <input
                type="checkbox"
                checked={applyBarcodes}
                onChange={(e) => setApplyBarcodes(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer"
              />
              <span>Также обновить несовпадающие штрихкоды из приходов BigQuery</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs font-medium text-gd-ink">
              <input
                type="checkbox"
                checked={applyNames}
                onChange={(e) => setApplyNames(e.target.checked)}
                className="w-4 h-4 rounded cursor-pointer"
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
          <div className="text-base font-bold text-gd-ink">
            Все цены совпадают с приходами BigQuery
          </div>
          <p className="text-xs text-gd-muted">
            Расхождений по этому направлению сейчас нет.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl glass-panel divide-y divide-gd-line overflow-hidden">
          {rows.map((r) => {
            const checked = selected.has(r.id);
            const priceDiff = Math.abs((Number(r.new) || 0) - (Number(r.old) || 0)) >= 0.005;
            const up = r.new > r.old;
            const metaReason = [r.nameDiff && 'Название', r.barcodeDiff && 'ШК'].filter(Boolean).join(' + ') || 'Без изм. цены';
            return (
              <div
                key={r.id}
                onClick={() => toggleRow(r.id)}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-gd-accent/12'
                    : 'hover:bg-gd-inner'
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
                        ? 'bg-gd-accent border-gd-accent text-gd-on-accent shadow-sm'
                        : 'border-gd-line bg-white'
                    }`}
                    aria-label="Выбрать позицию"
                  >
                    {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-gd-ink">
                        {r.name}
                      </span>

                      {r.big && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-gd-danger/15 text-gd-danger border border-gd-danger/30">
                          <AlertTriangle className="w-3 h-3" />
                          &gt;30%
                        </span>
                      )}

                      {r.stop && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-gd-danger/15 text-gd-danger">
                          Стоп
                        </span>
                      )}

                      {r.barcodeDiff && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-gd-warn/15 text-gd-warn border border-gd-warn/30">
                          ШК: {r.barcode || 'нет'} → {r.incBarcode}
                        </span>
                      )}
                    </div>

                    {r.nameDiff && (
                      <div className="text-xs text-gd-accent mt-0.5">
                        В приходе: «{r.incName}»
                      </div>
                    )}

                    <div className="text-[11px] text-gd-muted mt-0.5 flex flex-wrap gap-3">
                      <span>ШК: {r.barcode || '—'}</span>
                      {r.docDate && <span>Приход от {fmtDateShort(r.docDate)}</span>}
                    </div>
                  </div>
                </div>

                {/* Price Change Right Block */}
                <div className="flex items-center justify-end gap-3 shrink-0 pl-8 sm:pl-0">
                  {priceDiff ? (
                    <>
                      <div className="text-right">
                        <div className="text-xs text-gd-muted line-through">
                          {fmtMoney(r.old)} грн
                        </div>
                        <div className="text-base font-extrabold text-gd-ink">
                          {fmtMoney(r.new)} грн
                        </div>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-xl text-xs font-extrabold min-w-[64px] text-center ${
                          up
                            ? 'bg-gd-danger/15 text-gd-danger'
                            : 'bg-gd-ok/15 text-gd-ok'
                        }`}
                      >
                        {r.pct != null ? (r.pct > 0 ? `+${r.pct}%` : `${r.pct}%`) : 'Цена'}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="text-right">
                        <div className="text-[11px] text-gd-muted">цена без изм.</div>
                        <div className="text-sm font-bold text-gd-muted">
                          {fmtMoney(r.new)} грн
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-full text-xs font-bold min-w-[64px] text-center bg-gd-inner text-gd-muted border border-gd-line">
                        {metaReason}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
