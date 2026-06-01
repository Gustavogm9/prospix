import { useAdminAuthStore } from '../store/admin-auth-store';

export type AdminPermission =
  | 'tenants.manage'
  | 'users.manage'
  | 'billing.manage'
  | 'flags.manage'
  | 'dlq.manage'
  | 'discovery.promote'
  | 'impersonation'
  | 'audit.view'
  | 'settings.manage'
  | 'alerts.manage';

const ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  SUPER_ADMIN: [
    'tenants.manage',
    'users.manage',
    'billing.manage',
    'flags.manage',
    'dlq.manage',
    'discovery.promote',
    'impersonation',
    'audit.view',
    'settings.manage',
    'alerts.manage',
  ],
  ADMIN: [
    'tenants.manage',
    'billing.manage',
    'discovery.promote',
    'audit.view',
    'alerts.manage',
  ],
  GUILDS_ADMIN: [
    'tenants.manage',
    'users.manage',
    'billing.manage',
    'flags.manage',
    'dlq.manage',
    'discovery.promote',
    'impersonation',
    'audit.view',
    'settings.manage',
    'alerts.manage',
  ],
};

/**
 * Pure function — check if a given role has a specific permission.
 */
export function hasPermission(role: string | undefined, permission: AdminPermission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * React hook — returns true if the currently logged-in admin has the given permission.
 * Subscribes to the auth store so the component re-renders on role changes.
 */
export function usePermission(permission: AdminPermission): boolean {
  const role = useAdminAuthStore((s) => s.adminUser?.role);
  return hasPermission(role, permission);
}

/**
 * React hook — returns the full hasPermission checker bound to the current user's role.
 * Useful when a component needs to check multiple permissions without calling the hook N times.
 */
export function usePermissions() {
  const role = useAdminAuthStore((s) => s.adminUser?.role);
  return {
    role,
    can: (permission: AdminPermission) => hasPermission(role, permission),
  };
}
