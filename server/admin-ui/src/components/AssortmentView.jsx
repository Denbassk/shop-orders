import React, { useEffect, useMemo, useRef, useState } from 'react';
import { confirmAction } from './Confirm';
import {
  Plus,
  Search,
  Check,
  Edit3,
  Percent,
  Ban,
  CheckCircle2,
  MapPin,
  Sparkles,
  Lock,
  ArrowRight,
  Save,
} from 'lucide-react';
import { apiCall, fmtMoney, normalizeWeightName } from '../api';
import { Modal, AccessSelector, Portal } from './Modal';

const DIRS = [
  { id: 'bread', label: 'Хлеб Рома' },
  { id: 'nbhz', label: 'Хлеб НБХЗ' },
  { id: 'bakery', label: 'Кулинария и выпечка' },
  { id: 'veg', label: 'Овощи и фрукты' },
];

export default function AssortmentView({ initialDir = 'bread', onOpenIncoming, toast }) {
  const [dir, setDir] = useState(initialDir || 'bread');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all'); // all | active | stop | restricted
  const [selected, setSelected] = useState(new Set());

  // Add Product Modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    price: '',
    barcode: '',
    category: '',
    availability: '',
    cost: '',
    box: '',
    access: { mode: 'all', stores: [] },
  });
  const [savingAdd, setSavingAdd] = useState(false);

  // Edit Single Product Modal
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Bulk Price Change Modal
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [priceMode, setPriceMode] = useState('pct'); // pct | sum
  const [priceVal, setPriceVal] = useState('');
  const [pricePreview, setPricePreview] = useState(null);
  const [savingPrice, setSavingPrice] = useState(false);

  // Bulk Access Modal
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [bulkAccess, setBulkAccess] = useState({ mode: 'all', stores: [] });
  const [savingAccess, setSavingAccess] = useState(false);

  // Veg New From Supplier Price Modal
  const [vegNewOpen, setVegNewOpen] = useState(false);
  const [vegNewRows, setVegNewRows] = useState([]);
  const [vegNewSel, setVegNewSel] = useState(new Set());
  const [vegNewAccess, setVegNewAccess] = useState({ mode: 'all', stores: [] });
  const [loadingVegNew, setLoadingVegNew] = useState(false);
  const [savingVegNew, setSavingVegNew] = useState(false);

  useEffect(() => {
    if (initialDir) setDir(initialDir);
  }, [initialDir]);

  const dirRef = useRef(dir);
  dirRef.current = dir;

  const load = async (targetDir = dir) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await apiCall('assortment', { dir: targetDir });
      if (dirRef.current !== targetDir) return;
      setData(res);
    } catch (e) {
      if (dirRef.current !== targetDir) return;
      toast(e.message, 'err');
    } finally {
      if (dirRef.current === targetDir) setLoading(false);
    }
  };

  useEffect(() => {
    load(dir);
  }, [dir]);

  const storeMap = useMemo(() => {
    const m = new Map();
    (data?.stores || []).forEach((s) => m.set(s.id, s.label));
    return m;
  }, [data]);

  const products = data?.products || [];
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => {
      if (filter === 'active' && p.stop) return false;
      if (filter === 'stop' && !p.stop) return false;
      if (filter === 'restricted' && p.access?.mode === 'all') return false;
      if (!term) return true;
      return `${p.name} ${p.barcode} ${p.category}`.toLowerCase().includes(term);
    });
  }, [products, q, filter]);

  const toggleRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectFiltered = () => {
    if (filtered.length > 0 && filtered.every((p) => selected.has(p.id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  // --- Add new product ---
  const openAddModal = () => {
    setAddForm({
      name: '',
      price: '',
      barcode: '',
      category: '',
      availability: '',
      cost: '',
      box: '',
      access: { mode: 'all', stores: [] },
    });
    setAddOpen(true);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    setSavingAdd(true);
    try {
      const res = await apiCall('assortAdd', {
        dir,
        ...addForm,
      });
      toast(`Добавлено: ${res.name}`, 'ok');
      setAddOpen(false);
      await load(dir);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingAdd(false);
    }
  };

  // --- Edit single product ---
  const openEditModal = (p) => {
    setEditItem(p);
    setEditForm({
      name: p.name,
      barcode: p.barcode || '',
      price: String(p.price ?? ''),
      category: p.category || '',
      availability: p.availability || '',
      cost: p.cost ? String(p.cost) : '',
      box: p.box || '',
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editItem) return;
    setSavingEdit(true);
    try {
      await apiCall('assortEdit', {
        dir,
        id: editItem.id,
        ...editForm,
      });
      toast('Позиция обновлена', 'ok');
      setEditItem(null);
      await load(dir);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingEdit(false);
    }
  };

  // --- Bulk Stop / Unstop ---
  const [bulkStopBusy, setBulkStopBusy] = useState(false);
  const handleBulkStop = async (stopFlag) => {
    if (bulkStopBusy) return;
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!(await confirmAction(stopFlag
      ? { title: `Поставить на стоп ${ids.length} поз.?`, text: 'Продавцы не смогут заказывать эти позиции, пока не снимете стоп.', ok: 'Поставить на стоп', danger: true }
      : { title: `Снять стоп с ${ids.length} поз.?`, text: 'Позиции снова станут доступны продавцам.', ok: 'Снять стоп' }))) return;
    setBulkStopBusy(true);
    try {
      const res = await apiCall('assortStop', { dir, ids, stop: stopFlag });
      toast(
        stopFlag
          ? `Поставлено на стоп: ${res.changed} поз.`
          : `Снято со стопа: ${res.changed} поз.`,
        'ok'
      );
      await load(dir);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBulkStopBusy(false);
    }
  };

  // --- Bulk Price Change ---
  const openPriceModal = () => {
    setPriceMode('pct');
    setPriceVal('');
    setPricePreview(null);
    setPriceModalOpen(true);
  };

  const handlePreviewPrices = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSavingPrice(true);
    try {
      const prev = await apiCall('priceBulkPreview', {
        dir,
        ids,
        mode: priceMode,
        value: priceVal,
      });
      setPricePreview(prev);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingPrice(false);
    }
  };

  const handleApplyPrices = async () => {
    if (!pricePreview?.rows?.length) return;
    setSavingPrice(true);
    try {
      const res = await apiCall('priceBulkApply', {
        dir,
        mode: pricePreview.mode,
        value: pricePreview.value,
        rows: pricePreview.rows.map((r) => ({ id: r.id, old: r.old })),
      });
      toast(`Цены обновлены: ${res.changed} поз.`, 'ok');
      setPriceModalOpen(false);
      await load(dir);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingPrice(false);
    }
  };

  // --- Bulk Access ---
  const handleApplyAccess = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSavingAccess(true);
    try {
      const res = await apiCall('assortAccess', {
        dir,
        ids,
        mode: bulkAccess.mode,
        stores: bulkAccess.stores,
      });
      toast(`Доступ обновлён: ${res.changed} поз.`, 'ok');
      setAccessModalOpen(false);
      await load(dir);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingAccess(false);
    }
  };

  // --- Veg New From Price ---
  const openVegNew = async () => {
    setVegNewOpen(true);
    setLoadingVegNew(true);
    setVegNewSel(new Set());
    setVegNewAccess({ mode: 'all', stores: [] });
    try {
      const res = await apiCall('vegNewPreview', {});
      setVegNewRows(res.rows || []);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setLoadingVegNew(false);
    }
  };

  const handleVegNewApply = async () => {
    const names = Array.from(vegNewSel);
    if (!names.length) {
      toast('Выберите хотя бы одну позицию', 'err');
      return;
    }
    setSavingVegNew(true);
    try {
      const res = await apiCall('vegNewApply', {
        names,
        access: vegNewAccess,
      });
      toast(`Добавлено в стоп: ${res.added} поз.`, 'ok');
      setVegNewOpen(false);
      await load('veg');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setSavingVegNew(false);
    }
  };

  const normAddPreview = normalizeWeightName(addForm.name);
  const normEditPreview = normalizeWeightName(editForm.name);

  return (
    <div className="space-y-4 pb-20">
      {/* Header & Direction Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gd-ink">
            Ассортимент и цены
          </h2>
          <p className="text-xs text-gd-muted">
            {data?.priceLocked
              ? 'Цены обновляются из прайса поставщика · доступны стопы и доступ по точкам'
              : `Наценка для продавцов: ×${data?.markup || 1} · управление позициями, ценами и доступом`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {DIRS.map((d) => (
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
        </div>
      </div>

      {/* Incoming Banner inside Assortment */}
      {data?.incoming?.enabled && data.incoming.n > 0 && (
        <div className="rounded-2xl p-3.5 border border-gd-warn/40 bg-gd-warn/15 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold text-gd-warn">
            В приходах BigQuery найдено <b>{data.incoming.n}</b> расхождений цен
            {data.incoming.big > 0 ? ` (из них ${data.incoming.big} >30%)` : ''}
          </div>
          <button
            type="button"
            onClick={() => onOpenIncoming(dir)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-gd-warn text-gd-on-accent"
          >
            <span>Сверить приходы</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search, Filters & Add Button */}
      <div className="rounded-2xl p-4 glass-panel space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gd-muted" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию, штрихкоду или категории..."
              className="input-field pl-10"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {dir === 'veg' ? (
              <button type="button" onClick={openVegNew} className="btn-primary text-xs">
                <Sparkles className="w-4 h-4" />
                <span>Новые из прайса</span>
              </button>
            ) : (
              <button type="button" onClick={openAddModal} className="btn-primary text-xs">
                <Plus className="w-4 h-4" />
                <span>Новая позиция</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'all', label: `Все (${products.length})` },
              { id: 'active', label: `Активные (${products.filter((p) => !p.stop).length})` },
              { id: 'stop', label: `На стопе (${products.filter((p) => p.stop).length})` },
              {
                id: 'restricted',
                label: `Ограничен доступ (${products.filter((p) => p.access?.mode !== 'all').length})`,
              },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  filter === f.id
                    ? 'bg-gd-accent text-gd-on-accent'
                    : 'bg-gd-inner text-gd-muted hover:bg-gd-raised'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={toggleSelectFiltered}
            className="text-xs font-semibold text-gd-accent hover:underline"
          >
            {filtered.length > 0 && filtered.every((p) => selected.has(p.id))
              ? 'Снять выделение'
              : `Выделить показанные (${filtered.length})`}
          </button>
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-2xl glass-panel" />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl glass-panel divide-y divide-gd-line overflow-hidden">
          {filtered.map((p) => {
            const checked = selected.has(p.id);
            const acc = p.access || { mode: 'all', stores: [] };
            return (
              <div
                key={p.id}
                onClick={() => toggleRow(p.id)}
                className={`flex items-center justify-between gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  checked
                    ? 'bg-gd-accent/12'
                    : 'hover:bg-gd-inner'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRow(p.id);
                    }}
                    className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                      checked
                        ? 'bg-gd-accent border-gd-accent text-gd-on-accent'
                        : 'border-gd-line bg-white'
                    }`}
                  >
                    {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`font-bold text-sm ${
                          p.stop
                            ? 'line-through text-gd-muted'
                            : 'text-gd-ink'
                        }`}
                      >
                        {p.name}
                      </span>

                      {p.stop && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-gd-danger/15 text-gd-danger border border-gd-danger/30">
                          СТОП
                        </span>
                      )}

                      {p.category && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gd-inner text-gd-muted">
                          {p.category}
                        </span>
                      )}

                      {acc.mode !== 'all' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-gd-accent/12 text-gd-accent border border-gd-accent/30">
                          <MapPin className="w-3 h-3" />
                          {acc.mode === 'only'
                            ? `Только ${acc.stores.length} ТТ`
                            : `Кроме ${acc.stores.length} ТТ`}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-gd-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {p.barcode && <span className="font-mono">ШК: {p.barcode}</span>}
                      {p.box && <span>Ящик: {p.box}</span>}
                      {p.availability && <span>Наличие: {p.availability}</span>}
                      {p.cost > 0 && <span>Себест.: {fmtMoney(p.cost)} грн</span>}
                      {acc.mode !== 'all' && acc.stores.length > 0 && (
                        <span className="text-gd-accent truncate max-w-md">
                          {acc.stores
                            .slice(0, 4)
                            .map((id) => storeMap.get(id) || id)
                            .join(', ')}
                          {acc.stores.length > 4 ? ` +${acc.stores.length - 4}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Price & Edit Button */}
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="text-sm font-extrabold text-gd-ink">
                      {fmtMoney(p.price)} грн
                    </div>
                    {!data?.hidePrice && data?.markup > 1 && (
                      <div className="text-[11px] text-gd-accent">
                        продавец: {fmtMoney(p.sellerPrice)}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(p);
                    }}
                    className="p-2 rounded-xl text-gd-muted hover:text-gd-ink hover:bg-gd-raised"
                    title="Редактировать позицию"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}

          {!filtered.length && (
            <div className="p-8 text-center text-sm text-gd-muted">
              Позиции не найдены
            </div>
          )}
        </div>
      )}

      {/* Floating Bulk Action Bar (портал: иначе fixed считается от main) */}
      {selected.size > 0 && (
        <Portal>
        <div className="fixed bottom-4 left-4 right-4 lg:left-72 z-40 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl gd-modal shadow-2xl">
            <span className="text-xs font-bold px-2 text-gd-accent">
              Выбрано: {selected.size}
            </span>

            {!data?.priceLocked && (
              <button
                type="button"
                onClick={openPriceModal}
                className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Percent className="w-3.5 h-3.5" />
                <span>Изменить цены</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => handleBulkStop(true)}
              disabled={bulkStopBusy}
              className="btn-danger inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>На стоп</span>
            </button>

            <button
              type="button"
              onClick={() => handleBulkStop(false)}
              disabled={bulkStopBusy}
              className="disabled:opacity-50 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-gd-ok/15 text-gd-ok border border-gd-ok/40 hover:bg-gd-ok/25"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Снять стоп</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBulkAccess({ mode: 'all', stores: [] });
                setAccessModalOpen(true);
              }}
              className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>Доступ по ТТ</span>
            </button>

            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs text-gd-muted hover:text-gd-ink px-2"
            >
              Сброс
            </button>
          </div>
        </div>
        </Portal>
      )}

      {/* Modal 1: Add New Product */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Новая позиция в ассортимент"
        subtitle={data?.title}
        maxWidth="max-w-xl"
        footer={
          <>
            <button type="button" onClick={() => setAddOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              form="add-product-form"
              disabled={savingAdd}
              className="btn-primary"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить позицию</span>
            </button>
          </>
        }
      >
        <form id="add-product-form" onSubmit={handleAddSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold mb-1 text-gd-muted">
              Название товара *
            </label>
            <input
              type="text"
              required
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              placeholder="Например: Батон нарезной 500г"
              className="input-field"
            />
            {addForm.name.trim() && normAddPreview !== addForm.name.trim() && (
              <div className="text-xs text-gd-accent mt-1">
                Будет сохранено как: <b>{normAddPreview}</b>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1 text-gd-muted">
                Цена, грн *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={addForm.price}
                onChange={(e) => setAddForm({ ...addForm, price: e.target.value })}
                placeholder="0.00"
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 text-gd-muted">
                Штрихкод (4–20 цифр)
              </label>
              <input
                type="text"
                value={addForm.barcode}
                onChange={(e) => setAddForm({ ...addForm, barcode: e.target.value })}
                placeholder="482..."
                className="input-field font-mono"
              />
            </div>
          </div>

          {dir === 'bakery' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Категория
                </label>
                <input
                  type="text"
                  value={addForm.category}
                  onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                  placeholder="Выпечка / Салаты"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Себестоимость
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={addForm.cost}
                  onChange={(e) => setAddForm({ ...addForm, cost: e.target.value })}
                  placeholder="0.00"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Наличие / дни
                </label>
                <input
                  type="text"
                  value={addForm.availability}
                  onChange={(e) => setAddForm({ ...addForm, availability: e.target.value })}
                  placeholder="Ежедневно"
                  className="input-field"
                />
              </div>
            </div>
          ) : (
            (dir === 'bread' || dir === 'nbhz') && (
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Ящик / тара
                </label>
                <input
                  type="text"
                  value={addForm.box}
                  onChange={(e) => setAddForm({ ...addForm, box: e.target.value })}
                  placeholder="Например: лоток 12 шт"
                  className="input-field"
                />
              </div>
            )
          )}

          <AccessSelector
            stores={data?.stores || []}
            value={addForm.access}
            onChange={(access) => setAddForm({ ...addForm, access })}
          />
        </form>
      </Modal>

      {/* Modal 2: Edit Single Product */}
      <Modal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Редактирование позиции"
        subtitle={editItem?.name}
        footer={
          <>
            <button type="button" onClick={() => setEditItem(null)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="submit"
              form="edit-product-form"
              disabled={savingEdit}
              className="btn-primary"
            >
              <Save className="w-4 h-4" />
              <span>Сохранить</span>
            </button>
          </>
        }
      >
        {editItem && (
          <form id="edit-product-form" onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold mb-1 text-gd-muted">
                Название
              </label>
              <input
                type="text"
                required
                value={editForm.name || ''}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="input-field"
              />
              {editForm.name && normEditPreview !== editForm.name.trim() && (
                <div className="text-xs text-gd-accent mt-1">
                  Нормализуется в: <b>{normEditPreview}</b>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Цена, грн {data?.priceLocked && '(из прайса)'}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!!data?.priceLocked}
                  value={editForm.price || ''}
                  onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                  className="input-field disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Штрихкод
                </label>
                <input
                  type="text"
                  value={editForm.barcode || ''}
                  onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })}
                  className="input-field font-mono"
                />
              </div>
            </div>

            {dir === 'bakery' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1 text-gd-muted">
                    Категория
                  </label>
                  <input
                    type="text"
                    value={editForm.category || ''}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1 text-gd-muted">
                    Себестоимость
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.cost || ''}
                    onChange={(e) => setEditForm({ ...editForm, cost: e.target.value })}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1 text-gd-muted">
                    Наличие
                  </label>
                  <input
                    type="text"
                    value={editForm.availability || ''}
                    onChange={(e) => setEditForm({ ...editForm, availability: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>
            )}

            {(dir === 'bread' || dir === 'nbhz') && (
              <div>
                <label className="block text-xs font-bold mb-1 text-gd-muted">
                  Ящик / тара
                </label>
                <input
                  type="text"
                  value={editForm.box || ''}
                  onChange={(e) => setEditForm({ ...editForm, box: e.target.value })}
                  className="input-field"
                />
              </div>
            )}
          </form>
        )}
      </Modal>

      {/* Modal 3: Bulk Price Change */}
      <Modal
        open={priceModalOpen}
        onClose={() => setPriceModalOpen(false)}
        title="Массовое изменение цен"
        subtitle={`Выбрано позиций: ${selected.size}`}
        maxWidth="max-w-2xl"
        footer={
          <>
            <button type="button" onClick={() => setPriceModalOpen(false)} className="btn-secondary">
              Отмена
            </button>
            <button
              type="button"
              disabled={savingPrice || !priceVal}
              onClick={handlePreviewPrices}
              className="btn-secondary"
            >
              Рассчитать
            </button>
            {pricePreview?.rows?.length > 0 && (
              <button
                type="button"
                disabled={savingPrice}
                onClick={handleApplyPrices}
                className="btn-primary"
              >
                Применить ({pricePreview.n})
              </button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold mb-1 text-gd-muted">
                Способ изменения
              </label>
              <select
                value={priceMode}
                onChange={(e) => {
                  setPriceMode(e.target.value);
                  setPricePreview(null);
                }}
                className="input-field"
              >
                <option value="pct">На процент (%)</option>
                <option value="sum">На фиксированную сумму (грн)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1 text-gd-muted">
                Значение (можно с минусом, напр. -5)
              </label>
              <input
                type="number"
                step="0.01"
                value={priceVal}
                onChange={(e) => {
                  setPriceVal(e.target.value);
                  setPricePreview(null);
                }}
                placeholder={priceMode === 'pct' ? 'Например: 10 или -5' : 'Например: 2.50'}
                className="input-field"
              />
            </div>
          </div>

          {pricePreview && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-gd-muted">
                Предпросмотр ({pricePreview.n} поз. изменятся, пропущено: {pricePreview.skipped}):
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-gd-line divide-y divide-gd-line">
                {pricePreview.rows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-3.5 py-2 text-xs"
                  >
                    <span className="font-medium text-gd-ink truncate pr-2">
                      {r.name}
                    </span>
                    <span className="font-bold shrink-0">
                      <span className="text-gd-muted line-through mr-2">{fmtMoney(r.old)}</span>
                      <span className="text-gd-accent">{fmtMoney(r.new)} грн</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal 4: Bulk Access */}
      <Modal
        open={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        title="Доступность по торговым точкам"
        subtitle={`Для ${selected.size} выбранных позиций`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setAccessModalOpen(false)}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={savingAccess}
              onClick={handleApplyAccess}
              className="btn-primary"
            >
              Сохранить доступ
            </button>
          </>
        }
      >
        <AccessSelector
          stores={data?.stores || []}
          value={bulkAccess}
          onChange={setBulkAccess}
        />
      </Modal>

      {/* Modal 5: Veg New From Price */}
      <Modal
        open={vegNewOpen}
        onClose={() => setVegNewOpen(false)}
        title="Новые позиции из прайса поставщика"
        subtitle="Добавляются со статусом «СТОП» — включите их в списке, когда будете готовы"
        maxWidth="max-w-2xl"
        footer={
          <>
            <button type="button" onClick={() => setVegNewOpen(false)} className="btn-secondary">
              Закрыть
            </button>
            {vegNewRows.length > 0 && (
              <button
                type="button"
                disabled={savingVegNew || vegNewSel.size === 0}
                onClick={handleVegNewApply}
                className="btn-primary"
              >
                Добавить выбранные ({vegNewSel.size})
              </button>
            )}
          </>
        }
      >
        {loadingVegNew ? (
          <div className="p-8 text-center text-sm text-gd-muted">Читаю прайс поставщика…</div>
        ) : vegNewRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gd-muted">
            Все позиции из прайса поставщика уже есть в ассортименте.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-56 overflow-y-auto rounded-xl border border-gd-line divide-y divide-gd-line">
              {vegNewRows.map((r) => {
                const checked = vegNewSel.has(r.name);
                return (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => {
                      const next = new Set(vegNewSel);
                      if (next.has(r.name)) next.delete(r.name);
                      else next.add(r.name);
                      setVegNewSel(next);
                    }}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs hover:bg-gd-inner"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-4 h-4 rounded flex items-center justify-center border ${
                          checked
                            ? 'bg-gd-accent border-gd-accent text-gd-on-accent'
                            : 'border-gd-line'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 stroke-[3]" />}
                      </span>
                      <span className="font-semibold text-gd-ink truncate">
                        {r.name}
                      </span>
                    </div>
                    <span className="font-bold text-gd-accent shrink-0">
                      {fmtMoney(r.price)} грн
                    </span>
                  </button>
                );
              })}
            </div>

            <AccessSelector
              stores={data?.stores || []}
              value={vegNewAccess}
              onChange={setVegNewAccess}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
