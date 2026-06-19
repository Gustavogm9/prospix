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

function buildLeadEnrichedPrompt(lead: any): string {
  if (!lead) return "";
  
  let prompt = "\n\n### 👤 DADOS ENRIQUECIDOS DO LEAD (Use para contextualizar e personalizar a abordagem):\n";
  
  const firstName = lead.name ? lead.name.split(" ")[0] : "Lead";
  prompt += `- **Nome de tratamento**: ${firstName}\n`;
  
  if (lead.profession) {
    prompt += `- **Profissão/Nicho**: ${lead.profession}\n`;
  }
  
  if (lead.partner_or_owner !== null) {
    prompt += `- **Cargo/Socio-proprietário**: ${lead.partner_or_owner ? "Sim" : "Não"}\n`;
  }
  
  if (lead.years_of_practice) {
    prompt += `- **Tempo de atuação**: ${lead.years_of_practice} anos\n`;
  }

  if (lead.fit_score) {
    prompt += `- **Score de Qualificação Interno**: ${lead.fit_score}/100\n`;
  }

  if (lead.metadata) {
    const meta = typeof lead.metadata === "string" ? JSON.parse(lead.metadata) : lead.metadata;
    if (meta.company_name) {
      prompt += `- **Nome da Empresa**: ${meta.company_name}\n`;
    }
    if (meta.segment) {
      prompt += `- **Segmento da Empresa**: ${meta.segment}\n`;
    }
    if (meta.revenue_range || meta.estimated_revenue) {
      prompt += `- **Faturamento estimado**: ${meta.revenue_range || meta.estimated_revenue}\n`;
    }
    if (meta.employee_count) {
      prompt += `- **Número de funcionários**: ${meta.employee_count}\n`;
    }
    if (meta.city || meta.state) {
      prompt += `- **Localização**: ${meta.city || ""}${meta.city && meta.state ? "/" : ""}${meta.state || ""}\n`;
    }
  }

  if (lead.email) {
    const parts = lead.email.split("@");
    if (parts.length === 2) {
      const maskedEmail = parts[0].slice(0, 3) + "***@" + parts[1];
      prompt += `- **E-mail (mascarado)**: ${maskedEmail}\n`;
    }
  }

  return prompt;
}

// ── Guardrails ──────────────────────────────────────────────────────────────
function applyGuardrails(text: string): string {
  let cleaned = text.replace(/<[^>]*>?/gm, ''); // remove html
  cleaned = cleaned.replace(/^(System:|AI:|Assistant:)\s*/i, ''); // remove prefixes
  
  // Remove any price mentions (R$ XX, XX reais, etc.)
  cleaned = cleaned.replace(/R\$\s*[\d.,]+/gi, "[consulta personalizada]");
  cleaned = cleaned.replace(/\d+\s*reais/gi, "[consulta personalizada]");

  // Remove guarantee/promise keywords
  cleaned = cleaned.replace(/garant(o|imos|ia)/gi, "buscamos");
  cleaned = cleaned.replace(/prometo|prometemos/gi, "trabalhamos para");

  // Truncate to max 300 chars
  if (cleaned.length > 300) {
    cleaned = cleaned.slice(0, 297) + "...";
  }

  return cleaned.trim();
}

