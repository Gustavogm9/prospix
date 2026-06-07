// supabase/functions/enrich-leads/index.ts
// ProspIX — Supabase Edge Function: Enrich CAPTURED leads
// Called by pg_cron every 15 min (08h-20h BRT)
// Validates WhatsApp (Evolution API), fetches CNPJ (CNPJá + BrasilAPI + cache), calculates Fit Score

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVO_KEY_FALLBACK = "429683C4C977415CAAFCCE10F7D57E11";
const DEFAULT_BATCH_SIZE = 50;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function yearsDiff(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(
    0,
    Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  );
}

function cleanCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, "");
}

function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")  // Remove diacritics: ã→a, é→e, ç→c
    .replace(/[-–—]/g, " ")
    .replace(/[&]/g, " ")
    .replace(/[.'\"\,;:()\[\]{}#@!?°º]/g, "")  // Remove punctuation
    .replace(/\b(LTDA|ME|EPP|EIRELI|S\.?A\.?|SS|SOCIEDADE SIMPLES|CIA|COMPANHIA)\b/gi, "")
    .replace(/\b(DR\.?|DRA\.?|PROF\.?|SR\.?|SRA\.?)\s*/gi, "")  // Remove titles
    .replace(/\s*-\s*(CARDIOLOG|DERMATOLOG|ORTOPED|ADVOGAD|DENTIST|CIRURGI|PSICOLOG|NUTRICION|FISIOTERAPEUT|VETERINAR|GINECOLOG|PEDIATR|NEUROLOG|UROLOG|OFTALMOLOG|ONCOLOG|OTORRINO|ENDOCRIN|PNEUMOLOG|REUMATOLOG|NEFROL|GASTROENTER|HEMATOLOG|GERIATR|ANESTESI)[A-Z]*\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// Extract 2-3 core search tokens from a name (for fallback search)
function extractSearchTokens(name: string): string {
  const stopWords = new Set(["DE", "DO", "DA", "DOS", "DAS", "E", "EM", "O", "A", "OS", "AS",
    "COM", "PARA", "POR", "NO", "NA", "NOS", "NAS", "SEU", "SUA", "CENTRO", "INSTITUTO",
    "CLINICA", "CONSULTORIO", "ESCRITORIO", "LABORATORIO", "FARMACIA", "HOSPITAL",
    "SERVICOS", "COMERCIO", "INDUSTRIA", "LTDA", "ME", "EPP", "SA", "EIRELI"]);
  const normalized = normalizeCompanyName(name);
  const tokens = normalized.split(" ").filter(t => t.length >= 3 && !stopWords.has(t));
  // Return 2-3 most distinctive tokens
  return tokens.slice(0, 3).join(" ");
}

// Simple similarity score between two strings (0-1)
function similarityScore(a: string, b: string): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (na === nb) return 1.0;
  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Token overlap (Jaccard-like)
  const tokA = new Set(na.split(" ").filter(t => t.length >= 3));
  const tokB = new Set(nb.split(" ").filter(t => t.length >= 3));
  if (tokA.size === 0 || tokB.size === 0) return 0;
  let overlap = 0;
  for (const t of tokA) { if (tokB.has(t)) overlap++; }
  return overlap / Math.max(tokA.size, tokB.size);
}

// ── Evolution API: WhatsApp Validation ──────────────────────────────────────
interface EvoConfig {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
}

async function loadEvoConfig(tenantId: string): Promise<EvoConfig | null> {
  try {
    const { data, error } = await supabase
      .from("tenant_secrets")
      .select("evolution_base_url, evolution_instance_name, evolution_api_key_encrypted")
      .eq("tenant_id", tenantId)
      .single();

    if (error || !data?.evolution_instance_name) return null;

    return {
      baseUrl: data.evolution_base_url || "https://evolution-evolution-api.qr4jgl.easypanel.host",
      instanceName: data.evolution_instance_name,
      apiKey: data.evolution_api_key_encrypted || EVO_KEY_FALLBACK,
    };
  } catch (_e) {
    return null;
  }
}

async function checkWhatsApp(phone: string, evoConfig: EvoConfig | null): Promise<boolean | null> {
  if (!evoConfig || !phone) return null;
  try {
    const url = `${evoConfig.baseUrl}/chat/whatsappNumbers/${evoConfig.instanceName}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: evoConfig.apiKey },
      body: JSON.stringify({ numbers: [phone] }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = Array.isArray(data) ? data[0] : data;
    return result?.exists === true;
  } catch (_err) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CNPJ ENRICHMENT — Multi-source with cache
// ══════════════════════════════════════════════════════════════════════════════

interface CnpjInfo {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao: string;
  data_abertura: string | null;
  cnae: string;
  uf: string;
  municipio: string;
  bairro: string;
  qsa: { nome: string; qualificacao: string }[];
}

// ── 1. Check Supabase cache first ───────────────────────────────────────────
async function checkCnpjCache(cnpj: string): Promise<CnpjInfo | null> {
  const clean = cleanCnpj(cnpj);
  const { data } = await supabase
    .from("cnpj_cache")
    .select("*")
    .eq("cnpj", clean)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!data) return null;

  return {
    cnpj: data.cnpj,
    razao_social: data.razao_social || "",
    nome_fantasia: data.nome_fantasia || "",
    situacao: data.situacao || "",
    data_abertura: data.data_abertura,
    cnae: data.cnae || "",
    uf: data.uf || "",
    municipio: data.municipio || "",
    bairro: data.bairro || "",
    qsa: data.qsa || [],
  };
}

// ── 2. Search cache by company name (fuzzy) ─────────────────────────────────
async function searchCnpjCacheByName(companyName: string, city?: string): Promise<CnpjInfo | null> {
  const normalized = normalizeCompanyName(companyName);
  // First check the name search cache
  let query = supabase
    .from("cnpj_name_search_cache")
    .select("cnpj")
    .textSearch("search_query", normalized, { type: "websearch" })
    .order("relevance", { ascending: false })
    .limit(1);

  if (city) {
    query = query.eq("search_city", city.toUpperCase());
  }

  const { data: cached } = await query;
  if (cached?.[0]?.cnpj) {
    return checkCnpjCache(cached[0].cnpj);
  }

  // Fallback: search directly in cnpj_cache by razao_social
  const { data: direct } = await supabase
    .from("cnpj_cache")
    .select("*")
    .or(`razao_social.ilike.%${normalized.slice(0, 30)}%,nome_fantasia.ilike.%${normalized.slice(0, 30)}%`)
    .gt("expires_at", new Date().toISOString())
    .limit(3);

  if (direct?.[0]) {
    return {
      cnpj: direct[0].cnpj,
      razao_social: direct[0].razao_social || "",
      nome_fantasia: direct[0].nome_fantasia || "",
      situacao: direct[0].situacao || "",
      data_abertura: direct[0].data_abertura,
      cnae: direct[0].cnae || "",
      uf: direct[0].uf || "",
      municipio: direct[0].municipio || "",
      bairro: direct[0].bairro || "",
      qsa: direct[0].qsa || [],
    };
  }

  return null;
}

// ── 3. Save to cache ────────────────────────────────────────────────────────
async function saveToCnpjCache(info: CnpjInfo, source: string, searchQuery?: string, searchCity?: string) {
  // Upsert main cache
  await supabase.from("cnpj_cache").upsert({
    cnpj: info.cnpj,
    razao_social: info.razao_social,
    nome_fantasia: info.nome_fantasia,
    situacao: info.situacao,
    data_abertura: info.data_abertura,
    cnae: info.cnae,
    uf: info.uf,
    municipio: info.municipio,
    bairro: info.bairro,
    qsa: info.qsa,
    raw_data: info,
    source,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "cnpj" });

  // Save name → CNPJ mapping
  if (searchQuery) {
    await supabase.from("cnpj_name_search_cache").upsert({
      search_query: normalizeCompanyName(searchQuery),
      search_city: searchCity?.toUpperCase() || null,
      search_uf: info.uf || null,
      cnpj: info.cnpj,
      relevance: 1.0,
      searched_at: new Date().toISOString(),
    }, { onConflict: "search_query,search_city,cnpj" });
  }
}

// ── 4. CNPJá Commercial API (search by name — multi-strategy) ───────────────
function parseCnpjaRecord(rec: any): CnpjInfo {
  return {
    cnpj: cleanCnpj(rec.taxId),
    razao_social: rec.company?.name || "",
    nome_fantasia: rec.alias || "",
    situacao: "ATIVA",
    data_abertura: rec.founded || null,
    cnae: rec.mainActivity?.id?.toString() || "",
    uf: rec.address?.state || "",
    municipio: rec.address?.municipality?.toString() || "",
    bairro: rec.address?.district || "",
    qsa: (rec.company?.members || []).map((m: any) => ({
      nome: m.person?.name || "",
      qualificacao: m.role?.text || "",
    })),
  };
}

async function searchCnpjaWithQuery(query: string, uf: string | undefined, cnpjaKey: string): Promise<CnpjInfo[]> {
  if (!query || query.length < 3) return [];
  try {
    const params = new URLSearchParams({
      "names.in": query,
      "status.id.in": "2",
      "limit": "5",
    });
    if (uf) params.set("address.state.in", uf);

    const resp = await fetch(`https://api.cnpja.com/office?${params}`, {
      headers: { Authorization: cnpjaKey },
    });
    if (!resp.ok) return [];
    const d = await resp.json();
    return (d.records || []).map(parseCnpjaRecord);
  } catch (_e) {
    return [];
  }
}

