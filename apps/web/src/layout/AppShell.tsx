import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth-store';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  Home,
  MessageSquare,
  Columns,
  Calendar,
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
  ChevronDown,
  User,
  Target,
  TrendingUp,
  Cpu,
  Lightbulb,
  Plus,
  MapPin,
  Star,
  HelpCircle,
  Smartphone,
} from 'lucide-react';
import { Avatar, Dropdown, DropdownItem } from '@prospix/ui';
import { apiClient } from '../lib/api-client';

interface AppShellCounters {
  conversations: number;
  leads: number;
  pipeline: number;
  campaigns: number;
}

interface MenuSection {
  label?: string;
  items: MenuItem[];
}

interface MenuItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number | string;
  badgeColor?: string;
}

export default function AppShell() {
  const { user, clearSession } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [counters, setCounters] = useState<AppShellCounters | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [notifications, setNotifications] = useState<Array<{id: string; title: string; body: string; readAt: string | null; createdAt: string; link?: string}>>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const searchResults = globalSearch.trim().length > 1 ? [
    { type: 'lead', label: `Buscar "${globalSearch}" em Leads`, path: `/leads?search=${encodeURIComponent(globalSearch)}` },
    { type: 'conversa', label: `Buscar "${globalSearch}" em Conversas`, path: `/conversas?search=${encodeURIComponent(globalSearch)}` },
    { type: 'campanha', label: `Buscar "${globalSearch}" em Campanhas`, path: `/campanhas?search=${encodeURIComponent(globalSearch)}` },
  ] : [];

  useEffect(() => {
    let isMounted = true;

    const fetchCounters = async () => {
      try {
        const response = await apiClient.get('/tenant/dashboard/today');
        const data = response.data?.data ?? response.data;

        if (!isMounted) return;

        setCounters({
          conversations: data?.conversations_ready ?? 0,
          leads: data?.new_leads_today ?? 0,
          pipeline: data?.conversations_ready ?? 0,
          campaigns: 0,
        });
      } catch (error) {
        console.error('Error fetching AppShell counters:', error);
        if (isMounted) {
          setCounters({ conversations: 0, leads: 0, pipeline: 0, campaigns: 0 });
        }
      }
    };

    fetchCounters();

    return () => {
      isMounted = false;
    };
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await apiClient.get('/tenant/notifications');
      setNotifications(res.data?.data || []);
      setUnreadCount(res.data?.unreadCount || 0);
    } catch {}
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, []);

  const menuSections: MenuSection[] = [
    {
      items: [
        { name: 'Início', path: '/', icon: Home },
        { name: 'Conversas', path: '/conversas', icon: MessageSquare, badge: counters?.conversations || undefined },
        { name: 'Pipeline', path: '/funil', icon: Columns, badge: counters?.pipeline || undefined },
        { name: 'Minha Agenda', path: '/agenda', icon: Calendar },
        { name: 'Meus Leads', path: '/leads', icon: Users, badge: counters?.leads || undefined },
      ],
    },
    {
      label: 'INTELIGÊNCIA',
      items: [
        { name: 'Campanhas', path: '/campanhas', icon: Target, badge: counters?.campaigns || undefined },
        { name: 'Fontes de leads', path: '/fontes', icon: MapPin },
        { name: 'Roteiros da IA', path: '/roteiros', icon: FileText },
        { name: 'Indicações', path: '/indicacoes', icon: Star },
      ],
    },
    {
      label: 'ANÁLISE',
      items: [
        { name: 'Performance', path: '/performance', icon: TrendingUp },
        { name: 'Consumo de IA', path: '/consumo-ia', icon: Cpu },
        { name: 'App mobile', path: '/app-mobile', icon: Smartphone, badge: 'novo', badgeColor: 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' },
        { name: 'Configurações', path: '/configuracoes', icon: Settings },
      ],
    },
  ];



  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const renderNav = (items: MenuItem[], isActive: (path: string) => boolean, onItemClick?: () => void) => (
    items.map((item) => {
      const Icon = item.icon;
      const active = isActive(item.path);
      return (
        <NavLink
          key={item.path}
          to={item.path}
          onClick={onItemClick}
          className={() =>
            `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all group ${
              active
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
            }`
          }
        >
          <div className="flex items-center gap-3">
            <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${active ? 'text-white' : 'text-text-secondary group-hover:text-text'}`} />
            <span>{item.name}</span>
          </div>
          {item.badge !== undefined && (
            <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
              active ? 'bg-white/20 text-white' : item.badgeColor || 'bg-surface-sunken text-text-secondary border border-border'
            }`}>
              {item.badge}
            </span>
          )}
        </NavLink>
      );
    })
  );

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-bg flex relative">
      {/* ── Desktop Sidebar (236px) ────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[236px] bg-surface border-r border-border h-screen sticky top-0 shrink-0 z-20">
        {/* Sidebar Header */}
        <div className="h-[60px] border-b border-border flex items-center px-4 gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/10">
            <span className="font-heading text-sm font-bold text-white tracking-wider">P</span>
          </div>
          <div>
            <h1 className="font-heading font-semibold text-text text-[13.5px] leading-tight">{user?.name?.split(' ')[0] || 'Corretor'}</h1>
            <p className="text-[11px] text-text-secondary leading-tight mt-0.5">Corretor · Prospix</p>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto space-y-0.5">
          {menuSections.map((section, sIdx) => (
            <div key={sIdx}>
              {section.label && (
                <div className="text-[10px] uppercase tracking-[0.06em] text-text-secondary font-semibold px-3.5 pt-5 pb-1.5">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {renderNav(section.items, (path) => location.pathname === path)}
              </div>
            </div>
          ))}
        </nav>

        {/* How it works card */}
        <div className="mx-3 mb-3 p-3 bg-gradient-to-br from-primary to-[#142C52] rounded-xl text-white cursor-pointer hover:-translate-y-0.5 transition-transform">
          <div className="text-[12px] font-semibold flex items-center gap-1.5 mb-1">
            <Lightbulb className="w-3.5 h-3.5 text-[#E8981C]" />
            Como funciona?
          </div>
          <p className="text-[10.5px] text-white/80 leading-relaxed">Reveja como sua máquina opera.</p>
          <p className="text-[11px] font-semibold text-[#E8981C] mt-1.5 flex items-center gap-1">
            Refazer tour →
          </p>
        </div>

        {/* Sidebar Footer User Section */}
        <div className="p-4 border-t border-border bg-surface-sunken/40">
          <div className="flex items-center gap-3 px-2 py-1.5 mb-2">
            <Avatar 
              name={user?.name || 'Corretor'} 
              className="w-9 h-9 border border-border bg-surface text-text" 
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text truncate leading-none mb-1">{user?.name || 'Corretor'}</p>
              <p className="text-[10px] text-[#A56B0A] truncate leading-none font-semibold">Plano Profissional</p>
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
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsMobileMenuOpen(false)}
          />
          {/* Menu panel */}
          <aside className="relative flex flex-col w-[260px] bg-surface h-full border-r border-border animate-slideIn">
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 p-6 mb-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="font-heading text-sm font-bold text-white">P</span>
              </div>
              <h1 className="font-heading font-bold text-text text-sm">Prospix</h1>
            </div>
            
            <nav className="flex-1 px-4 space-y-0.5 overflow-y-auto">
              {menuSections.map((section, sIdx) => (
                <div key={sIdx}>
                  {section.label && (
                    <div className="text-[10px] uppercase tracking-[0.06em] text-text-secondary font-semibold px-3 pt-4 pb-1">
                      {section.label}
                    </div>
                  )}
                  {renderNav(section.items, (path) => location.pathname === path, () => setIsMobileMenuOpen(false))}
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
              aria-label="Abrir menu principal"
              className="md:hidden p-1.5 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Greeting */}
            <div className="hidden md:block">
              <h2 className="text-[15px] font-semibold text-text leading-tight">{getGreeting()}, {user?.name?.split(' ')[0] || 'Corretor'}</h2>
              <p className="text-[11px] text-text-secondary capitalize">
                {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>

            {/* Global Search Box */}
            <div className="relative hidden sm:block max-w-[440px] flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input 
                type="text" 
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                placeholder="Buscar lead, especialidade, cidade..."
                className="w-full bg-surface-sunken border border-transparent rounded-lg pl-9 pr-3 py-1.5 text-[13px] text-text placeholder-text-secondary focus:border-primary focus:bg-white focus:ring-1 focus:ring-primary/20 outline-none transition-all"
              />
              {isSearchFocused && searchResults.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsSearchFocused(false)} />
                  <div className="absolute left-0 right-0 mt-1.5 bg-white border border-[#E5E7EB] rounded-xl shadow-xl z-20 overflow-hidden animate-fadeIn">
                    {searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => { navigate(r.path); setGlobalSearch(''); setIsSearchFocused(false); }}
                        className="w-full text-left px-4 py-2.5 text-[12px] text-[#0F172A] hover:bg-[rgba(27,58,107,0.04)] flex items-center gap-2 transition-colors border-b border-[#EEF0F3] last:border-0"
                      >
                        <Search className="w-3 h-3 text-[#94A3B8]" />
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Tour button */}
            <button
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold text-[#A56B0A] bg-[rgba(232,152,28,0.14)] border border-[rgba(232,152,28,0.3)] hover:bg-[rgba(232,152,28,0.22)] transition-all hover:-translate-y-0.5"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Tour de 2min
            </button>

            {/* New Campaign button */}
            <button
              onClick={() => navigate('/campanhas')}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 bg-primary hover:bg-[#142C52] text-white text-[12px] font-semibold rounded-lg shadow-sm transition-all hover:-translate-y-0.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova campanha
            </button>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                aria-label={isNotificationsOpen ? 'Fechar notificações' : 'Abrir notificações'}
                aria-expanded={isNotificationsOpen}
                className="p-2 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text transition-all relative"
              >
                <Bell className="w-[17px] h-[17px]" />
                {unreadCount > 0 && <span className="absolute top-[5px] right-[6px] w-[7px] h-[7px] rounded-full bg-[#D92D20] border-2 border-white" />}
              </button>

              {isNotificationsOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsNotificationsOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-xl shadow-lg p-4 z-20 space-y-3 animate-fadeIn">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-text uppercase tracking-wider">Notificações</h4>
                      {unreadCount > 0 && (
                        <button
                          onClick={async () => {
                            try { await apiClient.patch('/tenant/notifications/read-all'); fetchNotifications(); } catch {}
                          }}
                          className="text-[11px] font-semibold text-primary hover:underline"
                        >
                          Marcar todas como lidas
                        </button>
                      )}
                    </div>
                    {notifications.length > 0 ? (
                      <div className="divide-y divide-border max-h-64 overflow-y-auto">
                        {notifications.slice(0, 8).map(n => (
                          <div key={n.id} className={`py-2.5 px-1 cursor-pointer hover:bg-[#F9FAFB] rounded-lg transition-colors ${!n.readAt ? 'bg-[rgba(27,58,107,0.03)]' : ''}`}
                            onClick={async () => {
                              if (!n.readAt) {
                                try { await apiClient.patch(`/tenant/notifications/${n.id}/read`); fetchNotifications(); } catch {}
                              }
                              if (n.link) navigate(n.link);
                              setIsNotificationsOpen(false);
                            }}
                          >
                            <div className="flex items-start gap-2">
                              {!n.readAt && <span className="w-2 h-2 rounded-full bg-[#1B3A6B] mt-1 shrink-0" />}
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F172A] truncate">{n.title}</p>
                                <p className="text-[11px] text-[#475569] line-clamp-2">{n.body}</p>
                                <p className="text-[10px] text-[#94A3B8] mt-0.5">{new Date(n.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-4 text-xs">
                        <p className="text-text-secondary leading-tight">Nenhuma notificação no momento.</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Profile Menu Dropdown */}
            <Dropdown
              trigger={
                <button className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-sunken transition-all">
                  <Avatar name={user?.name || 'Corretor'} className="w-7 h-7 bg-surface-sunken text-text" />
                  <span className="hidden sm:inline text-xs font-medium text-text">{user?.name?.split(' ')[0]}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />
                </button>
              }
            >
              <DropdownItem onClick={() => navigate('/configuracoes')}>
                <User className="w-3.5 h-3.5 mr-2" />
                Meu Perfil
              </DropdownItem>
              <DropdownItem onClick={() => navigate('/configuracoes?tab=integracoes')}>
                <Settings className="w-3.5 h-3.5 mr-2" />
                Integrações
              </DropdownItem>
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
    </ErrorBoundary>
  );
}
