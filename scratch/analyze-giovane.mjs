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

  // 2. Create Script Variations
  const advogadosScriptId = 'c0f83943-f88b-4651-a2a0-7cc7dbdfcddf';
  const empresariosScriptId = '1b5855ce-3fa5-4d26-9e8e-24de40c10d0a';
  const medicosScriptId = 'dd563a9d-55b7-4456-9769-f40f3fb58f3e';
  
  const now = new Date().toISOString();

  const variationsToInsert = [
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      script_id: advogadosScriptId,
      variant_letter: 'A',
      message: 'Olá {nome}, tudo bem? Vi que você atua na área jurídica e gostaria de apresentar as soluções de proteção financeira e seguro de vida da MetLife voltadas especificamente para advogados, que garantem a manutenção da sua renda em caso de imprevistos. Teria um tempinho amanhã para um bate-papo rápido de 10 min?',
      active: true,
      updated_at: now
    },
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      script_id: empresariosScriptId,
      variant_letter: 'A',
      message: 'Olá {nome}, tudo bem? Trabalho com proteção financeira e planejamento sucessório empresarial pela MetLife. Vi que você está à frente do seu negócio e gostaria de conversar rapidamente sobre estratégias de blindagem patrimonial que empresários da região estão utilizando. Como está sua agenda para um café rápido ou reunião online essa semana?',
      active: true,
      updated_at: now
    },
    {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      script_id: medicosScriptId,
      variant_letter: 'A',
      message: 'Olá Dr(a). {nome}, tudo bem? Sei que a rotina médica é intensa. Sou especialista da MetLife e ajudo profissionais da saúde com Seguro de Responsabilidade Civil e DIT (Diária por Incapacidade Temporária), garantindo sua renda caso precise se afastar. Podemos agendar 10 minutinhos essa semana para eu te explicar melhor como funciona?',
      active: true,
      updated_at: now
    }
  ];

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('script_variations')
    .insert(variationsToInsert)
    .select('id');

  console.log(`Inserted ${inserted?.length || 0} script variations.`, insertErr || '');
}

main().catch(console.error);
