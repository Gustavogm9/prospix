// supabase/functions/webhook-inbound/index.ts
// ProspIX — Supabase Edge Function: Public Webhook for Inbound Leads
// Receives POST from external forms (Typeform, Elementor, RD Station, etc.)
// and creates leads automatically.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CORS Headers ────────────────────────────────────────────────────────────
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize Brazilian phone: strip non-digits, ensure +55XXXXXXXXXXX format */
function normalizePhone(raw: string): string {
  let phone = raw.replace(/\D/g, "");
  // Remove any WhatsApp suffixes
  phone = phone.replace(/@.*$/, "");
  // If already has 55 prefix with valid length
  if (phone.startsWith("55") && phone.length >= 12) return `+${phone}`;
  // If just DDD + number (10 or 11 digits)
  if (phone.length === 11 || phone.length === 10) return `+55${phone}`;
  // If 8 or 9 digits (no DDD), can't normalize properly, return as-is with +55
  if (phone.length >= 8) return `+55${phone}`;
  return phone;
}

/** Basic UUID v4 regex check */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Webhook Handler
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  // ── CORS preflight ─────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed. Use POST." }, 405);
  }

  try {
    // ── Extract query parameters ───────────────────────────────
    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id");
    const apiKey = url.searchParams.get("api_key");

    if (!tenantId || !isValidUUID(tenantId)) {
      return jsonResponse(
        { ok: false, error: "Missing or invalid tenant_id query parameter." },
        400
      );
    }

    // ── Validate tenant exists ─────────────────────────────────
    const { data: tenant, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("id", tenantId)
      .single();

    if (tenantErr || !tenant) {
      return jsonResponse({ ok: false, error: "Tenant not found." }, 404);
    }

    // ── Validate API key (optional security layer) ─────────────
    const { data: tenantSecret } = await supabase
      .from("tenant_secrets")
      .select("webhook_api_key")
      .eq("tenant_id", tenantId)
      .single();

    // If the tenant has a webhook_api_key configured, enforce it
    if (tenantSecret?.webhook_api_key) {
      if (!apiKey || apiKey !== tenantSecret.webhook_api_key) {
        return jsonResponse(
          { ok: false, error: "Invalid or missing api_key." },
          401
        );
      }
    }
    // If no key is configured, accept the request (easy onboarding)

    // ── Parse request body ─────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { ok: false, error: "Invalid JSON body." },
        400
      );
    }

    const name = String(body.name || body.nome || "").trim();
    const rawPhone = String(body.phone || body.telefone || body.whatsapp || body.celular || "").trim();
    const email = String(body.email || body.e_mail || "").trim();
    const company = String(body.company || body.empresa || "").trim();
    const message = String(body.message || body.mensagem || body.observacao || "").trim();
    const sourceTag = String(body.source_tag || body.fonte || body.utm_source || "webhook").trim();

    // ── Validate required fields ───────────────────────────────
    if (!name) {
      return jsonResponse(
        { ok: false, error: "Missing required field: name (or nome)." },
        400
      );
    }
    if (!rawPhone) {
      return jsonResponse(
        { ok: false, error: "Missing required field: phone (or telefone/whatsapp/celular)." },
        400
      );
    }

    // ── Normalize phone ────────────────────────────────────────
    const phone = normalizePhone(rawPhone);

    if (phone.replace(/\D/g, "").length < 10) {
      return jsonResponse(
        { ok: false, error: "Invalid phone number. Must have at least 10 digits." },
        400
      );
    }

    console.log(`📩 Webhook inbound: ${name} | ${phone} | tenant=${tenantId}`);

    // ── Check for duplicate lead by phone ──────────────────────
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id, name, status")
      .eq("tenant_id", tenantId)
      .eq("whatsapp", phone)
      .single();

    if (existingLead) {
      console.log(`  ⚠️ Duplicate lead: ${existingLead.id} (${existingLead.name})`);

      // Still log the event so the tenant knows about the attempt
      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: existingLead.id,
        event_type: "webhook_duplicate",
        payload: {
          source_tag: sourceTag,
          form_data: { name, phone, email, company, message },
          reason: `Lead já existente recebido novamente via webhook (${sourceTag})`,
        },
        created_at: new Date().toISOString(),
      });

      return jsonResponse({
        ok: true,
        lead_id: existingLead.id,
        duplicate: true,
        message: "Lead already exists with this phone number.",
      });
    }

    // ── Insert new lead ────────────────────────────────────────
    const now = new Date().toISOString();
    const { data: newLead, error: insertErr } = await supabase
      .from("leads")
      .insert({
        tenant_id: tenantId,
        name,
        whatsapp: phone,
        source: "LANDING_PAGE",
        status: "CAPTURED",
        metadata: {
          email: email || undefined,
          company: company || undefined,
          message: message || undefined,
          source_tag: sourceTag,
          webhook_received_at: now,
        },
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (insertErr || !newLead) {
      console.error("  ❌ Failed to insert lead:", insertErr?.message);
      return jsonResponse(
        { ok: false, error: "Failed to create lead. " + (insertErr?.message || "") },
        500
      );
    }

    console.log(`  ✅ Lead created: ${newLead.id}`);

    // ── Insert lead_event ──────────────────────────────────────
    await supabase.from("lead_events").insert({
      tenant_id: tenantId,
      lead_id: newLead.id,
      event_type: "lead_captured",
      payload: {
        source: "LANDING_PAGE",
        source_tag: sourceTag,
        channel: "webhook",
        form_data: {
          name,
          phone,
          email: email || null,
          company: company || null,
          message: message || null,
        },
        reason: `Lead capturado via webhook inbound (${sourceTag})`,
      },
      created_at: now,
    });

    return jsonResponse({
      ok: true,
      lead_id: newLead.id,
      duplicate: false,
      message: "Lead created successfully.",
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("💥 Webhook inbound error:", errorMessage);
    return jsonResponse(
      { ok: false, error: "Internal server error." },
      500
    );
  }
});
