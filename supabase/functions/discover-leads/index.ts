// supabase/functions/discover-leads/index.ts
// ProspIX — Supabase Edge Function: MASTER Lead Discovery Engine
// Receives a POST with tenant_id, campaign_id, source_type, and config.
// Routes to the appropriate discovery handler, deduplicates, inserts leads, logs events.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  | "CRO_SP";

interface DiscoverRequest {
  tenant_id: string;
  campaign_id: string;
  source_type: SourceType;
  config: {
    search_tags?: string[];
    cities?: string[];
    state?: string;
    daily_limit?: number;
    profession?: string;
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
}

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
 * Retorna um Set com os telefones já cadastrados.
 */
async function getExistingPhones(
  tenantId: string,
  phones: string[]
): Promise<Set<string>> {
  if (phones.length === 0) return new Set();

  // Consulta em lotes de 50 para não estourar limites
  const existing = new Set<string>();
  const batchSize = 50;
  for (let i = 0; i < phones.length; i += batchSize) {
    const batch = phones.slice(i, i + batchSize);
    const { data } = await supabase
      .from("leads")
      .select("whatsapp")
      .eq("tenant_id", tenantId)
      .in("whatsapp", batch);
    if (data) {
      for (const row of data) {
        if (row.whatsapp) existing.add(row.whatsapp);
      }
    }
  }
  return existing;
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
      skipped++;
      console.log(`  ⏭️ Duplicata: ${lead.name} (${phone})`);
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
          metadata: { ...lead.metadata, website: lead.website || null },
          profession: lead.profession || null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        console.error(`  ❌ Erro ao inserir ${lead.name}: ${error.message}`);
        continue;
      }

