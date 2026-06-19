import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    // Get tenant info for slug
    const { data: tenant, error: tenantErr } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();

    if (tenantErr) throw tenantErr;
    if (!tenant) {
      return NextResponse.json({ error: 'NotFound', message: 'Tenant not found' }, { status: 404 });
    }

    let { data: secretRecord } = await supabaseAdmin
      .from('tenant_secrets')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const cleanSlug = tenant.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
    const defaultInstanceName = `tenant_${cleanSlug}`;

    if (!secretRecord) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('tenant_secrets')
        .insert({
          tenant_id: tenantId,
          evolution_instance_name: defaultInstanceName,
          evolution_webhook_secret: crypto.randomBytes(16).toString('hex'),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (createErr) throw createErr;
      secretRecord = created;
    } else if (!secretRecord.evolution_instance_name) {
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('tenant_secrets')
        .update({
          evolution_instance_name: defaultInstanceName,
          evolution_webhook_secret: secretRecord.evolution_webhook_secret || crypto.randomBytes(16).toString('hex'),
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (updateErr) throw updateErr;
      secretRecord = updated;
    }

    const instanceName = secretRecord!.evolution_instance_name!;
    const baseUrl = secretRecord!.evolution_base_url || process.env.EVOLUTION_BASE_URL;
    const apiKey = secretRecord!.evolution_api_key_encrypted || process.env.EVOLUTION_GUILDS_API_KEY || '';

    // Create instance on Evolution API
    await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });

    // Configure webhook
    const webhookUrl = `${process.env.API_URL || process.env.NEXT_PUBLIC_API_URL}/v1/webhooks/evolution`;


    await fetch(`${baseUrl}/webhook/set/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      }),
    });

    // Get QR Code
    const qrRes = await fetch(`${baseUrl}/instance/connect/${instanceName}`, {
      headers: { apikey: apiKey },
    });

    if (!qrRes.ok) {
      return NextResponse.json(
        {
          error: 'EXTERNAL_SERVICE_ERROR',
          message: 'Failed to retrieve WhatsApp pairing QR Code from Evolution API',
        },
        { status: 500 }
      );
    }

    const qrData = await qrRes.json();

    return NextResponse.json({
      instanceName,
      qrcode: qrData.base64,
    });
  } catch (err) {
    console.error('Error connecting WhatsApp integration:', err);
    return NextResponse.json(
      { error: 'InternalServerError', message: 'Failed to process WhatsApp integration request' },
      { status: 500 }
    );
  }
}
