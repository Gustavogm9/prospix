import React, { useEffect } from 'react';
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
import './index.css';

// Protected Admin Route checking adminToken and session
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { adminToken, adminUser, clearAdminSession } = useAdminAuthStore();
  const isAuthorized =
    !!adminToken &&
    !!adminUser &&
    ['SUPER_ADMIN', 'ADMIN', 'GUILDS_ADMIN'].includes(adminUser.role);

  useEffect(() => {
    if (!isAuthorized) {
      clearAdminSession();
    }
  }, [clearAdminSession, isAuthorized]);

  if (!isAuthorized) {
    // Proactively clear corrupted or incomplete localStorage credentials
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
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    {/* Global premium Toast alerts container */}
    <ToastContainer />
  </React.StrictMode>
);
