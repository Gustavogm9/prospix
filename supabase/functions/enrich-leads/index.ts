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

// ── Website Crawling Helpers ────────────────────────────────────────────────
async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

interface CrawlResult {
  html: string;
  isHttps: boolean;
  sslValid: boolean;
  headers: Record<string, string>;
  error?: string;
}

async function crawlWebsite(urlStr: string | null | undefined): Promise<CrawlResult | null> {
  if (!urlStr) return null;
  let url = urlStr.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }

  try {
    const isHttps = url.toLowerCase().startsWith("https://");
    const resp = await fetchWithTimeout(url, 4000);
    const html = await resp.text();
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    return {
      html: html.toLowerCase(),
      isHttps,
      sslValid: isHttps,
      headers,
    };
  } catch (err: any) {
    return {
      html: "",
      isHttps: url.toLowerCase().startsWith("https://"),
      sslValid: false,
      headers: {},
      error: err.message,
    };
  }
}

// ── Fit Score Calculator ────────────────────────────────────────────────────
function calcFitScore(lead: any, campaign: any, highValueAreas: string[], activeSources: Set<string>): number {
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

  // ── Premium Add-ons ──
  // 1. Instagram / Social Linker (+1.0 point if followers found)
  if (activeSources.has("INSTAGRAM_SCRAPER") && lead.metadata?.instagram) {
    score += 1.0;
  }

  // 2. Contato Direto do Sócio / QSA Cell Finder (+2.0 points if direct cell number was found)
  if (activeSources.has("SOCIO_CONTACT") && lead.metadata?.socio_contact) {
    score += 2.0;
  }

  // 3. Faturamento & Porte / CNPJ Premium (+1.5 points if EPP, MEDIA, or GRANDE)
  if (activeSources.has("CNPJ_PREMIUM") && lead.metadata?.cnpj_premium) {
    const porte = lead.metadata.cnpj_premium.porte;
    if (porte === "EPP" || porte === "MEDIA" || porte === "GRANDE") {
      score += 1.5;
    }
  }

  // 4. Cyber Risk Scraper (+1.5 points if vulnerabilities found, perfect for Cyber Insurance)
  if (activeSources.has("CYBER_RISK") && lead.metadata?.cyber_risk) {
    if (lead.metadata.cyber_risk.has_vulnerabilities === true) {
      score += 1.5;
    }
  }

  // 5. Ads Pixel Tracker (+1.0 point if active marketing pixels found)
  if (activeSources.has("ADS_TRACKER") && lead.metadata?.ads_tracker) {
    if (lead.metadata.ads_tracker.ads_active === true) {
      score += 1.0;
    }
  }

  // 6. Email Scraper (+1.0 point if direct emails found)
  if (activeSources.has("EMAIL_SCRAPER") && lead.metadata?.email_scraper) {
    if (lead.metadata.email_scraper.emails && lead.metadata.email_scraper.emails.length > 0) {
      score += 1.0;
    }
  }

  // 7. Fleet & Logistics Finder (+2.0 points if fleet active)
  if (activeSources.has("FLEET_TRACKER") && lead.metadata?.fleet_tracker) {
    if (lead.metadata.fleet_tracker.has_fleet === true) {
      score += 2.0;
    }
  }

  // 8. Judicial & Legal Risk Tracker (+1.5 points if lawsuits found, perfect for D&O)
  if (activeSources.has("JUDICIAL_TRACKER") && lead.metadata?.judicial_tracker) {
    if (lead.metadata.judicial_tracker.has_lawsuits === true) {
      score += 1.5;
    }
  }

  // 9. Technographic Detector (+1.0 point if high-value CRM/ecommerce tools found)
  if (activeSources.has("TECHNOGRAPHIC") && lead.metadata?.technographic) {
    if (lead.metadata.technographic.has_high_value_tools === true) {
      score += 1.0;
    }
  }

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

      // Fetch active premium lead sources configuration
      const { data: activeSourcesData } = await supabase
        .from("lead_sources")
        .select("source_type")
        .eq("tenant_id", tid)
        .eq("status", "ACTIVE");
      const activeSources = new Set((activeSourcesData || []).map((s: any) => s.source_type));

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

          // ── Premium Source Add-ons Enrichment ──────────────────
          
          // ── 1. Instagram Scraper (Social Linker) ──────────────────
          if (activeSources.has("INSTAGRAM_SCRAPER")) {
            const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
            if (APIFY_TOKEN) {
              try {
                // Gerar possíveis usernames a partir do nome da empresa
                const companyNameClean = (cnpjInfo?.nome_fantasia || cnpjInfo?.razao_social || leadName || "")
                  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/\b(ltda|me|epp|eireli|s\.?a\.?|ss)\b/gi, "")
                  .replace(/[^a-z0-9]/g, "")
                  .trim();

                if (companyNameClean.length >= 3) {
                  console.log(`  📸 Instagram: buscando perfil para "${companyNameClean}"...`);

                  // Chamar Apify Instagram Profile Scraper (sync, fast run)
                  const apifyResp = await fetch(
                    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        usernames: [companyNameClean],
                        resultsLimit: 1,
                      }),
                    }
                  );

                  if (apifyResp.ok) {
                    const apifyData = await apifyResp.json();
                    const profile = Array.isArray(apifyData) ? apifyData[0] : null;

                    if (profile && profile.username) {
                      metadata.instagram = {
                        username: profile.username,
                        full_name: profile.fullName || null,
                        followers: profile.followersCount || 0,
                        following: profile.followsCount || 0,
                        posts_count: profile.postsCount || 0,
                        biography: profile.biography?.slice(0, 200) || null,
                        is_business: profile.isBusinessAccount || false,
                        profile_url: `https://www.instagram.com/${profile.username}`,
                        data_source: "apify",
                      };
                      console.log(`  ✅ Instagram: @${profile.username} (${profile.followersCount || 0} seguidores)`);
                    } else {
                      metadata.instagram = {
                        available: false,
                        searched_username: companyNameClean,
                        reason: "Perfil não encontrado no Instagram",
                      };
                    }
                  } else {
                    console.warn(`  ⚠️ Instagram Apify API retornou status ${apifyResp.status}`);
                    metadata.instagram = {
                      available: false,
                      reason: `Apify API erro: HTTP ${apifyResp.status}`,
                    };
                  }
                } else {
                  metadata.instagram = {
                    available: false,
                    reason: "Nome da empresa muito curto para buscar perfil",
                  };
                }

                events.push({
                  tenant_id: tid,
                  lead_id: lead.id,
                  event_type: "instagram_enriched",
                  payload: {
                    username: metadata.instagram?.username || null,
                    followers: metadata.instagram?.followers || 0,
                    reason: metadata.instagram?.username
                      ? `Perfil @${metadata.instagram.username} encontrado com ${metadata.instagram.followers} seguidores.`
                      : metadata.instagram?.reason || "Perfil não localizado.",
                  },
                  created_at: now(),
                });
              } catch (igErr: any) {
                console.warn(`  ⚠️ Instagram Scraper erro: ${igErr.message?.slice(0, 80)}`);
                metadata.instagram = {
                  available: false,
                  reason: `Erro na busca: ${igErr.message?.slice(0, 100)}`,
                };
              }
            } else {
              console.log("  ℹ️ APIFY_API_TOKEN não configurado — Instagram Scraper desativado");
              metadata.instagram = { available: false, reason: "API key não configurada" };
            }
          }

          // ── 2. Contato Direto do Sócio (QSA Cell Finder) ──────────────
          if (activeSources.has("SOCIO_CONTACT") && cnpjInfo) {
            const INFOSIMPLES_TOKEN = Deno.env.get("INFOSIMPLES_API_TOKEN");
            if (INFOSIMPLES_TOKEN) {
              try {
                // Encontrar o sócio-administrador no QSA
                const adminKeywords = /administrador|s[óo]cio[- ]?administrador|diretor|gerente|presidente|propriet[áa]rio/i;
                const adminPartner = (cnpjInfo.qsa || []).find(s => adminKeywords.test(s.qualificacao));
                const partnerName = adminPartner?.nome || cnpjInfo.qsa?.[0]?.nome;

                if (partnerName) {
                  console.log(`  👤 QSA Cell Finder: buscando celular de "${partnerName}"...`);

                  // Tentar buscar telefone via InfoSimples — consulta por nome
                  const infoResp = await fetch("https://api.infosimples.com/api/v2/consultas/telefone/nome", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      nome: partnerName,
                      uf: cnpjInfo.uf || undefined,
                      municipio: cnpjInfo.municipio || undefined,
                      token: INFOSIMPLES_TOKEN,
                    }),
                  });

                  if (infoResp.ok) {
                    const infoData = await infoResp.json();
                    // InfoSimples retorna code 200 para sucesso
                    if (infoData.code === 200 && infoData.data && infoData.data.length > 0) {
                      // Filtrar apenas celulares (DDD + 9XXXX-XXXX)
                      const phones: string[] = [];
                      for (const record of infoData.data) {
                        const phoneList = record.telefones || record.phones || [];
                        for (const p of phoneList) {
                          const num = (p.numero || p.phone || p || "").toString().replace(/\D/g, "");
                          // Celulares brasileiros: 11 dígitos, 9° dígito = 9
                          if (num.length === 11 && num[2] === "9") {
                            phones.push(num);
                          } else if (num.length === 13 && num.startsWith("55") && num[4] === "9") {
                            phones.push(num.slice(2)); // remover 55
                          }
                        }
                      }

                      const uniquePhones = [...new Set(phones)].slice(0, 3);

                      if (uniquePhones.length > 0) {
                        // Validar o primeiro celular encontrado via WhatsApp
                        const primaryPhone = `55${uniquePhones[0]}`;
                        const wppCheck = await checkWhatsApp(primaryPhone, evoConfig);

                        metadata.socio_contact = {
                          partner_name: partnerName,
                          partner_role: adminPartner?.qualificacao || "Sócio",
                          phones_found: uniquePhones,
                          primary_phone: uniquePhones[0],
                          whatsapp_validated: wppCheck === true,
                          data_source: "infosimples",
                        };

                        // Se o WhatsApp do sócio for válido, atualizar o whatsapp do lead
                        if (wppCheck === true && !whatsappValid) {
                          console.log(`  ✅ QSA Cell: WhatsApp do sócio ${partnerName} validado: ${uniquePhones[0]}`);
                          // Nota: não sobrescrevemos o whatsapp original, guardamos em metadata
                        }

                        console.log(`  ✅ QSA Cell: ${uniquePhones.length} celular(es) encontrado(s) para ${partnerName}`);
                      } else {
                        metadata.socio_contact = {
                          partner_name: partnerName,
                          partner_role: adminPartner?.qualificacao || "Sócio",
                          phones_found: [],
                          available: false,
                          reason: "Nenhum celular encontrado nos registros",
                          data_source: "infosimples",
                        };
                      }
                    } else {
                      metadata.socio_contact = {
                        partner_name: partnerName,
                        available: false,
                        reason: infoData.message || "Nenhum resultado retornado pela API",
                        data_source: "infosimples",
                      };
                    }
                  } else {
                    console.warn(`  ⚠️ InfoSimples API retornou status ${infoResp.status}`);
                    metadata.socio_contact = {
                      partner_name: partnerName,
                      available: false,
                      reason: `InfoSimples API erro: HTTP ${infoResp.status}`,
                    };
                  }
                } else {
                  metadata.socio_contact = {
                    available: false,
                    reason: "Nenhum sócio encontrado no QSA do CNPJ",
                  };
                }

                events.push({
                  tenant_id: tid,
                  lead_id: lead.id,
                  event_type: "socio_contact_enriched",
                  payload: {
                    partner_name: metadata.socio_contact?.partner_name || null,
                    phones_count: metadata.socio_contact?.phones_found?.length || 0,
                    whatsapp_validated: metadata.socio_contact?.whatsapp_validated || false,
                    reason: metadata.socio_contact?.phones_found?.length > 0
                      ? `${metadata.socio_contact.phones_found.length} celular(es) encontrado(s) para o sócio ${metadata.socio_contact.partner_name}.`
                      : metadata.socio_contact?.reason || "Celular do sócio não localizado.",
                  },
                  created_at: now(),
                });
              } catch (socioErr: any) {
                console.warn(`  ⚠️ QSA Cell Finder erro: ${socioErr.message?.slice(0, 80)}`);
                metadata.socio_contact = {
                  available: false,
                  reason: `Erro na busca: ${socioErr.message?.slice(0, 100)}`,
                };
              }
            } else {
              console.log("  ℹ️ INFOSIMPLES_API_TOKEN não configurado — QSA Cell Finder desativado");
              metadata.socio_contact = { available: false, reason: "API key não configurada" };
            }
          }

          // 3. Faturamento & Porte (CNPJ Premium) — REAL DATA from CNPJ APIs
          // Uses porte_empresa and capital_social already returned by BrasilAPI/CNPJá.
          if (activeSources.has("CNPJ_PREMIUM") && cnpjInfo) {
            // Extract real porte from the raw CNPJ data (comes from BrasilAPI/ReceitaWS)
            const rawData = metadata.cnpj_info || {} as any;
            const porteRaw = rawData.porte || rawData.descricao_porte || "";
            let porteEmpresa = "ME";
            if (/grande/i.test(porteRaw)) porteEmpresa = "GRANDE";
            else if (/m[eé]di/i.test(porteRaw)) porteEmpresa = "MEDIA";
            else if (/pequeno|epp/i.test(porteRaw)) porteEmpresa = "EPP";
            else if (/micro|mei/i.test(porteRaw)) porteEmpresa = "ME";

            const capitalSocial = Number(rawData.capital_social || 0);

            metadata.cnpj_premium = {
              porte: porteEmpresa,
              porte_descricao: porteRaw || "Não informado",
              capital_social: capitalSocial,
              data_source: "receita_federal",
            };

            events.push({
              tenant_id: tid,
              lead_id: lead.id,
              event_type: "cnpj_premium_enriched",
              payload: {
                porte: porteEmpresa,
                capital_social: capitalSocial,
                reason: capitalSocial > 0
                  ? `Porte (${porteEmpresa}) e capital social (R$ ${capitalSocial.toLocaleString('pt-BR')}) extraídos da Receita Federal.`
                  : `Porte (${porteEmpresa}) identificado via Receita Federal. Capital social não disponível.`,
              },
              created_at: now(),
            });
          }

          // ── 4, 5, 6 & 9. Web Crawling Premium Add-ons (Cyber Risk, Ads Tracker, Email Scraper, Technographic) ──
          const website = lead.website || (metadata.cnpj_info?.nome_fantasia ? `${metadata.cnpj_info.nome_fantasia.toLowerCase().replace(/[^a-z0-9]/g, "")}.com.br` : null);
          const crawlActive = 
            activeSources.has("CYBER_RISK") || 
            activeSources.has("ADS_TRACKER") || 
            activeSources.has("EMAIL_SCRAPER") || 
            activeSources.has("TECHNOGRAPHIC");

          if (crawlActive) {
            console.log(`  🌐 Web Scraper: Crawling "${website || lead.name}" website...`);
            const crawlResult = await crawlWebsite(website || lead.website);

            // A. Cyber Risk Scraper
            if (activeSources.has("CYBER_RISK")) {
              if (crawlResult) {
                const missingSsl = !crawlResult.sslValid;
                const missingLgpd = !crawlResult.html.includes("privacidade") && 
                                    !crawlResult.html.includes("cookies") && 
                                    !crawlResult.html.includes("lgpd");
                const hasVulnerabilities = missingSsl || missingLgpd;
                metadata.cyber_risk = {
                  ssl_valid: crawlResult.sslValid,
                  lgpd_policy_found: !missingLgpd,
                  has_vulnerabilities: hasVulnerabilities,
                  vulnerabilities: [
                    missingSsl ? "Certificado SSL ausente ou inválido" : null,
                    missingLgpd ? "Política de privacidade ou cookies (LGPD) não localizada no site" : null
                  ].filter(Boolean)
                };
              } else {
                // Website inaccessible — report honestly instead of simulating
                metadata.cyber_risk = {
                  analyzed: false,
                  ssl_valid: null,
                  lgpd_policy_found: null,
                  has_vulnerabilities: false,
                  vulnerabilities: [],
                  reason: "Website inacessível ou não encontrado — análise de risco não realizada."
                };
              }

              events.push({
                tenant_id: tid,
                lead_id: lead.id,
                event_type: "cyber_risk_analyzed",
                payload: {
                  ssl_valid: metadata.cyber_risk.ssl_valid,
                  lgpd_policy_found: metadata.cyber_risk.lgpd_policy_found,
                  has_vulnerabilities: metadata.cyber_risk.has_vulnerabilities,
                  vulnerabilities: metadata.cyber_risk.vulnerabilities,
                  reason: metadata.cyber_risk.has_vulnerabilities
                    ? `Riscos de segurança detectados no site: ${metadata.cyber_risk.vulnerabilities.join(", ")}`
                    : "Site verificado e seguro (sem riscos evidentes de SSL/LGPD)."
                },
                created_at: now()
              });
            }

            // B. Ads Pixel Tracker
            if (activeSources.has("ADS_TRACKER")) {
              let fbPixel = false, googleAds = false, tiktokPixel = false;
              if (crawlResult && crawlResult.html) {
                fbPixel = crawlResult.html.includes("connect.facebook.net") || crawlResult.html.includes("fbq(");
                googleAds = crawlResult.html.includes("googletagmanager.com/gtag") || crawlResult.html.includes("googleads");
                tiktokPixel = crawlResult.html.includes("analytics.tiktok.com") || crawlResult.html.includes("ttq(");
              } else {
                // Website inaccessible — no simulation, report honestly
                // fbPixel, googleAds, tiktokPixel remain false
              }

              metadata.ads_tracker = {
                facebook_pixel: fbPixel,
                google_ads: googleAds,
                tiktok_pixel: tiktokPixel,
                ads_active: fbPixel || googleAds || tiktokPixel,
                pixels: [
                  fbPixel ? "Facebook Ads Pixel" : null,
                  googleAds ? "Google Ads Tracker" : null,
                  tiktokPixel ? "TikTok Ads Pixel" : null
                ].filter(Boolean)
              };

              events.push({
                tenant_id: tid,
                lead_id: lead.id,
                event_type: "ads_pixel_detected",
                payload: {
                  ads_active: metadata.ads_tracker.ads_active,
                  pixels: metadata.ads_tracker.pixels,
                  reason: metadata.ads_tracker.ads_active
                    ? `Campanhas de tráfego pago ativas detectadas via: ${metadata.ads_tracker.pixels.join(", ")}`
                    : "Nenhum pixel de anúncios ativos localizado no website."
                },
                created_at: now()
              });
            }

            // C. Website Email Scraper
            if (activeSources.has("EMAIL_SCRAPER")) {
              const scrapedEmails: string[] = [];
              if (crawlResult && crawlResult.html) {
                const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g;
                const matches = crawlResult.html.match(emailRegex) || [];
                const cleanEmails = [...new Set(matches.map(m => m.trim().toLowerCase()))]
                  .filter(e => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".svg") && !e.includes("sentry"));
                scrapedEmails.push(...cleanEmails.slice(0, 3));
              }

              // No fallback — if no emails found, report empty array honestly

              metadata.email_scraper = {
                emails: scrapedEmails,
                emails_count: scrapedEmails.length
              };

              events.push({
                tenant_id: tid,
                lead_id: lead.id,
                event_type: "emails_scraped",
                payload: {
                  emails: scrapedEmails,
                  reason: `Localizados ${scrapedEmails.length} e-mails públicos no website do lead.`
                },
                created_at: now()
              });
            }

            // D. Technographic Detector
            if (activeSources.has("TECHNOGRAPHIC")) {
              const detectedTechs: string[] = [];
              let highValueTools = false;

              if (crawlResult && crawlResult.html) {
                if (crawlResult.html.includes("hubspot")) { detectedTechs.push("HubSpot"); highValueTools = true; }
                if (crawlResult.html.includes("rdstation")) { detectedTechs.push("RD Station"); highValueTools = true; }
                if (crawlResult.html.includes("shopify")) { detectedTechs.push("Shopify"); highValueTools = true; }
                if (crawlResult.html.includes("vtex")) { detectedTechs.push("VTEX"); highValueTools = true; }
                if (crawlResult.html.includes("wp-content")) detectedTechs.push("WordPress");
                if (crawlResult.html.includes("google-analytics")) detectedTechs.push("Google Analytics");
              } else {
                // Website inaccessible — no simulation, report empty honestly
              }

              metadata.technographic = {
                technologies: detectedTechs,
                has_high_value_tools: highValueTools
              };

              events.push({
                tenant_id: tid,
                lead_id: lead.id,
                event_type: "technographics_detected",
                payload: {
                  technologies: detectedTechs,
                  has_high_value_tools: highValueTools,
                  reason: detectedTechs.length > 0
                    ? `Tecnologias identificadas no site: ${detectedTechs.join(", ")}`
                    : "Nenhuma tecnologia notável ou ferramenta B2B identificada no site."
                },
                created_at: now()
              });
            }
          }

          // ── 7. Fleet & Logistics Finder (ANTT/RNTRC heurístico via CNAE) ──
          if (activeSources.has("FLEET_TRACKER") && cnpjInfo) {
            try {
              const cnaeCode = cnpjInfo.cnae?.replace(/\D/g, "") || "";
              const companyNameUpper = (cnpjInfo.razao_social || cnpjInfo.nome_fantasia || "").toUpperCase();

              // CNAEs do setor de transporte (divisões 49, 50, 51, 52, 53)
              const transportCnaePrefixes = ["49", "50", "51", "52", "53"];
              const cnaeIsTransport = transportCnaePrefixes.some(p => cnaeCode.startsWith(p));

              // Palavras-chave indicativas de frota/logística no nome empresarial
              const fleetKeywords = [
                "TRANSPORTE", "TRANSPORTES", "TRANSPORTADORA",
                "LOGISTICA", "LOGÍSTICA", "FRETE", "FRETES",
                "CARGA", "CARGAS", "MUDANCAS", "MUDANÇAS",
                "EXPRESS", "EXPRESSO", "RODOVIARIO", "RODOVIÁRIO",
                "CAMINHAO", "CAMINHÕES", "CAMINHOES",
                "FROTA", "FROTAS", "DELIVERY", "ENTREGAS",
                "DISTRIBUIDORA", "DISTRIBUICAO", "DISTRIBUIÇÃO",
              ];
              const nameIndicators = fleetKeywords.filter(kw => companyNameUpper.includes(kw));
              const hasNameIndicator = nameIndicators.length > 0;

              // Classificação CNAE detalhada para tipos de transporte
              let transportType = "";
              if (cnaeCode.startsWith("4911") || cnaeCode.startsWith("4912")) transportType = "Transporte ferroviário";
              else if (cnaeCode.startsWith("4921") || cnaeCode.startsWith("4922") || cnaeCode.startsWith("4923") || cnaeCode.startsWith("4924") || cnaeCode.startsWith("4929") || cnaeCode.startsWith("4930")) transportType = "Transporte rodoviário";
              else if (cnaeCode.startsWith("50")) transportType = "Transporte aquaviário";
              else if (cnaeCode.startsWith("51")) transportType = "Transporte aéreo";
              else if (cnaeCode.startsWith("52")) transportType = "Atividades auxiliares de transporte";
              else if (cnaeCode.startsWith("53")) transportType = "Correio e entregas";

              const hasFleet = cnaeIsTransport || hasNameIndicator;

              const indicators: string[] = [];
              if (cnaeIsTransport) indicators.push(`CNAE ${cnaeCode} — setor de ${transportType || "transporte"}`);
              if (hasNameIndicator) indicators.push(`Nome contém: ${nameIndicators.join(", ")}`);

              metadata.fleet_tracker = {
                has_fleet: hasFleet,
                cnae_transport: cnaeIsTransport,
                cnae_code: cnaeCode,
                transport_type: transportType || null,
                name_indicators: nameIndicators,
                indicators,
                data_source: "cnae_analysis",
              };

              events.push({
                tenant_id: tid,
                lead_id: lead.id,
                event_type: "fleet_tracker_analyzed",
                payload: {
                  has_fleet: hasFleet,
                  cnae_transport: cnaeIsTransport,
                  transport_type: transportType || null,
                  indicators,
                  reason: hasFleet
                    ? `Indicadores de frota/logística detectados: ${indicators.join("; ")}`
                    : `CNAE (${cnaeCode}) fora do setor de transporte e sem indicadores no nome empresarial.`,
                },
                created_at: now(),
              });

              if (hasFleet) {
                console.log(`  🚛 Fleet Tracker: indicadores detectados — ${indicators.join("; ")}`);
              }
            } catch (fleetErr: any) {
              console.warn(`  ⚠️ Fleet Tracker erro: ${fleetErr.message?.slice(0, 80)}`);
              metadata.fleet_tracker = {
                has_fleet: false,
                available: false,
                reason: `Erro na análise: ${fleetErr.message?.slice(0, 100)}`,
              };
            }
          }

          // ── 8. Judicial & Legal Risk Tracker (Escavador API) ──────────
          if (activeSources.has("JUDICIAL_TRACKER") && cnpjInfo) {
            const ESCAVADOR_TOKEN = Deno.env.get("ESCAVADOR_API_TOKEN");
            if (ESCAVADOR_TOKEN) {
              try {
                const cnpjClean = cleanCnpj(cnpjInfo.cnpj);
                console.log(`  ⚖️ Judicial Tracker: consultando processos para CNPJ ${cnpjClean}...`);

                const escResp = await fetch(
                  `https://api.escavador.com/api/v2/processos?cpf_cnpj=${cnpjClean}`,
                  {
                    method: "GET",
                    headers: {
                      "Authorization": `Bearer ${ESCAVADOR_TOKEN}`,
                      "Accept": "application/json",
                    },
                  }
                );

                if (escResp.ok) {
                  const escData = await escResp.json();
                  const processos = escData.items || escData.data || escData.processos || [];
                  const totalProcessos = escData.total || processos.length || 0;

                  // Classificar tipos de processos
                  const tipos: Record<string, number> = {};
                  const tribunais: Set<string> = new Set();
                  let valorTotal = 0;
                  const processosAtivos: any[] = [];

                  for (const proc of processos.slice(0, 50)) {
                    const tipo = (proc.tipo || proc.classe || proc.natureza || "Outros").toString();
                    tipos[tipo] = (tipos[tipo] || 0) + 1;

                    if (proc.tribunal) tribunais.add(proc.tribunal);

                    const valor = Number(proc.valor_causa || proc.valor || 0);
                    if (valor > 0) valorTotal += valor;

                    // Considerar ativos os que não tem data de arquivamento
                    if (!proc.data_arquivamento && !proc.arquivado) {
                      processosAtivos.push({
                        numero: proc.numero_cnj || proc.numero || null,
                        tipo: tipo,
                        tribunal: proc.tribunal || null,
                        valor: valor || null,
                        data_inicio: proc.data_inicio || proc.data_distribuicao || null,
                      });
                    }
                  }

                  // Classificar áreas judiciais
                  const areaMap: Record<string, string> = {
                    "trabalhist": "Trabalhista",
                    "civel": "Cível", "cível": "Cível",
                    "tributari": "Tributário", "fiscal": "Fiscal",
                    "criminal": "Criminal", "penal": "Penal",
                    "consumidor": "Consumidor",
                  };
                  const areas: Set<string> = new Set();
                  for (const [tipo] of Object.entries(tipos)) {
                    const tipoLower = tipo.toLowerCase();
                    for (const [key, label] of Object.entries(areaMap)) {
                      if (tipoLower.includes(key)) areas.add(label);
                    }
                  }

                  metadata.judicial_tracker = {
                    has_lawsuits: totalProcessos > 0,
                    total_count: totalProcessos,
                    active_count: processosAtivos.length,
                    types: tipos,
                    areas: [...areas],
                    courts: [...tribunais].slice(0, 10),
                    estimated_total_value: valorTotal,
                    top_processes: processosAtivos.slice(0, 5),
                    data_source: "escavador",
                  };

                  console.log(`  ⚖️ Judicial: ${totalProcessos} processo(s) encontrado(s), ${processosAtivos.length} ativo(s)`);
                } else if (escResp.status === 404) {
                  // Nenhum processo encontrado — resultado legítimo
                  metadata.judicial_tracker = {
                    has_lawsuits: false,
                    total_count: 0,
                    active_count: 0,
                    types: {},
                    areas: [],
                    courts: [],
                    estimated_total_value: 0,
                    top_processes: [],
                    data_source: "escavador",
                  };
                  console.log(`  ⚖️ Judicial: nenhum processo encontrado para CNPJ ${cnpjClean}`);
                } else {
                  console.warn(`  ⚠️ Escavador API retornou status ${escResp.status}`);
                  metadata.judicial_tracker = {
                    has_lawsuits: false,
                    available: false,
                    reason: `Escavador API erro: HTTP ${escResp.status}`,
                  };
                }

                events.push({
                  tenant_id: tid,
                  lead_id: lead.id,
                  event_type: "judicial_tracker_analyzed",
                  payload: {
                    has_lawsuits: metadata.judicial_tracker.has_lawsuits,
                    total_count: metadata.judicial_tracker.total_count || 0,
                    active_count: metadata.judicial_tracker.active_count || 0,
                    areas: metadata.judicial_tracker.areas || [],
                    reason: metadata.judicial_tracker.has_lawsuits
                      ? `${metadata.judicial_tracker.total_count} processo(s) encontrado(s) via Escavador. Áreas: ${(metadata.judicial_tracker.areas || []).join(", ") || "não classificado"}.`
                      : metadata.judicial_tracker.reason || "Nenhum processo judicial encontrado vinculado ao CNPJ.",
                  },
                  created_at: now(),
                });
              } catch (judErr: any) {
                console.warn(`  ⚠️ Judicial Tracker erro: ${judErr.message?.slice(0, 80)}`);
                metadata.judicial_tracker = {
                  has_lawsuits: false,
                  available: false,
                  reason: `Erro na consulta: ${judErr.message?.slice(0, 100)}`,
                };
              }
            } else {
              console.log("  ℹ️ ESCAVADOR_API_TOKEN não configurado — Judicial Tracker desativado");
              metadata.judicial_tracker = { has_lawsuits: false, available: false, reason: "API key não configurada" };
            }
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

          // ── Premium Add-on score breakdown additions ──
          if (activeSources.has("INSTAGRAM_SCRAPER") && metadata.instagram) {
            scoreBreakdown["instagram_premium"] = 1.0;
          }
          if (activeSources.has("SOCIO_CONTACT") && metadata.socio_contact) {
            scoreBreakdown["socio_celular_direto"] = 2.0;
          }
          if (activeSources.has("CNPJ_PREMIUM") && metadata.cnpj_premium) {
            const porte = metadata.cnpj_premium.porte;
            if (porte === "EPP" || porte === "MEDIA" || porte === "GRANDE") {
              scoreBreakdown["porte_premium"] = 1.5;
            }
          }
          if (activeSources.has("CYBER_RISK") && metadata.cyber_risk?.has_vulnerabilities) {
            scoreBreakdown["cyber_risk_detectado"] = 1.5;
          }
          if (activeSources.has("ADS_TRACKER") && metadata.ads_tracker?.ads_active) {
            scoreBreakdown["ads_pixel_ativo"] = 1.0;
          }
          if (activeSources.has("EMAIL_SCRAPER") && metadata.email_scraper?.emails?.length > 0) {
            scoreBreakdown["email_direto_encontrado"] = 1.0;
          }
          if (activeSources.has("FLEET_TRACKER") && metadata.fleet_tracker?.has_fleet) {
            scoreBreakdown["frota_logistica_ativa"] = 2.0;
          }
          if (activeSources.has("JUDICIAL_TRACKER") && metadata.judicial_tracker?.has_lawsuits) {
            scoreBreakdown["risco_judicial_detectado"] = 1.5;
          }
          if (activeSources.has("TECHNOGRAPHIC") && metadata.technographic?.has_high_value_tools) {
            scoreBreakdown["tecnologias_alto_valor"] = 1.0;
          }

          const enrichedLead = {
            ...lead,
            whatsapp_valid: whatsappValid,
            partner_or_owner: partnerOrOwner,
            years_of_practice: yearsOfPractice,
            metadata,
          };
          const fitScore = calcFitScore(enrichedLead, campaign, highValueAreas, activeSources);
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
