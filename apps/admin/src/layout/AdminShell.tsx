import { useState } from 'react';
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
  Activity
} from 'lucide-react';
import { Avatar, Dropdown, DropdownItem } from '@prospix/ui';

export default function AdminShell() {
  const { adminUser, clearAdminSession } = useAdminAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuItems = [
    { name: 'Custos & Margens', path: '/', icon: BarChart3 },
    { name: 'Gerenciar Tenants', path: '/tenants', icon: Building },
    { name: 'Cadastrar Tenant', path: '/tenants/novo', icon: PlusCircle },
    { name: 'Templates Master', path: '/templates', icon: FileText },
  ];

  const handleLogout = () => {
    clearAdminSession();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-bg flex relative">
      {/* Desktop Admin Sidebar */}
      <aside className="hidden md:flex flex-col w-[236px] bg-surface border-r border-border h-screen sticky top-0 shrink-0 z-20 shadow-sm">
        <div className="h-[60px] border-b border-border flex items-center px-6 gap-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center shadow-lg shadow-amber-500/10">
            <span className="font-heading text-base font-bold text-white tracking-wider">A</span>
          </div>
          <div>
            <h1 className="font-heading font-bold text-text text-sm leading-tight">Prospix</h1>
            <p className="text-[10px] text-amber-800 font-mono tracking-wider uppercase font-semibold">Super-Admin Panel</p>
          </div>
        </div>

        <nav className="flex-1 py-6 px-4 space-y-1.5 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    isActive
                      ? 'bg-primary text-white shadow-sm shadow-primary/10 border border-primary/20'
                      : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
                  }`
                }
              >
                <Icon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-text-secondary group-hover:text-text'}`} />
                <span>{item.name}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border bg-surface-sunken/40">
          <div className="flex items-center gap-3 px-2 py-1.5 mb-2">
            <Avatar 
              name={adminUser?.name || 'Administrador'} 
              className="w-9 h-9 border border-border bg-surface text-text font-semibold" 
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text truncate leading-none mb-1">{adminUser?.name || 'Admin Guilds'}</p>
              <p className="text-[10px] text-amber-800 truncate leading-none font-mono">GUILDS_OWNER</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-xs font-semibold text-error hover:text-error-text rounded-lg hover:bg-error-soft/60 border border-transparent hover:border-error-soft transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />
          <aside className="relative flex flex-col w-[236px] bg-surface h-full border-r border-border p-6 animate-in slide-in-from-left duration-200">
              <button onClick={() => setIsMobileMenuOpen(false)} aria-label="Fechar menu admin" className="absolute top-4 right-4 p-1 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-8">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-500 to-red-500 flex items-center justify-center">
                <span className="font-heading text-base font-bold text-white">A</span>
              </div>
              <h1 className="font-heading font-bold text-text text-sm">Prospix Admin</h1>
            </div>
            
            <nav className="flex-1 space-y-1.5 overflow-y-auto">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        isActive ? 'bg-primary text-white shadow-sm border border-primary/20' : 'text-text-secondary hover:text-text hover:bg-surface-sunken'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 text-amber-500" />
                    <span>{item.name}</span>
                  </NavLink>
                );
              })}
            </nav>
            <div className="pt-4 border-t border-border mt-auto">
              <button onClick={handleLogout} className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm font-medium text-error hover:bg-error-soft/60 rounded-lg transition-all">
                <LogOut className="w-4 h-4" />
                <span>Deslogar</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <header className="h-[60px] border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-6 shrink-0 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileMenuOpen(true)} aria-label="Abrir menu admin" className="md:hidden p-1.5 rounded-lg hover:bg-surface-sunken text-text-secondary hover:text-text">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <Activity className="w-4 h-4 text-amber-800 animate-pulse" />
              <span>Conexão bypass-RLS ativa: conexão direta com role connection guilds_admin</span>
            </div>
          </div>

          <Dropdown
            trigger={
              <button className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-sunken border border-transparent hover:border-border transition-all">
                <Avatar name={adminUser?.name || 'Admin'} className="w-7 h-7 bg-surface-sunken text-text font-bold" />
                <span className="hidden sm:inline text-xs font-medium text-text">Admin</span>
                <ChevronDown className="w-3.5 h-3.5 text-text-secondary" />
              </button>
            }
          >
            <DropdownItem onClick={handleLogout} className="text-error hover:text-error-text">
              <LogOut className="w-3.5 h-3.5 mr-2" />
              Sair
            </DropdownItem>
          </Dropdown>
        </header>

        <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
