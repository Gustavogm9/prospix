import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '../../../_lib/supabase-admin';
import {
  getConfiguredAppOrigin,
  GOOGLE_OAUTH_NONCE_COOKIE,
  verifyGoogleOAuthState,
} from '@/lib/google-oauth-state';
import { encryptSecret } from '@/lib/secrets';

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set({
    name: GOOGLE_OAUTH_NONCE_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/integrations/google/callback',
    expires: new Date(0),
  });
  return response;
}

function oauthRedirect(origin: string, result: string) {
  return clearOAuthCookie(NextResponse.redirect(new URL(`/configuracoes?${result}`, origin)));
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  let origin: string;
  try {
    origin = getConfiguredAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  } catch {
    return clearOAuthCookie(
      NextResponse.json(
        { error: 'ConfigurationError', message: 'Integração Google indisponível.' },
        { status: 503 },
      ),
    );
  }

  if (error) {
    return oauthRedirect(origin, 'error=google_oauth_denied');
  }

  if (!code || !state) {
    return oauthRedirect(origin, 'error=missing_oauth_params');
  }

  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET;
  const nonce = request.cookies.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value;
  if (!stateSecret || !nonce) {
    return oauthRedirect(origin, 'error=invalid_oauth_state');
  }

  let tenantId: string;
  try {
    ({ tenantId } = verifyGoogleOAuthState(state, nonce, stateSecret));
  } catch {
    return oauthRedirect(origin, 'error=invalid_oauth_state');
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return oauthRedirect(origin, 'error=google_not_configured');
    }
    const redirectUri = `${origin}/api/integrations/google/callback`;

    // 1. Trocar o authorization code por access_token e refresh_token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });

    const tokenData: unknown = await tokenResponse.json();

    if (!tokenResponse.ok) {
      return oauthRedirect(origin, 'error=google_token_exchange_failed');
    }

    const refreshToken =
      tokenData &&
      typeof tokenData === 'object' &&
      'refresh_token' in tokenData &&
      typeof tokenData.refresh_token === 'string'
        ? tokenData.refresh_token
        : null;

    if (!refreshToken) {
      return oauthRedirect(origin, 'error=no_refresh_token');
    }

    // 2. Gravar o token no tenant_secrets
    const supabaseAdmin = getSupabaseAdmin();
    
    // Gravar o token no tenant_secrets com upsert para evitar erros de colunas inexistentes
    const { error: upsertError } = await supabaseAdmin
      .from('tenant_secrets')
      .upsert(
        {
          tenant_id: tenantId,
          google_oauth_refresh_encrypted: encryptSecret(refreshToken),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );

    if (upsertError) {
      console.error('Supabase Upsert Error:', upsertError);
      throw upsertError;
    }

    return oauthRedirect(origin, 'success=google_connected');
  } catch (err) {
    console.error('Callback OAuth error:', err);
    return oauthRedirect(origin, 'error=google_callback_failed');
  }
}
