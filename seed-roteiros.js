import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import crypto from 'crypto';

dotenv.config({ path: resolve(process.cwd(), './apps/web/.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const tenantId = '220e676e-ef8d-4312-814d-fb4dca962c06'; // Gustavo's current tenant

async function seed() {
  console.log('Seeding scripts for tenant:', tenantId);

  const scriptsToInsert = [
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: 'Objeção: "Tá caro"',
      category: 'OBJECTION',
      base_message: 'Dr. [Nome], entendo perfeitamente. Nossos parceiros faturam em média 3x mais recuperando o tempo perdido. Que tal focarmos no retorno que isso trará para a clínica [Empresa]?',
      status: 'ACTIVE',
      variables: ['Nome', 'Empresa'],
      updated_at: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: 'Objeção: "Não tenho tempo agora"',
      category: 'OBJECTION',
      base_message: 'Sem problemas, Dr. [Nome]! Posso retornar o contato semana que vem ou prefere deixar um horário rápido de 10 min agendado para quando estiver mais tranquilo?',
      status: 'ACTIVE',
      variables: ['Nome'],
      updated_at: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: 'Educação: O que fazemos',
      category: 'EDUCATION',
      base_message: 'Só para contextualizar, Dr. [Nome], nós ajudamos clínicas em [Cidade] a automatizar o agendamento via WhatsApp usando IA, poupando até 20 horas por semana das suas secretárias.',
      status: 'ACTIVE',
      variables: ['Nome', 'Cidade'],
      updated_at: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: 'Fechamento Padrão',
      category: 'CLOSING',
      base_message: 'Perfeito! Posso enviar o link para você criar sua conta e já começarmos o setup da clínica [Empresa]?',
      status: 'ACTIVE',
      variables: ['Empresa'],
      updated_at: new Date().toISOString()
    }
  ];

  for (const script of scriptsToInsert) {
    const { error } = await supabase.from('scripts').insert(script);
    if (error) {
      console.error('Error inserting script:', script.name, error.message);
    } else {
      console.log('Inserted script:', script.name);
    }
  }

  console.log('Seed completed!');
}

seed();
