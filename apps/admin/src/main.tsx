import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from '@prospix/ui';
import { useAdminAuthStore } from './store/admin-auth-store';
import AdminShell from './layout/AdminShell';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import NewTenant from './pages/NewTenant';
import Templates from './pages/Templates';
import Observability from './pages/Observability';
import Discovery from './pages/Discovery';
import TenantDetail from './pages/TenantDetail';
import Billing from './pages/Billing';
import AuditLog from './pages/AuditLog';
import Compliance from './pages/Compliance';
import FeatureFlags from './pages/FeatureFlags';
import Alerts from './pages/Alerts';
import Activity from './pages/Activity';
import UserManagement from './pages/UserManagement';
import Conversations from './pages/Conversations';
import LeadManagement from './pages/LeadManagement';
import Impersonation from './pages/Impersonation';
import Settings from './pages/Settings';
import './index.css';

// Protected Admin Route checking adminToken and session
// Zustand persist hydrates async – wait before evaluating auth state.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { adminToken, adminUser, clearAdminSession } = useAdminAuthStore();
  const [hasHydrated, setHasHydrated] = React.useState(false);

  React.useEffect(() => {
    const unsub = useAdminAuthStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    if ((useAdminAuthStore.persist as any).hasHydrated?.()) {
      setHasHydrated(true);
    }
    return unsub;
  }, []);

  if (!hasHydrated) {
    return null;
  }

  const isAuthorized =
    !!adminToken &&
    !!adminUser &&
    ['SUPER_ADMIN', 'ADMIN', 'GUILDS_ADMIN'].includes(adminUser.role);

  if (!isAuthorized) {
    clearAdminSession();
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}



ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public Admin Auth Gate */}
        <Route path="/login" element={<Login />} />

        {/* Private Super-Admin Routes (bypass-RLS) */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AdminShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/novo" element={<NewTenant />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
          <Route path="templates" element={<Templates />} />
          <Route path="observabilidade" element={<Observability />} />
          <Route path="discovery" element={<Discovery />} />
          <Route path="faturamento" element={<Billing />} />
          <Route path="audit" element={<AuditLog />} />
          <Route path="compliance" element={<Compliance />} />
          <Route path="flags" element={<FeatureFlags />} />
          <Route path="alertas" element={<Alerts />} />
          <Route path="atividade" element={<Activity />} />
          <Route path="usuarios" element={<UserManagement />} />
          <Route path="conversas" element={<Conversations />} />
          <Route path="leads" element={<LeadManagement />} />
          <Route path="impersonacao" element={<Impersonation />} />
          <Route path="configuracoes" element={<Settings />} />
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    {/* Global premium Toast alerts container */}
    <ToastContainer />
  </React.StrictMode>
);
