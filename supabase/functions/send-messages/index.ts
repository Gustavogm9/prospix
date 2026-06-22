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
async function processFirstTouch(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
  details: any[];
}> {
  let sent = 0, skipped = 0, failed = 0;
  const details: any[] = [];
  const brtHour = getBrtHour();
  const brtDate = getBrtDateStr();

  console.log(`\n━━━ First-Touch Messages ━━━`);
  console.log(`  BRT Hour: ${brtHour}, Date: ${brtDate}`);

  // Get all ACTIVE campaigns
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*")
    .eq("status", "ACTIVE");

  if (!campaigns?.length) {
    console.log("  No active campaigns");
    return { sent, skipped, failed, details };
  }

  for (const campaign of campaigns) {
    const tenantId = campaign.tenant_id;
    console.log(`\n  📢 Campaign: ${campaign.name} (${campaign.id})`);

    // ── Check hour window (BRT) ──────────────────────────────
    const windowStart = campaign.hour_window_start ?? 8;
    const windowEnd = campaign.hour_window_end ?? 20;
    if (brtHour < windowStart || brtHour >= windowEnd) {
      console.log(`  ⏰ Outside hour window (${windowStart}-${windowEnd}), current: ${brtHour} BRT`);
      skipped++;
      continue;
    }

    // ── Check daily limit ────────────────────────────────────
    const { count: sentToday } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("direction", "OUTBOUND")
      .eq("sender", "AI")
      .gte("created_at", `${brtDate}T00:00:00-03:00`)
      .lte("created_at", `${brtDate}T23:59:59-03:00`);

    const dailyLimit = campaign.daily_limit || 50;
    const alreadySent = sentToday || 0;
    const remaining = Math.max(0, dailyLimit - alreadySent);

    if (remaining <= 0) {
      console.log(`  🚫 Daily limit reached (${dailyLimit})`);
      skipped++;
      continue;
    }

    console.log(`  📊 Sent today: ${alreadySent}/${dailyLimit}, remaining: ${remaining}`);

    // ── Load Evolution config ────────────────────────────────
    const evoConfig = await loadEvoConfig(tenantId);
    if (!evoConfig) {
      console.log("  ❌ No Evolution API config for tenant");
      failed++;
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

    // Fallback: find an ACTIVE script matching campaign profession or universal
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
        // Prefer one matching the profession, fall back to universal (null target_profession)
        script = scripts.find((s: any) => s.target_profession === campaign.profession)
          || scripts.find((s: any) => !s.target_profession)
          || scripts[0];
      }
    }

    if (!script) {
      console.log("  ❌ No active script found");
      failed++;
      continue;
    }

    console.log(`  📝 Script: ${script.name} (${script.id})`);

    // ── Load script variations ───────────────────────────────
    const { data: variations } = await supabase
      .from("script_variations")
      .select("*")
      .eq("script_id", script.id)
      .eq("active", true);

    if (!variations?.length) {
      console.log("  ❌ No active script variations");
      failed++;
      continue;
    }

    // ── Find ENRICHED leads for this campaign ────────────────
    // Only leads not yet contacted, with valid whatsapp
    const { data: leads } = await supabase
      .from("leads")
      .select("*")
      .eq("campaign_id", campaign.id)
      .eq("tenant_id", tenantId)
      .eq("status", "ENRICHED")
      .is("contacted_at", null)
      .not("whatsapp", "is", null)
      .order("fit_score", { ascending: false })
      .limit(1); // 1 lead per campaign per execution (natural 60s pacing via cron)

    if (!leads?.length) {
      console.log("  📭 No enriched leads to contact");
      continue;
    }

    console.log(`  👥 ${leads.length} leads to contact`);

    // ── Check optouts ────────────────────────────────────────
    const phones = leads.map((l: any) => l.whatsapp);
    const { data: optouts } = await supabase
      .from("optouts")
      .select("whatsapp")
      .eq("tenant_id", tenantId)
      .in("whatsapp", phones);
    const optoutSet = new Set((optouts || []).map((o: any) => o.whatsapp));

    // ── Send messages ────────────────────────────────────────
    for (const lead of leads) {
      try {
        if (optoutSet.has(lead.whatsapp)) {
          console.log(`  ⛔ ${lead.name}: opted out`);
          skipped++;
          continue;
        }

        // Pick a variation by weight
        const variation = pickVariation(variations);
        if (!variation) {
          console.log(`  ⚠️ ${lead.name}: no variation available`);
          skipped++;
          continue;
        }

        // Substitute variables
        const messageContent = await substituteVariables(variation.message, lead);

        // Create conversation
        const conversationId = uuid();
        const now = new Date().toISOString();

        await supabase.from("conversations").insert({
          id: conversationId,
          tenant_id: tenantId,
          lead_id: lead.id,
          script_id: script.id,
          status: "ACTIVE",
          ai_handling: true,
          current_node_id: null,
          message_count: 1,
          started_at: now,
          last_message: messageContent.substring(0, 200),
          last_message_at: now,
          last_outbound_at: now,
        });

        // Send via Evolution API
        const sendResult = await sendWhatsApp(evoConfig, lead.whatsapp, messageContent);

        const messageId = uuid();
        const deliveryStatus = sendResult.ok ? "SENT" : "FAILED";

        // Create message record
        await supabase.from("messages").insert({
          id: messageId,
          tenant_id: tenantId,
          conversation_id: conversationId,
          direction: "OUTBOUND",
          sender: "AI",
          content: messageContent,
          delivery_status: deliveryStatus,
          whatsapp_message_id: sendResult.whatsappMsgId || null,
          script_id: script.id,
          script_variation_id: variation.id,
        });

        if (sendResult.ok) {
          // Update lead status to CONTACTED
          await supabase.from("leads").update({
            status: "CONTACTED",
            contacted_at: now,
            updated_at: now,
          }).eq("id", lead.id);

          // Increment script usage
          await supabase.from("scripts").update({
            total_usages: (script.total_usages || 0) + 1,
          }).eq("id", script.id);

          // Track WhatsApp usage
          await supabase.rpc("increment_tenant_usage", {
            p_tenant_id: tenantId,
            p_llm_tokens_input: 0,
            p_llm_tokens_output: 0,
            p_whatsapp_msgs: 1,
            p_maps_calls: 0
          });

          // Increment variation stats
          await supabase.from("script_variations").update({
            total_sent: (variation.total_sent || 0) + 1,
            updated_at: now,
          }).eq("id", variation.id);

          // Log lead_event
          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "message_sent",
            payload: {
              conversation_id: conversationId,
              message_id: messageId,
              script_name: script.name,
              variation: variation.variant_letter,
              delivery_status: "SENT",
              reason: `Primeira mensagem enviada via script "${script.name}" (variação ${variation.variant_letter})`,
            },
            created_at: now,
          });

          // Status change event
          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "status_changed",
            payload: {
              from: "ENRICHED",
              to: "CONTACTED",
              reason: `Lead contatado via WhatsApp com script "${script.name}"`,
            },
            created_at: now,
          });

          sent++;
          console.log(`  ✅ ${lead.name} → SENT (${variation.variant_letter})`);

          // Track WhatsApp usage
          await supabase.rpc("increment_tenant_usage", {
            p_tenant_id: tenantId,
            p_llm_tokens_input: 0,
            p_llm_tokens_output: 0,
            p_whatsapp_msgs: 1,
            p_maps_calls: 0
          });
        } else {
          // Log failure
          await supabase.from("lead_events").insert({
            tenant_id: tenantId,
            lead_id: lead.id,
            event_type: "message_failed",
            payload: {
              conversation_id: conversationId,
              error: sendResult.error,
              reason: `Falha ao enviar mensagem: ${sendResult.error}`,
            },
            created_at: now,
          });

          failed++;
          console.log(`  ❌ ${lead.name} → FAILED: ${sendResult.error}`);
        }

        // Small delay between sends to avoid rate limiting
        await sleep(1500);
      } catch (err: any) {
        console.error(`  💥 ${lead.name}: ${err.message?.slice(0, 100)}`);
        failed++;
      }
    }

    details.push({
      campaign_id: campaign.id,
      campaign_name: campaign.name,
      leads_found: leads.length,
    });
  }

  return { sent, skipped, failed, details };
}

