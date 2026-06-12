import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('apps/web/.env') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Finding tenant for Giovane...');
  
  const { data: tenants, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .ilike('name', '%giovane%');

  if (error || !tenants || tenants.length === 0) {
    console.log('Could not find tenant with name Giovane.');
    // Try getting the user that logged in
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users.users.find(u => u.email?.includes('giovane') || u.user_metadata?.full_name?.toLowerCase().includes('giovane'));
    if (user) {
      console.log('Found user:', user.email);
      const { data: profile } = await supabaseAdmin.from('profiles').select('tenant_id').eq('id', user.id).single();
      if (profile?.tenant_id) {
         console.log('Using tenant from profile:', profile.tenant_id);
         await cleanUp(profile.tenant_id);
         return;
      }
    }
    return;
  }

  const tenant = tenants[0];
  console.log('Found tenant:', tenant.name, 'ID:', tenant.id);
  await cleanUp(tenant.id);
}

async function cleanUp(tenantId) {
  if (!tenantId) return;

  console.log('Disconnecting calendar for tenant:', tenantId);
  const { error: secretsError } = await supabaseAdmin
    .from('tenant_secrets')
    .update({ 
      google_oauth_refresh_encrypted: null,
      google_calendar_id: null
    })
    .eq('tenant_id', tenantId);

  if (secretsError) console.error('Error updating tenant_secrets:', secretsError);
  else console.log('Successfully disconnected calendar.');

  console.log('Deleting test meetings for tenant:', tenantId);
  const { error: meetingsError } = await supabaseAdmin
    .from('meetings')
    .delete()
    .eq('tenant_id', tenantId);

  if (meetingsError) console.error('Error deleting meetings:', meetingsError);
  else console.log('Successfully deleted all meetings.');
}

main();
