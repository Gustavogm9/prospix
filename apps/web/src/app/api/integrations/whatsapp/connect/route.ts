import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, supabaseAdmin } from '../../../_lib/supabase-admin';
import {
  buildWahaWebhookUrl,
  createOrUpdateWahaSession,
  getWahaQrCode,
  loadTenantWhatsAppChannel,
  loadTenantWahaChannel,
} from '../../../_lib/whatsapp-provider';
import crypto from 'crypto';

const DEFAULT_WAHA_BASE_URL = 'https://waha-waha.qr4jgl.easypanel.host';

async function readRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    return await request.json();
  } catch (_err) {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  const { tenantId } = auth;

  try {
    const body = await readRequestBody(request);
    const requestedProvider = String(body.provider || '').toUpperCase();

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

    if (requestedProvider === 'WAHA') {
      const cleanSlug = tenant.slug.toLowerCase().replace(/[^a-z0-9]/g, '');
      const defaultInstanceName = `tenant_${cleanSlug}_waha`;
      let wahaChannel = await loadTenantWahaChannel(supabaseAdmin, tenantId);

      if (!wahaChannel) {
        const apiKey = process.env.WAHA_API_KEY || '';
        if (!apiKey) {
          return NextResponse.json(
            {
              error: 'CONFIGURATION_ERROR',
              message: 'WAHA ainda nao esta configurado para este tenant.',
            },
            { status: 500 }
          );
        }

        const { data: createdChannel, error: createChannelError } = await supabaseAdmin
          .from('whatsapp_channels')
          .insert({
            owner_type: 'TENANT',
            tenant_id: tenantId,
            provider: 'WAHA',
            label: `WAHA - ${tenant.name}`,
            base_url: process.env.WAHA_BASE_URL || DEFAULT_WAHA_BASE_URL,
            instance_name: defaultInstanceName,
            api_key_encrypted: apiKey,
            webhook_secret: crypto.randomBytes(32).toString('hex'),
            active: false,
            send_enabled: false,
            receive_enabled: false,
            connection_status: 'UNKNOWN',
            metadata: {
              role: 'candidate',
              created_by: 'tenant_waha_connect',
            },
          })
          .select('id')
          .maybeSingle();

        if (createChannelError || !createdChannel?.id) throw createChannelError;
        wahaChannel = await loadTenantWahaChannel(supabaseAdmin, tenantId);
      }

      if (!wahaChannel?.apiKey) {
        return NextResponse.json(
          {
            error: 'CONFIGURATION_ERROR',
            message: 'Chave WAHA ausente no canal candidato.',
          },
          { status: 500 }
        );
      }

      const webhookUrl = buildWahaWebhookUrl();
      if (!webhookUrl) {
        return NextResponse.json(
          {
            error: 'CONFIGURATION_ERROR',
            message: 'Webhook WAHA nao configurado.',
          },
          { status: 500 }
        );
      }

      await createOrUpdateWahaSession(wahaChannel, webhookUrl);
      const qrcode = await getWahaQrCode(wahaChannel);

      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({
          active: false,
          send_enabled: false,
          receive_enabled: false,
          connection_status: 'PENDING_QR',
          external_state: 'SCAN_QR_CODE',
          last_qr_requested_at: nowIso,
          last_checked_at: nowIso,
          last_error: null,
          metadata: {
            role: 'candidate',
            last_qr_requested_by: 'tenant_waha_connect',
            last_qr_requested_at: nowIso,
          },
        })
        .eq('id', wahaChannel.id);

      return NextResponse.json({
        provider: 'WAHA',
        mode: 'candidate',
        instanceName: wahaChannel.instanceName,
        qrcode,
      });
    }

    const activeChannel = await loadTenantWhatsAppChannel(supabaseAdmin, tenantId);
    if (activeChannel?.provider === 'WAHA') {
      if (!activeChannel.apiKey) {
        return NextResponse.json(
          {
            error: 'EXTERNAL_SERVICE_ERROR',
            message: 'WAHA API key is not configured for this WhatsApp channel',
          },
          { status: 500 }
        );
      }

      const webhookUrl = buildWahaWebhookUrl();
      if (!webhookUrl) {
        return NextResponse.json(
          {
            error: 'CONFIGURATION_ERROR',
            message: 'WAHA webhook URL is not configured',
          },
          { status: 500 }
        );
      }

      await createOrUpdateWahaSession(activeChannel, webhookUrl);
      const qrcode = await getWahaQrCode(activeChannel);

      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from('whatsapp_channels')
        .update({
          connection_status: 'PENDING_QR',
          external_state: 'SCAN_QR_CODE',
          last_qr_requested_at: nowIso,
          last_checked_at: nowIso,
          last_error: null,
        })
        .eq('id', activeChannel.id);

      const quarantineMinutesRaw = Number(process.env.WA_POST_RECONNECT_QUARANTINE_MINUTES || 60);
      const quarantineMinutes = Number.isFinite(quarantineMinutesRaw) && quarantineMinutesRaw >= 0 ? quarantineMinutesRaw : 60;
      await supabaseAdmin
        .from('whatsapp_guardian_status')
        .upsert(
          {
            tenant_id: tenantId,
            status: 'COLD',
            external_state: 'qr_requested',
            external_checked_at: nowIso,
            last_disconnect_reason_code: null,
            quarantined_until: new Date(Date.now() + quarantineMinutes * 60 * 1000).toISOString(),
            circuit_open_until: null,
            updated_at: nowIso,
          },
          { onConflict: 'tenant_id' }
        );

      return NextResponse.json({
        provider: 'WAHA',
        instanceName: activeChannel.instanceName,
        qrcode,
      });
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
    const quarantineMinutesRaw = Number(process.env.WA_POST_RECONNECT_QUARANTINE_MINUTES || 60);
    const quarantineMinutes = Number.isFinite(quarantineMinutesRaw) && quarantineMinutesRaw >= 0 ? quarantineMinutesRaw : 60;
    const nowIso = new Date().toISOString();
    const quarantinedUntil = new Date(Date.now() + quarantineMinutes * 60 * 1000).toISOString();
    const guardianPayload = {
      tenant_id: tenantId,
      status: 'COLD',
      external_state: 'qr_requested',
      external_checked_at: nowIso,
      last_disconnect_reason_code: null,
      quarantined_until: quarantinedUntil,
      circuit_open_until: null,
      updated_at: nowIso,
    };

    const { error: guardianErr } = await supabaseAdmin
      .from('whatsapp_guardian_status')
      .upsert(guardianPayload, { onConflict: 'tenant_id' });

    if (guardianErr) {
      await supabaseAdmin
        .from('whatsapp_guardian_status')
        .upsert({ tenant_id: tenantId, status: 'COLD', updated_at: nowIso }, { onConflict: 'tenant_id' });
    }

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
