import React from 'react';
import logoDark from '../assets/logo-dark.png';
import logoLight from '../assets/logo-light.png';
import {
  LayoutDashboard,
  ArrowDownToLine,
  Package,
  Clock,
  CalendarDays,
  Store,
  Trash2,
  Megaphone,
  Activity,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  LogOut,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'today', label: 'Сегодня', icon: LayoutDashboard, section: 'Оперативка' },
  { id: 'incoming', label: 'Приходы BigQuery', icon: ArrowDownToLine, section: 'Оперативка' },
  { id: 'assort', label: 'Ассортимент и цены', icon: Package, section: 'Оперативка' },
  { id: 'deadline', label: 'Время и доставка', icon: Clock, section: 'Оперативка' },
  { id: 'schedule', label: 'График точек', icon: CalendarDays, section: 'Справочники' },
  { id: 'stores', label: 'Магазины', icon: Store, section: 'Справочники' },
  { id: 'writeoffs', label: 'Списания ВК', icon: Trash2, section: 'Контроль' },
  { id: 'notices', label: 'Сообщения', icon: Megaphone, section: 'Контроль' },
  { id: 'health', label: 'Здоровье', icon: Activity, section: 'Система' },
  { id: 'log', label: 'Журнал', icon: ScrollText, section: 'Система' },
];

export default function Sidebar({
  activeTab,
  onSelect,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  badges = {},
  onLogout,
}) {
  const sections = ['Оперативка', 'Справочники', 'Контроль', 'Система'];

  const renderNavContent = (isMobile = false) => {
    const isCollapsed = !isMobile && collapsed;
    return (
      <div className="flex flex-col h-full select-none">
        {/* Header with Brand + Icon Collapse Button */}
        <div
          className={`flex items-center h-16 px-3.5 border-b border-slate-300/80 dark:border-cyan-400/15 ${
            isCollapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <img src={logoLight} alt="Фемели Маркет" className="h-9 w-auto object-contain block dark:hidden shrink-0" />
              <img src={logoDark} alt="Фемели Маркет" className="h-9 w-auto object-contain hidden dark:block shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300/85 truncate">
                  Пульт управления
                </div>
              </div>
            </div>
          )}

          {isMobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-cyan-950/60"
              title="Закрыть меню"
            >
              <X className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/80 dark:text-cyan-200/80 dark:hover:text-white dark:hover:bg-cyan-950/60 transition-colors"
              title={isCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              aria-label={isCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-5 h-5" />
              ) : (
                <PanelLeftClose className="w-5 h-5" />
              )}
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4">
          {sections.map((sec) => {
            const items = NAV_ITEMS.filter((i) => i.section === sec);
            return (
              <div key={sec} className="space-y-1">
                {!isCollapsed && (
                  <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-cyan-300/45">
                    {sec}
                  </div>
                )}
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = activeTab === item.id;
                  const badge = badges[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onSelect(item.id);
                        if (isMobile) onCloseMobile();
                      }}
                      title={isCollapsed ? item.label : undefined}
                      className={`group relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                        isCollapsed ? 'justify-center' : ''
                      } ${
                        active
                          ? 'bg-teal-600 text-white shadow-sm dark:bg-gradient-to-r dark:from-teal-500/25 dark:to-cyan-500/10 dark:text-teal-200 dark:border dark:border-teal-400/35 dark:shadow-[0_0_20px_rgba(20,184,166,0.16)]'
                          : 'text-slate-700 hover:bg-slate-200/80 hover:text-slate-950 dark:text-slate-300/85 dark:hover:bg-cyan-950/45 dark:hover:text-white border border-transparent'
                      }`}
                    >
                      {active && (
                        <span className="hidden dark:block absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-teal-400 shadow-[0_0_10px_#2dd4bf]" />
                      )}
                      <Icon
                        className={`w-5 h-5 shrink-0 transition-transform group-hover:scale-105 ${
                          active
                            ? 'text-white dark:text-teal-300'
                            : 'text-slate-500 group-hover:text-slate-800 dark:text-cyan-300/65 dark:group-hover:text-teal-200'
                        }`}
                      />
                      {!isCollapsed && (
                        <span className="truncate flex-1 text-left">{item.label}</span>
                      )}
                      {badge != null && badge > 0 && !isCollapsed && (
                        <span
                          className={`px-2 py-0.5 text-[11px] font-bold rounded-full ${
                            item.id === 'health'
                              ? 'bg-amber-500 text-slate-950'
                              : active
                              ? 'bg-white/20 text-white dark:bg-teal-400/25 dark:text-teal-200'
                              : 'bg-teal-100 text-teal-900 dark:bg-teal-500/20 dark:text-teal-300'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                      {badge != null && badge > 0 && isCollapsed && (
                        <span
                          className={`absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-[#0b1728] ${
                            item.id === 'health' ? 'bg-amber-400' : 'bg-teal-400'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer Logout */}
        <div className="p-2.5 border-t border-slate-300/80 dark:border-cyan-400/15">
          <button
            type="button"
            onClick={onLogout}
            title={isCollapsed ? 'Выйти' : undefined}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:text-rose-700 hover:bg-rose-50 dark:text-slate-400 dark:hover:text-rose-300 dark:hover:bg-rose-950/35 transition-colors ${
              isCollapsed ? 'justify-center' : ''
            }`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>Выйти из пульта</span>}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Rail */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 transition-all duration-200 border-r border-slate-300/90 bg-white/95 dark:bg-[#0a1627]/85 dark:backdrop-blur-xl dark:border-cyan-400/15 ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {renderNavContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white dark:bg-[#0b182b] border-r border-slate-300 dark:border-cyan-400/20 shadow-2xl">
            {renderNavContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