// ══════════════════════════════════════════════════════════════════════════════
// PART 2: Process pending_outbound (AI delayed responses)
// ══════════════════════════════════════════════════════════════════════════════
async function processPendingOutbound(): Promise<{
  sent: number;
  failed: number;
}> {
  let sent = 0, failed = 0;
  const now = new Date().toISOString();

  console.log(`\n━━━ Pending Outbound (AI Responses) ━━━`);

  // Find pending messages whose scheduled_for has passed
  const { data: pending } = await supabase
    .from("pending_outbound")
    .select("*")
    .is("sent_at", null)
    .is("failed_at", null)
    .lte("scheduled_for", now)
    .lt("attempts", 3)
    .order("scheduled_for", { ascending: true })
    .limit(50);

  if (!pending?.length) {
    console.log("  No pending messages");
    return { sent, failed };
  }

  console.log(`  📬 ${pending.length} pending messages to send`);

  // Group by tenant for Evolution config loading
  const tenantIds = [...new Set(pending.map((p: any) => p.tenant_id))];
  const evoConfigs: Record<string, EvoConfig | null> = {};
  for (const tid of tenantIds) {
    evoConfigs[tid] = await loadEvoConfig(tid);
  }

  for (const item of pending) {
    try {
      const evoConfig = evoConfigs[item.tenant_id];
      if (!evoConfig) {
        console.log(`  ❌ No Evolution config for tenant ${item.tenant_id}`);
        await supabase.from("pending_outbound").update({
          failed_at: now,
          failed_reason: "No Evolution API config",
          attempts: (item.attempts || 0) + 1,
        }).eq("id", item.id);
        failed++;
        continue;
      }

      // Get conversation to find the lead's phone
      const { data: conversation } = await supabase
        .from("conversations")
        .select("*, leads!conversations_lead_id_fkey(whatsapp, name, id)")
        .eq("id", item.conversation_id)
        .single();

      if (!conversation?.leads?.whatsapp) {
        console.log(`  ⚠️ No phone for conversation ${item.conversation_id}`);
        await supabase.from("pending_outbound").update({
          failed_at: now,
          failed_reason: "No phone number found for lead",
          attempts: (item.attempts || 0) + 1,
        }).eq("id", item.id);
        failed++;
        continue;
      }

      // Buscar o script_variation_id da primeira mensagem outbound se houver
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
      } catch (err) {
        console.error("Erro ao buscar script_variation_id da conversa:", err);
      }

      const phone = (conversation.leads as any).whatsapp;
      const leadName = (conversation.leads as any).name || "Lead";

      // Send via Evolution API
      const sendResult = await sendWhatsApp(evoConfig, phone, item.content, item.media_url, item.media_type);

      if (sendResult.ok) {
        // Mark as sent
        await supabase.from("pending_outbound").update({
          sent_at: now,
          attempts: (item.attempts || 0) + 1,
        }).eq("id", item.id);

        // Create message record
        const messageId = uuid();
        await supabase.from("messages").insert({
          id: messageId,
          tenant_id: item.tenant_id,
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
        });

        // Update conversation
        await supabase.from("conversations").update({
          last_message: item.content.substring(0, 200),
          last_message_at: now,
          last_outbound_at: now,
          message_count: (conversation.message_count || 0) + 1,
        }).eq("id", item.conversation_id);

        sent++;
        console.log(`  ✅ ${leadName} → AI response SENT`);

        // Track WhatsApp usage
        await supabase.rpc("increment_tenant_usage", {
          p_tenant_id: item.tenant_id,
          p_llm_tokens_input: 0,
          p_llm_tokens_output: 0,
          p_whatsapp_msgs: 1,
          p_maps_calls: 0
        });
      } else {
        const attempts = (item.attempts || 0) + 1;
        const updateData: any = {
          attempts,
          failed_reason: sendResult.error,
        };
        if (attempts >= 3) {
          updateData.failed_at = now;
        }
        await supabase.from("pending_outbound").update(updateData).eq("id", item.id);

        failed++;
        console.log(`  ❌ ${leadName} → FAILED (attempt ${attempts}): ${sendResult.error}`);
      }

      await sleep(1000);
    } catch (err: any) {
      console.error(`  💥 Pending ${item.id}: ${err.message?.slice(0, 100)}`);
      await supabase.from("pending_outbound").update({
        attempts: (item.attempts || 0) + 1,
        failed_reason: err.message?.slice(0, 200),
      }).eq("id", item.id);
      failed++;
    }
  }

  return { sent, failed };
}

// ── Main Handler ────────────────────────────────────────────────────────────
serve(async (_req: Request) => {
  try {
    console.log(`📤 ProspIX Send-Messages Worker`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   BRT:  ${getBrtHour()}h`);

    // Part 1: First-touch messages to ENRICHED leads
    const firstTouch = await processFirstTouch();

    // Part 2: Process queued AI responses
    const outbound = await processPendingOutbound();

    const summary = {
      ok: true,
      timestamp: new Date().toISOString(),
      first_touch: {
        sent: firstTouch.sent,
        skipped: firstTouch.skipped,
        failed: firstTouch.failed,
        campaigns: firstTouch.details,
      },
      pending_outbound: {
        sent: outbound.sent,
        failed: outbound.failed,
      },
    };

    console.log(`\n🏁 Summary: ${firstTouch.sent} first-touch + ${outbound.sent} AI responses sent`);

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
