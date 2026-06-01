import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../_lib/supabase-admin';

// POST /api/notifications/push-subscription — Store web push subscription
// NOTE: In production this should store to Redis. For now, this is a no-op ack.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  // Proxy to the Fastify API which has Redis
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) {
    try {
      const body = await request.json();
      const token = request.headers.get('authorization') || '';
      await fetch(`${apiUrl}/v1/tenant/notifications/push-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error('Error forwarding push subscription:', err);
    }
  }

  return NextResponse.json({ success: true });
}
