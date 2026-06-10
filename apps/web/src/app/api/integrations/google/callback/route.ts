import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/supabase-admin';

export async function GET(request: NextRequest) {
  // O callback original na migração não foi portado. Estamos recriando.
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    console.error('Google OAuth Error:', error);
    return NextResponse.redirect(new URL('/configuracoes?error=google_oauth_denied', request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/configuracoes?error=missing_oauth_params', request.url));
  }

  // O state contém o tenantId injetado na rota de oauth: `${tenantId}:${randomHex}`
  const tenantId = state.split(':')[0];

  try {
    const origin = request.headers.get('x-forwarded-host') 
      ? `https://${request.headers.get('x-forwarded-host')}` 
      : request.nextUrl.origin;
    const redirectUri = `${origin}/api/integrations/google/callback`;

    // 1. Trocar o authorization code por access_token e refresh_token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error('Google token exchange failed:', tokenData);
      return NextResponse.redirect(new URL('/configuracoes?error=google_token_exchange_failed', request.url));
    }

    const { refresh_token } = tokenData;

    // Apenas continuamos se recebemos o refresh_token (necessário access_type: 'offline' e prompt: 'consent')
    if (!refresh_token) {
      console.error('No refresh token received. The user may have already granted access previously without revoking.');
      // Opcional: tentar forçar revogação ou aceitar e pedir pro usuário reconectar
      return NextResponse.redirect(new URL('/configuracoes?error=no_refresh_token', request.url));
    }

    // 2. Gravar o token no tenant_secrets
    const supabaseAdmin = getSupabaseAdmin();
    
    // Usamos um upsert padrão ou checagem como nos outros endpoints
    const { data: existingSecret } = await supabaseAdmin
      .from('tenant_secrets')
      .select('id')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (existingSecret) {
      const { error: updateError } = await supabaseAdmin
        .from('tenant_secrets')
        .update({
          google_oauth_refresh_encrypted: refresh_token,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);

      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('tenant_secrets')
        .insert({
          tenant_id: tenantId,
          google_oauth_refresh_encrypted: refresh_token,
          updated_at: new Date().toISOString(),
        });

      if (insertError) throw insertError;
    }

    // Redireciona de volta com sucesso
    return NextResponse.redirect(new URL('/configuracoes?success=google_connected', request.url));
  } catch (err) {
    console.error('Callback OAuth error:', err);
    return NextResponse.redirect(new URL('/configuracoes?error=google_callback_failed', request.url));
  }
}
