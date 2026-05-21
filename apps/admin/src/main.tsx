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
import './index.css';

// Protected Admin Route checking adminToken and session
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { adminToken, adminUser, clearAdminSession } = useAdminAuthStore();
  
  if (!adminToken || !adminUser || (adminUser.role !== 'SUPER_ADMIN' && adminUser.role !== 'ADMIN')) {
    // Proactively clear corrupted or incomplete localStorage credentials
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
          <Route path="templates" element={<Templates />} />
        </Route>

        {/* Catch-all Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    {/* Global premium Toast alerts container */}
    <ToastContainer />
  </React.StrictMode>
);
