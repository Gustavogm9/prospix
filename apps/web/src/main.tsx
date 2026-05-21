import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from '@prospix/ui';
import { useAuthStore } from './store/auth-store';
import AppShell from './layout/AppShell';
import Login from './pages/auth/Login';
import SignupCode from './pages/auth/SignupCode';
import SignupDetails from './pages/auth/SignupDetails';
import InvitationError from './pages/auth/InvitationError';
import LoginCallback from './pages/auth/LoginCallback';
import Home from './pages/Home';
import Conversations from './pages/Conversations';
import Pipeline from './pages/Pipeline';
import Schedule from './pages/Schedule';
import Leads from './pages/Leads';
import Scripts from './pages/Scripts';
import Settings from './pages/Settings';
import './index.css';

// Protected Route Component injecting RLS authentication state
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken, tenantId, user, clearSession } = useAuthStore();
  
  if (!accessToken || !tenantId || !user || !['OWNER', 'ASSISTANT', 'ADMIN'].includes(user.role)) {
    // Proactively clear corrupted or incomplete localStorage credentials
    clearSession();
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public Auth Routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<SignupCode />} />
        <Route path="/cadastro/detalhes" element={<SignupDetails />} />
        <Route path="/cadastro/erro" element={<InvitationError />} />
        <Route path="/auth/callback" element={<LoginCallback />} />

        {/* Private Tenant Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Home />} />
          <Route path="conversas" element={<Conversations />} />
          <Route path="funil" element={<Pipeline />} />
          <Route path="agenda" element={<Schedule />} />
          <Route path="leads" element={<Leads />} />
          <Route path="roteiros" element={<Scripts />} />
          <Route path="configuracoes" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    {/* Rich design system Toast Container */}
    <ToastContainer />
  </React.StrictMode>
);
