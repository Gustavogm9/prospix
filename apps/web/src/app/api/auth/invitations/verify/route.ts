import { NextRequest, NextResponse } from 'next/server';

// POST /api/auth/invitations/verify — Verify invitation code (no auth required)
// Proxies to the Fastify API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (!apiUrl) {
      return NextResponse.json(
        { error: 'Configuration Error', message: 'API_URL not configured' },
        { status: 500 }
      );
    }

    const res = await fetch(`${apiUrl}/v1/auth/invitations/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('Error verifying invitation:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to verify invitation' },
      { status: 500 }
    );
  }
}
