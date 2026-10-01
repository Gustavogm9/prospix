// supabase/functions/discover-leads/index.ts
// ProspIX — Supabase Edge Function: MASTER Lead Discovery Engine
// Receives a POST with tenant_id, campaign_id, source_type, and config.
// Routes to the appropriate discovery handler, deduplicates, inserts leads, logs events.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isAuthorizedWorkerRequest } from "../_shared/worker-auth.ts";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// User-Agent padrão para scraping (simula navegador real)
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ── Tipos ───────────────────────────────────────────────────────────────────
type SourceType =
  | "GOOGLE_MAPS"
  | "CNPJ_MINER"
  | "DOCTORALIA"
  | "COMPRASNET"
  | "VIVAREAL"
  | "CRM_SP"
  | "OAB_SP"
  | "CRO_SP"
  | "TAVILY_B2B_SEARCH";

interface DiscoverRequest {
  tenant_id: string;
  campaign_id: string;
  run_id?: string;
  source_type: SourceType;
  config: {
    search_tags?: string[];
    cities?: string[];
    state?: string;
    daily_limit?: number;
    profession?: string;
    min_google_rating?: number;
    min_reviews?: number;
  };
}

interface DiscoveredLead {
  name: string;
  whatsapp: string | null;
  source: string;
  address: { city?: string; state?: string; full?: string };
  metadata: Record<string, any>;
  profession?: string;
  website?: string;
  google_rating?: number | null;
  google_reviews_count?: number | null;
  provisional_eligible?: boolean;
  provider_usage_event_id?: string | null;
  search_usage_event_id?: string | null;
}

interface DiscoveryContext {
  tenantId: string;
  campaignId: string;
  runId: string;
  sourceType: SourceType;
}

type UsageGate = { event_id?: string; should_stop?: boolean; stop_reason?: string | null };