async function searchCnpjaByName(companyName: string, uf?: string): Promise<CnpjInfo | null> {
  const cnpjaKey = Deno.env.get("CNPJA_API_KEY");
  if (!cnpjaKey) return null;

  // Strategy 1: Full normalized name
  const fullName = normalizeCompanyName(companyName);
  let results = await searchCnpjaWithQuery(fullName, uf, cnpjaKey);

  // Strategy 2: Core tokens only (removes generic words)
  if (results.length === 0) {
    const tokens = extractSearchTokens(companyName);
    if (tokens !== fullName && tokens.length >= 3) {
      results = await searchCnpjaWithQuery(tokens, uf, cnpjaKey);
    }
  }

  // Strategy 3: First 2 significant words only
  if (results.length === 0) {
    const words = fullName.split(" ").filter(w => w.length >= 3);
    if (words.length >= 2) {
      const twoWords = words.slice(0, 2).join(" ");
      if (twoWords !== fullName) {
        results = await searchCnpjaWithQuery(twoWords, uf, cnpjaKey);
      }
    }
  }

  if (results.length === 0) return null;

  // Score each result by similarity to the original name
  let bestMatch: CnpjInfo | null = null;
  let bestScore = 0;

  for (const r of results) {
    const scoreRazao = similarityScore(companyName, r.razao_social);
    const scoreFantasia = r.nome_fantasia ? similarityScore(companyName, r.nome_fantasia) : 0;
    const score = Math.max(scoreRazao, scoreFantasia);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = r;
    }
  }

  // Reject if similarity is too low (avoid false positives)
  if (bestScore < 0.3) {
    console.warn(`  ⚠️ CNPJá: best match for "${companyName}" had score ${bestScore.toFixed(2)} — rejected`);
    return null;
  }

  console.log(`  🔍 CNPJá match: "${companyName}" → "${bestMatch?.razao_social}" (score: ${bestScore.toFixed(2)})`);
  return bestMatch;
}

