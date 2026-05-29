import { useState, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAdminAuthStore } from '../store/admin-auth-store';
import {
  BarChart3,
  Building,
  PlusCircle,
  FileText,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Activity,
  Compass,
  CreditCard,
  History,
  ShieldAlert,
  ToggleRight,
  Bell,
  Users,
  UserCog,
  MessageSquare,
  Contact,
  Shield,
  Settings,
  Calendar,
  Target,
  GitBranch,
  Share2,
  MapPin,
} from 'lucide-react';
import { Avatar, Dropdown, DropdownItem } from '@prospix/ui';
import { GlobalSearch } from './GlobalSearch';
import { hasPermission, type AdminPermission } from '../lib/permissions';

interface MenuSection {
  label?: string;
  items: { name: string; path: string; icon: typeof BarChart3; permission?: AdminPermission }[];
}

export default function AdminShell() {
  const { adminUser, clearAdminSession } = useAdminAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuSections: MenuSection[] = [
    {
      items: [
        { name: 'Custos & Margens', path: '/', icon: BarChart3 },
        { name: 'Gerenciar Tenants', path: '/tenants', icon: Building, permission: 'tenants.manage' },
        { name: 'Cadastrar Tenant', path: '/tenants/novo', icon: PlusCircle, permission: 'tenants.manage' },
        { name: 'Templates Master', path: '/templates', icon: FileText },
        { name: 'Faturamento', path: '/faturamento', icon: CreditCard, permission: 'billing.manage' },
      ],
    },
    {
      label: 'MONITORAMENTO',
      items: [
        { name: 'Conversas IA', path: '/conversas', icon: MessageSquare },
        { name: 'Reuniões', path: '/reunioes', icon: Calendar },
        { name: 'Campanhas', path: '/campanhas', icon: Target },
        { name: 'Leads', path: '/leads', icon: Contact },
        { name: 'Pipeline', path: '/pipeline', icon: GitBranch },
        { name: 'Fontes de Leads', path: '/fontes', icon: MapPin },
        { name: 'Indicações', path: '/indicacoes', icon: Share2 },
      ],
    },
    {
      label: 'ANÁLISE',
      items: [
        { name: 'Atividade', path: '/atividade', icon: Users },
        { name: 'Observabilidade', path: '/observabilidade', icon: Activity, permission: 'dlq.manage' },
        { name: 'Discovery', path: '/discovery', icon: Compass, permission: 'discovery.promote' },
        { name: 'Audit Log', path: '/audit', icon: History, permission: 'audit.view' },
      ],
    },
    {
      label: 'SISTEMA',
      items: [
        { name: 'Compliance LGPD', path: '/compliance', icon: ShieldAlert, permission: 'settings.manage' },
        { name: 'Feature Flags', path: '/flags', icon: ToggleRight, permission: 'flags.manage' },
        { name: 'Alertas', path: '/alertas', icon: Bell, permission: 'alerts.manage' },
        { name: 'Usuários', path: '/usuarios', icon: UserCog, permission: 'users.manage' },
        { name: 'Impersonificação', path: '/impersonacao', icon: Shield, permission: 'impersonation' },
        { name: 'Configurações', path: '/configuracoes', icon: Settings, permission: 'settings.manage' },
      ],
    },
  ];

  const visibleSections = useMemo(
    () =>
      menuSections.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.permission || hasPermission(adminUser?.role, item.permission)),
      })).filter((section) => section.items.length > 0),
    [adminUser?.role]
  );

  const handleLogout = () => {
    clearAdminSession();
    navigate('/login');
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const renderNav = (
    items: MenuSection['items'],
    onItemClick?: () => void
  ) =>
    items.map((item) => {
      const Icon = item.icon;
      return (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          onClick={onItemClick}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all group ${
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                className={`w-4 h-4 transition-transform group-hover:scale-110 ${
                  isActive ? 'text-white' : 'text-text-secondary group-hover:text-text'
                }`}
              />
              <span>{item.name}</span>
            </>
          )}
        </NavLink>
      );
    });

  return (
    <div className="min-h-screen bg-bg flex relative">
      {/* ── Desktop Sidebar (236px) ────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[236px] bg-surface border-r border-border h-screen sticky top-0 shrink-0 z-20">
        {/* Sidebar Header */}
        <div className="h-[60px] border-b border-border flex items-center px-4 gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/10">
            <span className="font-heading text-sm font-bold text-white tracking-wider">A</span>
          </div>
          <div>
            <h1 className="font-heading font-semibold text-text text-[13.5px] leading-tight">
              {adminUser?.name?.split(' ')[0] || 'Admin'}
            </h1>
            <p className="text-[11px] text-text-secondary leading-tight mt-0.5">Super-Admin · Prospix</p>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto space-y-0.5">
          {visibleSections.map((section, sIdx) => (
            <div key={sIdx}>
              {section.label && (
                <div className="text-[10px] uppercase tracking-[0.06em] text-text-secondary font-semibold px-3.5 pt-5 pb-1.5">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">{renderNav(section.items)}</div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer User Section */}
        <div className="p-4 border-t border-border bg-surface-sunken/40">
          <div className="flex items-center gap-3 px-2 py-1.5 mb-2">
            <Avatar
              name={adminUser?.name || 'Administrador'}
              className="w-9 h-9 border border-border bg-surface text-text"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text truncate leading-none mb-1">
                {adminUser?.name || 'Admin Guilds'}
              </p>
              <p className="text-[10px] text-[#A56B0A] truncate leading-none font-semibold">
                {adminUser?.role || 'ADMIN'}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-semibold text-red-600 hover:text-red-700 rounded-lg hover:bg-red-50 border border-transparent hover:border-red-100 transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* ── Slide-out mobile navigation drawer ────────────────────────────── */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <aside className="relative flex flex-col w-[260px] bg-surface h-full border-r border-border animate-slideIn">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 p-6 mb-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center">
                <span className="font-heading text-sm font-bold text-white">A</span>
              </div>
              <h1 className="font-heading font-bold text-text text-sm">Prospix Admin</h1>
            </div>

            <nav className="flex-1 px-4 space-y-0.5 overflow-y-auto">
              {visibleSections.map((section, sIdx) => (
                <div key={sIdx}>
                  {section.label && (
                    <div className="text-[10px] uppercase tracking-[0.06em] text-text-secondary font-semibold px-3 pt-4 pb-1">
                      {section.label}
                    </div>
                  )}
                  {renderNav(section.items, () => setIsMobileMenuOpen(false))}
                </div>
              ))}
            </nav>

            <div className="pt-4 border-t border-border mt-auto p-4">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-500/5 rounded-lg transition-all"
              >
                <LogOut className="w-4 h-4" />
                <span>Encerrar Sessão</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main Area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Topbar (60px) */}
        <header className="h-[60px] border-b border-border bg-surface/50 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-5 shrink-0">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Abrir menu admin"
              className="md:hidden p-1.5 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Greeting */}
            <div className="hidden md:block">
              <h2 className="text-[15px] font-semibold text-text leading-tight">
                {getGreeting()}, {adminUser?.name?.split(' ')[0] || 'Admin'}
              </h2>
              <p className="text-[11px] text-text-secondary capitalize">
                {new Date().toLocaleDateString('pt-BR', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
            </div>

            {/* Global Search */}
            <GlobalSearch />
          </div>

          <div className="flex items-center gap-3">
            {/* bypass-RLS indicator */}
            <div
              className="hidden lg:flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary"
              title="Conexão bypass-RLS ativa"
            >
              <Activity className="w-3.5 h-3.5 text-amber-800 animate-pulse" />
              <span>bypass-RLS</span>
            </div>

            {/* Profile Menu */}
            <Dropdown
              trigger={
                <button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-sunken transition-all">
                  <Avatar
                    name={adminUser?.name || 'Admin'}
                    className="w-7 h-7 bg-surface-sunken text-text"
                  />
                  <span className="hidden sm:inline text-xs font-medium text-text">
                    {adminUser?.name?.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />
                </button>
              }
            >
              <DropdownItem onClick={handleLogout} className="text-red-600 hover:text-red-700">
                <LogOut className="w-3.5 h-3.5 mr-2" />
                Sair da Conta
              </DropdownItem>
            </Dropdown>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-5 md:p-6 overflow-y-auto max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
