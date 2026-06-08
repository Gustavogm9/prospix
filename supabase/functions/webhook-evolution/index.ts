// supabase/functions/webhook-evolution/index.ts
// ProspIX — Supabase Edge Function: Webhook from Evolution API
// Receives MESSAGES_UPSERT events, classifies intent with GPT-4o-mini,
// generates AI responses, and queues them in pending_outbound with human-like delay.

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
function uuid(): string {
  return crypto.randomUUID();
}

/** Random delay between min and max seconds */
function randomDelay(minSec: number, maxSec: number): number {
  return Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
}

/** Normalize Brazilian phone: strip non-digits, ensure 55 prefix */
function normalizePhone(raw: string): string {
  let phone = raw.replace(/\D/g, "");
  // Remove @s.whatsapp.net or @c.us suffix if present
  phone = phone.replace(/@.*$/, "");
  if (phone.startsWith("55") && phone.length >= 12) return phone;
  if (phone.length === 11 || phone.length === 10) return `55${phone}`;
  return phone;
}

// ── OpenAI Call ──────────────────────────────────────────────────────────────
async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  temperature = 0.7,
  maxTokens = 300,
  model = MODEL,
  tools?: any[]
): Promise<{ content: string; toolCalls: any[]; tokensIn: number; tokensOut: number; latencyMs: number }> {
  const start = Date.now();
  
  const payload: any = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const latencyMs = Date.now() - start;

  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`OpenAI ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await resp.json();
  const message = data.choices?.[0]?.message;
  const content = message?.content?.trim() || "";
  const toolCalls = message?.tool_calls || [];
  const tokensIn = data.usage?.prompt_tokens || 0;
  const tokensOut = data.usage?.completion_tokens || 0;

  return { content, toolCalls, tokensIn, tokensOut, latencyMs };
}

// ── Referral Extraction ──────────────────────────────────────────────────────
async function extractReferrals(messageContent: string): Promise<Array<{ name: string; phone: string }>> {
  const prompt = `Você é um extrator de contatos.
O usuário acabou de mandar uma mensagem com indicações (nomes e telefones).
Extraia todos os contatos fornecidos na mensagem.
RETORNE APENAS UM JSON ARRAY VÁLIDO. Sem formatação markdown, sem crases, sem texto adicional.
O array deve ter o formato:
[{"name": "Nome da pessoa", "phone": "Número de telefone"}]
Se não encontrar nada, retorne [].`;

  const result = await callOpenAI(prompt, messageContent, 0.1, 150);
  try {
    const cleanContent = result.content.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleanContent);
  } catch (err) {
    console.error("Failed to parse referrals JSON", result.content);
    return [];
  }
}

// ── Intent Classification ───────────────────────────────────────────────────
const CLASSIFIER_PROMPT = `Você é um classificador de intenções para prospecção B2B de seguros.
Classifique a mensagem do lead em UMA das categorias:
- INTERESTED: demonstra interesse no produto/serviço
- NOT_INTERESTED: rejeita, pede para parar, não quer
- QUESTION: faz pergunta sobre o produto/serviço
- OBJECTION: levanta objeção (preço, já tem, não precisa)
- CALLBACK_REQUEST: pede para ligar, falar com humano
- GREETING: saudação simples (oi, bom dia)
- REFERRAL_PROVIDED: envia nomes e números de telefone de indicações (amigos, sócios, colegas)
Responda APENAS com a categoria.`;

const VALID_INTENTS = [
  "INTERESTED",
  "NOT_INTERESTED",
  "QUESTION",
  "OBJECTION",
  "CALLBACK_REQUEST",
  "GREETING",
  "REFERRAL_PROVIDED",
];

async function classifyIntent(
  messageContent: string
): Promise<{ intent: string; confidence: number; tokensIn: number; tokensOut: number; latencyMs: number }> {
  const result = await callOpenAI(CLASSIFIER_PROMPT, messageContent, 0.2, 20);
  const raw = result.content.toUpperCase().trim();
  const intent = VALID_INTENTS.find((i) => raw.includes(i)) || "GREETING";
  const confidence = intent === raw ? 0.95 : 0.75;

  return {
    intent,
    confidence,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
  };
}

// ── Response Generation ─────────────────────────────────────────────────────
function buildResponsePrompt(scriptBaseMessage: string | null, aiTools?: string[] | null, aiInstructions?: string | null): string {
  let prompt = aiInstructions || `Você é um consultor de seguros profissional e simpático.
Você está prospectando via WhatsApp.
Responda de forma natural, curta (máx 2 parágrafos), e consultiva.
Nunca mencione preços específicos.
Não faça promessas.
Use o roteiro como guia mas adapte à conversa.
Se o lead não tem interesse, agradeça educadamente.`;

  if (scriptBaseMessage) {
    prompt += `\n\nRoteiro base:\n${scriptBaseMessage}`;
  }

  if (aiTools && aiTools.length > 0) {
    prompt += `\n\n### FERRAMENTAS AUTORIZADAS (Você pode avisar o lead que usará estas ferramentas se necessário):`;
    if (aiTools.includes('CALENDAR_READ')) {
      prompt += `\n- CONSULTAR AGENDA: Você tem acesso à agenda e pode dizer algo como "Vou verificar a agenda do Giovane e te passo opções de horários."`;
    }
    if (aiTools.includes('CALENDAR_WRITE')) {
      prompt += `\n- AGENDAR REUNIÃO: Você está autorizado a agendar reuniões se o lead confirmar um horário: "Vou deixar esse horário reservado na agenda!"`;
    }
    if (aiTools.includes('SEND_PDF')) {
      prompt += `\n- ENVIAR PDF: Você pode enviar o PDF institucional se solicitado: "Posso enviar nosso material em PDF se quiser conhecer mais." (Apenas avise, o sistema enviará o arquivo na próxima mensagem).`;
    }
    if (aiTools.includes('ESCALATE')) {
      prompt += `\n- ENCAMINHAR PARA HUMANO: Você tem autorização para passar a conversa para um especialista humano (Giovane) se o lead quiser ligação ou fizer perguntas complexas: "Vou pedir pro Giovane te ligar ou continuar o atendimento por aqui."`;
    }
  }

  return prompt;
}