      // Registra evento de captura
      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: insertedLead.id,
        event_type: "lead_captured",
        payload: {
          source: lead.source,
          source_type: sourceType,
          name: lead.name,
          phone: lead.whatsapp,
          city: lead.address?.city,
          state: lead.address?.state,
          profession: lead.profession || null,
          reason: `Lead capturado via ${sourceType}`,
          raw_metadata_keys: Object.keys(lead.metadata || {}),
        },
        created_at: now,
      });

      inserted++;
      console.log(`  ✅ Inserido: ${lead.name} (${phone})`);
    } catch (err: any) {
      console.error(`  💥 Erro inesperado ao inserir ${lead.name}: ${err.message}`);
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
          metadata: { ...lead.metadata, website: lead.website || null },
          profession: lead.profession || null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();

      if (error) {
        console.error(`  ❌ Erro ao inserir ${lead.name} (sem tel): ${error.message}`);
        continue;
      }

      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: insertedLead.id,
        event_type: "lead_captured",
        payload: {
          source: lead.source,
          source_type: sourceType,
          name: lead.name,
          phone: null,
          city: lead.address?.city,
          state: lead.address?.state,
          profession: lead.profession || null,
          needs_enrichment: true,
          reason: `Lead capturado via ${sourceType} — sem telefone, precisa enriquecimento`,
        },
        created_at: now,
      });

      inserted++;
      console.log(`  ✅ Inserido (sem tel): ${lead.name} — precisa enriquecimento`);
    } catch (err: any) {
      console.error(`  💥 Erro inesperado ao inserir ${lead.name}: ${err.message}`);
    }
  }

  return { inserted, skipped };
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 1: GOOGLE MAPS (Places API)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverGoogleMaps(
  tenantId: string,
  config: DiscoverRequest["config"]
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
  const leads: DiscoveredLead[] = [];

  for (const city of cities) {
    for (const tag of tags) {
      if (leads.length >= dailyLimit) break;

      const query = `${tag} em ${city}`;
      console.log(`  🔍 Buscando: "${query}"`);

      try {
        // Text Search para encontrar estabelecimentos
        const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
        searchUrl.searchParams.set("query", query);
        searchUrl.searchParams.set("key", apiKey);
        searchUrl.searchParams.set("language", "pt-BR");
        searchUrl.searchParams.set("type", "establishment");

        const searchResp = await safeFetch(searchUrl.toString());
        if (!searchResp.ok) {
          console.error(`  ❌ Text Search falhou: HTTP ${searchResp.status}`);
          continue;
        }

        const searchData = await searchResp.json();
        if (searchData.status !== "OK" && searchData.status !== "ZERO_RESULTS") {
          console.error(`  ❌ Text Search status: ${searchData.status} — ${searchData.error_message || ""}`);
          continue;
        }

        const results = searchData.results || [];
        console.log(`  📍 ${results.length} resultados para "${query}"`);

        for (const place of results) {
          if (leads.length >= dailyLimit) break;

          try {
            // Rate limit: 200ms entre requests
            await sleep(200);

            // Place Details para obter telefone, website, etc.
            const detailsUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
            detailsUrl.searchParams.set("place_id", place.place_id);
            detailsUrl.searchParams.set("fields", "formatted_phone_number,international_phone_number,website,rating,user_ratings_total,address_components");
            detailsUrl.searchParams.set("key", apiKey);

            const detailsResp = await safeFetch(detailsUrl.toString());
            if (!detailsResp.ok) continue;

            const detailsData = await detailsResp.json();
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

            leads.push({
              name: place.name || "Sem nome",
              whatsapp: phone,
              source: "GOOGLE_MAPS",
              website: detail.website || null,
              address: {
                city: placeCity,
                state: placeState,
                full: place.formatted_address || "",
              },
              metadata: {
                google_place_id: place.place_id,
                google_rating: detail.rating || place.rating || null,
                google_reviews_count: detail.user_ratings_total || null,
                raw_phone: rawPhone || null,
                website: detail.website || null,
                search_tag: tag,
                search_city: city,
              },
            });
          } catch (err: any) {
            console.error(`  ⚠️ Erro no detalhe de ${place.name}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`  💥 Erro na busca "${query}": ${err.message}`);
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
  config: DiscoverRequest["config"]
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

  // Data de 30 dias atrás para buscar empresas recém-abertas
  const thirtyDaysAgo = formatDate(daysAgo(30));

  for (const city of cities) {
    if (leads.length >= dailyLimit) break;

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

      const resp = await safeFetch(`https://api.cnpja.com/office?${params}`, {
        headers: {
          Authorization: cnpjaKey,
          "Content-Type": "application/json",
        },
      });

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
      }
    } catch (err: any) {
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
  config: DiscoverRequest["config"]
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

  for (const city of cities) {
    for (const specialtySlug of effectiveTags) {
      if (leads.length >= dailyLimit) break;

      const citySlug = toSlug(city);
      const url = `https://www.doctoralia.com.br/${specialtySlug}/${citySlug}`;

      console.log(`  🔍 Scraping: ${url}`);

      try {
        // Rate limit: 3 segundos entre requests para evitar ban
        await sleep(3000);

        const resp = await safeFetch(url, {}, 20000);
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

        // Diagnostic: log a snippet of the HTML to help debug extraction
        const htmlSnippet = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").slice(0, 2000);
        console.log(`  🔬 HTML snippet (primeiro 2000 chars sem scripts): ${htmlSnippet.slice(0, 500)}`);

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
        }
      } catch (err: any) {
        console.error(`  💥 Erro ao scrape Doctoralia (${url}): ${err.message}`);
      }
    }
  }

  console.log(`🩺 Doctoralia: ${leads.length} leads encontrados`);
  return leads;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 4: COMPRASNET (Licitações — Portal Nacional de Contratações Públicas)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverComprasnet(
  config: DiscoverRequest["config"]
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

    const resp = await safeFetch(pncpUrl.toString(), {
      headers: { Accept: "application/json" },
    }, 20000);

    if (resp.ok) {
      const rawText = await resp.text();
      console.log(`  📄 PNCP resposta: ${rawText.length} bytes, preview: ${rawText.slice(0, 300)}`);

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
      }
    } else {
      console.warn(`  ⚠️ PNCP retornou HTTP ${resp.status}, tentando API alternativa...`);
    }
  } catch (err: any) {
    console.error(`  ⚠️ PNCP falhou: ${err.message}. Tentando API alternativa...`);
  }

  // API alternativa (dados.gov.br) caso a principal falhe
  if (leads.length === 0) {
    try {
      const sixMonthsAgo = formatDate(daysAgo(180));
      const altUrl = `https://api-compras.dados.gov.br/contratos?uf_contratado=${state}&data_inicio_vigencia_min=${sixMonthsAgo}&offset=0&limit=${dailyLimit}`;

      console.log(`  🔍 Tentando API alternativa: dados.gov.br`);

      const resp = await safeFetch(altUrl, {
        headers: { Accept: "application/json" },
      }, 20000);

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
        }
      } else {
        console.error(`  ❌ API alternativa também falhou: HTTP ${resp.status}`);
      }
    } catch (err: any) {
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
  _config: DiscoverRequest["config"]
): Promise<DiscoveredLead[]> {
  console.log("🏠 VivaReal: Fonte temporariamente indisponível.");

  // VivaReal uses Cloudflare protection that blocks automated access.
  // Direct HTTP scraping returns 403/challenge pages instead of real content.
  // This source needs a scraping proxy (e.g., Apify, ScrapingBee) to work.
  throw new Error(
    "VivaReal protegido por Cloudflare — requer proxy de scraping (Apify/ScrapingBee). " +
    "Configure a integração com proxy e reative esta fonte. " +
    "Alternativa: use CNPJ_MINER com CNAE imobiliário para encontrar imobiliárias."
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 6: CRM_SP (Conselho Regional de Medicina — Médicos)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverCrmSp(
  _config: DiscoverRequest["config"]
): Promise<DiscoveredLead[]> {
  console.log("⚕️ CRM-SP: Fonte temporariamente indisponível.");

  // CFM uses CAPTCHA/Cloudflare and CREMESP has SSL certificate issues
  // Direct HTTP scraping returns generic portal HTML or fails TLS handshake.
  // This source needs a scraping proxy (e.g., Apify, ScrapingBee) to work.
  throw new Error(
    "CRM/CFM bloqueiam acesso automatizado (WAF/Captcha/SSL). " +
    "Requer Apify ou automação de navegador para funcionar. " +
    "Alternativa: use DOCTORALIA com profession=DOCTOR para encontrar médicos."
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 7: OAB_SP (Cadastro Nacional de Advogados)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverOabSp(
  _config: DiscoverRequest["config"]
): Promise<DiscoveredLead[]> {
  console.log("⚖️ OAB-SP: Fonte temporariamente indisponível.");

  // OAB CNA site is an Angular SPA and its API is protected (CORS/Tokens).
  // Direct HTTP scraping only returns the empty app shell, not the data.
  // This source needs a scraping proxy (e.g., Apify, ScrapingBee) with browser rendering to work.
  throw new Error(
    "OAB CNA bloqueia acesso automatizado direto (API/SPA). " +
    "Requer Apify ou automação de navegador (Puppeteer/Playwright) para funcionar. " +
    "Alternativa: use CNPJ_MINER com CNAE de advocacia para encontrar escritórios."
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER 8: CRO_SP (Conselho Regional de Odontologia — Dentistas)
// ══════════════════════════════════════════════════════════════════════════════

async function discoverCroSp(
  _config: DiscoverRequest["config"]
): Promise<DiscoveredLead[]> {
  console.log("🦷 CRO-SP: Fonte temporariamente indisponível.");

  // CRO-SP website blocks automated access (timeout after ~12s).
  // The site likely uses WAF/bot protection that prevents direct scraping.
  // This source needs Apify or a similar browser automation tool to work.
  throw new Error(
    "CRO-SP bloqueia acesso automatizado (timeout/WAF). " +
    "Requer Apify ou automação de navegador para funcionar. " +
    "Alternativa: use DOCTORALIA com profession=DENTIST para encontrar dentistas."
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER — Mapeia source_type para o handler correto
// ══════════════════════════════════════════════════════════════════════════════

async function routeDiscovery(
  request: DiscoverRequest
): Promise<DiscoveredLead[]> {
  const { tenant_id, source_type, config } = request;

  switch (source_type) {
    case "GOOGLE_MAPS":
      return discoverGoogleMaps(tenant_id, config);
    case "CNPJ_MINER":
      return discoverCnpjMiner(config);
    case "DOCTORALIA":
      return discoverDoctoralia(config);
    case "COMPRASNET":
      return discoverComprasnet(config);
    case "VIVAREAL":
      return discoverVivaReal(config);
    case "CRM_SP":
      return discoverCrmSp(config);
    case "OAB_SP":
      return discoverOabSp(config);
    case "CRO_SP":
      return discoverCroSp(config);
    default:
      throw new Error(`source_type desconhecido: ${source_type}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  // Apenas aceita POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Método não permitido. Use POST." }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body: DiscoverRequest = await req.json();
    const { tenant_id, campaign_id, source_type, config } = body;

    // Validações básicas
    if (!tenant_id || !campaign_id || !source_type) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Campos obrigatórios: tenant_id, campaign_id, source_type",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const validSources: SourceType[] = [
      "GOOGLE_MAPS", "CNPJ_MINER", "DOCTORALIA", "COMPRASNET",
      "VIVAREAL", "CRM_SP", "OAB_SP", "CRO_SP",
    ];
    if (!validSources.includes(source_type)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `source_type inválido: ${source_type}. Válidos: ${validSources.join(", ")}`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`\n${"═".repeat(70)}`);
    console.log(`🔎 ProspIX Discovery Engine`);
    console.log(`   Time:        ${new Date().toISOString()}`);
    console.log(`   Tenant:      ${tenant_id}`);
    console.log(`   Campaign:    ${campaign_id}`);
    console.log(`   Source:      ${source_type}`);
    console.log(`   Config:      ${JSON.stringify(config || {})}`);
    console.log(`${"═".repeat(70)}\n`);

    // Verifica se o tenant e campanha existem
    const { data: campaign, error: campError } = await supabase
      .from("campaigns")
      .select("id, name, status, profession")
      .eq("id", campaign_id)
      .eq("tenant_id", tenant_id)
      .single();

    if (campError || !campaign) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Campanha ${campaign_id} não encontrada para o tenant ${tenant_id}`,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📢 Campanha: ${campaign.name} (${campaign.status})`);

    // Injeta profissão da campanha no config se disponível
    if (campaign.profession && !config?.profession) {
      (config as any).profession = campaign.profession;
    }

    // ── Executa o handler de descoberta ──────────────────────────
    let discoveredLeads: DiscoveredLead[] = [];
    const errors: string[] = [];

    try {
      discoveredLeads = await routeDiscovery({ tenant_id, campaign_id, source_type, config });
    } catch (err: any) {
      const errorMsg = err.message || "Erro desconhecido no handler de descoberta";
      console.error(`❌ Erro no handler ${source_type}: ${errorMsg}`);
      errors.push(errorMsg);

      // Retorna erro gracioso, não crasha
      const result: DiscoverResult = {
        ok: false,
        source_type,
        leads_found: 0,
        leads_inserted: 0,
        leads_skipped_duplicate: 0,
        errors,
      };
      return new Response(JSON.stringify(result), {
        status: 200, // 200 mesmo com erro no handler — o erro está no payload
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`\n📊 Leads descobertos: ${discoveredLeads.length}`);

    // ── Deduplica e insere ───────────────────────────────────────
    const { inserted, skipped } = await insertLeads(
      tenant_id,
      campaign_id,
      source_type,
      discoveredLeads
    );

    // ── Registra execução no tenant_discoveries (se a tabela existir)
    try {
      await supabase.from("tenant_discoveries").insert({
        tenant_id,
        campaign_id,
        source_type,
        leads_found: discoveredLeads.length,
        leads_inserted: inserted,
        leads_skipped: skipped,
        config: config || {},
        errors: errors.length > 0 ? errors : null,
        executed_at: new Date().toISOString(),
      });
    } catch (_e) {
      // Tabela pode não existir — não é crítico
      console.warn("⚠️ Não foi possível registrar em tenant_discoveries");
    }

    // ── Resposta final ──────────────────────────────────────────
    const result: DiscoverResult = {
      ok: true,
      source_type,
      leads_found: discoveredLeads.length,
      leads_inserted: inserted,
      leads_skipped_duplicate: skipped,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`\n🏁 Resultado final:`);
    console.log(`   Encontrados: ${result.leads_found}`);
    console.log(`   Inseridos:   ${result.leads_inserted}`);
    console.log(`   Duplicatas:  ${result.leads_skipped_duplicate}`);
    console.log(`${"═".repeat(70)}\n`);

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Fatal error:", err.message);
    console.error(err.stack);
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
