import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../_lib/supabase-admin';

// POST /api/scripts/simulate — Simulate script response
// Proxies to the Fastify API
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  try {
    const body = await request.json();
    const token = request.headers.get('authorization') || '';
    const tenantId = auth.tenantId;

    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      return NextResponse.json(
        { error: 'Configuration Error', message: 'API_URL not configured' },
        { status: 500 }
      );
    }

    const res = await fetch(`${apiUrl}/v1/tenant/scripts/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('Error simulating script:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to simulate script' },
      { status: 500 }
    );
  }
}