function buildConversationContext(messages: any[], leadName: string): string {
  let ctx = `Conversa com ${leadName || "o lead"}:\n\n`;
  for (const msg of messages) {
    const who = msg.direction === "INBOUND" ? "Lead" : "Consultor";
    ctx += `${who}: ${msg.content}\n`;
  }
  return ctx;
}

// ── Guardrails ──────────────────────────────────────────────────────────────
function applyGuardrails(text: string): string {
  let result = text;

  // Truncate to max 300 chars
  if (result.length > 300) {
    result = result.slice(0, 297) + "...";
  }

  // Remove any price mentions (R$ XX, XX reais, etc.)
  result = result.replace(/R\$\s*[\d.,]+/gi, "[consulta personalizada]");
  result = result.replace(/\d+\s*reais/gi, "[consulta personalizada]");

  // Remove guarantee/promise keywords
  result = result.replace(/garant(o|imos|ia)/gi, "buscamos");
  result = result.replace(/prometo|prometemos/gi, "trabalhamos para");

  return result;
}

// ── Status update logic based on intent ─────────────────────────────────────
function getLeadStatusFromIntent(intent: string, currentStatus: string): string | null {
  switch (intent) {
    case "INTERESTED":
      return "CONVERSING";
    case "NOT_INTERESTED":
      return "NOT_INTERESTED";
    case "CALLBACK_REQUEST":
      return "ESCALATED_HUMAN";
    case "QUESTION":
    case "OBJECTION":
    case "GREETING":
      if (currentStatus === "CONTACTED" || currentStatus === "NO_RESPONSE") {
        return "CONVERSING";
      }
      return null;
    default:
      return null;
  }
}

