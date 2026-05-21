import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth-store';
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
  CheckCircle2,
  ChevronDown,
  User
} from 'lucide-react';
import { Avatar, Dropdown, DropdownItem } from '@prospix/ui';

export default function AppShell() {
  const { user, clearSession } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Mock numbers for dynamic sidebar counters
  const counters = {
    conversations: 4,
    leads: 12,
  };

  const menuItems = [
    { name: 'Início', path: '/', icon: Home },
    { name: 'Conversas', path: '/conversas', icon: MessageSquare, badge: counters.conversations },
    { name: 'Pipeline', path: '/funil', icon: Columns },
    { name: 'Agenda', path: '/agenda', icon: Calendar },
    { name: 'Leads', path: '/leads', icon: Users, badge: counters.leads },
    { name: 'Roteiros', path: '/roteiros', icon: FileText },
    { name: 'Configurações', path: '/configuracoes', icon: Settings },
  ];

  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  // Mock onboarding steps
  const onboardingSteps = [
    { label: 'Conectar WhatsApp', completed: true },
    { label: 'Google Agenda', completed: false },
    { label: 'Ativar Roteiro Base', completed: false },
  ];

  const completedStepsCount = onboardingSteps.filter(s => s.completed).length;

  return (
    <div className="min-h-screen bg-bg flex relative">
      {/* ── Desktop Sidebar (236px) ────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-[236px] bg-surface border-r border-border h-screen sticky top-0 shrink-0 z-20">
        {/* Sidebar Header */}
        <div className="h-[60px] border-b border-border flex items-center px-6 gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/10">
            <span className="font-heading text-base font-bold text-white tracking-wider">P</span>
          </div>
          <div>
            <h1 className="font-heading font-bold text-text text-sm leading-tight">Prospix</h1>
            <p className="text-[10px] text-text-secondary font-mono tracking-wider uppercase font-semibold">Corretor B2B</p>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-text-secondary group-hover:text-text'}`} />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-surface-sunken text-text-secondary border border-border'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Onboarding Checklist Widget in Sidebar */}
        {completedStepsCount < onboardingSteps.length && (
          <div className="m-4 p-4 rounded-xl bg-surface-sunken border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">Onboarding</span>
              <span className="text-[10px] font-mono text-text-secondary">{completedStepsCount}/{onboardingSteps.length}</span>
            </div>
            <div className="w-full bg-border h-1 rounded-full overflow-hidden">
              <div 
                className="bg-gradient-to-r from-primary to-secondary h-full rounded-full transition-all duration-500" 
                style={{ width: `${(completedStepsCount / onboardingSteps.length) * 100}%` }}
              />
            </div>
            <ul className="space-y-1.5 pt-1">
              {onboardingSteps.map((step, idx) => (
                <li key={idx} className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className={`w-3.5 h-3.5 shrink-0 ${step.completed ? 'text-success' : 'text-text-secondary/50'}`} />
                  <span className={step.completed ? 'text-text-secondary line-through' : 'text-text'}>{step.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sidebar Footer User Section */}
        <div className="p-4 border-t border-border bg-surface-sunken/40">
          <div className="flex items-center gap-3 px-2 py-1.5 mb-2">
            <Avatar 
              name={user?.name || 'Corretor'} 
              className="w-9 h-9 border border-border bg-surface text-text" 
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text truncate leading-none mb-1">{user?.name || 'Corretor'}</p>
              <p className="text-[10px] text-text-secondary truncate leading-none font-mono">Workspace ID: {user?.tenant_id.substring(0, 8)}</p>
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
          <aside className="relative flex flex-col w-[260px] bg-surface h-full border-r border-border p-6 animate-slideIn">
            <button 
              onClick={() => setIsMobileMenuOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-8">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-primary to-secondary flex items-center justify-center">
                <span className="font-heading text-base font-bold text-white">P</span>
              </div>
              <h1 className="font-heading font-bold text-text text-sm">Prospix</h1>
            </div>
            
            <nav className="flex-1 space-y-1.5 overflow-y-auto">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive
                          ? 'bg-primary text-white'
                          : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
                      }`
                    }
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-text-secondary'}`} />
                      <span>{item.name}</span>
                    </div>
                  </NavLink>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-border mt-auto">
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
        <header className="h-[60px] border-b border-border bg-surface/50 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="md:hidden p-1.5 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Global Search Box */}
            <div className="relative hidden sm:block max-w-[280px]">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input 
                type="text" 
                placeholder="Buscar lead ou apólice..."
                className="w-full bg-surface border border-border rounded-xl pl-10 pr-3.5 py-1.5 text-xs text-text placeholder-text-secondary focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Notifications Dropdown */}
            <div className="relative">
              <button 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="p-2 rounded-xl bg-surface hover:bg-surface-sunken border border-border text-text-secondary hover:text-text transition-all relative"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary" />
              </button>

              {isNotificationsOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setIsNotificationsOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-surface border border-border rounded-2xl shadow-lg p-4 z-20 space-y-3 animate-fadeIn">
                    <h4 className="text-xs font-semibold text-text uppercase tracking-wider">Notificações</h4>
                    <div className="divide-y divide-border max-h-64 overflow-y-auto">
                      <div className="py-2.5 text-xs">
                        <p className="text-text font-medium leading-tight">Novo lead capturado</p>
                        <p className="text-text-secondary text-[10px] mt-0.5 font-mono">10 minutos atrás</p>
                      </div>
                      <div className="py-2.5 text-xs">
                        <p className="text-text font-medium leading-tight">Agendamento confirmado: Alice Souza</p>
                        <p className="text-text-secondary text-[10px] mt-0.5 font-mono">1 hora atrás</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Profile Menu Dropdown */}
            <Dropdown
              trigger={
                <button className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-sunken border border-transparent hover:border-border transition-all">
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
        <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