// ── 5. CNPJá Open API (lookup by exact CNPJ — FREE, 5/min) ─────────────────
async function lookupCnpjaOpen(cnpj: string): Promise<CnpjInfo | null> {
  const clean = cleanCnpj(cnpj);
  if (clean.length !== 14) return null;

  try {
    const resp = await fetch(`https://open.cnpja.com/office/${clean}`);
    if (!resp.ok) return null;

    const d = await resp.json();
    return {
      cnpj: clean,
      razao_social: d.company?.name || "",
      nome_fantasia: d.alias || "",
      situacao: d.status?.text === "Ativa" ? "ATIVA" : "INATIVA",
      data_abertura: d.founded || null,
      cnae: d.mainActivity?.id?.toString() || "",
      uf: d.address?.state || "",
      municipio: d.address?.city || "",
      bairro: d.address?.district || "",
      qsa: (d.company?.members || []).map((m: any) => ({
        nome: m.person?.name || "",
        qualificacao: m.role?.text || "",
      })),
    };
  } catch (_e) {
    return null;
  }
}

// ── 6. BrasilAPI (lookup by exact CNPJ — FREE) ─────────────────────────────
async function lookupBrasilApi(cnpj: string): Promise<CnpjInfo | null> {
  const clean = cleanCnpj(cnpj);
  if (clean.length !== 14) return null;

  try {
    const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`);
    if (!resp.ok) return null;

    const d = await resp.json();
    return {
      cnpj: clean,
      razao_social: d.razao_social || "",
      nome_fantasia: d.nome_fantasia || "",
      situacao: d.situacao_cadastral === 2 ? "ATIVA" : "INATIVA",
      data_abertura: d.data_inicio_atividade,
      cnae: String(d.cnae_fiscal || ""),
      uf: d.uf,
      municipio: d.municipio,
      bairro: d.bairro,
      qsa: (d.qsa || []).map((s: any) => ({
        nome: s.nome_socio || s.nome || "",
        qualificacao: s.qualificacao_socio_descricao || "",
      })),
    };
  } catch (_e) {
    return null;
  }
}

// ── 7. ReceitaWS fallback (lookup by exact CNPJ — FREE 3/min) ───────────────
async function lookupReceitaWs(cnpj: string): Promise<CnpjInfo | null> {
  const clean = cleanCnpj(cnpj);
  if (clean.length !== 14) return null;

  try {
    await sleep(1500); // Rate limit
    const resp = await fetch(`https://receitaws.com.br/v1/cnpj/${clean}`);
    if (!resp.ok) return null;

    const d = await resp.json();
    if (d.status === "ERROR") return null;

    let dataAbertura: string | null = null;
    if (d.abertura) {
      const parts = d.abertura.split("/");
      if (parts.length === 3) dataAbertura = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    return {
      cnpj: clean,
      razao_social: d.nome || "",
      nome_fantasia: d.fantasia || "",
      situacao: d.situacao || "ATIVA",
      data_abertura: dataAbertura,
      cnae: d.atividade_principal?.[0]?.code?.replace(/\D/g, "") || "",
      uf: d.uf,
      municipio: d.municipio,
      bairro: d.bairro,
      qsa: (d.qsa || []).map((s: any) => ({
        nome: s.nome || "",
        qualificacao: s.qual || "",
      })),
    };
  } catch (_e) {
    return null;
  }
}

// ── MASTER: Enrich CNPJ for a lead ──────────────────────────────────────────
async function enrichCnpj(
  leadName: string,
  existingCnpj: string | null,
  city?: string,
  uf?: string
): Promise<{ info: CnpjInfo | null; source: string }> {
  // 1. If we have a CNPJ, try cache → open APIs
  if (existingCnpj) {
    const clean = cleanCnpj(existingCnpj);
    if (clean.length === 14) {
      // Check cache
      const cached = await checkCnpjCache(clean);
      if (cached) return { info: cached, source: "cache" };

      // Try CNPJá open (free)
      const cnpja = await lookupCnpjaOpen(clean);
      if (cnpja) {
        await saveToCnpjCache(cnpja, "cnpja_open", leadName, city);
        return { info: cnpja, source: "cnpja_open" };
      }

      // Try BrasilAPI (free)
      const brasil = await lookupBrasilApi(clean);
      if (brasil) {
        await saveToCnpjCache(brasil, "brasilapi", leadName, city);
        return { info: brasil, source: "brasilapi" };
      }

      // Try ReceitaWS (free, slow)
      const receita = await lookupReceitaWs(clean);
      if (receita) {
        await saveToCnpjCache(receita, "receitaws", leadName, city);
        return { info: receita, source: "receitaws" };
      }
    }
  }

  // 2. No CNPJ — try name search
  // 2a. Check name search cache first (FREE)
  const cachedByName = await searchCnpjCacheByName(leadName, city);
  if (cachedByName) return { info: cachedByName, source: "cache_name" };

  // 2b. CNPJá commercial search by name (costs 1 credit per 10 results)
  const cnpjaResult = await searchCnpjaByName(leadName, uf);
  if (cnpjaResult) {
    await saveToCnpjCache(cnpjaResult, "cnpja_commercial", leadName, city);
    return { info: cnpjaResult, source: "cnpja_commercial" };
  }

  return { info: null, source: "none" };
}

// ── Fit Score Calculator ────────────────────────────────────────────────────
function calcFitScore(lead: any, campaign: any, highValueAreas: string[]): number {
  let score = 0;

  if (lead.profession && lead.profession === campaign.profession) score += 3.0;
  if (lead.whatsapp_valid === true) score += 2.0;
  else if (lead.whatsapp) score += 1.0;
  if (lead.partner_or_owner) score += 2.0;

  const nb = lead.address?.neighborhood;
  if (nb && highValueAreas.some((a: string) => a.toLowerCase().trim() === nb.toLowerCase().trim())) score += 1.0;

  const years = lead.years_of_practice || lead.metadata?.cnpj_age_years || 0;
  score += Math.min(years / 5, 1.0);

  const rating = Number(lead.google_rating || 0);
  const reviews = lead.google_reviews_count || 0;
  if (rating >= 4.5 && reviews >= 10) score += 1.0;

  return Math.max(0, Math.min(10, score));
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  try {
    let batchSize = DEFAULT_BATCH_SIZE;
    let tenantId: string | null = null;

    try {
      const body = await req.json();
      batchSize = body.batch_size || DEFAULT_BATCH_SIZE;
      tenantId = body.tenant_id || null;
    } catch (_e) { /* defaults */ }

    console.log(`🔬 ProspIX Enrich Worker v2 (with CNPJ cache)`);
    console.log(`   Time: ${new Date().toISOString()}`);

    // Find tenants with CAPTURED leads
    let tenantIds: string[] = [];
    if (tenantId) {
      tenantIds = [tenantId];
    } else {
      const { data: tenantData } = await supabase
        .from("leads")
        .select("tenant_id")
        .eq("status", "CAPTURED")
        .limit(100);
      tenantIds = [...new Set((tenantData || []).map((r: any) => r.tenant_id))] as string[];
    }

    if (tenantIds.length === 0) {
      return new Response(JSON.stringify({ message: "No leads to enrich", processed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const tid of tenantIds) {
      console.log(`\n━━━ Tenant: ${tid} ━━━`);

      const { data: leads } = await supabase
        .from("leads")
        .select("*")
        .eq("tenant_id", tid)
        .eq("status", "CAPTURED")
        .order("created_at", { ascending: true })
        .limit(batchSize);

      if (!leads?.length) {
        results.push({ tenant_id: tid, enriched: 0, archived: 0, failed: 0, cnpj_found: 0 });
        continue;
      }

      console.log(`  📋 ${leads.length} leads to enrich`);

      const { data: campaigns } = await supabase.from("campaigns").select("*").eq("tenant_id", tid);
      const campaignMap = Object.fromEntries((campaigns || []).map((c: any) => [c.id, c]));

      const { data: tenant } = await supabase.from("tenants").select("*").eq("id", tid).single();
      const evoConfig = await loadEvoConfig(tid);

      let enriched = 0, archived = 0, failed = 0, cnpjFound = 0;

      for (const lead of leads) {
        try {
          const metadata: Record<string, any> = { ...(lead.metadata || {}) };
          let whatsappValid: boolean | null = lead.whatsapp_valid;
          let yearsOfPractice: number = lead.years_of_practice || 0;
          let partnerOrOwner: boolean = lead.partner_or_owner || false;
          let leadName = lead.name;
          const now = () => new Date().toISOString();
          const events: any[] = []; // Collect all events for batch insert

          // ── Step A: Validate WhatsApp ──────────────────────────
          const wppResult = await checkWhatsApp(lead.whatsapp, evoConfig);
          if (wppResult !== null) whatsappValid = wppResult;

          events.push({
            tenant_id: tid,
            lead_id: lead.id,
            event_type: "whatsapp_check",
            payload: {
              phone: lead.whatsapp || null,
              result: wppResult === true ? "valid" : wppResult === false ? "invalid" : "not_checked",
              reason: !lead.whatsapp
                ? "Sem número de telefone cadastrado"
                : !evoConfig
                ? "Evolution API não configurada para este tenant"
                : wppResult === true
                ? "Número verificado como WhatsApp ativo"
                : wppResult === false
                ? "Número não possui WhatsApp"
                : "Falha na verificação (API indisponível)",
            },
            created_at: now(),
          });

          // ── Step B: CNPJ enrichment (with cache!) ──────────────
          const existingCnpj = metadata.cnpj || metadata.cnpj_number;
          const city = lead.address?.city?.split(" - ")?.[0]?.trim();
          const uf = lead.address?.city?.split(" - ")?.[1]?.trim();

          const { info: cnpjInfo, source: cnpjSource } = await enrichCnpj(
            leadName,
            existingCnpj,
            city,
            uf
          );

          if (cnpjInfo) {
            metadata.cnpj_info = cnpjInfo;
            metadata.cnpj = cnpjInfo.cnpj;
            metadata.partners = cnpjInfo.qsa;
            metadata.cnpj_age_years = yearsDiff(cnpjInfo.data_abertura);
            metadata.cnpj_source = cnpjSource;
            yearsOfPractice = metadata.cnpj_age_years;
            partnerOrOwner = true;
            cnpjFound++;

            if (!leadName || leadName === "") {
              leadName = cnpjInfo.nome_fantasia || cnpjInfo.razao_social;
            }

            events.push({
              tenant_id: tid,
              lead_id: lead.id,
              event_type: "cnpj_found",
              payload: {
                cnpj: cnpjInfo.cnpj,
                razao_social: cnpjInfo.razao_social,
                nome_fantasia: cnpjInfo.nome_fantasia,
                situacao: cnpjInfo.situacao,
                source: cnpjSource,
                partners_count: cnpjInfo.qsa?.length || 0,
                partners: cnpjInfo.qsa?.slice(0, 5).map((s) => s.nome),
                company_age_years: metadata.cnpj_age_years,
                reason:
                  cnpjSource === "cache"
                    ? "CNPJ encontrado no cache (sem custo)"
                    : cnpjSource === "cache_name"
                    ? "CNPJ encontrado por nome no cache (sem custo)"
                    : cnpjSource === "cnpja_commercial"
                    ? `CNPJ encontrado via pesquisa CNPJá por nome "${leadName}"`
                    : cnpjSource === "cnpja_open"
                    ? "CNPJ consultado via API pública CNPJá (grátis)"
                    : cnpjSource === "brasilapi"
                    ? "CNPJ consultado via BrasilAPI (grátis)"
                    : `CNPJ consultado via ${cnpjSource}`,
              },
              created_at: now(),
            });

            console.log(`  ✅ ${leadName} → CNPJ: ${cnpjInfo.cnpj} (${cnpjSource}) | ${cnpjInfo.qsa?.length || 0} sócios`);
          } else {
            events.push({
              tenant_id: tid,
              lead_id: lead.id,
              event_type: "cnpj_not_found",
              payload: {
                search_name: leadName,
                search_city: city || null,
                search_uf: uf || null,
                had_existing_cnpj: !!existingCnpj,
                reason: !leadName
                  ? "Lead sem nome — impossível buscar CNPJ"
                  : existingCnpj
                  ? `CNPJ ${existingCnpj} informado mas não encontrado em nenhuma base`
                  : `Nenhuma empresa encontrada com o nome "${leadName}"${city ? ` em ${city}` : ""}${uf ? `/${uf}` : ""}`,
              },
              created_at: now(),
            });
          }

          // ── Step C: Recalculate fit score ───────────────────────
          const campaign = campaignMap[lead.campaign_id] || { profession: lead.profession || "" };
          const filters = campaign.filters || {};
          const highValueAreas: string[] = filters.high_value_areas || tenant?.high_value_areas || [];
          const minFitScore: number = filters.min_fit_score ?? 5;

          // Calculate individual score components for transparency
          const scoreBreakdown: Record<string, number> = {};
          if (lead.profession && lead.profession === campaign.profession) scoreBreakdown["profissao_match"] = 3.0;
          if (whatsappValid === true) scoreBreakdown["whatsapp_valido"] = 2.0;
          else if (lead.whatsapp) scoreBreakdown["tem_telefone"] = 1.0;
          if (partnerOrOwner) scoreBreakdown["socio_ou_dono"] = 2.0;
          const nb = lead.address?.neighborhood;
          if (nb && highValueAreas.some((a: string) => a.toLowerCase().trim() === nb.toLowerCase().trim())) scoreBreakdown["bairro_premium"] = 1.0;
          const years = yearsOfPractice;
          if (years > 0) scoreBreakdown["tempo_mercado"] = Math.min(years / 5, 1.0);
          const rating = Number(lead.google_rating || 0);
          const reviews = lead.google_reviews_count || 0;
          if (rating >= 4.5 && reviews >= 10) scoreBreakdown["avaliacao_google"] = 1.0;

          const enrichedLead = {
            ...lead,
            whatsapp_valid: whatsappValid,
            partner_or_owner: partnerOrOwner,
            years_of_practice: yearsOfPractice,
            metadata,
          };
          const fitScore = calcFitScore(enrichedLead, campaign, highValueAreas);
          const finalStatus = fitScore >= minFitScore ? "ENRICHED" : "ARCHIVED";

          events.push({
            tenant_id: tid,
            lead_id: lead.id,
            event_type: "fit_score_calculated",
            payload: {
              score: fitScore,
              threshold: minFitScore,
              breakdown: scoreBreakdown,
              reason: `Score ${fitScore.toFixed(1)} calculado: ${Object.entries(scoreBreakdown).map(([k, v]) => `${k}(+${v})`).join(" + ") || "sem pontos"}`,
            },
            created_at: now(),
          });

          // ── Step D: Update lead ────────────────────────────────
          await supabase.from("leads").update({
            name: leadName,
            whatsapp_valid: whatsappValid,
            years_of_practice: yearsOfPractice,
            partner_or_owner: partnerOrOwner,
            fit_score: fitScore,
            status: finalStatus,
            metadata,
            updated_at: now(),
          }).eq("id", lead.id);

          // ── Step E: Status change event with full reason ────────
          const archiveReasons: string[] = [];
          if (fitScore < minFitScore) archiveReasons.push(`Score (${fitScore.toFixed(1)}) abaixo do mínimo (${minFitScore})`);
          if (!lead.whatsapp) archiveReasons.push("Sem telefone");
          if (whatsappValid === false) archiveReasons.push("WhatsApp inválido");
          if (!cnpjInfo) archiveReasons.push("CNPJ não encontrado");

          events.push({
            tenant_id: tid,
            lead_id: lead.id,
            event_type: "status_changed",
            payload: {
              from: "CAPTURED",
              to: finalStatus,
              reason: finalStatus === "ENRICHED"
                ? `Lead qualificado com score ${fitScore.toFixed(1)}/${minFitScore}. ${cnpjInfo ? `CNPJ: ${cnpjInfo.cnpj} (${cnpjInfo.qsa?.length || 0} sócios).` : ""} ${whatsappValid === true ? "WhatsApp verificado." : ""}`
                : `Lead arquivado: ${archiveReasons.join("; ")}`,
              fit_score: fitScore,
              cnpj_found: !!cnpjInfo,
              whatsapp_valid: whatsappValid,
            },
            created_at: now(),
          });

          // ── Step F: Batch insert all events ────────────────────
          await supabase.from("lead_events").insert(events);

          if (finalStatus === "ENRICHED") enriched++;
          else archived++;

          await sleep(300);
        } catch (err: any) {
          console.error(`  ❌ ${lead.name}: ${err.message?.slice(0, 80)}`);
          // Log failure event too
          await supabase.from("lead_events").insert({
            tenant_id: tid,
            lead_id: lead.id,
            event_type: "enrichment_failed",
            payload: {
              error: err.message?.slice(0, 200),
              reason: `Erro durante enriquecimento: ${err.message?.slice(0, 100)}`,
            },
            created_at: new Date().toISOString(),
          });
          failed++;
        }
      }

      results.push({ tenant_id: tid, enriched, archived, failed, cnpj_found: cnpjFound });
      console.log(`\n  🏁 ${enriched} enriched, ${archived} archived, ${failed} failed, ${cnpjFound} CNPJs found`);
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Fatal:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
