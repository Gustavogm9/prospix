import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import crypto from 'crypto';

dotenv.config({ path: resolve(process.cwd(), './apps/web/.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tenantId = '220e676e-ef8d-4312-814d-fb4dca962c06'; // Gustavo's current tenant

async function seed() {
  console.log('Seeding scripts for tenant:', tenantId);

  // Define scripts and their variations
  const data = [
    {
      script: {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        name: 'Objeção: "Tá caro" (Com Variantes)',
        category: 'OBJECTION',
        base_message: 'Dr. [Nome], entendo perfeitamente. Nossos parceiros faturam em média 3x mais recuperando o tempo perdido. Que tal focarmos no retorno que isso trará para a clínica [Empresa]?',
        status: 'ACTIVE',
        variables: ['Nome', 'Empresa'],
        updated_at: new Date().toISOString()
      },
      variations: [
        { name: 'Mais direto', content: 'Dr. [Nome], o custo de não automatizar o agendamento hoje é perder pacientes para a concorrência. Nossos parceiros recuperam o investimento em menos de 1 mês. Topa uma call de 10min?', weight: 60 },
        { name: 'Foco no Retorno', content: 'Dr. [Nome], entendo! Para a [Empresa], quanto custa 1 hora da sua secretária lidando com mensagens manuais? Nosso robô custa menos que o vale-refeição dela e trabalha 24/7. Vamos testar?', weight: 40 }
      ]
    },
    {
      script: {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        name: 'Educação: O que fazemos (Com Variantes)',
        category: 'EDUCATION',
        base_message: 'Só para contextualizar, Dr. [Nome], nós ajudamos clínicas em [Cidade] a automatizar o agendamento via WhatsApp usando IA, poupando até 20 horas por semana das suas secretárias.',
        status: 'ACTIVE',
        variables: ['Nome', 'Cidade'],
        updated_at: new Date().toISOString()
      },
      variations: [
        { name: 'Prova Social', content: 'Só pra contextualizar, Dr. [Nome], a gente ajudou várias clínicas em [Cidade] a acabar com os furos de agenda e reagendamentos usando nossa IA no WhatsApp.', weight: 70 },
        { name: 'Curto e Simples', content: 'Resumindo Dr. [Nome]: Colocamos uma IA no WhatsApp da clínica para agendar consultas sozinha. Chega de paciente esperando resposta por horas!', weight: 30 }
      ]
    }
  ];

  for (const item of data) {
    const { error: scriptError } = await supabase.from('scripts').insert(item.script);
    if (scriptError) {
      console.error('Error inserting script:', item.script.name, scriptError.message);
      continue;
    } 
    console.log('Inserted script:', item.script.name);

    for (let i = 0; i < item.variations.length; i++) {
      const v = item.variations[i];
      const { error: varError } = await supabase.from('script_variations').insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        script_id: item.script.id,
        variant_letter: String.fromCharCode(65 + i),
        message: v.content,
        weight: v.weight / 100, // DB expects weight between 0 and 1
        active: true,
        updated_at: new Date().toISOString()
      });
      if (varError) {
        console.error('  Error inserting variation:', v.name, varError.message);
      } else {
        console.log('  Inserted variation:', v.name);
      }
    }
  }

  console.log('Seed completed!');
}

seed();