function getConversationStatusFromIntent(intent: string): string | null {
  switch (intent) {
    case "NOT_INTERESTED":
      return "CLOSED";
    case "CALLBACK_REQUEST":
      return "ESCALATED";
    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Webhook Handler
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const payload = await req.json();
    const event = payload.event;

    console.log(`📩 Webhook received: ${event}`);

    // Only handle incoming messages
    if (event !== "messages.upsert" && event !== "MESSAGES_UPSERT") {
      // Also handle message status updates
      if (event === "messages.update" || event === "MESSAGES_UPDATE") {
        return await handleMessageStatusUpdate(payload);
      }
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: `event: ${event}` }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Extract message data from webhook payload ────────────
    const messageData = payload.data;
    if (!messageData) {
      return new Response(JSON.stringify({ ok: false, error: "No message data" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Evolution API webhook structure
    const remoteJid = messageData.key?.remoteJid || "";
    const fromMe = messageData.key?.fromMe || false;
    const whatsappMessageId = messageData.key?.id || "";

    // Skip outbound messages (sent by us)
    if (fromMe) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "outbound message" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Skip group messages
    if (remoteJid.includes("@g.us")) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "group message" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract text content
    const messageContent =
      messageData.message?.conversation ||
      messageData.message?.extendedTextMessage?.text ||
      messageData.message?.imageMessage?.caption ||
      messageData.message?.videoMessage?.caption ||
      "";

    if (!messageContent.trim()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "non-text message" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract and normalize phone number
    const rawPhone = remoteJid.replace(/@.*$/, "");
    const phone = normalizePhone(rawPhone);

    console.log(`  📱 From: ${phone}`);
    console.log(`  💬 Content: ${messageContent.slice(0, 80)}`);

    // ── Identify the instance → tenant ───────────────────────
    const instanceName = payload.instance || payload.instanceName || "";
    const { data: tenantSecret } = await supabase
      .from("tenant_secrets")
      .select("tenant_id")
      .eq("evolution_instance_name", instanceName)
      .single();

    if (!tenantSecret?.tenant_id) {
      console.log(`  ❌ No tenant found for instance: ${instanceName}`);
      return new Response(JSON.stringify({ ok: false, error: "Unknown instance" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const tenantId = tenantSecret.tenant_id;
    console.log(`  🏢 Tenant: ${tenantId}`);

    // ── Find lead by phone number ────────────────────────────
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("whatsapp", phone)
      .single();

    if (!lead) {
      console.log(`  ⚠️ No lead found for phone: ${phone}`);
      // Could create a new lead here in the future
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unknown lead" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`  👤 Lead: ${lead.name} (${lead.id})`);

    // ── Find or create conversation ──────────────────────────
    let conversation: any = null;

    // Look for an active conversation with this lead
    const { data: existingConv } = await supabase
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("lead_id", lead.id)
      .in("status", ["ACTIVE", "PAUSED"])
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (existingConv) {
      conversation = existingConv;
    } else {
      // Create a new conversation
      const convId = uuid();
      const now = new Date().toISOString();
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({
          id: convId,
          tenant_id: tenantId,
          lead_id: lead.id,
          status: "ACTIVE",
          ai_handling: true,
          message_count: 0,
          started_at: now,
          last_message_at: now,
        })
        .select()
        .single();
      conversation = newConv;
    }

    if (!conversation) {
      console.log("  ❌ Failed to find/create conversation");
      return new Response(JSON.stringify({ ok: false, error: "conversation error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Insert inbound message ───────────────────────────────
    const inboundMsgId = uuid();
    const now = new Date().toISOString();

    await supabase.from("messages").insert({
      id: inboundMsgId,
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: "INBOUND",
      sender: "LEAD",
      content: messageContent,
      delivery_status: "DELIVERED",
      whatsapp_message_id: whatsappMessageId,
    });

    // Update conversation timestamps
    await supabase.from("conversations").update({
      last_message_at: now,
      last_inbound_at: now,
      message_count: (conversation.message_count || 0) + 1,
    }).eq("id", conversation.id);

    // Update lead first_response_at if this is the first reply
    if (!lead.first_response_at) {
      await supabase.from("leads").update({
        first_response_at: now,
        updated_at: now,
      }).eq("id", lead.id);
    }

    // Log message_received event
    await supabase.from("lead_events").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      event_type: "message_received",
      payload: {
        conversation_id: conversation.id,
        message_id: inboundMsgId,
        content_preview: messageContent.slice(0, 100),
        reason: `Mensagem recebida do lead: "${messageContent.slice(0, 60)}"`,
      },
      created_at: now,
    });

    // ── AI Handling ──────────────────────────────────────────
    if (!conversation.ai_handling) {
      console.log("  🤷 AI handling disabled, message saved only");
      return new Response(JSON.stringify({
        ok: true,
        message_id: inboundMsgId,
        ai_handling: false,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("  🤖 AI handling active, processing...");

    // ── Step 1: Classify intent ──────────────────────────────
    const classification = await classifyIntent(messageContent);
    console.log(`  🎯 Intent: ${classification.intent} (${classification.confidence})`);

    // Update the inbound message with intent info
    await supabase.from("messages").update({
      intent_detected: classification.intent,
      intent_confidence: classification.confidence,
      llm_model: MODEL,
      llm_tokens_input: classification.tokensIn,
      llm_tokens_output: classification.tokensOut,
      llm_latency_ms: classification.latencyMs,
    }).eq("id", inboundMsgId);

    // Log intent classified event
    await supabase.from("lead_events").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      event_type: "intent_classified",
      payload: {
        conversation_id: conversation.id,
        intent: classification.intent,
        confidence: classification.confidence,
        message_preview: messageContent.slice(0, 60),
        reason: `Intenção classificada como "${classification.intent}" com ${(classification.confidence * 100).toFixed(0)}% de confiança`,
      },
      created_at: now,
    });

    // ── Step 2: Update lead and conversation status ──────────
    const newLeadStatus = getLeadStatusFromIntent(classification.intent, lead.status);
    if (newLeadStatus && newLeadStatus !== lead.status) {
      await supabase.from("leads").update({
        status: newLeadStatus,
        updated_at: now,
      }).eq("id", lead.id);

      await supabase.from("lead_events").insert({
        tenant_id: tenantId,
        lead_id: lead.id,
        event_type: "status_changed",
        payload: {
          from: lead.status,
          to: newLeadStatus,
          reason: `Status atualizado de "${lead.status}" para "${newLeadStatus}" após classificação de intenção "${classification.intent}"`,
          triggered_by: "ai_classification",
        },
        created_at: now,
      });
    }

    const newConvStatus = getConversationStatusFromIntent(classification.intent);
    if (newConvStatus) {
      const convUpdate: any = { status: newConvStatus };
      if (newConvStatus === "CLOSED") convUpdate.closed_at = now;
      if (newConvStatus === "ESCALATED") convUpdate.escalated_reason = `Lead solicitou: ${classification.intent}`;
      await supabase.from("conversations").update(convUpdate).eq("id", conversation.id);
    }

    // ── Step 3: Handle special intents ───────────────────────
    // If NOT_INTERESTED, add to optouts
    if (classification.intent === "NOT_INTERESTED") {
      await supabase.from("optouts").upsert({
        tenant_id: tenantId,
        whatsapp: lead.whatsapp,
        reason: "Lead respondeu que não tem interesse",
        source: "ai_classification",
      }, { onConflict: "tenant_id,whatsapp" });
    }

    if (classification.intent === "CALLBACK_REQUEST") {
      await supabase.from("conversations").update({
        ai_handling: false,
        status: "ESCALATED",
        escalated_reason: "Lead solicitou contato humano",
      }).eq("id", conversation.id);

      // Notifica o tenant
      const { data: tenantAdmin } = await supabase.from("users").select("id").eq("tenant_id", tenantId).limit(1).single();
      if (tenantAdmin) {
        await supabase.from("notifications").insert({
          id: uuid(),
          tenant_id: tenantId,
          user_id: tenantAdmin.id,
          title: "Lead Solicitou Contato Humano",
          body: `O lead ${lead.name || lead.whatsapp} solicitou atendimento humano.`,
          type: "lead_escalated",
          link: `/inbox?conversation=${conversation.id}`
        });
      }

      console.log("  📞 Callback requested, AI disabled, escalated");
      return new Response(JSON.stringify({
        ok: true,
        message_id: inboundMsgId,
        intent: classification.intent,
        action: "escalated_to_human",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // If REFERRAL_PROVIDED, extract the referrals and create new leads
    if (classification.intent === "REFERRAL_PROVIDED") {
      console.log("  🤝 Referral detected! Extracting...");
      const referrals = await extractReferrals(messageContent);
      if (referrals.length > 0) {
        console.log(`  🎉 Extracted ${referrals.length} referrals!`);
        for (const ref of referrals) {
          await supabase.from("leads").insert({
            tenant_id: tenantId,
            name: ref.name,
            whatsapp: ref.phone,
            source: "REFERRAL",
            metadata: {
              referred_by_id: lead.id,
              referred_by_name: lead.name
            }
          });
        }
        
        await supabase.from("lead_events").insert({
          tenant_id: tenantId,
          lead_id: lead.id,
          event_type: "referrals_provided",
          payload: { count: referrals.length, referrals },
          created_at: now,
        });

        const reply = "Muito obrigado pelas indicações! Vou entrar em contato com eles. Pode deixar que não serei chato haha. Mais alguma coisa que eu possa ajudar?";
        
        await supabase.from("pending_outbound").insert({
          tenant_id: tenantId,
          conversation_id: conversation.id,
          content: reply,
          idempotency_key: `ref_ack_${inboundMsgId}`,
          scheduled_for: new Date(Date.now() + 5000).toISOString(),
          attempts: 0,
        });

        return new Response(JSON.stringify({
          ok: true,
          message_id: inboundMsgId,
          intent: classification.intent,
          referrals_extracted: referrals.length
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── Step 4: Generate AI response ─────────────────────────
    // Fetch last 10 messages for context
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("direction, sender, content, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(10);

    // Fetch the active script for context
    let scriptBaseMessage: string | null = null;
    let aiTools: string[] | null = [];
    let aiInstructions: string | null = null;
    if (conversation.script_id) {
      const { data: script } = await supabase
        .from("scripts")
        .select("base_message, name, ai_tools, ai_instructions")
        .eq("id", conversation.script_id)
        .single();
      scriptBaseMessage = script?.base_message || null;
      aiTools = script?.ai_tools || [];
      aiInstructions = script?.ai_instructions || null;
    }

    const { data: tenantAiConfig } = await supabase
      .from("tenant_ai_configs")
      .select("system_model, system_temperature")
      .eq("tenant_id", tenantId)
      .single();

    const modelToUse = tenantAiConfig?.system_model || MODEL;
    const tempToUse = tenantAiConfig?.system_temperature ?? 0.7;

    const responsePrompt = buildResponsePrompt(scriptBaseMessage, aiTools, aiInstructions);
    const conversationCtx = buildConversationContext(recentMessages || [], lead.name || "");

    const openAiTools = [];
    if (aiTools?.includes("SEND_PDF")) {
      openAiTools.push({
        type: "function",
        function: {
          name: "send_pdf",
          description: "Envia o PDF de apresentação da empresa para o cliente.",
          parameters: {
            type: "object",
            properties: {
              confirmation_message: {
                type: "string",
                description: "A mensagem que acompanhará o PDF."
              }
            },
            required: ["confirmation_message"]
          }
        }
      });
    }

    const aiResponse = await callOpenAI(responsePrompt, conversationCtx, tempToUse, 300, modelToUse, openAiTools);
    let responseText = applyGuardrails(aiResponse.content);
    let mediaUrl = null;
    let mediaType = null;

    if (aiResponse.toolCalls?.length > 0) {
      for (const call of aiResponse.toolCalls) {
        if (call.function?.name === "send_pdf") {
          try {
            const args = JSON.parse(call.function.arguments);
            responseText = args.confirmation_message || "Segue a nossa apresentação em PDF:";
            mediaUrl = "https://prospix.com.br/wp-content/uploads/2023/10/Apresentacao-Prospix.pdf";
            mediaType = "document";
          } catch(e) {}
        }
      }
    }

    console.log(`  💡 AI Response: ${responseText.slice(0, 80)}...`);

    // ── Step 5: Queue in pending_outbound with delay ─────────
    const delaySec = randomDelay(30, 120);
    const scheduledFor = new Date(Date.now() + delaySec * 1000).toISOString();
    const idempotencyKey = `ai-${conversation.id}-${inboundMsgId}`;

    await supabase.from("pending_outbound").insert({
      id: uuid(),
      tenant_id: tenantId,
      conversation_id: conversation.id,
      content: responseText,
      media_url: mediaUrl,
      media_type: mediaType,
      idempotency_key: idempotencyKey,
      scheduled_for: scheduledFor,
      attempts: 0,
    });

    // Log AI response generated event
    await supabase.from("lead_events").insert({
      tenant_id: tenantId,
      lead_id: lead.id,
      event_type: "ai_response_generated",
      payload: {
        conversation_id: conversation.id,
        intent: classification.intent,
        response_preview: responseText.slice(0, 80),
        delay_seconds: delaySec,
        scheduled_for: scheduledFor,
        model: MODEL,
        tokens_in: aiResponse.tokensIn,
        tokens_out: aiResponse.tokensOut,
        latency_ms: aiResponse.latencyMs,
        reason: `Resposta IA gerada (${aiResponse.tokensOut} tokens) e agendada com atraso de ${delaySec}s para parecer humana`,
      },
      created_at: now,
    });

    console.log(`  ⏱️ Scheduled for +${delaySec}s (${scheduledFor})`);

    return new Response(JSON.stringify({
      ok: true,
      message_id: inboundMsgId,
      intent: classification.intent,
      confidence: classification.confidence,
      response_scheduled: scheduledFor,
      delay_seconds: delaySec,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Webhook error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ── Handle message status updates (DELIVERED, READ) ─────────────────────────
async function handleMessageStatusUpdate(payload: any): Promise<Response> {
  try {
    const statusData = payload.data;
    if (!statusData) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const whatsappMsgId = statusData.key?.id || statusData.keyId;
    const status = statusData.status;
    if (!whatsappMsgId || !status) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Map Evolution status to our enum
    let deliveryStatus: string | null = null;
    const now = new Date().toISOString();
    const updateData: any = {};

    switch (status) {
      case "DELIVERY_ACK":
      case 3:
        deliveryStatus = "DELIVERED";
        updateData.delivered_at = now;
        break;
      case "READ":
      case 4:
        deliveryStatus = "READ";
        updateData.read_at = now;
        break;
      case "PLAYED":
      case 5:
        deliveryStatus = "READ";
        updateData.read_at = now;
        break;
      default:
        return new Response(JSON.stringify({ ok: true, skipped: true, status }), {
          headers: { "Content-Type": "application/json" },
        });
    }

    if (deliveryStatus) {
      updateData.delivery_status = deliveryStatus;
      await supabase
        .from("messages")
        .update(updateData)
        .eq("whatsapp_message_id", whatsappMsgId);
    }

    return new Response(JSON.stringify({ ok: true, updated: deliveryStatus }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Status update error:", err.message);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
