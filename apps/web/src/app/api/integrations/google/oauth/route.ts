import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../../_lib/supabase-admin';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    // Generate CSRF state
    const state = crypto.randomBytes(16).toString('hex');

    // In production, store state in a KV/Redis. For now, embed tenantId in state.
    // The callback on the API server will validate this.
    const stateValue = `${tenantId}:${state}`;

    const redirectUri = `${process.env.API_URL || process.env.NEXT_PUBLIC_API_URL}/api/integrations/google/callback`;
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
        state: stateValue,
      }).toString();

    return NextResponse.json({ auth_url: authUrl });
  } catch (err) {
    console.error('Error generating Google OAuth URL:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to generate OAuth URL' },
      { status: 500 }
    );
  }
}
