import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function buildMessage(leadName: string | null) {
  const firstName = leadName ? leadName.split(" ")[0] : "tudo bem";
  return `Oi ${firstName}, tudo bem? Queria agradecer pela confiança! A propósito, você tem o contato de 2 ou 3 colegas ou sócios no mesmo perfil que o seu, que também poderiam se beneficiar dessa proteção? Pode me passar os nomes e números por aqui mesmo.`;
}

serve(async (req: Request) => {
  try {
    console.log(`⏱️ Cron Referrals Loop triggered at ${new Date().toISOString()}`);

    // Fetch leads closed between 24 and 48 hours ago
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, tenant_id, name, whatsapp, metadata, closed_at")
      .not("closed_at", "is", null)
      .lt("closed_at", oneDayAgo)
      .gt("closed_at", twoDaysAgo);

    if (error) {
      throw error;
    }

    if (!leads || leads.length === 0) {
      console.log("No leads eligible for referral loop right now.");
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const lead of leads) {
      const meta = lead.metadata || {};
      
      // Check if we already triggered it
      if (meta.referral_loop_triggered) {
        continue;
      }

      console.log(`Sending referral request to lead ${lead.id} (${lead.name})`);

      // 1. Enqueue message to pending_outbound
      const message = buildMessage(lead.name);
      
      // We need a conversation ID. Find the active conversation.
      const { data: convs } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(1);
        
      const conversationId = convs && convs.length > 0 ? convs[0].id : null;

      if (!conversationId) {
         console.log(`  Skipping lead ${lead.id} - no active conversation found`);
         continue;
      }

      await supabase.from("pending_outbound").insert({
        tenant_id: lead.tenant_id,
        conversation_id: conversationId,
        content: message,
        idempotency_key: `ref_loop_${lead.id}`,
        scheduled_for: new Date().toISOString(),
        attempts: 0,
      });

      // 2. Mark metadata as triggered
      meta.referral_loop_triggered = true;
      meta.referral_asked_at = new Date().toISOString();

      await supabase
        .from("leads")
        .update({ metadata: meta })
        .eq("id", lead.id);

      // 3. Log event
      await supabase.from("lead_events").insert({
        tenant_id: lead.tenant_id,
        lead_id: lead.id,
        event_type: "referral_loop_triggered",
        payload: {
          message_preview: message.slice(0, 50),
          closed_at: lead.closed_at
        },
        created_at: new Date().toISOString()
      });

      processed++;
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("💥 Error in cron-referrals:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