interface DiscoverResult {
  ok: boolean;
  source_type: string;
  leads_found: number;
  leads_inserted: number;
  leads_skipped_duplicate: number;
  errors?: string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function envCostMicros(name: string): number {
  const parsed = Number(Deno.env.get(name) || "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

class ProspectingControlError extends Error {}

async function recordProviderCall(params: {
  context: DiscoveryContext;
  provider: string;
  service: string;
  operation: string;
  idempotencyKey: string;
  status: "ATTEMPTED" | "SUCCEEDED" | "FAILED";
  estimatedCostMicros?: number;
  externalRequestId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<UsageGate> {
  const { data, error } = await supabase.rpc("record_provider_usage_event", {
    p_tenant_id: params.context.tenantId,
    p_campaign_id: params.context.campaignId,
    p_lead_id: null,
    p_prospecting_run_id: params.context.runId,
    p_provider: params.provider,
    p_service: params.service,
    p_operation: params.operation,
    p_source_type: params.context.sourceType,
    p_status: params.status,
    p_quantity: 1,
    p_unit: "request",
    p_estimated_cost_micros: params.estimatedCostMicros || 0,
    p_external_request_id: params.externalRequestId || null,
    p_idempotency_key: params.idempotencyKey,
    p_metadata: params.metadata || {},
  });
  if (error) throw new ProspectingControlError(`Nao foi possivel registrar o consumo do provedor (${error.code || "RPC"})`);
  return (data || {}) as UsageGate;
}

async function fetchAndRecordProviderCall(params: {
  context: DiscoveryContext;
  url: string;
  fetchOptions?: RequestInit;
  timeoutMs?: number;
  provider: string;
  service: string;
  operation: string;
  idempotencyKey: string;
  estimatedCostMicros: number;
}): Promise<{ response: Response; gate: UsageGate }> {
  await recordProviderCall({
    context: params.context,
    provider: params.provider,
    service: params.service,
    operation: params.operation,
    idempotencyKey: params.idempotencyKey,
    status: "ATTEMPTED",
    estimatedCostMicros: params.estimatedCostMicros,
  });

  let response: Response;
  try {
    response = await safeFetch(params.url, params.fetchOptions || {}, params.timeoutMs);
  } catch {
    const gate = await recordProviderCall({
      context: params.context,
      provider: params.provider,
      service: params.service,
      operation: params.operation,
      idempotencyKey: params.idempotencyKey,
      status: "FAILED",
      estimatedCostMicros: params.estimatedCostMicros,
      metadata: { network_error: true },
    });
    if (gate.should_stop) {
      throw new ProspectingControlError(gate.stop_reason || "PROSPECTING_BUDGET_STOPPED");
    }
    throw new Error("PROVIDER_NETWORK_ERROR");
  }

  const gate = await recordProviderCall({
    context: params.context,
    provider: params.provider,
    service: params.service,
    operation: params.operation,
    idempotencyKey: params.idempotencyKey,
    status: response.ok ? "SUCCEEDED" : "FAILED",
    estimatedCostMicros: params.estimatedCostMicros,
    externalRequestId: response.headers.get("x-request-id"),
    metadata: { http_status: response.status },
  });
  return { response, gate };
}

async function recordRunCandidate(
  context: DiscoveryContext,
  eligible: boolean,
): Promise<UsageGate> {
  const { data, error } = await supabase.rpc("update_prospecting_run_progress", {
    p_run_id: context.runId,
    p_discovered_delta: 1,
    p_eligible_delta: eligible ? 1 : 0,
  });
  if (error) throw new ProspectingControlError(`Nao foi possivel atualizar o limite da execucao (${error.code || "RPC"})`);
  return (data || {}) as UsageGate;
}

/**
 * Remove acentos de uma string (para gerar URL slugs).
 * Ex: "São José do Rio Preto" → "Sao Jose do Rio Preto"
 */
function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Converte string para slug de URL.
 * Ex: "São José do Rio Preto" → "sao-jose-do-rio-preto"
 */
function toSlug(str: string): string {
  return removeAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/**
 * Normaliza telefones brasileiros para o formato +55XXXXXXXXXXX.
 * Aceita vários formatos: (11) 99999-9999, 11999999999, +5511999999999, etc.
 * Retorna null se não conseguir normalizar.
 */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Remove tudo que não é dígito
  let digits = raw.replace(/\D/g, "");

  // Se começa com 0, remove o zero (ex: 011 → 11)
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  // Se já tem o código do país (55), normaliza
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    return `+${digits}`;
  }

  // Telefone com DDD (10 ou 11 dígitos): adiciona +55
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  // Telefone sem DDD (8 ou 9 dígitos) — não é possível normalizar sem DDD
  if (digits.length === 8 || digits.length === 9) {
    // Sem DDD, não podemos garantir o número correto
    return null;
  }

  // Formato já completo com +55
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+${digits}`;
  }

  return null;
}

/**
 * Extrai números de telefone de um texto HTML usando regex.
 * Busca padrões brasileiros: (XX) XXXX-XXXX, (XX) XXXXX-XXXX, etc.
 */
function extractPhonesFromText(text: string): string[] {
  const patterns = [
    // (11) 99999-9999 ou (11) 9999-9999
    /\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4}/g,
    // +55 11 99999-9999
    /\+?55\s*\(?\d{2}\)?\s*\d{4,5}[-.\s]?\d{4}/g,
    // 11999999999 (sequência contínua)
    /(?<!\d)\d{10,11}(?!\d)/g,
  ];

  const found = new Set<string>();
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const m of matches) {
      const normalized = normalizePhone(m);
      if (normalized) found.add(normalized);
    }
  }
  return [...found];
}

/**
 * Fetch com timeout e User-Agent de navegador.
 */
async function safeFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        ...options.headers,
      },
    });
    clearTimeout(id);
    return resp;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Formata data no padrão YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Retorna data de N dias atrás.
 */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATION & INSERTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Verifica quais telefones já existem na tabela leads para o tenant.
 * Retorna telefone, id e campanha dos leads já cadastrados.
 */
async function getExistingPhones(
  tenantId: string,
  phones: string[]
): Promise<Map<string, { id: string; campaignId: string | null }>> {
  if (phones.length === 0) return new Map();

  // Consulta em lotes de 50 para não estourar limites
  const existing = new Map<string, { id: string; campaignId: string | null }>();
  const batchSize = 50;
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    const { data } = await supabase
      .from("leads")
      .select("id, whatsapp, campaign_id")
      .eq("tenant_id", tenantId)
      .in("whatsapp", batch);
    if (data) {
      for (const row of data) {
        if (row.whatsapp) existing.set(row.whatsapp, {
          id: row.id,
          campaignId: row.campaign_id || null,
        });
      }
    }
  }
  return existing;
}

async function linkProviderUsageToLead(params: {
  tenantId: string;
  campaignId: string;
  leadId: string;
  usageEventId?: string | null;
}): Promise<void> {
  if (!params.usageEventId) return;
  const { data, error } = await supabase
    .from("provider_usage_events")
    .update({ lead_id: params.leadId })
    .eq("id", params.usageEventId)
    .eq("tenant_id", params.tenantId)
    .eq("campaign_id", params.campaignId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new ProspectingControlError(`Nao foi possivel atribuir consumo ao lead (${error?.code || "DB"})`);
  }
}

/**
 * Insere leads novos e registra eventos de captura.
 * Retorna contadores de inseridos e duplicados.
 */
async function insertLeads(
  tenantId: string,
  campaignId: string,
  sourceType: string,
  leads: DiscoveredLead[]
): Promise<{ inserted: number; skipped: number }> {
  if (leads.length === 0) return { inserted: 0, skipped: 0 };

  // Coleta todos os telefones válidos para checar duplicatas
  const phonesMap = new Map<string, DiscoveredLead>();
  const leadsWithoutPhone: DiscoveredLead[] = [];

  for (const lead of leads) {
    if (lead.whatsapp) {
      // Se dois leads têm o mesmo telefone, mantém o primeiro
      if (!phonesMap.has(lead.whatsapp)) {
        phonesMap.set(lead.whatsapp, lead);
      }
    } else {
      leadsWithoutPhone.push(lead);
    }
  }

  // Verifica quais já existem no banco
  const existingPhones = await getExistingPhones(tenantId, [...phonesMap.keys()]);

  let inserted = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  // Insere leads com telefone (que não são duplicatas)
  for (const [phone, lead] of phonesMap) {
    if (existingPhones.has(phone)) {
      const existingLead = existingPhones.get(phone)!;
      if (existingLead.campaignId === campaignId) {
        await linkProviderUsageToLead({
          tenantId,
          campaignId,
          leadId: existingLead.id,
          usageEventId: lead.provider_usage_event_id,
        });
      }
      skipped++;
      console.log('  Lead duplicado ignorado.');
      continue;
    }

    try {
      const { data: insertedLead, error } = await supabase
        .from("leads")
        .insert({
          tenant_id: tenantId,
          campaign_id: campaignId,
          name: lead.name,
          whatsapp: lead.whatsapp,
          source: lead.source,
          status: "CAPTURED",
          address: lead.address,
          metadata: {
            ...lead.metadata,
            website: lead.website || null,
            discovery_provider_usage_event_id: lead.provider_usage_event_id || null,
            discovery_search_usage_event_id: lead.search_usage_event_id || null,
          },
          profession: lead.profession || null,
          google_rating: lead.google_rating ?? null,
          google_reviews_count: lead.google_reviews_count ?? null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        console.error('  Erro ao inserir lead com telefone.', { code: error.code });
        continue;
      }

      await linkProviderUsageToLead({
        tenantId,
        campaignId,
        leadId: insertedLead.id,
        usageEventId: lead.provider_usage_event_id,
      });

      // Registra evento de captura
      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: insertedLead.id,
        event_type: "lead_captured",
        payload: {
          source: lead.source,
          source_type: sourceType,
          city: lead.address?.city,
          state: lead.address?.state,
          profession: lead.profession || null,
          reason: `Lead capturado via ${sourceType}`,
          raw_metadata_keys: Object.keys(lead.metadata || {}),
        },
        created_at: now,
      });

      inserted++;
      console.log(`  Lead inserido: ${insertedLead.id}`);

    } catch (error) {
      if (error instanceof ProspectingControlError) throw error;
      console.error('  Erro inesperado ao inserir lead com telefone.');
    }
  }

  // Insere leads sem telefone (profissionais de conselhos, etc.)
  // Esses leads precisarão de enriquecimento posterior
  for (const lead of leadsWithoutPhone) {
    try {
      const { data: insertedLead, error } = await supabase
        .from("leads")
        .insert({
          tenant_id: tenantId,
          campaign_id: campaignId,
          name: lead.name,
          whatsapp: null,
          source: lead.source,
          status: "CAPTURED",
          address: lead.address,
          metadata: {
            ...lead.metadata,
            website: lead.website || null,
            discovery_provider_usage_event_id: lead.provider_usage_event_id || null,
            discovery_search_usage_event_id: lead.search_usage_event_id || null,
          },
          profession: lead.profession || null,
          google_rating: lead.google_rating ?? null,
          google_reviews_count: lead.google_reviews_count ?? null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        console.error('  Erro ao inserir lead sem telefone.', { code: error.code });
        continue;
      }


      await linkProviderUsageToLead({
        tenantId,
        campaignId,
        leadId: insertedLead.id,
        usageEventId: lead.provider_usage_event_id,
      });

      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: insertedLead.id,
        event_type: "lead_captured",
        payload: {
          source: lead.source,
          source_type: sourceType,
          city: lead.address?.city,
          state: lead.address?.state,
          profession: lead.profession || null,
          needs_enrichment: true,
          reason: `Lead capturado via ${sourceType} — sem telefone, precisa enriquecimento`,
        },
        created_at: now,
      });

      inserted++;
      console.log(`  Lead sem telefone inserido: ${insertedLead.id}`);
    } catch (error) {
      if (error instanceof ProspectingControlError) throw error;
      console.error('  Erro inesperado ao inserir lead sem telefone.');
    }
  }

  return { inserted, skipped };
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 1: GOOGLE MAPS (Places API)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverGoogleMaps(
  tenantId: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🗺️ Google Maps: Iniciando busca...");

  // Carrega API key do tenant
  const { data: secrets } = await supabase
    .from("tenant_secrets")
    .select("google_maps_api_key_encrypted")
    .eq("tenant_id", tenantId)
    .single();

  const apiKey = secrets?.google_maps_api_key_encrypted;
  if (!apiKey) {
    throw new Error("Google Maps API Key não configurada para este tenant");
  }

  const tags = config.search_tags || [];
  const cities = config.cities || [];
  const dailyLimit = config.daily_limit || 20;
  const textSearchCostMicros = envCostMicros("GOOGLE_MAPS_TEXT_SEARCH_COST_MICROS");
  const placeDetailsCostMicros = envCostMicros("GOOGLE_MAPS_PLACE_DETAILS_COST_MICROS");
  if (tags.length === 0 || cities.length === 0) {
    throw new Error("Google Maps discovery requires at least one search tag and city");
  }
  if (textSearchCostMicros <= 0 || placeDetailsCostMicros <= 0) {
    throw new Error("Google Maps cost estimates must be configured before discovery");
  }
  const leads: DiscoveredLead[] = [];
  let budgetStopped = false;

  for (const [cityIndex, city] of cities.entries()) {
    for (const [tagIndex, tag] of tags.entries()) {
      if (leads.length >= dailyLimit || budgetStopped) break;

      const query = `${tag} em ${city}`;
      console.log(`  Executando busca Google Maps ${cityIndex + 1}/${cities.length}, termo ${tagIndex + 1}/${tags.length}`);

      try {
        // Text Search para encontrar estabelecimentos
        const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
        searchUrl.searchParams.set("query", query);
        searchUrl.searchParams.set("key", apiKey);
        searchUrl.searchParams.set("language", "pt-BR");
        searchUrl.searchParams.set("type", "establishment");

        const textSearchKey = `maps-text:${context.runId}:${cityIndex}:${tagIndex}`;
        const { response: searchResp, gate: textSearchGate } = await fetchAndRecordProviderCall({
          context,
          url: searchUrl.toString(),
          provider: "GOOGLE_MAPS",
          service: "PLACES_API",
          operation: "TEXT_SEARCH",
          idempotencyKey: textSearchKey,
          estimatedCostMicros: textSearchCostMicros,
        });
        if (textSearchGate.should_stop) {
          budgetStopped = true;
          break;
        }
        if (!searchResp.ok) {
          console.error(`  ❌ Text Search falhou: HTTP ${searchResp.status}`);
          continue;
        }

        const searchData = await searchResp.json();
        if (searchData.status !== "OK" && searchData.status !== "ZERO_RESULTS") {
          await recordProviderCall({
            context,
            provider: "GOOGLE_MAPS",
            service: "PLACES_API",
            operation: "TEXT_SEARCH",
            idempotencyKey: textSearchKey,
            status: "FAILED",
            estimatedCostMicros: textSearchCostMicros,
            metadata: { provider_status: String(searchData.status || "UNKNOWN") },
          });
          console.error(`  ❌ Text Search status: ${searchData.status} — ${searchData.error_message || ""}`);
          continue;
        }

        const results = searchData.results || [];
        console.log(`  Google Maps retornou ${results.length} resultados`);

        for (const place of results) {
          if (leads.length >= dailyLimit || budgetStopped) break;

          try {
            // Rate limit: 200ms entre requests
            await sleep(200);

            // Place Details para obter telefone, website, etc.
            const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
            detailsUrl.searchParams.set("place_id", place.place_id);
            detailsUrl.searchParams.set("fields", "formatted_phone_number,international_phone_number,website,rating,user_ratings_total,address_components");
            detailsUrl.searchParams.set("key", apiKey);

            const detailUsageKey = `maps-detail:${context.runId}:${place.place_id}`;
            const { response: detailsResp, gate: detailsGate } = await fetchAndRecordProviderCall({
              context,
              url: detailsUrl.toString(),
              provider: "GOOGLE_MAPS",
              service: "PLACES_API",
              operation: "PLACE_DETAILS",
              idempotencyKey: detailUsageKey,
              estimatedCostMicros: placeDetailsCostMicros,
            });
            if (detailsGate.should_stop) {
              budgetStopped = true;
              break;
            }
            if (!detailsResp.ok) continue;

            const detailsData = await detailsResp.json();
            if (detailsData.status !== "OK") {
              await recordProviderCall({
                context,
                provider: "GOOGLE_MAPS",
                service: "PLACES_API",
                operation: "PLACE_DETAILS",
                idempotencyKey: detailUsageKey,
                status: "FAILED",
                estimatedCostMicros: placeDetailsCostMicros,
                metadata: { provider_status: String(detailsData.status || "UNKNOWN") },
              });
              continue;
            }
            const detail = detailsData.result || {};

            // Extrai telefone e normaliza
            const rawPhone = detail.international_phone_number || detail.formatted_phone_number;
            const phone = normalizePhone(rawPhone);

            // Extrai cidade e estado dos address_components
            let placeCity = city;
            let placeState = config.state || "";
            if (detail.address_components) {
              for (const comp of detail.address_components) {
                if (comp.types?.includes("administrative_area_level_2")) {
                  placeCity = comp.long_name;
                }
                if (comp.types?.includes("administrative_area_level_1")) {
                  placeState = comp.short_name;
                }
              }
            }

            const rating = Number(detail.rating || place.rating || 0);
            const reviews = Number(detail.user_ratings_total || place.user_ratings_total || 0);
            const provisionalEligible = Boolean(phone) &&
              rating >= Number(config.min_google_rating || 0) &&
              reviews >= Number(config.min_reviews || 0);

            leads.push({
              name: place.name || "Sem nome",
              whatsapp: phone,
              source: "GOOGLE_MAPS",
              website: detail.website || null,
              profession: config.profession,
              google_rating: rating || null,
              google_reviews_count: reviews || null,
              provisional_eligible: provisionalEligible,
              provider_usage_event_id: detailsGate.event_id || null,
              search_usage_event_id: textSearchGate.event_id || null,
              address: {
                city: placeCity,
                state: placeState,
                full: place.formatted_address || "",
              },
              metadata: {
                google_place_id: place.place_id,
                google_rating: detail.rating || place.rating || null,
                google_reviews_count: detail.user_ratings_total || null,
                website: detail.website || null,
                search_tag: tag,
                search_city: city,
              },
            });
            const candidateGate = await recordRunCandidate(context, provisionalEligible);
            if (candidateGate.should_stop) {
              budgetStopped = true;
              break;
            }
          } catch (error) {
            if (error instanceof ProspectingControlError) throw error;
            console.error('  Falha ao processar detalhe de um resultado do Google Maps.');
          }
        }
      } catch (error) {
        if (error instanceof ProspectingControlError) throw error;
        console.error('  Falha na busca Google Maps.');
      }
    }
  }

  console.log(`🗺️ Google Maps: ${leads.length} leads encontrados`);
  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 2: CNPJ MINER (CNPJá API)
// ══════════════════════════════════════════════════════════════════════════════

// Mapeamento profissão → CNAEs relevantes
const PROFESSION_CNAE_MAP: Record<string, string[]> = {
  DOCTOR: ["8610-1", "8630-5", "8630-5/01", "8630-5/02", "8630-5/03", "8630-5/04"],
  DENTIST: ["8630-5/04", "8611-8"],
  LAWYER: ["6911-7", "6911-7/01", "6911-7/02", "6911-7/03"],
  ACCOUNTANT: ["6920-6", "6920-6/01", "6920-6/02"],
  VETERINARIAN: ["7500-1"],
  PSYCHOLOGIST: ["8650-0/04"],
  NUTRITIONIST: ["8650-0/05"],
  PHYSIOTHERAPIST: ["8650-0/06"],
  ARCHITECT: ["7111-1"],
  ENGINEER: ["7112-0"],
};

async function discoverCnpjMiner(
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🏭 CNPJ Miner: Iniciando busca...");

  const cnpjaKey = Deno.env.get("CNPJA_API_KEY");
  if (!cnpjaKey) {
    throw new Error(
      "CNPJA_API_KEY não configurada — configure a variável de ambiente CNPJA_API_KEY no Supabase (Settings > Edge Functions > Secrets) com sua chave da API CNPJá (https://cnpja.com)"
    );
  }

  const cities = config.cities || [];
  const dailyLimit = config.daily_limit || 20;
  const profession = config.profession;
  const leads: DiscoveredLead[] = [];
  const requestCostMicros = envCostMicros("CNPJA_SEARCH_COST_MICROS");
  if (requestCostMicros <= 0) {
    throw new Error("CNPJa cost estimate must be configured before discovery");
  }
  let budgetStopped = false;

  // Data de 30 dias atrás para buscar empresas recém-abertas
  const thirtyDaysAgo = formatDate(daysAgo(30));

  for (const [cityIndex, city] of cities.entries()) {
    if (leads.length >= dailyLimit || budgetStopped) break;

    console.log(`  🔍 Buscando empresas novas em: ${city}`);

    try {
      const params = new URLSearchParams({
        "founded.after": thirtyDaysAgo,
        "address.municipality.in": city,
        "status.id.in": "2", // Status 2 = Ativa
        "limit": String(Math.min(dailyLimit - leads.length, 20)),
      });

      // Filtra por CNAE se tiver profissão definida
      if (profession && PROFESSION_CNAE_MAP[profession]) {
        params.set("mainActivity.id.in", PROFESSION_CNAE_MAP[profession].join(","));
      }

      const { response: resp, gate: usageGate } = await fetchAndRecordProviderCall({
        context,
        url: `https://api.cnpja.com/office?${params}`,
        fetchOptions: {
          headers: {
            Authorization: cnpjaKey,
            "Content-Type": "application/json",
          },
        },
        provider: "CNPJA",
        service: "OFFICE_API",
        operation: "SEARCH",
        idempotencyKey: `cnpja-search:${context.runId}:${cityIndex}`,
        estimatedCostMicros: requestCostMicros,
      });
      if (usageGate.should_stop) {
        budgetStopped = true;
        break;
      }

      if (!resp.ok) {
        console.error(`  ❌ CNPJá API falhou: HTTP ${resp.status}`);
        const errBody = await resp.text();
        console.error(`  → ${errBody.slice(0, 200)}`);
        continue;
      }

      const data = await resp.json();
      const records = data.records || [];
      console.log(`  📊 ${records.length} empresas encontradas em ${city}`);

      for (const rec of records) {
        if (leads.length >= dailyLimit) break;

        const name = rec.alias || rec.company?.name || "Sem nome";
        const rawPhone =
          rec.phones?.[0]?.number ||
          rec.address?.phone ||
          rec.phone ||
          null;
        const phone = normalizePhone(rawPhone);

        leads.push({
          name,
          whatsapp: phone,
          source: "CNPJ_MINER",
          address: {
            city: rec.address?.municipality || city,
            state: rec.address?.state || config.state || "",
            full: [
              rec.address?.street,
              rec.address?.number,
              rec.address?.district,
              rec.address?.municipality,
              rec.address?.state,
            ]
              .filter(Boolean)
              .join(", "),
          },
          metadata: {
            cnpj: rec.taxId?.replace(/\D/g, "") || null,
            razao_social: rec.company?.name || null,
            nome_fantasia: rec.alias || null,
            cnae_principal: rec.mainActivity?.id || null,
            cnae_descricao: rec.mainActivity?.text || null,
            data_abertura: rec.founded || null,
            raw_phone: rawPhone,
            capital_social: rec.company?.equity || null,
            porte: rec.company?.size?.text || null,
            socios: (rec.company?.members || []).map((m: any) => ({
              nome: m.person?.name || "",
              qualificacao: m.role?.text || "",
            })),
          },
          profession: profession || undefined,
        });
        const candidateGate = await recordRunCandidate(context, Boolean(phone));
        if (candidateGate.should_stop) {
          budgetStopped = true;
          break;
        }
      }
    } catch (err: any) {
      if (err instanceof ProspectingControlError) throw err;
      console.error(`  💥 Erro ao buscar em ${city}: ${err.message}`);
    }
  }