function getStartNode(flow: any): any {
  if (!flow || !flow.nodes || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return null;
  const nodes = flow.nodes;
  
  const startNode = nodes.find((n: any) => 
    n.type === 'trigger' || 
    n.type === 'start' || 
    String(n.id).toLowerCase().includes('start') || 
    String(n.id).toLowerCase().includes('trigger')
  );
  if (startNode) return startNode;
  
  const edges = flow.edges || [];
  const targetIds = new Set(edges.map((e: any) => e.target));
  const noIncoming = nodes.find((n: any) => !targetIds.has(n.id));
  if (noIncoming) return noIncoming;

  return nodes[0];
}

async function classifyNextNode(
  leadMessage: string,
  currentNode: any,
  outgoingEdges: any[],
  nodes: any[]
): Promise<string | null> {
  if (!outgoingEdges || outgoingEdges.length === 0) return null;
  if (outgoingEdges.length === 1) {
    return outgoingEdges[0].target;
  }

  const options = outgoingEdges.map((e, idx) => {
    const targetNode = nodes.find(n => n.id === e.target);
    const label = e.data?.label || e.label || `Avançar para ${targetNode?.data?.title || targetNode?.type || e.target}`;
    return `${idx + 1}. ID: ${e.target} - Condição: "${label}"`;
  }).join("\n");

  const prompt = `Você é um motor de máquina de estados de conversação B2B.
O lead está na etapa: "${currentNode.data?.title || currentNode.type || currentNode.id}"
A mensagem que o lead enviou é: "${leadMessage}"

Temos as seguintes transições de saída possíveis a partir deste nó:
${options}

Qual opção de saída (ou seja, o ID do nó de destino) descreve melhor a resposta do lead?
Responda APENAS com o ID do nó escolhido (ex: "node_1234"). Se nenhuma opção se adequar bem, responda com o ID da opção que parecer mais razoável ou que represente um fluxo padrão de avanço.`;

  try {
    const result = await callOpenAI(prompt, leadMessage, 0.1, 100);
    const matchedId = result.content.trim();
    
    const isValid = outgoingEdges.some(e => e.target === matchedId);
    if (isValid) return matchedId;

    const found = outgoingEdges.find(e => matchedId.includes(e.target));
    if (found) return found.target;
  } catch (err) {
    console.error("Erro ao classificar transição de nó:", err);
  }

  return outgoingEdges[0].target;
}

function parseFlowToPrompt(flow: any): string {
  if (!flow || !flow.nodes || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return "";
  const nodes = flow.nodes;
  const edges = flow.edges || [];
  
  let instructions = "\n### FLUXOGRAMA DE DECISÃO DA CONVERSA (STATE MACHINE)\nSiga RIGOROSAMENTE estas etapas do fluxo para este roteiro. Mapeie em que ponto a conversa está e responda de acordo com os próximos nós:\n\n";
  
  // Sort nodes generally by Y position to read top to bottom logically
  const sortedNodes = [...nodes].sort((a: any, b: any) => (a.position?.y || 0) - (b.position?.y || 0));

  for (const node of sortedNodes) {
    const title = node.data?.title || node.type;
    const content = node.data?.message || node.data?.content || '';
    if (!title && !content) continue;
    
    instructions += `- **[${title}]**: ${content}\n`;
    
    // find connected edges
    const outgoing = edges.filter((e: any) => e.source === node.id);
    if (outgoing.length > 0) {
      for (const edge of outgoing) {
        const targetNode = nodes.find((n: any) => n.id === edge.target);
        if (targetNode) {
          const condition = edge.data?.label ? `Se o usuário se encaixar em "${edge.data.label}"` : `Se a conversa avançar`;
          instructions += `   -> ${condition} => Vá para o passo: [${targetNode.data?.title || targetNode.type}]\n`;
        }
      }
    }
  }
  
  instructions += "\n(Sua tarefa é identificar em qual etapa a conversa está atualmente e responder com base no que está escrito no nó correto e nas ramificações possíveis.)\n";
  return instructions;
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

    // (Removed fromMe check here, moved down to handle manual messages)

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

    // Buscar o script_variation_id da primeira mensagem outbound se houver
    let scriptVariationId: string | null = null;
    try {
      const { data: firstOutbound } = await supabase
        .from("messages")
        .select("script_variation_id")
        .eq("conversation_id", conversation.id)
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

    // ── Insert message ───────────────────────────────
    const now = new Date().toISOString();

    if (fromMe) {
      // Check if we already have this message (sent by our UI/AI)
      const { data: existingMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversation.id)
        .or(`whatsapp_message_id.eq.${whatsappMessageId},content.eq.${messageContent}`)
        .limit(1)
        .maybeSingle();

      if (existingMsg) {
        // We already know about this message
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "outbound message already logged" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // If not found, it's a manual message from Giovane's phone!
      const outMsgId = uuid();
      await supabase.from("messages").insert({
        id: outMsgId,
        tenant_id: tenantId,
        conversation_id: conversation.id,
        direction: "OUTBOUND",
        sender: "USER",
        content: messageContent,
        delivery_status: "DELIVERED",
        whatsapp_message_id: whatsappMessageId,
        script_id: conversation.script_id || null,
        script_node_id: conversation.current_node_id || null,
        script_variation_id: scriptVariationId || null,
      });

      // Update conversation and turn OFF AI handling
      await supabase.from("conversations").update({
        last_message: messageContent.substring(0, 200),
        last_message_at: now,
        last_outbound_at: now,
        ai_handling: false, // Turn off AI because the human took over on their phone!
        message_count: (conversation.message_count || 0) + 1,
      }).eq("id", conversation.id);

      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "manual outbound message saved" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Proceed with inbound message processing ─────────────────
    const inboundMsgId = uuid();

    await supabase.from("messages").insert({
      id: inboundMsgId,
      tenant_id: tenantId,
      conversation_id: conversation.id,
      direction: "INBOUND",
      sender: "LEAD",
      content: messageContent,
      delivery_status: "DELIVERED",
      whatsapp_message_id: whatsappMessageId,
      script_id: conversation.script_id || null,
      script_node_id: conversation.current_node_id || null,
      script_variation_id: scriptVariationId || null,
    });

    // Update conversation timestamps + last message preview
    await supabase.from("conversations").update({
      last_message: messageContent.substring(0, 200),
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
    // Se for NOT_INTERESTED, ativa o Guardião 1 (Radar Opt-Out)
    if (classification.intent === "NOT_INTERESTED") {
      await supabase.from("optouts").upsert({
        tenant_id: tenantId,
        whatsapp: lead.whatsapp,
        reason: "Lead respondeu que não tem interesse",
        source: "ai_classification",
      }, { onConflict: "tenant_id,whatsapp" });

      await supabase.from("conversations").update({
        ai_handling: false, // Desliga a IA para este lead
        status: "CLOSED",
      }).eq("id", conversation.id);

      const reply = "Entendo perfeitamente. Agradeço pela atenção e não entrarei mais em contato! Desejo sucesso para você e sua empresa.";
      await supabase.from("pending_outbound").insert({
        id: uuid(),
        tenant_id: tenantId,
        conversation_id: conversation.id,
        content: reply,
        idempotency_key: `optout_${inboundMsgId}`,
        scheduled_for: new Date(Date.now() + 5000).toISOString(),
        attempts: 0,
      });

      console.log("  🛑 Guardião 1: Opt-Out ativado. IA desligada e mensagem de saída enfileirada.");
      return new Response(JSON.stringify({
        ok: true,
        message_id: inboundMsgId,
        intent: classification.intent,
        action: "optout_processed",
      }), {
        headers: { "Content-Type": "application/json" },
      });
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

    // ── Anti-Loop Guardian ─────────────────────────────
    // Se a conversa já teve 10 mensagens (5 trocas) e não agendou, desliga IA e escala.
    if ((conversation.message_count || 0) >= 10 && lead.status !== "MEETING_SCHEDULED" && classification.intent !== "SCHEDULED") {
      await supabase.from("conversations").update({
        ai_handling: false,
        status: "ESCALATED",
        escalated_reason: "Limite de mensagens atingido (Anti-Loop)",
      }).eq("id", conversation.id);

      console.log("  🛑 Guardião Anti-Loop ativado. Escalonando para humano.");
      
      const reply = "Essa é uma ótima pergunta! Vou pedir pro Giovane te explicar certinho por áudio em breve, ok?";
      await supabase.from("pending_outbound").insert({
        id: uuid(),
        tenant_id: tenantId,
        conversation_id: conversation.id,
        content: reply,
        idempotency_key: `antiloop_${inboundMsgId}`,
        scheduled_for: new Date(Date.now() + 5000).toISOString(),
        attempts: 0,
      });

      return new Response(JSON.stringify({
        ok: true,
        message_id: inboundMsgId,
        action: "anti_loop_escalated",
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
    let scriptFlow: any = null;
    let guardiansConfig: any = null;
    
    if (conversation.script_id) {
      const { data: script } = await supabase
        .from("scripts")
        .select("base_message, name, ai_tools, ai_instructions, flow, restrictions, context_documents, guardians_config")
        .eq("id", conversation.script_id)
        .single();
      scriptBaseMessage = script?.base_message || null;
      aiTools = script?.ai_tools || [];
      aiInstructions = script?.ai_instructions || null;
      scriptFlow = script?.flow || null;
      guardiansConfig = script?.guardians_config || null;

      if (script?.restrictions) {
        aiInstructions = (aiInstructions || "") + "\n\n### ⛔ RESTRIÇÕES DA IA (O que você NUNCA deve falar/fazer):\n" + script.restrictions;
      }
      if (script?.context_documents && Array.isArray(script.context_documents) && script.context_documents.length > 0) {
        let docsPrompt = "\n\n### 📖 MATERIAIS DE APOIO (Documentos de Referência):\nUse as informações contidas nos links abaixo para tirar dúvidas técnicas do lead se ele perguntar:\n";
        script.context_documents.forEach((doc: any) => {
          docsPrompt += `- **${doc.title}**: ${doc.url}\n`;
        });
        aiInstructions = (aiInstructions || "") + docsPrompt;
      }
    }

    let isStateMachineEnabled = false;
    try {
      const { data: flag } = await supabase
        .from("feature_flags")
        .select("enabled")
        .eq("key", "FLAG_SCRIPT_STATE_MACHINE")
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .order("tenant_id", { nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (flag?.enabled) {
        isStateMachineEnabled = true;
      }
    } catch (err) {
      console.error("Erro ao verificar feature flag FLAG_SCRIPT_STATE_MACHINE:", err);
    }

    if (isStateMachineEnabled && scriptFlow) {
      const startNode = getStartNode(scriptFlow);
      let currentNode = scriptFlow.nodes.find((n: any) => n.id === conversation.current_node_id) || startNode;

      if (currentNode) {
        let currentNodeId = currentNode.id;
        const outgoingEdges = (scriptFlow.edges || []).filter((e: any) => e.source === currentNode.id);

        if (recentMessages && recentMessages.length > 0 && outgoingEdges.length > 0) {
          const transitionNodeId = await classifyNextNode(messageContent, currentNode, outgoingEdges, scriptFlow.nodes);
          if (transitionNodeId) {
            const nextNode = scriptFlow.nodes.find((n: any) => n.id === transitionNodeId);
            if (nextNode) {
              currentNode = nextNode;
              currentNodeId = nextNode.id;
              
              await supabase
                .from("conversations")
                .update({ current_node_id: currentNodeId })
                .eq("id", conversation.id);
            }
          }
        } else if (!conversation.current_node_id) {
          await supabase
            .from("conversations")
            .update({ current_node_id: currentNodeId })
            .eq("id", conversation.id);
        }

        const nodeTitle = currentNode.data?.title || currentNode.type || "Etapa Atual";
        const nodeContent = currentNode.data?.message || currentNode.data?.content || "";

        const stateMachineInstructions = `
### 🤖 ETAPA DO FLUXO ATIVA (MÁQUINA DE ESTADOS):
Você está na etapa de conversa: **[${nodeTitle}]**
Mensagem de referência ou instrução para esta etapa: "${nodeContent}"
Importante: Gere a resposta para o lead com base nesta etapa atual e garanta que está avançando no fluxo de conversa de forma natural.
`;
        aiInstructions = (aiInstructions || "") + "\n" + stateMachineInstructions;
        console.log(`  🤖 Máquina de Estados: Nó ativo ${nodeTitle} (${currentNodeId}) injetado no prompt.`);
      }
    } else if (scriptFlow) {
      const flowInstructions = parseFlowToPrompt(scriptFlow);
      if (flowInstructions) {
        aiInstructions = (aiInstructions || "") + "\n\n" + flowInstructions;
      }
    }

    // ── Camada 3: Guardiões Injetados ────────────────────────
    
    // Buscar o Contexto de Negócio do Tenant
    const { data: businessContext } = await supabase
      .from("tenant_business_context")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (businessContext) {
      let personaGuardrail = "\n\n### 🧬 CONTEXTO DO NEGÓCIO & PERSONALIDADE:\n";
      if (businessContext.persona_name) personaGuardrail += `- **Seu Nome**: ${businessContext.persona_name}\n`;
      if (businessContext.persona_role) personaGuardrail += `- **Seu Cargo**: ${businessContext.persona_role}\n`;
      if (businessContext.business_description) personaGuardrail += `- **Sobre o Negócio/Diferencial**: ${businessContext.business_description}\n`;
      if (businessContext.tone_of_voice) personaGuardrail += `- **Tom de Voz OBRIGATÓRIO**: ${businessContext.tone_of_voice}\n`;
      if (businessContext.common_objections) personaGuardrail += `- **Como lidar com objeções**: ${businessContext.common_objections}\n`;
      if (businessContext.standard_approaches) personaGuardrail += `- **Abordagens de Ouro**: ${businessContext.standard_approaches}\n`;
      
      aiInstructions = (aiInstructions || "") + personaGuardrail;
      console.log("  🧬 Contexto de Negócio injetado no prompt.");
    }

    const leadEnrichedPrompt = buildLeadEnrichedPrompt(lead);
    if (leadEnrichedPrompt) {
      aiInstructions = (aiInstructions || "") + leadEnrichedPrompt;
      console.log("  👤 Dados Enriquecidos do Lead injetados no prompt.");
    }

    const objectionsEnabled = guardiansConfig?.objections_enabled !== false;
    const qualificationEnabled = guardiansConfig?.qualification_enabled !== false;
    const shortResponsesEnabled = guardiansConfig?.short_responses_enabled !== false;

    if (classification.intent === "OBJECTION" && objectionsEnabled) {
      let matchedObjectionsText = "";
      try {
        const { data: dbObjections } = await supabase
          .from("objections")
          .select("title, pattern, response")
          .eq("tenant_id", tenantId)
          .or(`script_id.eq.${conversation.script_id},script_id.is.null`);

        if (dbObjections && dbObjections.length > 0) {
          matchedObjectionsText = "\n\n### 🛡️ RESPOSTAS DE CONTORNO ESPECÍFICAS CADASTRADAS:\nUse as regras de resposta abaixo caso o lead apresente alguma destas objeções:\n";
          dbObjections.forEach((obj: any) => {
            matchedObjectionsText += `- Se a objeção for sobre **${obj.title}** (ou semelhante a **"${obj.pattern}"**), use como guia esta resposta: "${obj.response}"\n`;
          });
        }
      } catch (err) {
        console.error("Erro ao buscar objeções estruturadas:", err);
      }

      const objectionGuardrail = `

### 🛡️ GUARDIÃO DE OBJEÇÕES (Framework JEB BLOUNT - Objections):
O lead acabou de apresentar uma objeção (tempo, preço, status quo, já tem fornecedor, etc).
APLIQUE IMEDIATAMENTE O FRAMEWORK L-D-A (Ledge, Disrupt, Ask) de Jeb Blount para contornar a objeção:
1. **Ledge (Apoio/Empatia):** Concorde ou valide a objeção rapidamente. Nunca bata de frente. (Ex: "Entendo perfeitamente a correria", "Faz todo sentido você já estar satisfeito com seu fornecedor atual").
2. **Disrupt (Ruptura):** Use um padrão de interrupção (ex técnica do "É exatamente por isso..."). (Ex: "É exatamente por isso que eu estou te chamando, a maioria dos nossos clientes também pensava assim até descobrir que...").
3. **Ask (Pergunta para Retomar Controle):** Feche a mensagem sempre com uma pergunta focada em fechar a reunião ou avançar para o próximo passo.
REGRA DE OURO: Integre as respostas recomendadas de contorno abaixo ao fluxo L-D-A.${matchedObjectionsText}`;
      aiInstructions = (aiInstructions || "") + objectionGuardrail;
      console.log("  🛡️ Guardião 2: Framework de Objeção (Jeb Blount) e Objeções Estruturadas injetados no prompt.");
    }

    if ((classification.intent === "INTERESTED" || classification.intent === "QUESTION") && qualificationEnabled) {
      // Guardião SPIN / BANT / Receita Previsível
      const salesFrameworkGuardrail = `

### 🛡️ GUARDIÃO DE QUALIFICAÇÃO E DIAGNÓSTICO (SPIN / BANT / Receita Previsível):
O lead demonstrou interesse inicial ou fez uma pergunta. 
NÃO VOMITE A AGENDA NEM DETALHES DO PRODUTO IMEDIATAMENTE.
Use as seguintes técnicas combinadas:
1. **Receita Previsível (Aaron Ross):** Mantenha mensagens CURTAS (formato "Spear-phishing"). Responda a dúvida dele de forma muito direta e passe a bola de volta. Se houver dúvida sobre quem decide, pergunte sutilmente: "Normalmente, você é a pessoa que lidera esses projetos por aí?"
2. **SPIN Selling (Neil Rackham):** Comece a mapear a dor. Se a dor não estiver clara, faça 1 (apenas uma) pergunta de PROBLEMA ou IMPLICAÇÃO. (Ex: "Como você tem lidado com [Problema X] hoje?" ou "Qual impacto isso tem gerado na operação?").
3. **BANT:** O objetivo final é entender Budget, Authority, Need e Timeframe, mas não pareça um interrogatório. Faça no máximo UMA pergunta por mensagem.
REGRA: Responda a pergunta do lead in 1 frase. Em seguida, faça UMA pergunta SPIN focada em mapear o cenário atual (Need/Problema).`;
      aiInstructions = (aiInstructions || "") + salesFrameworkGuardrail;
      console.log("  🛡️ Guardião 4: SPIN/BANT/Receita Previsível Injetado no prompt.");

      const agendaGuardrail = `

### 🛡️ GUARDIÃO DE AGENDA (FECHAMENTO):
Só proponha a agenda se: 1) O lead pedir, OU 2) A dor (Need do BANT) já estiver clara após as perguntas do SPIN.
- Quando propuser agenda, use o fechamento direto: "Faz sentido batermos um papo rápido de 15 min? Tenho uma brecha na Segunda às 10h ou às 14h, qual fica melhor?"
- Nunca marque fim de semana.`;
      aiInstructions = (aiInstructions || "") + agendaGuardrail;
      console.log("  🛡️ Guardião 3: Contexto Vivo de Agenda injetado no prompt.");
    }

    if (shortResponsesEnabled) {
      const shortResponseGuardrail = `

### 🛡️ GUARDIÃO DE RESPOSTAS CURTAS:
OBRIGATÓRIO: Escreva mensagens CURTAS e DIRETA ao ponto (máximo de 2 parágrafos curtos). Nunca mande textos longos ou listas explicativas longas. Simule uma conversa humana fluida.`;
      aiInstructions = (aiInstructions || "") + shortResponseGuardrail;
      console.log("  🛡️ Guardião 5: Respostas Curtas (Spear-phishing) injetado no prompt.");
    }

    // Sleep Mode Guardrail
    // Get current hour in UTC-3 (BRT)
    const currentHourBRT = new Date().getUTCHours() - 3; 
    const normalizedHour = currentHourBRT < 0 ? currentHourBRT + 24 : currentHourBRT;
    let isSleepMode = false;
    let scheduledTime = new Date(Date.now() + 5000);

    if (normalizedHour >= 20 || normalizedHour < 8) {
      isSleepMode = true;
      const sleepModeGuardrail = `\n\n### 🌙 GUARDIÃO DE HORÁRIO COMERCIAL (SLEEP MODE):\nATENÇÃO: Você está recebendo essa mensagem fora do horário comercial (${normalizedHour}h). \n- Aja como se tivesse visto a mensagem no dia seguinte de manhã.\n- OBRIGATÓRIO COMEÇAR A MENSAGEM COM: 'Bom dia! Desculpe a demora, já não estava no escritório ontem...'\n- Depois disso, siga a resposta normalmente.`;
      aiInstructions = (aiInstructions || "") + sleepModeGuardrail;
      console.log(`  🌙 Guardião Sleep Mode Ativado (Hora BRT: ${normalizedHour}h).`);
      
      // Calculate delay to next 08:00 AM BRT
      // BRT is UTC-3, so 08:00 BRT is 11:00 UTC
      const nextSend = new Date();
      nextSend.setUTCHours(11, 0, 0, 0); // 08:00 AM BRT
      if (normalizedHour >= 20) {
        nextSend.setUTCDate(nextSend.getUTCDate() + 1);
      }
      scheduledTime = nextSend;
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
              confirmation_message: { type: "string", description: "A mensagem que acompanhará o PDF." }
            },
            required: ["confirmation_message"]
          }
        }
      });
    }

    if (aiTools?.includes("CALENDAR_WRITE")) {
      openAiTools.push({
        type: "function",
        function: {
          name: "schedule_meeting",
          description: "Agenda a reunião confirmada com o lead e gera o Dossiê de Pré-Reunião para o Humano.",
          parameters: {
            type: "object",
            properties: {
              confirmation_message: { type: "string", description: "Mensagem final agradecendo e confirmando o agendamento." },
              dossier_summary: { type: "string", description: "Resumo em tópicos das dores, objeções superadas e perfil do cliente para o humano ler antes da reunião." }
            },
            required: ["confirmation_message", "dossier_summary"]
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
        
        if (call.function?.name === "schedule_meeting") {
          try {
            const args = JSON.parse(call.function.arguments);
            responseText = args.confirmation_message || "Agendado com sucesso! Nos falamos em breve.";
            
            // Camada 4: Dossiê Pós-Agendamento
            const dossier = args.dossier_summary;
            
            // Update Lead and Conversation Status
            await supabase.from("leads").update({ status: "MEETING_SCHEDULED" }).eq("id", lead.id);
            await supabase.from("conversations").update({ status: "SCHEDULED", ai_handling: false }).eq("id", conversation.id);
            
            // Create Notification with Dossier
            const { data: tenantAdmin } = await supabase.from("users").select("id").eq("tenant_id", tenantId).limit(1).single();
            if (tenantAdmin && dossier) {
              await supabase.from("notifications").insert({
                id: uuid(),
                tenant_id: tenantId,
                user_id: tenantAdmin.id,
                title: `Reunião Agendada: ${lead.name}`,
                body: `Dossiê da IA: ${dossier.slice(0, 200)}...`,
                type: "meeting_scheduled",
                link: `/inbox?conversation=${conversation.id}`
              });
            }
            
            console.log(`  📅 Guardião 4: Dossiê Gerado e Reunião Agendada!`);
          } catch(e) {
            console.error("Error processing schedule_meeting tool:", e);
          }
        }
      }
    }

    console.log(`  💡 AI Response: ${responseText.slice(0, 80)}...`);

    // ── Step 5: Queue in pending_outbound with delay ─────────
    const delaySec = randomDelay(30, 120);
    const scheduledFor = isSleepMode ? scheduledTime.toISOString() : new Date(Date.now() + delaySec * 1000).toISOString();
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

    // Increment AI LLM usage
    await supabase.rpc("increment_tenant_usage", {
      p_tenant_id: tenantId,
      p_llm_tokens_input: aiResponse.tokensIn || 0,
      p_llm_tokens_output: aiResponse.tokensOut || 0,
      p_whatsapp_msgs: 0,
      p_maps_calls: 0
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
