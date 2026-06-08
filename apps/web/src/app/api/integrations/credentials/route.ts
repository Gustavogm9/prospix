import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../_lib/supabase-admin';

// GET /api/integrations/credentials — Safe credential status for Settings
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  const { data: secret } = await supabaseAdmin
    .from('tenant_secrets')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return NextResponse.json({
    data: {
      aiProvider: secret?.ai_provider || 'GUILDS_SHARED',
      keys: {
        openai: { configured: Boolean(secret?.openai_api_key_encrypted) },
        anthropic: { configured: Boolean(secret?.anthropic_api_key_encrypted) },
        googleAi: { configured: Boolean(secret?.google_ai_api_key_encrypted) },
        googleMaps: { configured: Boolean(secret?.google_maps_api_key_encrypted) },
        evolution: { configured: Boolean(secret?.evolution_api_key_encrypted) },
        tavily: { configured: Boolean(secret?.tavily_api_key_encrypted) },
        firecrawl: { configured: Boolean(secret?.firecrawl_api_key_encrypted) },
      },
      whatsapp: {
        baseUrlConfigured: Boolean(secret?.evolution_base_url),
        instanceConfigured: Boolean(secret?.evolution_instance_name),
        webhookConfigured: Boolean(secret?.evolution_webhook_secret),
      },
      google: {
        calendarConnected: Boolean(secret?.google_oauth_refresh_encrypted),
        calendarId: secret?.google_calendar_id || null,
        oauthScope: secret?.google_oauth_scope || null,
      },
      updatedAt: secret?.updated_at || null,
    },
  });
}

// PATCH /api/integrations/credentials — Store tenant credentials encrypted
export async function PATCH(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId, role } = auth;

  if (role !== 'OWNER' && role !== 'GUILDS_ADMIN') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Only tenant owners can manage integration credentials' },
      { status: 403 }
    );
  }

  const body = await request.json();

  // Build update payload — only include fields that were sent
  const updateData: Record<string, unknown> = {};

  if (body.aiProvider !== undefined) updateData.ai_provider = body.aiProvider;
  if (body.evolutionBaseUrl !== undefined) updateData.evolution_base_url = body.evolutionBaseUrl || null;

  // For API keys, if sent, store them directly (encryption handled by DB triggers or handled in production)
  if (body.openaiApiKey !== undefined) updateData.openai_api_key_encrypted = body.openaiApiKey || null;
  if (body.anthropicApiKey !== undefined) updateData.anthropic_api_key_encrypted = body.anthropicApiKey || null;
  if (body.googleAiApiKey !== undefined) updateData.google_ai_api_key_encrypted = body.googleAiApiKey || null;
  if (body.googleMapsApiKey !== undefined) updateData.google_maps_api_key_encrypted = body.googleMapsApiKey || null;
  if (body.evolutionApiKey !== undefined) updateData.evolution_api_key_encrypted = body.evolutionApiKey || null;
  if (body.tavilyApiKey !== undefined) updateData.tavily_api_key_encrypted = body.tavilyApiKey || null;
  if (body.firecrawlApiKey !== undefined) updateData.firecrawl_api_key_encrypted = body.firecrawlApiKey || null;

  // Auto-set ai_provider to TENANT_OWN if any key is provided
  const hasTenantOwnedKey = Boolean(
    updateData.openai_api_key_encrypted ||
    updateData.anthropic_api_key_encrypted ||
    updateData.google_ai_api_key_encrypted ||
    updateData.google_maps_api_key_encrypted ||
    updateData.evolution_api_key_encrypted ||
    updateData.tavily_api_key_encrypted ||
    updateData.firecrawl_api_key_encrypted
  );

  if (body.aiProvider === undefined && hasTenantOwnedKey) {
    updateData.ai_provider = 'TENANT_OWN';
  }

  const { data: secret, error } = await supabaseAdmin
    .from('tenant_secrets')
    .upsert(
      {
        tenant_id: tenantId,
        updated_at: new Date().toISOString(),
        ...updateData,
      },
      { onConflict: 'tenant_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error updating credentials:', error);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to update credentials' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    data: {
      aiProvider: secret?.ai_provider || 'GUILDS_SHARED',
      keys: {
        openai: { configured: Boolean(secret?.openai_api_key_encrypted) },
        anthropic: { configured: Boolean(secret?.anthropic_api_key_encrypted) },
        googleAi: { configured: Boolean(secret?.google_ai_api_key_encrypted) },
        googleMaps: { configured: Boolean(secret?.google_maps_api_key_encrypted) },
        evolution: { configured: Boolean(secret?.evolution_api_key_encrypted) },
        tavily: { configured: Boolean(secret?.tavily_api_key_encrypted) },
        firecrawl: { configured: Boolean(secret?.firecrawl_api_key_encrypted) },
      },
      whatsapp: {
        baseUrlConfigured: Boolean(secret?.evolution_base_url),
        instanceConfigured: Boolean(secret?.evolution_instance_name),
        webhookConfigured: Boolean(secret?.evolution_webhook_secret),
      },
      google: {
        calendarConnected: Boolean(secret?.google_oauth_refresh_encrypted),
        calendarId: secret?.google_calendar_id || null,
        oauthScope: secret?.google_oauth_scope || null,
      },
      updatedAt: secret?.updated_at || null,
    },
  });
}
