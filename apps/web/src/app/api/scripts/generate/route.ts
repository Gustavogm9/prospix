import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '../../_lib/supabase-admin';

function getMockGeneratedScript(niche: string, product: string) {
  let baseMessage = '';
  let variations: Array<{ content: string; weight: number }> = [];

  if (product === 'KEYMAN') {
    baseMessage = 'Olá {primeiro_nome}, sou especialista em proteção societária e vi sua empresa. Gostaria de apresentar nossa solução de Seguro de Sucessão Societária (Keyman) para garantir a continuidade do negócio em caso de ausência de sócios-chave.';
    variations = [
      {
        content: 'Olá {primeiro_nome}, tudo bem? Como sócio, você já pensou em como ficaria a empresa caso um dos sócios principais precise se afastar repentinamente? Conhece a proteção de Sócios-Chave (Keyman)?',
        weight: 34
      },
      {
        content: 'Oi {primeiro_nome}, sou especialista em blindagem patrimonial de empresas. Sabia que a ausência de um sócio-chave pode paralisar as operações? Temos uma solução de proteção sob medida.',
        weight: 33
      },
      {
        content: 'Olá {primeiro_nome}, uma dúvida estratégica: sua empresa possui um plano de sucessão estruturado para os sócios principais? Conhece o seguro Keyman?',
        weight: 33
      }
    ];
  } else {
    const nicheLabel = niche === 'DOCTOR' ? 'médicos' : niche === 'LAWYER' ? 'advogados' : 'empresários';
    const nicheGreeting = niche === 'DOCTOR' ? 'Dr. {primeiro_nome}' : '{primeiro_nome}';
    
    baseMessage = `Olá ${nicheGreeting}, tudo bem? Atuo na proteção financeira de profissionais autônomos. Gostaria de apresentar o DIT (Diária de Incapacidade Temporária) para garantir sua renda caso precise se afastar por motivos de saúde.`;
    variations = [
      {
        content: `Olá ${nicheGreeting}, tudo bem? Como você atua de forma autônoma, já pensou em como fica seu faturamento se precisar se afastar por motivo de saúde? Conhece o DIT?`,
        weight: 34
      },
      {
        content: `Oi ${nicheGreeting}, sou consultor de proteção financeira. Sabia que ${nicheLabel} possuem tarifas exclusivas para a contratação de Diária de Incapacidade Temporária?`,
        weight: 33
      },
      {
        content: `Olá ${nicheGreeting}, uma dúvida rápida: se você precisar de um afastamento médico hoje, quem cobre as despesas do seu consultório ou escritório? Conhece a cobertura do DIT?`,
        weight: 33
      }
    ];
  }

  return {
    data: {
      baseMessage,
      variations
    }
  };
}

// POST /api/scripts/generate — AI generate script
// Proxies to the Fastify API that has AIRouter access
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if ('error' in auth) return auth.error;

  let body: any = {};
  try {
    body = await request.json();
  } catch (err) {
    // Ignore body parse errors for fallback
  }

  const { niche = 'DOCTOR', product = 'DIT' } = body;

  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    console.warn('API_URL not configured. Returning mock generated script as fallback.');
    return NextResponse.json(getMockGeneratedScript(niche, product));
  }

  try {
    const token = request.headers.get('authorization') || '';
    const tenantId = auth.tenantId;

    const res = await fetch(`${apiUrl}/v1/tenant/scripts/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`Fetch to Fastify API returned status ${res.status}. Falling back to mock generator.`);
      return NextResponse.json(getMockGeneratedScript(niche, product));
    }

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.warn('Error fetching from backend API, returning mock generated script fallback:', err);
    return NextResponse.json(getMockGeneratedScript(niche, product));
  }
}
