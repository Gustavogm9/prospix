// supabase/functions/send-messages/index.ts
// ProspIX — Supabase Edge Function: Send Messages
// Called by pg_cron every 5 min (08h-23h BRT)
// 1. Sends first-touch messages to ENRICHED leads (via script + variation)
// 2. Processes pending_outbound records (AI responses queued with delay)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o-mini";

// ── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Get current hour in BRT (UTC-3) */
function getBrtHour(): number {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours();
}

/** Get current date string in BRT (YYYY-MM-DD) */
function getBrtDateStr(): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().split("T")[0];
}

// ── Evolution API Config ────────────────────────────────────────────────────
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
      apiKey: data.evolution_api_key_encrypted || "429683C4C977415CAAFCCE10F7D57E11",
    };
  } catch (_e) {
    return null;
  }
}

// ── OpenAI Helper ───────────────────────────────────────────────────────────
async function callOpenAI(systemPrompt: string, userMessage: string, maxTokens = 100): Promise<string> {
  try {
    const payload = {
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    };

    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) return "";
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("OpenAI Error:", err);
    return "";
  }
}

// ── Intelligence: Pré-Abordagem (Icebreaker) ────────────────────────────────
async function generateIcebreaker(lead: any): Promise<string> {
  // If the lead is generic and has no QSA, fallback to standard
  const hasQsa = lead.metadata?.cnpj_info?.qsa?.length > 0;
  if (!hasQsa && !lead.metadata?.cnpj_info?.cnae_principal) return "";

  const qsaNames = lead.metadata?.cnpj_info?.qsa?.map((q: any) => q.nome).join(", ");
  const cnaeDesc = lead.metadata?.cnpj_info?.cnae_principal?.descricao || lead.profession || "empresa";
  const empresaNome = lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || lead.name;
  const dataAbertura = lead.metadata?.cnpj_info?.dataAbertura || "";

  const systemPrompt = `Você é um SDR gerador de quebra-gelos curtos.
Sua missão é ler os dados públicos de uma empresa e gerar UMA ÚNICA FRASE de elogio ou reconhecimento profissional para iniciar uma conversa no WhatsApp.
Exemplo: "Vi que vocês já estão há 5 anos consolidados no mercado de advocacia em São Paulo..." ou "Parabéns pelo trabalho na Amorim Assessoria!".
NÃO faça perguntas, NÃO se apresente. APENAS gere a frase (curta, simpática e profissional).`;

  const userPrompt = `Empresa: ${empresaNome}\nRamo/CNAE: ${cnaeDesc}\nSócios: ${qsaNames}\nData de Abertura: ${dataAbertura}`;

  const icebreaker = await callOpenAI(systemPrompt, userPrompt, 50);
  return icebreaker;
}

