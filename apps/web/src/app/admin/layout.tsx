'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminAuthStore } from '@/store/admin-auth-store';
import { supabaseAdmin } from '@/lib/supabase';
import AdminShell from '@/layout/AdminShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { adminUser, setAdminSession, clearAdminSession } = useAdminAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  // Login page should NOT be wrapped in the AdminShell or auth-protected
  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) {
      setIsChecking(false);
      return;
    }

    const checkSession = async () => {
      try {
        const { data: { session } } = await supabaseAdmin.auth.getSession();

        if (!session) {
          clearAdminSession();
          router.replace('/admin/login');
          return;
        }

        // If we have a Supabase session but no admin user in Zustand, restore it
        if (!adminUser && session.user) {
          const meta = session.user.user_metadata;
          setAdminSession({
            id: session.user.id,
            name: meta?.name || session.user.email || 'Admin',
            email: session.user.email || '',
            role: meta?.role || 'ADMIN',
          });
        }
      } catch {
        clearAdminSession();
        router.replace('/admin/login');
        return;
      }

      setIsChecking(false);
    };

    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginPage]);

  // Login page: render children directly (no shell, no auth check)
  if (isLoginPage) {
    return <>{children}</>;
  }

  // While checking auth, show loading spinner
  if (isChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-xs text-text-secondary font-medium">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  // Authenticated: wrap in AdminShell
  return <AdminShell>{children}</AdminShell>;
}
