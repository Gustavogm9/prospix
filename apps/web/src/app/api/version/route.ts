import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Returns the Vercel commit SHA to indicate the current build version
  // If not on Vercel, returns 'dev'
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev'
  });
}
