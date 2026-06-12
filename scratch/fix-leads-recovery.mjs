import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config({ path: path.resolve('apps/web/.env') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const tenantId = '220e676e-ef8d-4312-814d-fb4dca962c06';
  
  console.log('1. FIXING SCRIPT VARIATIONS...');
  
  // Update all script variations to not promise "10 min amanhã"
  const { data: variations } = await supabaseAdmin
    .from('script_variations')
    .select('*')
    .eq('tenant_id', tenantId);

  for (const v of variations) {
    let newMsg = v.message;
    // Replace 10 min with 30 min
    newMsg = newMsg.replace(/10 min(utinhos)?/gi, '30 min');
    // Replace "amanhã" com "nos próximos dias"
    newMsg = newMsg.replace(/amanhã/gi, 'nos próximos dias');
    
    if (newMsg !== v.message) {
      await supabaseAdmin.from('script_variations').update({ message: newMsg }).eq('id', v.id);
      console.log('Updated variation', v.id);
    }
  }

  console.log('2. FETCHING AFFECTED LEADS...');
  
  const tenMinsAgo = new Date(Date.now() - 30 * 60000).toISOString();
  const { data: leads } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'ENRICHED')
    .is('contacted_at', null)
    .gte('updated_at', tenMinsAgo);

  console.log('Found', leads?.length || 0, 'potentially affected leads.');

  // Get evo config
  const { data: tenantSettings } = await supabaseAdmin
    .from('tenant_settings')
    .select('whatsapp_instance_name')
    .eq('tenant_id', tenantId)
    .single();

  const evoUrl = process.env.EVOLUTION_API_URL;
  const instanceName = tenantSettings.whatsapp_instance_name;
  const globalApiKey = process.env.EVOLUTION_GLOBAL_API_KEY;

  let recovered = 0;

  for (const lead of leads) {
    if (!lead.whatsapp) continue;
    
    try {
      const firstName = (lead.name || '').split(' ')[0];
      
      let apologyMsg = 'Opa ' + firstName + ', tudo bem? Meu WhatsApp acabou enviando uma mensagem com erro de digitação no seu nome agora pouco, desculpe! \uD83D\uDE05\n\nMas como eu ia dizendo, sou especialista da MetLife e ajudo profissionais com soluções de proteção financeira e seguro de vida. Sei que sua rotina é intensa, podemos agendar um bate-papo rápido de 30 min nos próximos dias para eu te explicar melhor como funciona?';
      
      if (lead.campaign_id === '19ef40b7-12a7-4de1-849c-278eda4def67' || lead.campaign_id === 'e6bf8967-f9d8-46f1-a4f0-857b57eef382') {
          apologyMsg = 'Opa ' + firstName + ', tudo bem? Meu WhatsApp enviou a mensagem anterior com um erro no seu nome, perdão! \uD83D\uDE05\n\nMas retomando: trabalho com proteção financeira e planejamento sucessório empresarial pela MetLife. Vi que você está à frente do seu negócio e gostaria de conversar rapidamente sobre estratégias de blindagem patrimonial que empresários da região estão utilizando. Como está sua agenda para um café rápido ou reunião online de 30min essa semana?';
      } else if (lead.campaign_id === '1c3b73a2-1128-4f94-9aca-a21f26c9baef') {
          apologyMsg = 'Opa ' + firstName + ', tudo bem? Meu WhatsApp acabou cortando seu nome na mensagem anterior, desculpe! \uD83D\uDE05\n\nComo eu ia dizendo: vi que você atua na área jurídica e gostaria de apresentar as soluções de proteção financeira e seguro de vida da MetLife voltadas especificamente para advogados. Teria um tempinho nos próximos dias para um bate-papo rápido de 30 min?';
      }

      console.log('Sending apology to', lead.whatsapp, '...');
      
      const sendRes = await fetch(evoUrl + '/message/sendText/' + instanceName, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': globalApiKey
        },
        body: JSON.stringify({
          number: lead.whatsapp,
          options: {
            delay: 1200,
            presence: 'composing'
          },
          textMessage: {
            text: apologyMsg
          }
        })
      });

      if (sendRes.ok) {
        recovered++;
        
        const conversationId = crypto.randomUUID();
        const now = new Date().toISOString();
        
        await supabaseAdmin.from('conversations').insert({
          id: conversationId,
          tenant_id: tenantId,
          lead_id: lead.id,
          status: 'ACTIVE',
          ai_handling: true,
          message_count: 2,
          started_at: now,
          last_message_at: now,
          last_outbound_at: now
        });

        await supabaseAdmin.from('leads').update({ contacted_at: now }).eq('id', lead.id);
        
        await new Promise(r => setTimeout(r, 15000));
      }
      
    } catch (err) {
      console.error('Error recovering lead', lead.whatsapp, err.message);
    }
  }

  console.log('Successfully recovered', recovered, 'leads!');
}

main().catch(console.error);