  console.log(`🏭 CNPJ Miner: ${leads.length} leads encontrados`);
  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 3: DOCTORALIA (Web Scraping)
// ══════════════════════════════════════════════════════════════════════════════

// Doctoralia ONLY works for medical professions. Map professions to valid URL slugs.
const DOCTORALIA_SPECIALTY_SLUGS: Record<string, string[]> = {
  DOCTOR: [
    "cardiologista", "dermatologista", "endocrinologista", "gastroenterologista",
    "ginecologista", "neurologista", "oftalmologista", "ortopedista",
    "otorrinolaringologista", "pediatra", "psiquiatra", "urologista",
    "clinico-geral", "geriatra", "nefrologista", "pneumologista",
    "reumatologista", "oncologista", "hematologista", "infectologista",
    "cirurgiao-plastico", "angiologista", "proctologista", "medico",
  ],
  DENTIST: [
    "dentista", "ortodontista", "implantodontista", "endodontista",
    "periodontista", "odontopediatra", "cirurgiao-dentista",
  ],
};

// Map common Portuguese search tags to Doctoralia-compatible slugs
const DOCTORALIA_TAG_SLUG_MAP: Record<string, string> = {
  "médico": "clinico-geral",
  "medico": "clinico-geral",
  "clínico geral": "clinico-geral",
  "clinico geral": "clinico-geral",
  "cardiologista": "cardiologista",
  "dermatologista": "dermatologista",
  "endocrinologista": "endocrinologista",
  "gastroenterologista": "gastroenterologista",
  "ginecologista": "ginecologista",
  "neurologista": "neurologista",
  "oftalmologista": "oftalmologista",
  "ortopedista": "ortopedista",
  "otorrinolaringologista": "otorrinolaringologista",
  "pediatra": "pediatra",
  "psiquiatra": "psiquiatra",
  "urologista": "urologista",
  "geriatra": "geriatra",
  "nefrologista": "nefrologista",
  "pneumologista": "pneumologista",
  "reumatologista": "reumatologista",
  "oncologista": "oncologista",
  "hematologista": "hematologista",
  "infectologista": "infectologista",
  "cirurgião plástico": "cirurgiao-plastico",
  "cirurgiao plastico": "cirurgiao-plastico",
  "angiologista": "angiologista",
  "proctologista": "proctologista",
  "dentista": "dentista",
  "ortodontista": "ortodontista",
  "implantodontista": "implantodontista",
  "endodontista": "endodontista",
  "periodontista": "periodontista",
  "odontopediatra": "odontopediatra",
  "cirurgião dentista": "cirurgiao-dentista",
  "cirurgiao dentista": "cirurgiao-dentista",
};

async function discoverDoctoralia(
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🩺 Doctoralia: Iniciando busca...");

  // Doctoralia ONLY works for medical professions (DOCTOR / DENTIST)
  const profession = config.profession || "";
  const allowedProfessions = ["DOCTOR", "DENTIST"];
  if (!allowedProfessions.includes(profession)) {
    throw new Error(
      `Doctoralia disponível apenas para profissões médicas (DOCTOR, DENTIST). ` +
      `Profissão recebida: '${profession || "nenhuma"}'. ` +
      `Para outras profissões, use fontes como CNPJ_MINER, OAB_SP, etc.`
    );
  }

  const tags = config.search_tags || [];
  const cities = config.cities || [];
  const dailyLimit = config.daily_limit || 20;
  const leads: DiscoveredLead[] = [];
  let budgetStopped = false;

  // If no tags provided, use default specialties for the profession
  const validSlugs = DOCTORALIA_SPECIALTY_SLUGS[profession] || [];
  let effectiveTags = tags.length > 0 ? tags : validSlugs.slice(0, 3);

  // Map tags to valid Doctoralia slugs
  effectiveTags = effectiveTags.map((tag) => {
    const lower = tag.toLowerCase().trim();
    // Check if it's already a known slug
    if (validSlugs.includes(lower)) return lower;
    // Check the mapping table
    if (DOCTORALIA_TAG_SLUG_MAP[lower]) return DOCTORALIA_TAG_SLUG_MAP[lower];
    // Try to slugify directly and check if valid
    const slugged = toSlug(tag);
    if (validSlugs.includes(slugged)) return slugged;
    // Fallback: use the slug as-is (it may still work on Doctoralia)
    return slugged;
  });

  console.log(`  📋 Profissão: ${profession}, Tags mapeadas: [${effectiveTags.join(", ")}]`);

  for (const [cityIndex, city] of cities.entries()) {
    for (const [tagIndex, specialtySlug] of effectiveTags.entries()) {
      if (leads.length >= dailyLimit || budgetStopped) break;

      const citySlug = toSlug(city);
      const url = `https://www.doctoralia.com.br/${specialtySlug}/${citySlug}`;

      console.log(`  🔍 Scraping: ${url}`);

      try {
        // Rate limit: 3 segundos entre requests para evitar ban
        await sleep(3000);

        const { response: resp, gate: usageGate } = await fetchAndRecordProviderCall({
          context,
          url,
          timeoutMs: 20000,
          provider: "DOCTORALIA",
          service: "PUBLIC_WEB",
          operation: "SEARCH_PAGE",
          idempotencyKey: `doctoralia:${context.runId}:${cityIndex}:${tagIndex}`,
          estimatedCostMicros: 0,
        });
        if (usageGate.should_stop) {
          budgetStopped = true;
          break;
        }
        if (!resp.ok) {
          console.error(`  ❌ Doctoralia retornou HTTP ${resp.status} para ${url}`);
          if (resp.status === 404) {
            console.warn(`  ⚠️ Slug '${specialtySlug}' inválido para Doctoralia — pulando`);
          }
          continue;
        }

        const html = await resp.text();
        console.log(`  📄 HTML recebido: ${html.length} bytes`);

        // Extrai telefones do HTML
        const phones = extractPhonesFromText(html);

        // Strategy 1: Extract from data-doctor-name attributes
        const dataNameRegex = /data-doctor-name=["']([^"']+)["']/gi;
        const doctorNames: string[] = [];
        let nameMatch;
        while ((nameMatch = dataNameRegex.exec(html)) !== null) {
          const name = nameMatch[1].trim();
          if (name.length > 3 && name.length < 100) doctorNames.push(name);
        }

        // Strategy 2: Extract from h2/h3 tags with professional name patterns
        const doctorNameRegex =
          /<(?:h2|h3)[^>]*class="[^"]*(?:doctor|name|professional)[^"]*"[^>]*>([^<]+)</gi;
        while ((nameMatch = doctorNameRegex.exec(html)) !== null) {
          doctorNames.push(nameMatch[1].trim());
        }

        // Strategy 3: Extract from itemprop="name" (structured data)
        const nameMatches = html.match(
          /itemprop=["']name["'][^>]*>([^<]+)</gi
        ) || [];
        for (const m of nameMatches) {
          const clean = m.replace(/itemprop=["']name["'][^>]*>/i, "").trim();
          if (clean && clean.length > 3 && clean.length < 100) {
            if (/^(Dr\.?|Dra\.?)\s/i.test(clean) || doctorNames.length === 0) {
              doctorNames.push(clean);
            }
          }
        }

        // Strategy 4: Extract from <a> tags with doctor profile links
        const profileLinkRegex = /href="[^"]*\/(?:medico|dentista)\/[^"]*"[^>]*>\s*(?:<[^>]*>)*\s*(Dr\.?a?\s+[^<]{3,60})/gi;
        while ((nameMatch = profileLinkRegex.exec(html)) !== null) {
          const name = nameMatch[1].replace(/<[^>]*>/g, "").trim();
          if (name.length > 3) doctorNames.push(name);
        }

        // Strategy 5: JSON-LD structured data
        const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let jsonLdMatch;
        while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
          try {
            const jsonData = JSON.parse(jsonLdMatch[1]);
            const items = Array.isArray(jsonData) ? jsonData : [jsonData];
            for (const item of items) {
              if (item["@type"] === "Physician" || item["@type"] === "Dentist" || item["@type"] === "MedicalBusiness") {
                if (item.name) doctorNames.push(item.name);
              }
              // Also check itemListElement
              if (item.itemListElement) {
                for (const el of item.itemListElement) {
                  if (el.item?.name) doctorNames.push(el.item.name);
                }
              }
            }
          } catch (_) { /* ignore malformed JSON-LD */ }
        }

        // Strategy 6: Brute-force — extract any <h2> or <h3> text that looks like a person name
        const h2h3Regex = /<(?:h2|h3)[^>]*>\s*(?:<[^>]*>\s*)*((?:Dr\.?a?\s+)?[A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de?|dos?|das?|e|[A-ZÀ-Ú])[a-zà-ú]*)*(?:\s+[A-ZÀ-Ú][a-zà-ú]+)+)/gi;
        while ((nameMatch = h2h3Regex.exec(html)) !== null) {
          const name = nameMatch[1].replace(/<[^>]*>/g, "").trim();
          if (name.length > 5 && name.length < 80 && name.includes(" ")) {
            doctorNames.push(name);
          }
        }

        // Strategy 7: Extract from <a> tags with data-ga-label or title containing doctor names
        const gaLabelRegex = /(?:data-ga-label|title)=["']((?:Dr\.?a?\s+)?[A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-Za-zÀ-ú]+){1,6})["']/gi;
        while ((nameMatch = gaLabelRegex.exec(html)) !== null) {
          const name = nameMatch[1].trim();
          if (name.length > 5 && name.length < 80 && /^(Dr\.?|Dra\.?)\s/i.test(name)) {
            doctorNames.push(name);
          }
        }

        // Strategy 8: Look for any text matching "Dr(a). Name" pattern in the body
        const drPatternRegex = />(Dr\.?a?\.\s+[A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de?|dos?|das?|e|[A-ZÀ-Ú])[a-zà-ú]*)*(?:\s+[A-ZÀ-Ú][a-zà-ú]+)*)</gi;
        while ((nameMatch = drPatternRegex.exec(html)) !== null) {
          const name = nameMatch[1].trim();
          if (name.length > 5 && name.length < 80) {
            doctorNames.push(name);
          }
        }

        console.log(`  🔬 Estratégias: data-attr=${doctorNames.filter(n => n.startsWith("Dr")).length}, total bruto=${doctorNames.length}`);

        // Remove duplicatas de nomes
        const uniqueNames = [...new Set(doctorNames)];

        console.log(
          `  📋 ${uniqueNames.length} profissionais e ${phones.length} telefones encontrados`
        );

        // Cria leads combinando nomes com telefones (quando possível)
        for (let i = 0; i < uniqueNames.length && leads.length < dailyLimit; i++) {
          const docName = uniqueNames[i];
          const phone = phones[i] || null;

          leads.push({
            name: docName,
            whatsapp: phone,
            source: "DOCTORALIA",
            address: {
              city: city,
              state: config.state || "",
            },
            metadata: {
              specialty: specialtySlug,
              doctoralia_url: url,
              scrape_date: new Date().toISOString(),
            },
            profession: profession,
          });
          const candidateGate = await recordRunCandidate(context, Boolean(phone));
          if (candidateGate.should_stop) {
            budgetStopped = true;
            break;
          }
        }
      } catch (err: any) {
        if (err instanceof ProspectingControlError) throw err;
        console.error(`  💥 Erro ao scrape Doctoralia (${url}): ${err.message}`);
      }
    }
    if (budgetStopped) break;
  }

  console.log(`🩺 Doctoralia: ${leads.length} leads encontrados`);
  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 4: COMPRASNET (Licitações — Portal Nacional de Contratações Públicas)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverComprasnet(
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🏛️ ComprasNet/PNCP: Iniciando busca...");

  const state = config.state || "SP";
  const dailyLimit = config.daily_limit || 20;
  const leads: DiscoveredLead[] = [];

  const thirtyDaysAgo = formatDate(daysAgo(30));
  const today = formatDate(new Date());

  // Tenta a API principal do PNCP
  try {
    const pncpUrl = new URL("https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao");
    pncpUrl.searchParams.set("dataInicial", thirtyDaysAgo);
    pncpUrl.searchParams.set("dataFinal", today);
    pncpUrl.searchParams.set("uf", state);
    pncpUrl.searchParams.set("pagina", "1");
    pncpUrl.searchParams.set("tamanhoPagina", String(dailyLimit));

    console.log(`  🔍 Consultando PNCP: ${pncpUrl}`);

    const { response: resp, gate: usageGate } = await fetchAndRecordProviderCall({
      context,
      url: pncpUrl.toString(),
      fetchOptions: { headers: { Accept: "application/json" } },
      timeoutMs: 20000,
      provider: "OTHER",
      service: "PNCP_PUBLIC_API",
      operation: "SEARCH",
      idempotencyKey: `pncp-primary:${context.runId}`,
      estimatedCostMicros: 0,
    });
    if (usageGate.should_stop) return leads;

    if (resp.ok) {
      const rawText = await resp.text();
      console.log(`  PNCP resposta recebida: ${rawText.length} bytes`);

      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch (_) {
        console.warn(`  ⚠️ PNCP não retornou JSON válido`);
        data = {};
      }

      // Handle various response shapes from the PNCP API
      let items: any[] = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.data && Array.isArray(data.data)) {
        items = data.data;
      } else if (data.resultado && Array.isArray(data.resultado)) {
        items = data.resultado;
      } else if (data.items && Array.isArray(data.items)) {
        items = data.items;
      } else if (data.contratacoes && Array.isArray(data.contratacoes)) {
        items = data.contratacoes;
      } else {
        // Try to find any array property in the response
        for (const key of Object.keys(data)) {
          if (Array.isArray(data[key]) && data[key].length > 0) {
            items = data[key];
            console.log(`  📌 Usando propriedade '${key}' como lista de contratações`);
            break;
          }
        }
      }

      console.log(`  📊 ${items.length} contratações encontradas`);

      for (const contract of items) {
        if (leads.length >= dailyLimit) break;

        const companyName =
          contract.nomeRazaoSocialFornecedor ||
          contract.razaoSocial ||
          contract.orgaoEntidade?.razaoSocial ||
          "Empresa não identificada";

        const cnpj =
          contract.cnpjFornecedor ||
          contract.cnpj ||
          null;

        leads.push({
          name: companyName,
          whatsapp: null, // ComprasNet geralmente não tem telefone
          source: "COMPRASNET",
          address: {
            city: contract.municipio || "",
            state: state,
          },
          metadata: {
            cnpj: cnpj,
            valor_contrato: contract.valorTotalEstimado || contract.valorInicial || null,
            objeto: contract.objetoCompra || contract.objeto || null,
            numero_controle: contract.numeroControlePNCP || null,
            data_publicacao: contract.dataPublicacaoPncp || contract.dataPublicacao || null,
            modalidade: contract.modalidadeNome || null,
            orgao: contract.orgaoEntidade?.razaoSocial || null,
            // Empresas com contratos governamentais precisam de Seguro Garantia
            seguro_sugerido: "SEGURO_GARANTIA",
            scrape_date: new Date().toISOString(),
          },
        });
        const candidateGate = await recordRunCandidate(context, false);
        if (candidateGate.should_stop) return leads;
      }
    } else {
      console.warn(`  ⚠️ PNCP retornou HTTP ${resp.status}, tentando API alternativa...`);
    }
  } catch (err: any) {
    if (err instanceof ProspectingControlError) throw err;
    console.error(`  ⚠️ PNCP falhou: ${err.message}. Tentando API alternativa...`);
  }

  // API alternativa (dados.gov.br) caso a principal falhe
  if (leads.length === 0) {
    try {
      const sixMonthsAgo = formatDate(daysAgo(180));
      const altUrl = `https://api-compras.dados.gov.br/contratos?uf_contratado=${state}&data_inicio_vigencia_min=${sixMonthsAgo}&offset=0&limit=${dailyLimit}`;

      console.log(`  🔍 Tentando API alternativa: dados.gov.br`);

      const { response: resp, gate: usageGate } = await fetchAndRecordProviderCall({
        context,
        url: altUrl,
        fetchOptions: { headers: { Accept: "application/json" } },
        timeoutMs: 20000,
        provider: "OTHER",
        service: "DADOS_GOV_BR_COMPRAS",
        operation: "SEARCH",
        idempotencyKey: `pncp-alternative:${context.runId}`,
        estimatedCostMicros: 0,
      });
      if (usageGate.should_stop) return leads;

      if (resp.ok) {
        const data = await resp.json();
        const items = data._embedded?.contratos || data || [];
        const contractList = Array.isArray(items) ? items : [];

        console.log(`  📊 ${contractList.length} contratos encontrados (dados.gov.br)`);

        for (const contract of contractList) {
          if (leads.length >= dailyLimit) break;

          leads.push({
            name: contract.fornecedor?.nome || "Empresa não identificada",
            whatsapp: null,
            source: "COMPRASNET",
            address: {
              city: contract.fornecedor?.municipio || "",
              state: state,
            },
            metadata: {
              cnpj: contract.fornecedor?.cnpj_cpf_idgener || null,
              valor_contrato: contract.valor_inicial || null,
              objeto: contract.objeto || null,
              uasg: contract.uasg || null,
              seguro_sugerido: "SEGURO_GARANTIA",
              source_api: "dados.gov.br",
              scrape_date: new Date().toISOString(),
            },
          });
          const candidateGate = await recordRunCandidate(context, false);
          if (candidateGate.should_stop) return leads;
        }
      } else {
        console.error(`  ❌ API alternativa também falhou: HTTP ${resp.status}`);
      }
    } catch (err: any) {
      if (err instanceof ProspectingControlError) throw err;
      console.error(`  💥 Erro na API alternativa: ${err.message}`);
    }
  }

  console.log(`🏛️ ComprasNet: ${leads.length} leads encontrados`);
  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 5: VIVAREAL (Imobiliário — Seguro Fiança Locatícia)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverVivaReal(
  tenant_id: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🏠 VivaReal: Fonte bloqueada por Cloudflare. Fazendo fallback para Tavily B2B Search...");
  return discoverTavily(tenant_id, {
    ...config,
    profession: "imobiliária ou corretor de imóveis",
    search_tags: ["imobiliária", "corretor de imóveis", "venda de imóveis"]
  }, context);
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 6: CRM_SP (Conselho Regional de Medicina — Médicos)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverCrmSp(
  tenant_id: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("⚕️ CRM-SP: Fonte bloqueada (WAF/CAPTCHA). Fazendo fallback para Tavily B2B Search...");
  return discoverTavily(tenant_id, {
    ...config,
    profession: "médico ou clínica médica",
    search_tags: ["médico", "clínica médica", "consultório médico"]
  }, context);
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 7: OAB_SP (Cadastro Nacional de Advogados)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverOabSp(
  tenant_id: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("⚖️ OAB-SP: SPA/API bloqueada. Fazendo fallback para Tavily B2B Search...");
  return discoverTavily(tenant_id, {
    ...config,
    profession: "advogado ou escritório de advocacia",
    search_tags: ["advogado", "escritório de advocacia", "advocacia"]
  }, context);
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 8: CRO_SP (Conselho Regional de Odontologia — Dentistas)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverCroSp(
  tenant_id: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🦷 CRO-SP: WAF bloqueando. Fazendo fallback para Tavily B2B Search...");
  return discoverTavily(tenant_id, {
    ...config,
    profession: "dentista ou clínica odontológica",
    search_tags: ["dentista", "clínica odontológica", "consultório odontológico"]
  }, context);
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 9: TAVILY_B2B_SEARCH
// ══════════════════════════════════════════════════════════════════════════════

async function discoverTavily(
  tenant_id: string,
  config: DiscoverRequest["config"],
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  console.log("🌐 Tavily: Iniciando busca...");

  const { data: secrets } = await supabase
    .from("tenant_secrets")
    .select("tavily_api_key_encrypted")
    .eq("tenant_id", tenant_id)
    .single();

  const tavilyKey = secrets?.tavily_api_key_encrypted;
  if (!tavilyKey) {
    throw new Error("API key do Tavily não configurada neste tenant.");
  }

  const cities = config.cities || [];
  const tags = config.search_tags || [];
  const dailyLimit = config.daily_limit || 10;
  const leads: DiscoveredLead[] = [];
  const requestCostMicros = envCostMicros("TAVILY_SEARCH_COST_MICROS");
  if (requestCostMicros <= 0) {
    throw new Error("Tavily cost estimate must be configured before discovery");
  }
  let budgetStopped = false;

  for (const [cityIndex, city] of cities.entries()) {
    if (leads.length >= dailyLimit || budgetStopped) break;
    const queryStr = tags.length > 0 ? tags.join(" OR ") : config.profession || "empresas";
    const searchQuery = `"${queryStr}" em ${city} brasil contato whatsapp`;

    try {
      const { response: resp, gate: usageGate } = await fetchAndRecordProviderCall({
        context,
        url: "https://api.tavily.com/search",
        fetchOptions: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: searchQuery,
            search_depth: "basic",
            include_answer: false,
            include_raw_content: false,
            max_results: Math.max(5, dailyLimit - leads.length),
          }),
        },
        provider: "TAVILY",
        service: "SEARCH_API",
        operation: "BASIC_SEARCH",
        idempotencyKey: `tavily:${context.runId}:${cityIndex}`,
        estimatedCostMicros: requestCostMicros,
      });
      if (usageGate.should_stop) {
        budgetStopped = true;
        break;
      }

      // Increment usage
      await supabase.rpc("increment_tenant_usage", {
        p_tenant_id: tenant_id,
        p_tavily_calls: 1,
      });

      if (!resp.ok) {
        console.error(`  ❌ Tavily falhou: HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      const results = data.results || [];
      console.log(`  📊 ${results.length} resultados no Tavily para ${city}`);

      for (const res of results) {
        if (leads.length >= dailyLimit) break;

        leads.push({
          name: res.title?.slice(0, 50) || "Lead (Tavily)",
          whatsapp: null,
          source: "TAVILY_B2B_SEARCH",
          address: { city },
          website: res.url,
          metadata: {
            tavily_content: res.content?.slice(0, 500),
            search_query: searchQuery,
            scrape_date: new Date().toISOString(),
          },
        });
        const candidateGate = await recordRunCandidate(context, false);
        if (candidateGate.should_stop) {
          budgetStopped = true;
          break;
        }
      }
    } catch (err: any) {
      if (err instanceof ProspectingControlError) throw err;
      console.error(`  💥 Erro no Tavily: ${err.message}`);
    }
  }

  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER — Mapeia source_type para o handler correto
// ══════════════════════════════════════════════════════════════════════════════

async function routeDiscovery(
  request: DiscoverRequest,
  context: DiscoveryContext,
): Promise<DiscoveredLead[]> {
  const { tenant_id, source_type, config } = request;

  switch (source_type) {
    case "GOOGLE_MAPS":
      return discoverGoogleMaps(tenant_id, config, context);
    case "CNPJ_MINER":
      return discoverCnpjMiner(config, context);
    case "DOCTORALIA":
      return discoverDoctoralia(config, context);
    case "COMPRASNET":
      return discoverComprasnet(config, context);
    case "VIVAREAL":
      return discoverVivaReal(tenant_id, config, context);
    case "CRM_SP":
      return discoverCrmSp(tenant_id, config, context);
    case "OAB_SP":
      return discoverOabSp(tenant_id, config, context);
    case "CRO_SP":
      return discoverCroSp(tenant_id, config, context);
    case "TAVILY_B2B_SEARCH":
      return discoverTavily(tenant_id, config, context);
    default:
      throw new Error(`source_type desconhecido: ${source_type}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

const VALID_SOURCES: SourceType[] = [
  "GOOGLE_MAPS", "CNPJ_MINER", "DOCTORALIA", "COMPRASNET",
  "VIVAREAL", "CRM_SP", "OAB_SP", "CRO_SP", "TAVILY_B2B_SEARCH",
];

type CampaignConfigRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  profession: string | null;
  filters: Record<string, any> | null;
  cities: string[] | null;
  state: string | null;
  search_tags: string[] | null;
  capture_sources: string[] | null;
  daily_limit: number;
  discovery_auto_enabled: boolean;
  homologation_mode: boolean;
  icps?: { min_google_rating?: number | null; min_reviews?: number | null } | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function campaignDiscoveryConfig(campaign: CampaignConfigRow, limit: number): DiscoverRequest["config"] {
  const fallbackTerms = campaign.filters?.search_terms?.[campaign.profession || ""];
  return {
    cities: campaign.cities?.length ? campaign.cities : (campaign.filters?.cities || []),
    state: campaign.state || "SP",
    search_tags: campaign.search_tags?.length ? campaign.search_tags : (Array.isArray(fallbackTerms) ? fallbackTerms : []),
    profession: campaign.profession || undefined,
    daily_limit: Math.min(Math.max(limit || 1, 1), 100),
    min_google_rating: Number(campaign.icps?.min_google_rating ?? campaign.filters?.min_google_rating ?? 0),
    min_reviews: Number(campaign.icps?.min_reviews ?? campaign.filters?.min_reviews ?? 0),
  };
}

function brtDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function executeDiscoveryRun(params: {
  campaign: CampaignConfigRow;
  sourceType: SourceType;
  runId: string;
  limit: number;
}): Promise<DiscoverResult & { run_id: string; status: string }> {
  const config = campaignDiscoveryConfig(params.campaign, params.limit);
  const context: DiscoveryContext = {
    tenantId: params.campaign.tenant_id,
    campaignId: params.campaign.id,
    runId: params.runId,
    sourceType: params.sourceType,
  };

  await supabase.from("prospecting_runs").update({
    status: "RUNNING",
    started_at: new Date().toISOString(),
  }).eq("id", params.runId).eq("status", "QUEUED");

  try {
    const discoveredLeads = await routeDiscovery({
      tenant_id: params.campaign.tenant_id,
      campaign_id: params.campaign.id,
      run_id: params.runId,
      source_type: params.sourceType,
      config,
    }, context);
    const { inserted, skipped } = await insertLeads(
      params.campaign.tenant_id,
      params.campaign.id,
      params.sourceType,
      discoveredLeads,
    );
    const { data: currentRun } = await supabase
      .from("prospecting_runs")
      .select("status")
      .eq("id", params.runId)
      .single();
    const status = currentRun?.status === "STOPPED_BUDGET" ? "STOPPED_BUDGET" : "SUCCEEDED";
    await supabase.rpc("finish_prospecting_run", {
      p_run_id: params.runId,
      p_status: status,
      p_discovered_count: discoveredLeads.length,
      p_inserted_count: inserted,
      p_duplicate_count: skipped,
      p_eligible_count: discoveredLeads.filter((lead) => lead.provisional_eligible ?? Boolean(lead.whatsapp)).length,
      p_error_code: null,
      p_error_message: null,
    });
    return {
      ok: true,
      run_id: params.runId,
      status,
      source_type: params.sourceType,
      leads_found: discoveredLeads.length,
      leads_inserted: inserted,
      leads_skipped_duplicate: skipped,
    };
  } catch (error) {
    const code = "DISCOVERY_PROVIDER_ERROR";
    const { data: failedRun } = await supabase
      .from("prospecting_runs")
      .select("status, stop_reason, discovered_count, inserted_count, duplicate_count, eligible_count")
      .eq("id", params.runId)
      .maybeSingle();
    const finalStatus = failedRun?.status === "STOPPED_BUDGET" ? "STOPPED_BUDGET" : "FAILED";
    const discoveredCount = Math.max(0, Number(failedRun?.discovered_count || 0));
    const insertedCount = Math.max(0, Number(failedRun?.inserted_count || 0));
    const duplicateCount = Math.max(0, Number(failedRun?.duplicate_count || 0));
    const eligibleCount = Math.max(0, Number(failedRun?.eligible_count || 0));
    await supabase.rpc("finish_prospecting_run", {
      p_run_id: params.runId,
      p_status: finalStatus,
      p_discovered_count: discoveredCount,
      p_inserted_count: insertedCount,
      p_duplicate_count: duplicateCount,
      p_eligible_count: eligibleCount,
      p_error_code: code,
      p_error_message: error instanceof Error ? error.message : code,
    });
    console.error("[discover] run failed", { runId: params.runId, source: params.sourceType, code });
    return {
      ok: false,
      run_id: params.runId,
      status: finalStatus,
      source_type: params.sourceType,
      leads_found: discoveredCount,
      leads_inserted: insertedCount,
      leads_skipped_duplicate: duplicateCount,
      errors: [code],
    };
  }
}

serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  if (!isAuthorizedWorkerRequest(req, {
    serviceRoleKey: SUPABASE_KEY,
    supabaseUrl: SUPABASE_URL,
    cronSecret: Deno.env.get("CRON_SECRET") || "",
  })) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const body = await req.json() as Record<string, any>;
    if (body.auto_mode === true) {
      const { data: activeCampaigns, error } = await supabase
        .from("campaigns")
        .select("id, tenant_id, name, status, profession, filters, cities, state, search_tags, capture_sources, daily_limit, discovery_auto_enabled, homologation_mode, icps:icp_id(min_google_rating,min_reviews)")
        .eq("status", "ACTIVE")
        .eq("discovery_auto_enabled", true);
      if (error) throw error;

      const results: unknown[] = [];
      for (const rawCampaign of activeCampaigns || []) {
        const campaign = rawCampaign as CampaignConfigRow;
        const scheduledSources = campaign.homologation_mode
          ? (campaign.capture_sources || []).slice(0, 1)
          : (campaign.capture_sources || []);
        for (const rawSource of scheduledSources) {
          const sourceType = String(rawSource).toUpperCase() as SourceType;
          if (!VALID_SOURCES.includes(sourceType)) continue;
          const idempotencyKey = `cron:${brtDateKey()}:${campaign.id}:${sourceType}`;
          const config = campaignDiscoveryConfig(campaign, campaign.daily_limit);
          const { data: gate, error: gateError } = await supabase.rpc("begin_scheduled_prospecting_run", {
            p_tenant_id: campaign.tenant_id,
            p_campaign_id: campaign.id,
            p_source_type: sourceType,
            p_idempotency_key: idempotencyKey,
            p_requested_limit: campaign.daily_limit,
            p_config: config,
          });
          if (gateError || !gate?.ok || gate?.replayed) {
            results.push({ campaign_id: campaign.id, source_type: sourceType, status: gate?.code || gate?.status || "SKIPPED" });
            continue;
          }
          results.push(await executeDiscoveryRun({
            campaign,
            sourceType,
            runId: gate.run_id,
            limit: gate.effective_limit,
          }));
        }
      }
      return jsonResponse({ ok: true, results });
    }

    const { tenant_id, campaign_id, source_type, run_id } = body as DiscoverRequest;
    const headerRunId = req.headers.get("x-prospix-discovery-run");
    if (!tenant_id || !campaign_id || !run_id || headerRunId !== run_id || !VALID_SOURCES.includes(source_type)) {
      return jsonResponse({ ok: false, error: "INVALID_RUN_SCOPE" }, 400);
    }

    const { data: run, error: runError } = await supabase
      .from("prospecting_runs")
      .select("id, tenant_id, campaign_id, source_type, requested_limit, status")
      .eq("id", run_id)
      .eq("tenant_id", tenant_id)
      .eq("campaign_id", campaign_id)
      .eq("source_type", source_type)
      .in("status", ["QUEUED", "RUNNING"])
      .single();
    if (runError || !run) return jsonResponse({ ok: false, error: "RUN_NOT_AUTHORIZED" }, 403);

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, tenant_id, name, status, profession, filters, cities, state, search_tags, capture_sources, daily_limit, discovery_auto_enabled, homologation_mode, icps:icp_id(min_google_rating,min_reviews)")
      .eq("id", campaign_id)
      .eq("tenant_id", tenant_id)
      .eq("status", "ACTIVE")
      .single();
    if (campaignError || !campaign || !(campaign.capture_sources || []).includes(source_type)) {
      await supabase.rpc("finish_prospecting_run", {
        p_run_id: run_id,
        p_status: "SKIPPED",
        p_discovered_count: 0,
        p_inserted_count: 0,
        p_duplicate_count: 0,
        p_eligible_count: 0,
        p_error_code: "DISCOVERY_CAMPAIGN_NOT_ACTIVE",
        p_error_message: "Campaign is not active or source is disabled",
      });
      return jsonResponse({ ok: false, error: "DISCOVERY_CAMPAIGN_NOT_ACTIVE" }, 409);
    }

    const result = await executeDiscoveryRun({
      campaign: campaign as CampaignConfigRow,
      sourceType: source_type,
      runId: run_id,
      limit: run.requested_limit,
    });
    return jsonResponse(result, result.ok ? 200 : 502);
  } catch (error) {
    console.error("[discover] fatal", { code: "DISCOVERY_INTERNAL_ERROR" });
    return jsonResponse({ ok: false, error: "DISCOVERY_INTERNAL_ERROR" }, 500);
  }
});
