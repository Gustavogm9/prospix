import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { v4 as uuid } from "https://esm.sh/uuid@9.0.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${Deno.env.get("CRON_SECRET")}` && !req.headers.get("x-local-dev")) {
      return new Response('Unauthorized', { status: 401 });
    }

    const now = new Date();
    // 24 hours ago
    const cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    console.log(`\n🔍 Searching for stalled conversations (last outbound before ${cutoffDate})...`);

    // We want active conversations where the AI sent the last message and lead hasn't replied for 24h.
    // Since we don't have a direct "last_sender" column on conversation, we can query conversations 
    // where last_message_at <= cutoffDate, and then check the last message.
    const { data: conversations, error: convError } = await supabase
      .from("conversations")
      .select("*, leads!conversations_lead_id_fkey(name, whatsapp)")
      .eq("status", "CONVERSING")
      .eq("ai_handling", true)
      .lte("last_message_at", cutoffDate)
      .limit(50);

    if (convError) throw convError;

    if (!conversations || conversations.length === 0) {
      console.log("✅ No stalled conversations found.");
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const conv of conversations) {
      // Fetch the last message to ensure it was from the AI
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("direction, content")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (!lastMsg || lastMsg.direction !== "OUTBOUND") {
        continue;
      }

      // Check if the last message was already a follow-up
      if (lastMsg.content.includes("Conseguiu ver a mensagem") || lastMsg.content.includes("conseguiu dar uma olhada")) {
        // Stop following up, they really ghosted us.
        console.log(`🛑 Conversation ${conv.id} already received a follow-up. Escalating or pausing.`);
        await supabase.from("conversations").update({
          ai_handling: false,
          status: "ESCALATED",
          escalated_reason: "Lead ghosted after follow-up",
        }).eq("id", conv.id);
        continue;
      }

      const leadName = conv.leads?.name?.split(" ")[0] || "tudo bem";
      const followUpMsg = `Oi ${leadName}, conseguiu dar uma olhadinha na minha última mensagem? Só pra eu saber se podemos prosseguir ou se deixo para falar com você em outro momento!`;

      console.log(`📩 Queueing follow-up for ${conv.id} (Lead: ${leadName})`);

      await supabase.from("pending_outbound").insert({
        id: uuid(),
        tenant_id: conv.tenant_id,
        conversation_id: conv.id,
        content: followUpMsg,
        idempotency_key: `followup_${conv.id}_${now.getTime()}`,
        scheduled_for: now.toISOString(),
        attempts: 0,
      });

      processed++;
    }

    console.log(`\n🎉 Processed ${processed} follow-ups.`);

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("💥 Error processing follow-ups:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
