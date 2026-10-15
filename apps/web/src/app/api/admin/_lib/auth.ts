// Compatibility entry point for routes inside /api/admin.
// The implementation lives in one place so every administrative endpoint
// validates the current database role using the same contract.
export { requireAdmin, supabaseAdmin } from '../../_lib/auth';
