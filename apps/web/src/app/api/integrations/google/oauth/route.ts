import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../_lib/supabase-admin';
import {
  createGoogleOAuthState,
  getConfiguredAppOrigin,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_STATE_TTL_SECONDS,
} from '@/lib/google-oauth-state';

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'Usuário sem organização ativa.' },
      { status: 403 },
    );
  }

  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET;
    if (!clientId || !stateSecret) {
      return NextResponse.json(
        { error: 'ConfigurationError', message: 'Integração Google indisponível.' },
        { status: 503 },
      );
    }

    const { state, nonce } = createGoogleOAuthState(
      { tenantId, userId: auth.userId },
      stateSecret,
    );
    const origin = getConfiguredAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
    const redirectUri = `${origin}/api/integrations/google/callback`;
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
        state,
      }).toString();

    const response = NextResponse.json({ auth_url: authUrl });
    response.cookies.set({
      name: GOOGLE_OAUTH_NONCE_COOKIE,
      value: nonce,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations/google/callback',
      maxAge: GOOGLE_OAUTH_STATE_TTL_SECONDS,
    });
    return response;
  } catch (err) {
    console.error('Error generating Google OAuth URL:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to generate OAuth URL' },
      { status: 500 }
    );
  }
}
