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
        {/* Header with Brand + Collapse Button */}
        <div
          className={`flex items-center h-16 px-4 border-b border-[var(--gd-line)] ${
            isCollapsed ? 'justify-center' : 'justify-between'
          }`}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2.5 min-w-0">
              <img src={logoLight} alt="Фемели Маркет" className="h-8 w-auto object-contain block dark:hidden shrink-0" />
              <img src={logoDark} alt="Фемели Маркет" className="h-8 w-auto object-contain hidden dark:block shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--gd-muted)] truncate">
                  Пульт
                </div>
              </div>
            </div>
          )}

          {isMobile ? (
            <button
              type="button"
              onClick={onCloseMobile}
              className="w-9 h-9 rounded-full border border-[var(--gd-line)] bg-[var(--gd-inner)] hover:bg-[var(--gd-raised)] inline-grid place-items-center transition-colors"
              title="Закрыть меню"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="w-9 h-9 rounded-full border border-[var(--gd-line)] bg-[var(--gd-inner)] hover:bg-[var(--gd-raised)] inline-grid place-items-center transition-colors"
              title={isCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              aria-label={isCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto py-3.5 px-2.5 space-y-4">
          {sections.map((sec) => {
            const items = NAV_ITEMS.filter((i) => i.section === sec);
            return (
              <div key={sec} className="space-y-1">
                {!isCollapsed && (
                  <div className="px-3.5 pb-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[var(--gd-muted)] opacity-75">
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
                      className={`group relative w-full flex items-center gap-3 rounded-full transition-all duration-200 ${
                        isCollapsed ? 'justify-center w-11 h-11 mx-auto p-0' : 'px-3.5 py-2.5 text-[13px]'
                      } ${
                        active
                          ? 'bg-[var(--gd-pick)] text-[var(--gd-pick-ink)] font-extrabold shadow-[inset_0_1px_0_white,0_3px_10px_rgb(var(--gd-dark-shadow)/18%)]'
                          : 'text-[var(--gd-ink)] font-semibold opacity-85 hover:opacity-100 hover:bg-[var(--gd-inner)]'
                      }`}
                    >
                      <Icon
                        className={`w-[17px] h-[17px] shrink-0 transition-transform group-hover:scale-105 ${
                          active ? 'text-[var(--gd-pick-ink)] stroke-[2.2]' : 'text-[var(--gd-ink)] opacity-85 stroke-[1.8]'
                        }`}
                      />
                      {!isCollapsed && (
                        <span className="truncate flex-1 text-left">{item.label}</span>
                      )}
                      {badge != null && badge > 0 && !isCollapsed && (
                        <span
                          className={`px-2 py-0.5 text-[10.5px] font-extrabold rounded-full ${
                            item.id === 'health'
                              ? 'bg-[var(--gd-coral)] text-[#231a16]'
                              : active
                              ? 'bg-[#241b17]/12 text-[var(--gd-pick-ink)]'
                              : 'bg-[var(--gd-raised)] text-[var(--gd-ink)] border border-[var(--gd-line)]'
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                      {badge != null && badge > 0 && isCollapsed && (
                        <span
                          className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--gd-coral)]"
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
        <div className="p-2.5 border-t border-[var(--gd-line)]">
          <button
            type="button"
            onClick={onLogout}
            title={isCollapsed ? 'Выйти' : undefined}
            className={`w-full flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[12.5px] font-semibold text-[var(--gd-muted)] hover:text-[var(--gd-coral)] hover:bg-[var(--gd-inner)] transition-colors ${
              isCollapsed ? 'justify-center px-0' : ''
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
      {/* Desktop Floating Spatial Glass Rail */}
      <div className="hidden lg:block shrink-0 p-2.5 sm:p-4 lg:pr-0">
        <aside
          className={`sticky top-4 h-[calc(100svh-2rem)] flex flex-col rounded-[32px] gd-rail-shell border transition-all duration-200 overflow-hidden ${
            collapsed ? 'w-[68px]' : 'w-64'
          }`}
        >
          {renderNavContent(false)}
        </aside>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex p-3">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] rounded-[30px] gd-rail-shell border overflow-hidden shadow-2xl">
            {renderNavContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
