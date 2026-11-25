import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Menu,
  Sun,
  Moon,
  RefreshCw,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { adminPost, apiCall, apiLogout, setAuthHandler } from './api';
import Sidebar, { NAV_ITEMS } from './components/Sidebar';
import TodayView from './components/TodayView';
import DirOrdersView from './components/DirOrdersView';
import IncomingView from './components/IncomingView';
import AssortmentView from './components/AssortmentView';
import DeadlineView from './components/DeadlineView';
import ScheduleView from './components/ScheduleView';
import StoresView from './components/StoresView';
import WriteOffsView from './components/WriteOffsView';
import NoticesView from './components/NoticesView';
import { HealthView, LogView } from './components/HealthLogView';

export default function App() {
  // Auth state: 'checking' | 'login' | 'authed'
  const [authState, setAuthState] = useState('checking');
  const [pin, setPin] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Theme ('dark' default = Deep Navy & Turquoise Glass; 'light' = High-Contrast Crisp Slate)
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('pult_theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('pult_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pult_rail_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pult_rail_collapsed', next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Navigation state
  const [activeTab, setActiveTab] = useState('today');
  const [dirOrdersKey, setDirOrdersKey] = useState('bread');
  const [assortDir, setAssortDir] = useState('bread');
  const [deadlineDir, setDeadlineDir] = useState('bread');
  const [incomingDir, setIncomingDir] = useState('bread');

  // Shared dashboard data
  const [todayData, setTodayData] = useState(null);
  const [woBrief, setWoBrief] = useState(null);
  const [noticeCount, setNoticeCount] = useState(0);
  const [healthAlerts, setHealthAlerts] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const handleLogout = useCallback(() => {
    apiLogout();
    setAuthState('login');
    setTodayData(null);
  }, []);

  useEffect(() => {
    setAuthHandler(handleLogout);
  }, [handleLogout]);

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);
    try {
      const [td, wo, nl] = await Promise.all([
        apiCall('today', {}),
        apiCall('woBrief', {}).catch(() => null),
        apiCall('noticeList', {}).catch(() => null),
      ]);
      setTodayData(td);
      if (wo) setWoBrief(wo);
      if (nl?.notices) setNoticeCount(nl.notices.length);
      return td;
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Check existing HttpOnly cookie on initial load
  useEffect(() => {
    adminPost('today', {}).then(
      (r) => {
        if (r && r.ok) {
          setTodayData(r.data);
          setAuthState('authed');
          apiCall('woBrief', {})
            .then(setWoBrief)
            .catch(() => {});
          apiCall('noticeList', {})
            .then((nl) => nl?.notices && setNoticeCount(nl.notices.length))
            .catch(() => {});
        } else {
          setAuthState('login');
        }
      },
      () => setAuthState('login')
    );
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginErr('');
    try {
      const r = await adminPost('login', { pin });
      if (!r || !r.ok) {
        setLoginErr((r && r.error) || 'Неверный PIN');
        return;
      }
      setPin('');
      setAuthState('authed');
      await loadDashboard();
    } catch (err) {
      setLoginErr(err.message || 'Ошибка входа');
    } finally {
      setLoggingIn(false);
    }
  };

  // Compute badges for sidebar rail
  const badges = useMemo(() => {
    const incTotal = Object.values(todayData?.incoming || {}).reduce(
      (sum, x) => sum + (Number(x?.n) || 0),
      0
    );
    return {
      incoming: incTotal,
      notices: noticeCount,
      health: healthAlerts,
    };
  }, [todayData, noticeCount, healthAlerts]);

  const currentPageTitle = useMemo(() => {
    if (activeTab === 'dirOrders') return 'Заказы по направлению';
    return NAV_ITEMS.find((i) => i.id === activeTab)?.label || 'Пульт управления';
  }, [activeTab]);

  // --- Loading / Checking Session ---
  if (authState === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="flex items-center gap-3 text-sm font-semibold text-teal-600 dark:text-teal-300">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Загрузка пульта Фемелі Маркет…</span>
        </div>
      </div>
    );
  }

  // --- PIN Login Screen ---
  if (authState === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl p-7 glass-panel space-y-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-gradient-to-br from-teal-500 to-cyan-500 text-slate-950 font-extrabold text-xl shadow-[0_0_24px_rgba(20,184,166,0.35)]">
              ФМ
            </div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              Пульт Фемелі Маркет
            </h1>
            <p className="text-xs text-slate-500 dark:text-cyan-200/65">
              Введите PIN-код администратора для входа
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="input-field pl-10 text-center tracking-[0.35em] text-lg font-bold"
              />
            </div>

            {loginErr && (
              <div className="text-xs font-semibold text-center text-rose-600 dark:text-rose-400">
                {loginErr}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn || !pin}
              className="btn-primary w-full py-3"
            >
              {loggingIn ? 'Проверяю…' : 'Войти в пульт'}
            </button>
          </form>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="text-xs text-slate-500 hover:text-slate-800 dark:text-cyan-200/60 dark:hover:text-white inline-flex items-center gap-1.5"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              <span>{theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Authenticated Shell ---
  return (
    <div className="min-h-screen flex">
      <Sidebar
        activeTab={activeTab === 'dirOrders' ? 'today' : activeTab}
        onSelect={(tab) => setActiveTab(tab)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        badges={badges}
        onLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 flex items-center justify-between gap-3 border-b border-slate-300/80 bg-white/85 backdrop-blur-md dark:bg-[#081220]/80 dark:border-cyan-400/15">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-700 hover:bg-slate-200/70 dark:text-cyan-200 dark:hover:bg-cyan-950/60"
              aria-label="Открыть меню"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                {currentPageTitle}
              </h1>
              {todayData && (
                <div className="text-[11px] font-medium text-slate-500 dark:text-cyan-200/65 truncate">
                  {todayData.today} ({todayData.dow}) · Киев {todayData.time}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadDashboard()}
              disabled={refreshing}
              className="btn-secondary px-3 py-2 text-xs"
              title="Обновить сводку"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Обновить</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              className="p-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:bg-cyan-950/45 dark:border-cyan-400/20 dark:text-cyan-200 dark:hover:bg-cyan-900/50 transition-colors"
              title={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* Main Workspace */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'today' && (
            <TodayView
              todayData={todayData}
              woBrief={woBrief}
              onRefresh={loadDashboard}
              onOpenDirOrders={(k) => {
                setDirOrdersKey(k);
                setActiveTab('dirOrders');
              }}
              onOpenAssort={(k) => {
                setAssortDir(k);
                setActiveTab('assort');
              }}
              onOpenDeadline={(k) => {
                setDeadlineDir(k);
                setActiveTab('deadline');
              }}
              onOpenIncoming={(k) => {
                setIncomingDir(k);
                setActiveTab('incoming');
              }}
              onOpenWriteOffs={() => setActiveTab('writeoffs')}
              toast={toast}
            />
          )}

          {activeTab === 'dirOrders' && (
            <DirOrdersView
              dir={dirOrdersKey}
              onChangeDir={setDirOrdersKey}
              onBack={() => {
                setActiveTab('today');
                loadDashboard();
              }}
              toast={toast}
            />
          )}

          {activeTab === 'incoming' && (
            <IncomingView
              initialDir={incomingDir}
              toast={toast}
              onApplied={loadDashboard}
            />
          )}

          {activeTab === 'assort' && (
            <AssortmentView
              initialDir={assortDir}
              onOpenIncoming={(k) => {
                setIncomingDir(k);
                setActiveTab('incoming');
              }}
              toast={toast}
            />
          )}

          {activeTab === 'deadline' && (
            <DeadlineView
              initialDir={deadlineDir}
              todayData={todayData}
              onRefresh={loadDashboard}
              toast={toast}
            />
          )}

          {activeTab === 'schedule' && <ScheduleView toast={toast} />}

          {activeTab === 'stores' && <StoresView toast={toast} />}

          {activeTab === 'writeoffs' && (
            <WriteOffsView
              toast={toast}
              onRefreshBrief={() =>
                apiCall('woBrief', {})
                  .then(setWoBrief)
                  .catch(() => {})
              }
            />
          )}

          {activeTab === 'notices' && (
            <NoticesView toast={toast} onCountChange={setNoticeCount} />
          )}

          {activeTab === 'health' && (
            <HealthView toast={toast} onLevelChange={setHealthAlerts} />
          )}

          {activeTab === 'log' && <LogView toast={toast} />}
        </main>
      </div>

      {/* Toast Stack */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-bold shadow-xl border backdrop-blur-xl ${
              t.type === 'err'
                ? 'bg-rose-600 text-white border-rose-500 dark:bg-rose-950/90 dark:text-rose-200 dark:border-rose-500/40'
                : t.type === 'ok'
                ? 'bg-emerald-600 text-white border-emerald-500 dark:bg-emerald-950/90 dark:text-emerald-200 dark:border-emerald-500/40'
                : 'bg-slate-900 text-white border-slate-700 dark:bg-[#0d1f36]/95 dark:text-cyan-100 dark:border-cyan-400/30'
            }`}
          >
            {t.type === 'err' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : t.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <Info className="w-4 h-4 shrink-0" />
            )}
            <span className="leading-snug">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
