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
import LegalDocument from './pages/legal/LegalDocument';
import Home from './pages/Home';
import Conversations from './pages/Conversations';
import Pipeline from './pages/Pipeline';
import Schedule from './pages/Schedule';
import Leads from './pages/Leads';
import Scripts from './pages/Scripts';
import Settings from './pages/Settings';
import Campaigns from './pages/Campaigns';
import Performance from './pages/Performance';
import AIConsumption from './pages/AIConsumption';
import LeadSources from './pages/LeadSources';
import Referrals from './pages/Referrals';
import AppMobile from './pages/AppMobile';
import './index.css';

// Protected Route Component injecting RLS authentication state
// Zustand persist hydrates async from localStorage – we must wait before
// deciding to redirect, otherwise a brief null-state frame triggers clearSession().
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { accessToken, tenantId, user, clearSession } = useAuthStore();
  const [hasHydrated, setHasHydrated] = React.useState(false);

  React.useEffect(() => {
    // Zustand persist calls onRehydrateStorage synchronously during module load
    // but the actual hydration happens async. Use a micro-tick to let it settle.
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    // If hydration already happened before this effect ran
    if ((useAuthStore.persist as any).hasHydrated?.()) {
      setHasHydrated(true);
    }
    return unsub;
  }, []);

  const isAuthorized =
    !!accessToken &&
    !!tenantId &&
    !!user &&
    ['OWNER', 'ASSISTANT', 'ADMIN'].includes(user.role);

  // Clean up stale session data via effect (not during render) to avoid
  // the infinite re-render loop that caused React error #185.
  React.useEffect(() => {
    if (hasHydrated && !isAuthorized) {
      clearSession();
    }
  }, [hasHydrated, isAuthorized, clearSession]);

  // Show nothing while waiting for the store to hydrate from localStorage
  if (!hasHydrated) {
    return null;
  }

  if (!isAuthorized) {
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
        <Route path="/termos" element={<LegalDocument kind="terms" />} />
        <Route path="/privacidade" element={<LegalDocument kind="privacy" />} />

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
          <Route path="campanhas" element={<Campaigns />} />
          <Route path="fontes" element={<LeadSources />} />
          <Route path="indicacoes" element={<Referrals />} />
          <Route path="performance" element={<Performance />} />
          <Route path="consumo-ia" element={<AIConsumption />} />
          <Route path="app-mobile" element={<AppMobile />} />
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