// ── Send WhatsApp Message via Evolution API ─────────────────────────────────
async function sendWhatsApp(
  evoConfig: EvoConfig,
  phone: string,
  text: string,
  mediaUrl?: string | null,
  mediaType?: string | null
): Promise<{ ok: boolean; whatsappMsgId?: string; error?: string }> {
  try {
    let url = `${evoConfig.baseUrl}/message/sendText/${evoConfig.instanceName}`;
    let body: any = { number: phone, text };

    if (mediaUrl) {
      url = `${evoConfig.baseUrl}/message/sendMedia/${evoConfig.instanceName}`;
      body = {
        number: phone,
        mediatype: mediaType || "document",
        mimetype: "application/pdf",
        caption: text,
        media: mediaUrl,
        fileName: "Apresentacao_Prospix.pdf"
      };
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: evoConfig.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return { ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 200)}` };
    }

    const data = await resp.json();
    // Evolution API returns: { key: { id: "whatsapp_msg_id" }, ... }
    const whatsappMsgId = data?.key?.id || data?.messageId || null;
    return { ok: true, whatsappMsgId };
  } catch (err: any) {
    return { ok: false, error: err.message?.slice(0, 200) };
  }
}

// Helper para inferir o gênero a partir do primeiro nome para fins de saudação (Dr./Dra.)
function getGenderFromFirstName(name: string): 'M' | 'F' {
  if (!name) return 'M';
  const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  
  const masculineExceptions = [
    'luca', 'lucas', 'jean', 'george', 'andre', 'felipe', 'alexandre', 'guilherme', 'henrique',
    'mateus', 'matheus', 'jonas', 'isaias', 'elias', 'josias', 'messias', 'natan', 'natanael',
    'samuel', 'daniel', 'gabriel', 'rafael', 'miguel', 'murilo', 'danilo', 'angelo', 'otavio',
    'caio', 'heitor', 'igor', 'yuri', 'enzo', 'davi', 'arthur', 'artur', 'ian', 'caua', 'bento'
  ];
  
  const feminineExceptions = [
    'beatriz', 'alice', 'yasmin', 'iasmin', 'raquel', 'rachel', 'irene', 'miriam', 'ester', 'esther',
    'carol', 'caroline', 'carolina', 'nair', 'ines', 'cleide', 'suely', 'sueli', 'elisabeth',
    'elizabeth', 'elis', 'elisregina', 'ruth', 'rose', 'roseli', 'rosely', 'marlene', 'solange',
    'gisele', 'giselle', 'lourdes', 'margarida', 'vivian', 'viviane', 'tati', 'tatiane', 'carmen',
    'carminha', 'luiza', 'luisa', 'isis', 'yara', 'iara', 'ellen', 'helen', 'helena', 'eliane',
    'elisangela', 'simone', 'denise', 'marise', 'rosane', 'cristiane', 'adriana'
  ];

  if (feminineExceptions.includes(cleanName)) return 'F';
  if (masculineExceptions.includes(cleanName)) return 'M';
  if (cleanName.endsWith('a')) return 'F';
  if (cleanName.endsWith('y') && !['wesley', 'valdecy', 'roney', 'rudy', 'darcy'].includes(cleanName)) return 'F';
  
  return 'M';
}

// ── Variable Substitution ───────────────────────────────────────────────────
async function substituteVariables(message: string, lead: any): Promise<string> {
  let result = message;
  
  // Try to find a real person's name (Partner/Socio) in the enriched CNPJ QSA
  let personName = "";
  if (lead.metadata && lead.metadata.cnpj_info && lead.metadata.cnpj_info.qsa && lead.metadata.cnpj_info.qsa.length > 0) {
    const socio = lead.metadata.cnpj_info.qsa[0].nome;
    if (socio) personName = socio;
  }
  
  // If no socio found, check if lead.name looks like a generic company name
  const leadName = lead.name || "";
  let firstName = "";
  
  if (personName) {
    // Take the first name of the partner and capitalize it
    const parts = personName.split(" ");
    firstName = parts[0];
    firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  } else {
    // Fallback logic
    const lowerName = leadName.toLowerCase();
    const genericTerms = ['advocacia', 'advogado', 'advogados', 'assessoria', 'consultoria', 'escritório', 'clínica', 'centro', 'instituto', 'odontologia', 'saúde'];
    const isGeneric = genericTerms.some(term => lowerName.includes(term));
    
    if (isGeneric) {
      firstName = "Responsável"; // Fallback to "Responsável" if it's a generic company name
    } else {
      // Remove prefixos Dr./Dra. se presentes no nome original do lead para evitar duplicações
      const cleanLeadName = leadName.replace(/^(dr\.|dra\.|dr|dra)\s+/gi, "");
      firstName = cleanLeadName.split(" ")[0] || "";
      firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }
  }

  const company = lead.metadata?.cnpj_info?.nomeFantasia || lead.metadata?.cnpj_info?.razaoSocial || lead.name || "";
  const city = lead.address?.city?.split(" - ")?.[0]?.trim() || "";

  // Inferir o gênero do nome destinatário
  const gender = getGenderFromFirstName(firstName);

  // Ajustar dinamicamente o prefixo Dr. ou Dra. se estiver logo antes do placeholder de Nome
  if (gender === 'F') {
    result = result.replace(/Dr\.\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dra. ');
    result = result.replace(/Dr\b(?!\.)\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dra ');
  } else {
    result = result.replace(/Dra\.\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dr. ');
    result = result.replace(/Dra\b(?!\.)\s+(?=(\[|\{)+Nome(\]|\})+)/gi, 'Dr ');
  }

  // Support both [Nome], [nome], {Nome}, {nome}, {{Nome}}, {{nome}} (one or more curly braces/brackets)
  result = result.replace(/(\[|\{)+Nome(\]|\})+/gi, firstName || leadName);
  result = result.replace(/(\[|\{)+Empresa(\]|\})+/gi, company);
  result = result.replace(/(\[|\{)+Cidade(\]|\})+/gi, city);

  // Icebreaker Logic
  if (result.match(/(\[|\{)+Icebreaker(\]|\})+/gi) || result.match(/(\[|\{)+Quebra-gelo(\]|\})+/gi)) {
    const icebreaker = await generateIcebreaker(lead);
    result = result.replace(/(\[|\{)+Icebreaker(\]|\})+/gi, icebreaker);
    result = result.replace(/(\[|\{)+Quebra-gelo(\]|\})+/gi, icebreaker);
  }
  
  return result;
}

// ── Weighted Variation Selection ────────────────────────────────────────────
function pickVariation(variations: any[]): any {
  const active = variations.filter((v: any) => v.active);
  if (active.length === 0) return null;
  if (active.length === 1) return active[0];

  const totalWeight = active.reduce((sum: number, v: any) => sum + (v.weight || 0), 0);
  if (totalWeight <= 0) return active[0];

  let rand = Math.random() * totalWeight;
  for (const v of active) {
    rand -= v.weight || 0;
    if (rand <= 0) return v;
  }
  return active[active.length - 1];
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 1: Send first-touch messages to ENRICHED leads
// ══════════════════════════════════════════════════════════════════════════════
async function processFirstTouch(tenantId: string, processedLeadIds: Set<string>): Promise<{ queued: number; failed: number }> {
  let queued = 0, failed = 0;
  const brtHour = getBrtHour();
  const brtDate = getBrtDateStr();

  // Get campaign for this tenant (only ACTIVE campaigns)
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "ACTIVE");

  if (!campaigns?.length) {
    return { queued, failed };
  }

  for (const campaign of campaigns) {
    // ── Check hour window (BRT) ──────────────────────────────
    const windowStart = campaign.hour_window_start ?? 8;
    const windowEnd = campaign.hour_window_end ?? 20;
    if (brtHour < windowStart || brtHour >= windowEnd) {
      continue;
    }

    // ── Check daily limit ────────────────────────────────────
    const { count: sentToday } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "OUTBOUND")
      .eq("sender", "AI")
      .gte("created_at", brtDate + "T00:00:00-03:00")
      .lte("created_at", brtDate + "T23:59:59-03:00");

    const dailyLimit = campaign.daily_limit || 50;
    const alreadySent = sentToday || 0;
    const remaining = Math.max(0, dailyLimit - alreadySent);

    if (remaining <= 0) {
      continue;
    }

    // ── Find script for this campaign ────────────────────────
    let scriptId = campaign.active_script_id;
    let script: any = null;

    if (scriptId) {
      const { data: s } = await supabase
        .from("scripts")
        .select("*")
        .eq("id", scriptId)
        .eq("status", "ACTIVE")
        .single();
      script = s;
    }

    if (!script) {
      const { data: scripts } = await supabase
        .from("scripts")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("status", "ACTIVE")
        .eq("category", "APPROACH")
        .order("total_usages", { ascending: false })
        .limit(5);

      if (scripts?.length) {
        script = scripts.find((s: any) => s.target_profession === campaign.profession)
          || scripts.find((s: any) => !s.target_profession)
          || scripts[0];
      }
    }

    if (!script) {
      failed++;
      continue;
    }

    // ── Load script variations ───────────────────────────────
    const { data: variations } = await supabase
      .from("script_variations")
      .select("*")
      .eq("script_id", script.id)
      .eq("active", true);

    if (!variations?.length) {
      failed++;
      continue;
    }

    // ── Find ENRICHED leads for this campaign ────────────────
    let query = supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("tenant_id", tenantId)
      .eq("status", "ENRICHED")
      .is("contacted_at", null)
      .is("queued_first_touch_at", null)
      .not("whatsapp", "is", null);

    if (processedLeadIds.size > 0) {
      query = query.not("id", "in", `(${Array.from(processedLeadIds).map(id => `'${id}'`).join(",")})`);
    }

    const { data: leads } = await query
      .order("fit_score", { ascending: false })
      .limit(5);

    if (!leads?.length) {
      continue;
    }

    // Iterar sobre os candidatos encontrados até achar um válido
    for (const lead of leads) {
      const phone = lead.whatsapp || "";
      const companyName = (lead.name || "").toLowerCase().trim();

      // A. Filtro de Telefone Celular Móvel (Regex)
      const cleanPhone = phone.replace(/\D/g, "");
      const isCelular = /^55\d{2}9\d{8}$/.test(cleanPhone);

      if (!isCelular) {
        console.log(`  🚫 [Filtro Celular] Lead "${lead.name}" (ID: ${lead.id}) pulado. Telefone fixo/inválido: ${phone}`);
        await supabase
          .from("leads")
          .update({ 
            status: "INVALID_NUMBER", 
            updated_at: new Date().toISOString() 
          })
          .eq("id", lead.id);
        
        processedLeadIds.add(lead.id); // Evita reprocessar no mesmo loop
        continue;
      }

      // B. Filtro de Nomes Comerciais/Empresas (Lista Negra)
      const scriptProfession = (script.target_profession || "").toLowerCase();
      const isTargetProfessionLiberal = scriptProfession.includes("médico") || scriptProfession.includes("medico") || scriptProfession.includes("doctor") || scriptProfession.includes("doutor") || scriptProfession.includes("advogado") || scriptProfession.includes("lawyer") || scriptProfession.includes("dentist") || scriptProfession.includes("dentista") || scriptProfession.includes("direito") || scriptProfession.includes("saúde") || scriptProfession.includes("saude");

      if (isTargetProfessionLiberal) {
        const blacklist = ['pousada', 'hotel', 'chácara', 'chacara', 'variedades', 'artesanato', 'imports', 'turismo', 'parque', 'restaurante', 'grill', 'picanha', 'tintas', 'loja', 'loteamento', 'auto', 'mecânica', 'mecanica', 'oficina', 'barbearia', 'salão', 'salao', 'construção', 'construcao', 'distribuidora', 'mercado', 'supermercado', 'padaria', 'confeitaria'];
        const hasCommercialTerm = blacklist.some(term => companyName.includes(term));

        if (hasCommercialTerm) {
          console.log(`  🚫 [Filtro Comercial] Lead "${lead.name}" (ID: ${lead.id}) pulado. Termo comercial incompatível com script liberal.`);
          await supabase
            .from("leads")
            .update({ 
              status: "COMMERCIAL_LEAD_SKIPPED", 
              updated_at: new Date().toISOString() 
            })
            .eq("id", lead.id);

          processedLeadIds.add(lead.id); // Evita reprocessar no mesmo loop
          continue;
        }
      }

      // C. Check optouts
      const { data: optout } = await supabase
        .from("optouts")
        .select("whatsapp")
        .eq("tenant_id", tenantId)
        .eq("whatsapp", phone)
        .maybeSingle();

      if (optout) {
        processedLeadIds.add(lead.id);
        continue;
      }

      // Se passou em todos os filtros, tentar enfileirar
      try {
        const variation = pickVariation(variations);
        if (!variation) {
          processedLeadIds.add(lead.id);
          continue;
        }

        const messageContent = await substituteVariables(variation.message, lead);
        const conversationId = uuid();
        const nowTime = new Date().toISOString();

        const { error: convErr } = await supabase.from("conversations").insert({
          id: conversationId,
          tenant_id: tenantId,
          lead_id: lead.id,
          script_id: script.id,
          status: "ACTIVE",
          ai_handling: true,
          current_node_id: null,
          message_count: 1,
          started_at: nowTime,
          last_message: messageContent.substring(0, 200),
          last_message_at: nowTime,
          last_outbound_at: nowTime,
        });
        if (convErr) throw new Error("Erro ao criar conversação: " + convErr.message);

        const { error: queueErr } = await supabase.from("pending_outbound").insert({
          id: uuid(),
          tenant_id: tenantId,
          conversation_id: conversationId,
          content: messageContent,
          idempotency_key: "active-" + lead.id,
          scheduled_for: nowTime,
          attempts: 0,
          message_type: "OUTBOUND_START",
          priority: 6,
        });
        if (queueErr) throw new Error("Erro ao enfileirar mensagem: " + queueErr.message);

        const { error: leadErr } = await supabase.from("leads").update({
          queued_first_touch_at: nowTime,
          updated_at: nowTime,
        }).eq("id", lead.id);
        if (leadErr) throw new Error("Erro ao atualizar lead: " + leadErr.message);

        const { error: scriptErr } = await supabase.from("scripts").update({
          total_usages: (script.total_usages || 0) + 1,
        }).eq("id", script.id);
        if (scriptErr) throw new Error("Erro ao atualizar script: " + scriptErr.message);

        const { error: variationErr } = await supabase.from("script_variations").update({
          total_sent: (variation.total_sent || 0) + 1,
          updated_at: nowTime,
        }).eq("id", variation.id);
        if (variationErr) throw new Error("Erro ao atualizar variação de script: " + variationErr.message);

        processedLeadIds.add(lead.id);
        queued++;
        break; // Processou 1 lead com sucesso para esta campanha, sai do loop de leads
      } catch (err: any) {
        console.error("  💥 Erro ao enfileirar lead: " + err.message);
        failed++;
        processedLeadIds.add(lead.id);
      }
    }
  }

  return { queued, failed };
}

async function runGuardianWorkerForTenant(tenantId: string, runEndTime: number): Promise<{ sent: number; queued: number; failed: number }> {
  let sent = 0, queued = 0, failed = 0;

  // 1. Tentar Lock Lógico Persistente (timeout de 2 min)
  const nowTime = new Date().toISOString();
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  
  const { data: lockUpdate, error: lockErr } = await supabase
    .from("whatsapp_guardian_status")
    .update({ locked_at: nowTime })
    .eq("tenant_id", tenantId)
    .or(`locked_at.is.null,locked_at.lt.${twoMinutesAgo}`)
    .select();

  if (lockErr || !lockUpdate || lockUpdate.length === 0) {
    console.log("  🔒 [Lock Lógico] Worker para tenant " + tenantId + " já está rodando em outra instância.");
    return { sent: 0, queued: 0, failed: 0 };
  }

  console.log("  🚀 [Lock Lógico] Lock adquirido com sucesso para tenant " + tenantId + ". Iniciando processamento...");

  // Inicializar caches locais de memória para esta rodada contra race conditions
  const processedLeadIds = new Set<string>();
  const processedConversationIds = new Set<string>();

  try {
    while (Date.now() < runEndTime) {
      // 1. Carregar status do Guardião do Tenant
      let { data: guardianStatus } = await supabase
        .from("whatsapp_guardian_status")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (!guardianStatus) {
        const { data: newStatus } = await supabase
          .from("whatsapp_guardian_status")
          .insert({ tenant_id: tenantId, status: "NORMAL", locked_at: nowTime })
          .select("*")
          .single();
        guardianStatus = newStatus;
      }

      const numberState = guardianStatus.status || "NORMAL";

      if (numberState === "PAUSED" || numberState === "SUSPENDED") {
        console.log("  ⏸️ Guardião do tenant " + tenantId + " está pausado ou suspenso. Estado: " + numberState);
        await sleep(5000);
        continue;
      }

      // 2. Coletar estatísticas dinâmicas
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const startOfDay = new Date(new Date().setHours(0,0,0,0)).toISOString();

      const { count: sentLastMinute } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("direction", "OUTBOUND")
        .gte("created_at", oneMinuteAgo);

      const { count: sentLastHour } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("direction", "OUTBOUND")
        .gte("created_at", oneHourAgo);

      const { count: newChatsToday } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("started_at", startOfDay);

      const msgsLastMin = sentLastMinute || 0;
      const msgsLastHr = sentLastHour || 0;
      const chatsToday = newChatsToday || 0;

      // 3. Definir limites conforme o Estado do Número
      let globalMinDelay = 12;
      let globalDelayRange = { min: 18, max: 45 };
      let maxMsgsPerMin = 3;
      let maxMsgsPerHr = 90;
      let maxNewChatsPerHr = 6;
      let maxNewChatsPerDay = 80;

      if (numberState === "COLD") {
        globalMinDelay = 20;
        globalDelayRange = { min: 45, max: 120 };
        maxMsgsPerMin = 2;
        maxMsgsPerHr = 45;
        maxNewChatsPerHr = 3;
        maxNewChatsPerDay = 20;
      } else if (numberState === "HIGH_LOAD") {
        globalMinDelay = 15;
        globalDelayRange = { min: 25, max: 70 };
        maxMsgsPerMin = 3;
        maxMsgsPerHr = 90;
        maxNewChatsPerHr = 0;
      } else if (numberState === "COOLDOWN") {
        globalMinDelay = 60;
        globalDelayRange = { min: 120, max: 600 };
        maxMsgsPerMin = 1;
        maxMsgsPerHr = 15;
        maxNewChatsPerHr = 0;
      }

      // 4. Verificar se há respostas reativas pendentes na fila
      const { count: reactivePendingCount } = await supabase
        .from("pending_outbound")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("sent_at", null)
        .is("failed_at", null)
        .in("message_type", ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"]);

      const hasReactivePending = (reactivePendingCount || 0) > 0;

      // 5. Enfileiramento de Novas Abordagens Ativas (se puder)
      const canQueueNewActive = 
        numberState !== "COOLDOWN" && 
        numberState !== "PAUSED" && 
        numberState !== "SUSPENDED" &&
        !hasReactivePending && 
        msgsLastHr < maxMsgsPerHr && 
        chatsToday < maxNewChatsPerDay;

      if (canQueueNewActive) {
        const { queued: q } = await processFirstTouch(tenantId, processedLeadIds);
        queued += q;
      }

      // 6. Buscar a mensagem mais prioritária na fila a enviar
      let queueQuery = supabase
        .from("pending_outbound")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("sent_at", null)
        .is("failed_at", null)
        .lte("scheduled_for", new Date().toISOString())
        .lt("attempts", 3);

      if (processedConversationIds.size > 0) {
        queueQuery = queueQuery.not("conversation_id", "in", `(${Array.from(processedConversationIds).map(id => `'${id}'`).join(",")})`);
      }

      const { data: queueItems } = await queueQuery
        .order("priority", { ascending: true })
        .order("scheduled_for", { ascending: true })
        .limit(1);


      if (!queueItems || queueItems.length === 0) {
        await sleep(2000);
        continue;
      }

      const item = queueItems[0];
      processedConversationIds.add(item.conversation_id);

      // Obter detalhes da conversa/telefone do lead
      const { data: conversation } = await supabase
        .from("conversations")
        .select("*, leads!conversations_lead_id_fkey(whatsapp, name, id, status)")
        .eq("id", item.conversation_id)
        .single();

      if (!conversation?.leads?.whatsapp) {
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: "Telefone do lead não encontrado",
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);
        failed++;
        continue;
      }

      const phone = (conversation.leads as any).whatsapp;
      const leadName = (conversation.leads as any).name || "Lead";

      // 7. Validar limites antes do envio
      const limitsExceeded = 
        msgsLastMin >= maxMsgsPerMin || 
        msgsLastHr >= maxMsgsPerHr || 
        (item.message_type === "OUTBOUND_START" && chatsToday >= maxNewChatsPerDay);

      if (limitsExceeded) {
        const newScheduled = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        await supabase.from("pending_outbound").update({
          scheduled_for: newScheduled,
          failed_reason: "Limites de envio excedidos. Adiado pelo Guardião."
        }).eq("id", item.id);
        
        console.log("  ⚠️ Limites excedidos para tenant " + tenantId + ". Mensagem reagendada para " + newScheduled);
        await sleep(2000);
        continue;
      }

      // 8. Aplicar delay global
      const minRange = globalDelayRange.min;
      const maxRange = globalDelayRange.max;
      
      let calculatedDelay = Math.floor(Math.random() * (maxRange - minRange + 1)) + minRange;
      const roll = Math.random() * 100;
      if (roll > 80 && roll <= 95) {
        calculatedDelay = Math.floor(calculatedDelay * 1.5);
      } else if (roll > 95) {
        calculatedDelay = Math.floor(calculatedDelay * 2.5);
      }

      calculatedDelay = Math.max(globalMinDelay, calculatedDelay);

      if (guardianStatus.last_global_send_at) {
        const lastSend = new Date(guardianStatus.last_global_send_at).getTime();
        const diffSec = (Date.now() - lastSend) / 1000;
        
        if (diffSec < calculatedDelay) {
          const sleepSec = Math.ceil(calculatedDelay - diffSec);
          console.log("  ⏱️ Guardião: Aguardando " + sleepSec + "s de delay global...");
          await sleep(sleepSec * 1000);
        }
      }

      // 9. Enviar via Evolution API
      const evoConfig = await loadEvoConfig(tenantId);
      if (!evoConfig) {
        await supabase.from("pending_outbound").update({
          failed_at: new Date().toISOString(),
          failed_reason: "Evolution API Key não configurada",
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);
        failed++;
        continue;
      }

      const sendResult = await sendWhatsApp(evoConfig, phone, item.content, item.media_url, item.media_type);
      const nowTime = new Date().toISOString();

      if (sendResult.ok) {
        await supabase.from("pending_outbound").update({
          sent_at: nowTime,
          attempts: (item.attempts || 0) + 1
        }).eq("id", item.id);

        const messageId = uuid();

        let scriptVariationId: string | null = null;
        try {
          const { data: firstOutbound } = await supabase
            .from("messages")
            .select("script_variation_id")
            .eq("conversation_id", item.conversation_id)
            .not("script_variation_id", "is", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (firstOutbound?.script_variation_id) {
            scriptVariationId = firstOutbound.script_variation_id;
          }
        } catch (_) {}

        await supabase.from("messages").insert({
          id: messageId,
          tenant_id: tenantId,
          conversation_id: item.conversation_id,
          direction: "OUTBOUND",
          sender: "AI",
          content: item.content,
          media_url: item.media_url,
          media_type: item.media_type,
          delivery_status: "SENT",
          whatsapp_message_id: sendResult.whatsappMsgId || null,
          script_id: conversation.script_id || null,
          script_node_id: conversation.current_node_id || null,
          script_variation_id: scriptVariationId || null,
          created_at: nowTime,
        });

        await supabase.from("conversations").update({
          last_message: item.content.substring(0, 200),
          last_message_at: nowTime,
          last_outbound_at: nowTime,
          message_count: (conversation.message_count || 0) + 1,
        }).eq("id", item.conversation_id);

        if (item.message_type === "OUTBOUND_START" && conversation.leads?.status === "ENRICHED") {
          await supabase.from("leads").update({
            status: "CONTACTED",
            contacted_at: nowTime,
            updated_at: nowTime,
          }).eq("id", conversation.leads.id);

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: conversation.leads.id,
            event_type: "message_sent",
            payload: {
              conversation_id: item.conversation_id,
              message_id: messageId,
              delivery_status: "SENT",
              reason: "Primeira mensagem ativa enviada com sucesso pelo Guardião",
            },
            created_at: nowTime,
          });

          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: conversation.leads.id,
            event_type: "status_changed",
            payload: { from: "ENRICHED", to: "CONTACTED", reason: "Lead contatado pelo Guardião" },
            created_at: nowTime,
          });
        }

        await supabase.rpc("increment_tenant_usage", {
          p_tenant_id: tenantId,
          p_llm_tokens_input: 0,
          p_llm_tokens_output: 0,
          p_whatsapp_msgs: 1,
          p_maps_calls: 0
        });

        await supabase.from("whatsapp_guardian_status").update({
          last_global_send_at: nowTime,
          updated_at: nowTime,
        }).eq("tenant_id", tenantId);

        sent++;
        console.log("  ✅ [Guard] Mensagem enviada para " + leadName + " (Tipo: " + item.message_type + ")");

        // Registrar Telemetria
        try {
          await supabase.from("whatsapp_guardian_telemetry").insert({
            tenant_id: tenantId,
            message_id: messageId,
            conversation_id: item.conversation_id,
            message_type: item.message_type,
            queued_at: item.created_at,
            scheduled_for: item.scheduled_for,
            sent_at: nowTime,
            delay_applied: calculatedDelay,
            delay_reason: "Delay global de " + calculatedDelay + "s respeitado orgonicamente",
            number_state: numberState,
            queue_position: 1,
            is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
            is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
            sent_last_minute: msgsLastMin + 1,
            sent_last_hour: msgsLastHr + 1,
            new_chats_today: chatsToday + (item.message_type === "OUTBOUND_START" ? 1 : 0),
          });
        } catch (telErr) {
          console.warn("  ⚠️ Falha ao registrar telemetria:", telErr);
        }

      } else {
        const errText = (sendResult.error || "").toLowerCase();
        const isSuspendedError = errText.includes("401") || 
                                 errText.includes("conflict") || 
                                 errText.includes("device_removed") || 
                                 errText.includes("stream errored");

        if (isSuspendedError) {
          console.error(`  🚨 [WhatsApp Suspenso] Detectado erro de suspensão/desconexão para o tenant ${tenantId}: ${sendResult.error}`);
          
          // 1. Atualizar o status do Guardião do Tenant para SUSPENDED e resetar locked_at
          await supabase
            .from("whatsapp_guardian_status")
            .update({ 
              status: "SUSPENDED", 
              locked_at: null,
              updated_at: nowTime 
            })
            .eq("tenant_id", tenantId);

          // 2. Disparar Alerta Operacional
          try {
            await supabase.from("operational_alerts").insert({
              id: uuid(),
              type: "whatsapp_suspension",
              severity: "CRITICAL",
              tenant_id: tenantId,
              title: "WhatsApp Suspenso (Meta)",
              message: `A conexão do WhatsApp foi derrubada pela Meta. Erro: ${sendResult.error}`,
              context: { error: sendResult.error, conversation_id: item.conversation_id, pending_outbound_id: item.id },
              created_at: nowTime,
              updated_at: nowTime
            });
          } catch (alertErr) {
            console.error("  ⚠️ Erro ao inserir alerta operacional:", alertErr);
          }

          // 3. Notificar o Usuário Administrador
          try {
            const { data: userAdmin } = await supabase
              .from("users")
              .select("id")
              .eq("tenant_id", tenantId)
              .order("role", { ascending: true })
              .limit(1)
              .maybeSingle();

            if (userAdmin?.id) {
              await supabase.from("notifications").insert({
                id: uuid(),
                tenant_id: tenantId,
                user_id: userAdmin.id,
                type: "whatsapp_suspension",
                title: "🚨 WhatsApp Desconectado por Suspensão (Meta)",
                body: "Atenção: A conexão do seu WhatsApp foi derrubada pela Meta devido a indícios de suspensão/spam. A prospecção ativa foi congelada para proteger seu número. Reconecte o aparelho nas configurações.",
                created_at: nowTime
              });
            } else {
              console.warn(`  ⚠️ Nenhum usuário encontrado para notificar sobre suspensão no tenant ${tenantId}`);
            }
          } catch (notifErr) {
            console.error("  ⚠️ Erro ao criar notificação de usuário:", notifErr);
          }

          // Registrar falha na telemetria (marcar como duplicado = false, mas com erro)
          try {
            await supabase.from("whatsapp_guardian_telemetry").insert({
              tenant_id: tenantId,
              conversation_id: item.conversation_id,
              message_type: item.message_type,
              queued_at: item.created_at,
              scheduled_for: item.scheduled_for,
              error: sendResult.error,
              number_state: "SUSPENDED",
              is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
              is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
            });
          } catch (_) {}

          // Adiar item de envio atual para que não fique travado tentando de novo infinitamente antes de expirar
          const attempts = (item.attempts || 0) + 1;
          await supabase.from("pending_outbound").update({
            attempts,
            failed_reason: sendResult.error
          }).eq("id", item.id);
          
          failed++;

          // 4. Abortar fila do tenant atual
          break;
        }

        // Fluxo de erro normal (que não é suspensão)
        const attempts = (item.attempts || 0) + 1;
        const updateData: any = {
          attempts,
          failed_reason: sendResult.error
        };
        if (attempts >= 3) {
          updateData.failed_at = nowTime;
        }
        await supabase.from("pending_outbound").update(updateData).eq("id", item.id);
        failed++;

        try {
          await supabase.from("whatsapp_guardian_telemetry").insert({
            tenant_id: tenantId,
            conversation_id: item.conversation_id,
            message_type: item.message_type,
            queued_at: item.created_at,
            scheduled_for: item.scheduled_for,
            error: sendResult.error,
            number_state: numberState,
            is_reactive: ["REACTIVE_REPLY", "CHAT_CONTINUATION", "LOOKUP_REPLY"].includes(item.message_type || ""),
            is_followup: item.message_type === "COMMERCIAL_FOLLOWUP",
          });
        } catch (_) {}

        console.log("  ❌ Falha no envio para " + leadName + " (Tentativa " + attempts + "): " + sendResult.error);
      }

      await sleep(1500);
    }
  } finally {
    try {
      await supabase
        .from("whatsapp_guardian_status")
        .update({ locked_at: null })
        .eq("tenant_id", tenantId)
        .eq("locked_at", nowTime);
      console.log("  🔓 [Lock Lógico] Lock liberado para tenant " + tenantId + ".");
    } catch (errUnlock) {
      console.error("  ⚠️ Erro ao liberar lock lógico:", errUnlock);
    }
  }

  return { sent, queued, failed };
}

serve(async (req: Request) => {
  try {
    console.log("📤 ProspIX WhatsApp Guardian Worker");
    console.log("   Time: " + new Date().toISOString());

    const runEndTime = Date.now() + 50 * 1000; // Loop dura até 50 segundos

    // Ler payload para saber se processamos um tenant específico ou todos os tenants ativos
    let targetTenantId: string | null = null;
    try {
      const body = await req.json();
      if (body?.tenant_id) targetTenantId = body.tenant_id;
    } catch (_) {}

    let tenantIds: string[] = [];

    if (targetTenantId) {
      tenantIds = [targetTenantId];
    } else {
      // Obter todos os tenants ativos que possuem campanhas ativas
      const { data: activeCampaigns } = await supabase
        .from("campaigns")
        .select("tenant_id")
        .eq("status", "ACTIVE");
      
      if (activeCampaigns?.length) {
        tenantIds = [...new Set(activeCampaigns.map((c: any) => c.tenant_id))];
      }
    }

    if (tenantIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No active tenants to process" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("   Processando tenants: " + tenantIds.join(", "));

    const results = [];
    for (const tenantId of tenantIds) {
      const result = await runGuardianWorkerForTenant(tenantId, runEndTime);
      results.push({ tenant_id: tenantId, ...result });
    }

    const summary = {
      ok: true,
      timestamp: new Date().toISOString(),
      results
    };

    console.log("\n🏁 Worker finalizado: " + JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
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
