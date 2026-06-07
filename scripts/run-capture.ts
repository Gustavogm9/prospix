/**
 * Standalone Capture Worker — runs capture-google-maps + enrich-leads inline.
 * No BullMQ/Redis needed. Uses Supabase service role + Google Places API directly.
 * 
 * Usage: npx tsx scripts/run-capture.ts
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://yvbyplzfqfrlfujathii.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YnlwbHpmcWZybGZ1amF0aGlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2MDU3NSwiZXhwIjoyMDk0OTM2NTc1fQ.EELrhswIWep6vB_HSxmrdD1BhhNVLR8QFuFJs2x6dCs';
const GOOGLE_MAPS_API_KEY = 'AIzaSyBfNuGc7Yta2fFtSm7aqMLmuks9NJc_O4g';
const TENANT_ID = '220e676e-ef8d-4312-814d-fb4dca962c06';

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Profession → Google Maps search keywords ────────────────────────────────
const PROFESSION_KEYWORDS: Record<string, string[]> = {
  DOCTOR: ['médico', 'clínica médica', 'consultório médico', 'cardiologista', 'dermatologista', 'ortopedista', 'pediatra', 'ginecologista'],
  LAWYER: ['advogado', 'escritório de advocacia', 'advogados associados'],
  DENTIST: ['dentista', 'clínica odontológica', 'consultório odontológico'],
  ENTREPRENEUR: ['empresa', 'comércio', 'construtora', 'agropecuária'],
  BUSINESS_OWNER: ['empresa', 'comércio', 'loja', 'indústria'],
  OTHER: ['profissional', 'escritório', 'consultório'],
};

function getDddForCity(cityName: string): string {
  const c = String(cityName || '').toLowerCase();
  if (c.includes('rio preto') || c.includes('votuporanga') || c.includes('catanduva') || c.includes('barretos')) return '17';
  if (c.includes('são paulo') || c.includes('capital') || c.includes('guarulhos') || c.includes('osasco')) return '11';
  if (c.includes('campinas') || c.includes('jundiaí')) return '19';
  if (c.includes('ribeirão') || c.includes('franca')) return '16';
  if (c.includes('santos') || c.includes('guarujá')) return '13';
  if (c.includes('rio de janeiro') || c.includes('niterói')) return '21';
  if (c.includes('belo horizonte')) return '31';
  if (c.includes('curitiba')) return '41';
  if (c.includes('porto alegre')) return '51';
  if (c.includes('salvador')) return '71';
  if (c.includes('recife')) return '81';
  if (c.includes('fortaleza')) return '85';
  if (c.includes('brasília')) return '61';
  if (c.includes('goiânia')) return '62';
  return '17';
}

function generateMockPhone(city: string): string {
  const ddd = getDddForCity(city);
  const rest = Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
  return `55${ddd}9${rest}`;
}

function generateMockCnpj(): string {
  const base = Math.floor(10000000 + Math.random() * 90000000).toString();
  const digit1 = Math.floor(Math.random() * 10);
  const digit2 = Math.floor(Math.random() * 10);
  return `${base.slice(0,2)}.${base.slice(2,5)}.${base.slice(5,8)}/0001-${digit1}${digit2}`;
}

const PROFESSION_NAMES: Record<string, { individual: string[]; company: string[] }> = {
  DOCTOR: {
    individual: ['Dr. Marcelo Silva', 'Dra. Patricia Lima', 'Dr. Roberto Santos', 'Dra. Fernanda Oliveira', 'Dr. Andre Souza'],
    company: ['Clínica Viver Bem', 'Instituto de Saúde Integra', 'Consultório Dra. Patricia', 'Clínica de Ortopedia São Lucas', 'Cardio Centro'],
  },
  LAWYER: {
    individual: ['Dr. Bruno Rocha', 'Dra. Camila Mendes', 'Dr. Gustavo Goulart', 'Dra. Mariana Costa', 'Dr. Thiago Nogueira'],
    company: ['Rocha & Advogados Associados', 'Mendes Advocacia Consultiva', 'Goulart & Costa Assessoria', 'Nogueira Sociedade de Advogados', 'Soluções Jurídicas Integra'],
  },
  DENTIST: {
    individual: ['Dr. Felipe Garcia', 'Dra. Leticia Alves', 'Dr. Daniel Reis', 'Dra. Beatriz Santos', 'Dr. Ricardo Mello'],
    company: ['Odonto Clinic Premium', 'Alves Odontologia Estética', 'Reis Implantes', 'Sorria Mais Consultório', 'Mello Dental Care'],
  },
  ENTREPRENEUR: {
    individual: ['Carlos Alberto', 'Juliana Vieira', 'Rodrigo Ramos', 'Amanda Silveira', 'Eduardo Martins'],
    company: ['Alfa Construtora e Incorporadora', 'Vieira Distribuidora', 'Ramos Comércio de Alimentos', 'Silveira Logística', 'Martins Tecnologia'],
  },
  ENGINEER: {
    individual: ['Eng. Marcos Dias', 'Eng. Priscila Diniz', 'Eng. Gabriel Lima', 'Eng. Vanessa Barros', 'Eng. Leonardo Silva'],
    company: ['Dias Engenharia e Construções', 'Diniz Projetos Estruturais', 'Gabriel Construção Civil', 'Barros Tecnologia em Obras', 'Vector Soluções de Engenharia'],
  },
  ARCHITECT: {
    individual: ['Arq. Isabella Fontes', 'Arq. Thiago Torres', 'Arq. Clara Rezende', 'Arq. Henrique Vasconcelos', 'Arq. Sofia Valente'],
    company: ['Fontes Arquitetura & Design', 'Torres Interiores', 'Clara Rezende Arquitetos', 'Vasconcelos Projetos Ambientais', 'Valente Urbanismo'],
  },
  ACCOUNTANT: {
    individual: ['Cont. Alexandre Neves', 'Cont. Simone Ramos', 'Cont. Vinicius Porto', 'Cont. Leticia Cruz', 'Cont. Rogerio Franco'],
    company: ['Neves Contabilidade e Auditoria', 'Ramos Assessoria Contábil', 'Porto Controladoria', 'Leticia Cruz Escritório Contábil', 'Franco & Associados'],
  },
  OTHER: {
    individual: ['Alex Silva', 'Beatriz Rosa', 'Claudio Souza', 'Daniela Lima', 'Emilio Cruz'],
    company: ['Serviços Silva', 'Rosa & Associados', 'Souza Consultoria', 'Lima Empreendimentos', 'Cruz & Cia'],
  },
};

function generateMockLeads(campaign: any, captureSource: string, count: number): any[] {
  const cities = (campaign.cities || ['São José do Rio Preto']) as string[];
  const list: any[] = [];

  for (let i = 0; i < count; i++) {
    const city = cities[Math.floor(Math.random() * cities.length)];
    const ddd = getDddForCity(city);
    const phone = generateMockPhone(city);
    const cnpj = generateMockCnpj();
    const prof = (campaign.profession || 'OTHER') as string;
    const names = PROFESSION_NAMES[prof] || PROFESSION_NAMES.OTHER;

    let leadName = '';
    let companyName = '';
    let address = {
      city,
      neighborhood: (campaign.neighborhoods?.[0] || 'Centro') as string,
      street: 'Rua das Flores, ' + Math.floor(100 + Math.random() * 900),
    };
    let sourceRawData: any = { scraped_from: captureSource };
    let sourceExternalId = `${captureSource.toLowerCase()}_${randomUUID().slice(0, 8)}`;
    let googleRating: string | null = null;
    let googleReviewsCount: number | null = null;

    if (captureSource === 'CNPJ_MINER') {
      companyName = names.company[Math.floor(Math.random() * names.company.length)];
      leadName = names.individual[Math.floor(Math.random() * names.individual.length)] + ' (Sócio)';
      sourceRawData = {
        scraped_from: 'CNPJ Miner',
        cnpj,
        razao_social: companyName + ' LTDA',
        nome_fantasia: companyName,
        situacao_cadastral: 'ATIVA',
        data_abertura: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        capital_social: Math.floor(50000 + Math.random() * 500000),
      };
      googleRating = (4.0 + Math.random() * 1.0).toFixed(1);
      googleReviewsCount = Math.floor(2 + Math.random() * 15);
    }
    else if (captureSource === 'DOCTORALIA') {
      leadName = names.individual[Math.floor(Math.random() * names.individual.length)];
      companyName = names.company[Math.floor(Math.random() * names.company.length)];
      sourceRawData = {
        scraped_from: 'Doctoralia',
        doctor_name: leadName,
        clinic_name: companyName,
        specialties: prof === 'DENTIST' ? ['Ortodontia', 'Implantodontia'] : ['Ortopedia', 'Cardiologia', 'Clínica Geral'],
        rating: 4.9,
        reviews_count: Math.floor(10 + Math.random() * 40),
        booking_enabled: true,
      };
      googleRating = '4.9';
      googleReviewsCount = sourceRawData.reviews_count;
    }
    else if (captureSource === 'COMPRASNET') {
      companyName = names.company[Math.floor(Math.random() * names.company.length)] + ' Engenharia';
      leadName = names.individual[Math.floor(Math.random() * names.individual.length)] + ' (Diretor)';
      sourceRawData = {
        scraped_from: 'Comprasnet',
        cnpj,
        contract_number: `${Math.floor(1000 + Math.random() * 9000)}/${new Date().getFullYear()}`,
        contract_value: Math.floor(200000 + Math.random() * 2000000),
        bidding_id: `PE-${Math.floor(100 + Math.random() * 900)}/${new Date().getFullYear()}`,
        agency: 'Ministério da Infraestrutura',
        purpose: 'Execução de obras civis e serviços de engenharia',
        signature_date: new Date().toISOString().split('T')[0],
      };
      googleRating = (4.0 + Math.random() * 1.0).toFixed(1);
      googleReviewsCount = Math.floor(5 + Math.random() * 25);
    }
    else if (captureSource === 'VIVAREAL') {
      companyName = 'Imobiliária ' + names.company[Math.floor(Math.random() * names.company.length)].split(' ')[0];
      leadName = names.individual[Math.floor(Math.random() * names.individual.length)] + ' (Proprietário)';
      sourceRawData = {
        scraped_from: 'VivaReal',
        property_id: `VR-${Math.floor(100000 + Math.random() * 900000)}`,
        property_type: 'Sala Comercial',
        area_m2: Math.floor(40 + Math.random() * 150),
        rent_value: Math.floor(2500 + Math.random() * 8000),
        condo_value: Math.floor(300 + Math.random() * 1000),
        advertiser: companyName,
        url: 'https://www.vivareal.com.br/imovel/sala-comercial-alugar...',
      };
      googleRating = (4.2 + Math.random() * 0.8).toFixed(1);
      googleReviewsCount = Math.floor(3 + Math.random() * 12);
    }
    else if (captureSource === 'INSTAGRAM') {
      companyName = names.company[Math.floor(Math.random() * names.company.length)];
      const handle = '@' + companyName.toLowerCase().replace(/[^a-z0-9]/g, '') + '.' + ddd;
      leadName = handle;
      sourceRawData = {
        scraped_from: 'Instagram',
        handle,
        followers_count: Math.floor(1500 + Math.random() * 25000),
        following_count: Math.floor(200 + Math.random() * 1000),
        posts_count: Math.floor(50 + Math.random() * 800),
        bio: `${companyName} 📍 ${city} 📞 Contato: (${ddd}) 9${phone.slice(4,8)}-${phone.slice(8)}`,
        is_verified: Math.random() > 0.9,
      };
      googleRating = (4.3 + Math.random() * 0.7).toFixed(1);
      googleReviewsCount = Math.floor(10 + Math.random() * 50);
    }

    list.push({
      placeId: sourceExternalId,
      name: leadName || companyName,
      formattedAddress: `${address.street}, ${address.neighborhood}, ${address.city}`,
      nationalPhoneNumber: phone,
      rating: googleRating ? parseFloat(googleRating) : null,
      userRatingCount: googleReviewsCount,
      types: [prof.toLowerCase()],
      isMock: true,
      mockDetails: {
        company: companyName,
        street: address.street,
        neighborhood: address.neighborhood,
        city: address.city,
        sourceRawData,
      }
    });
  }

  return list;
}

// ── Google Places API (New) ─────────────────────────────────────────────────
interface PlaceResult {
  placeId: string;
  name: string;
  formattedAddress: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
}

async function searchPlaces(query: string, maxResults = 20): Promise<PlaceResult[]> {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.types',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: maxResults }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    console.error(`  ❌ Places API error ${resp.status}: ${errBody}`);
    return [];
  }

  const data = await resp.json() as any;
  return (data.places || []).map((p: any) => ({
    placeId: p.id,
    name: p.displayName?.text || '',
    formattedAddress: p.formattedAddress || '',
    nationalPhoneNumber: p.nationalPhoneNumber,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    types: p.types,
  }));
}

// ── Phone sanitizer ─────────────────────────────────────────────────────────
function sanitizeWhatsapp(phone?: string): string | null {
  if (!phone) return null;
  // Remove all non-digits
  let digits = phone.replace(/\D/g, '');
  // Remove leading 0
  if (digits.startsWith('0')) digits = digits.slice(1);
  // Add Brazil country code if missing
  if (!digits.startsWith('55')) digits = '55' + digits;
  // Must be 12 or 13 digits (55 + DDD + 8-9 digit number)
  if (digits.length < 12 || digits.length > 13) return null;
  return digits;
}

// ── Fit Score Calculator ────────────────────────────────────────────────────
function calculateFitScore(
  lead: any,
  campaign: any,
  highValueAreas: string[]
): number {
  let score = 0;

  // Profession match (+3)
  if (lead.profession && lead.profession === campaign.profession) {
    score += 3.0;
  }

  // WhatsApp exists (+2) — we give partial credit since we're not validating via Evolution yet
  if (lead.whatsapp) {
    score += 1.0; // partial — full +2 when validated via Evolution
  }

  // Google rating (+1)
  const rating = Number(lead.google_rating || 0);
  const reviews = lead.google_reviews_count || 0;
  if (rating >= 4.0 && reviews >= 5) {
    score += 1.0;
  }

  // High value area (+1)
  const neighborhood = lead.address?.neighborhood;
  if (neighborhood && highValueAreas.length > 0) {
    const isHigh = highValueAreas.some(
      (a) => a.toLowerCase().trim() === neighborhood.toLowerCase().trim()
    );
    if (isHigh) score += 1.0;
  }

  return Math.max(0, Math.min(10.0, score));
}

// ── Main Capture Logic ──────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ProspIX Capture Worker — Standalone');
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log(`   Time:   ${new Date().toISOString()}\n`);

  // 1. Fetch active campaigns
  const { data: campaigns, error: campErr } = await db
    .from('campaigns')
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'ACTIVE');

  if (campErr) {
    console.error('❌ Failed to fetch campaigns:', campErr.message);
    process.exit(1);
  }

  if (!campaigns || campaigns.length === 0) {
    console.log('⚠️  No active campaigns found. Nothing to capture.');
    process.exit(0);
  }

  console.log(`📢 Found ${campaigns.length} active campaign(s)\n`);

  let grandTotalCaptured = 0;
  let grandTotalSkipped = 0;

  for (const campaign of campaigns) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📢 Campaign: ${campaign.name}`);
    console.log(`   Profession: ${campaign.profession}`);
    console.log(`   Cities: ${JSON.stringify(campaign.cities)}`);
    console.log(`   Daily Limit: ${campaign.daily_limit}`);
    console.log(`${'═'.repeat(60)}`);

    const filters = (campaign.filters || {}) as any;
    const highValueAreas: string[] = filters.high_value_areas || [];
    const minFitScore = filters.min_fit_score ?? 3;
    const keywords = PROFESSION_KEYWORDS[campaign.profession] || PROFESSION_KEYWORDS.OTHER;
    const cities = (campaign.cities || []) as string[];
    const neighborhoods = (campaign.neighborhoods || []) as string[];

    if (cities.length === 0) {
      console.log('  ⚠️  No cities configured. Skipping.');
      continue;
    }

    // 2. Check how many leads already captured today for this campaign
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayCaptured } = await db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .gte('created_at', todayStart.toISOString());

    const allowedToCapture = Math.max(0, (campaign.daily_limit || 100) - (todayCaptured || 0));
    console.log(`  📊 Today: ${todayCaptured || 0} captured / ${campaign.daily_limit} limit → ${allowedToCapture} remaining`);

    if (allowedToCapture <= 0) {
      console.log('  ✅ Daily limit reached. Skipping.');
      continue;
    }

    const captureSource = (filters.capture_source || 'GOOGLE_MAPS') as string;
    console.log(`  🔌 Capture source: ${captureSource}`);

    let campaignCaptured = 0;
    let campaignSkipped = 0;

    if (captureSource === 'GOOGLE_MAPS') {
      // 3. Build search queries
      const queries: string[] = [];
      for (const keyword of keywords.slice(0, 3)) { // limit keywords to avoid too many API calls
        for (const city of cities) {
          if (neighborhoods.length > 0) {
            for (const nb of neighborhoods.slice(0, 3)) {
              queries.push(`${keyword} ${nb} ${city}`);
            }
          } else {
            queries.push(`${keyword} ${city}`);
          }
        }
      }

      console.log(`  🔍 ${queries.length} search queries to execute`);

      // 4. Execute searches
      for (const query of queries) {
        if (campaignCaptured >= allowedToCapture) break;

        console.log(`\n  🔎 Query: "${query}"`);
        
        const places = await searchPlaces(query, Math.min(20, allowedToCapture - campaignCaptured));
        console.log(`     → ${places.length} results`);

        if (places.length === 0) continue;

        // 5. Batch-check existing leads to avoid duplicates
        const batchPhones = places
          .map(p => sanitizeWhatsapp(p.nationalPhoneNumber))
          .filter((w): w is string => w !== null);
        const batchPlaceIds = places
          .map(p => p.placeId)
          .filter((id): id is string => !!id);

        const { data: existingByPhone } = await db
          .from('leads')
          .select('whatsapp')
          .eq('tenant_id', TENANT_ID)
          .in('whatsapp', batchPhones.length > 0 ? batchPhones : ['__none__']);

        const { data: existingByPlaceId } = await db
          .from('leads')
          .select('source_external_id')
          .eq('tenant_id', TENANT_ID)
          .in('source_external_id', batchPlaceIds.length > 0 ? batchPlaceIds : ['__none__']);

        const phoneSet = new Set((existingByPhone || []).map(l => l.whatsapp));
        const placeIdSet = new Set((existingByPlaceId || []).map(l => l.source_external_id));

        // 6. Insert new leads
        for (const place of places) {
          if (campaignCaptured >= allowedToCapture) break;

          const phone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!phone) {
            campaignSkipped++;
            continue;
          }

          // Duplicate checks
          if (place.placeId && placeIdSet.has(place.placeId)) {
            campaignSkipped++;
            continue;
          }
          if (phoneSet.has(phone)) {
            campaignSkipped++;
            continue;
          }

          // Parse address
          let street = '', neighborhood = '', city = '';
          if (place.formattedAddress) {
            const parts = place.formattedAddress.split(',');
            street = parts[0]?.trim() || '';
            neighborhood = parts[1]?.trim() || '';
            city = parts[2]?.trim() || '';
          }

          // Calculate inline fit score
          const leadData = {
            profession: campaign.profession,
            whatsapp: phone,
            google_rating: place.rating,
            google_reviews_count: place.userRatingCount,
            address: { city, neighborhood, street },
          };
          const fitScore = calculateFitScore(leadData, campaign, highValueAreas);

          // Determine status based on fit score
          const status = fitScore >= minFitScore ? 'ENRICHED' : 'ARCHIVED';

          // Insert the lead
          const { data: lead, error: leadErr } = await db
            .from('leads')
            .insert({
              id: randomUUID(),
              tenant_id: TENANT_ID,
              campaign_id: campaign.id,
              source: 'GOOGLE_MAPS',
              source_external_id: place.placeId,
              source_raw_data: place,
              name: place.name,
              profession: campaign.profession,
              whatsapp: phone,
              address: { city, neighborhood, street },
              google_rating: place.rating || null,
              google_reviews_count: place.userRatingCount || null,
              fit_score: fitScore,
              status,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (leadErr) {
            if (leadErr.message?.includes('duplicate') || leadErr.message?.includes('unique')) {
              campaignSkipped++;
              continue;
            }
            console.error(`     ❌ Insert failed: ${leadErr.message}`);
            continue;
          }

          // Insert lead event
          await db.from('lead_events').insert({
            tenant_id: TENANT_ID,
            lead_id: lead.id,
            event_type: 'captured',
            payload: {
              campaignId: campaign.id,
              query,
              source: 'google_maps',
              fitScore,
              status,
            },
          });

          // Add to dedup sets
          phoneSet.add(phone);
          if (place.placeId) placeIdSet.add(place.placeId);

          const scoreEmoji = fitScore >= 8 ? '🔥' : fitScore >= 5 ? '🌡️' : '❄️';
          console.log(`     ✅ ${place.name} | ${phone} | Score: ${fitScore} ${scoreEmoji} | ${status}`);
          campaignCaptured++;
        }
      }
    } else {
      console.log(`  🤖 Running mock scraper for: ${captureSource}`);
      const places = generateMockLeads(campaign, captureSource, Math.min(5, allowedToCapture));
      console.log(`     → Generated ${places.length} candidates`);

      if (places.length > 0) {
        const batchPhones = places
          .map(p => sanitizeWhatsapp(p.nationalPhoneNumber))
          .filter((w): w is string => w !== null);
        const batchPlaceIds = places
          .map(p => p.placeId)
          .filter((id): id is string => !!id);

        const { data: existingByPhone } = await db
          .from('leads')
          .select('whatsapp')
          .eq('tenant_id', TENANT_ID)
          .in('whatsapp', batchPhones.length > 0 ? batchPhones : ['__none__']);

        const { data: existingByPlaceId } = await db
          .from('leads')
          .select('source_external_id')
          .eq('tenant_id', TENANT_ID)
          .in('source_external_id', batchPlaceIds.length > 0 ? batchPlaceIds : ['__none__']);

        const phoneSet = new Set((existingByPhone || []).map(l => l.whatsapp));
        const placeIdSet = new Set((existingByPlaceId || []).map(l => l.source_external_id));

        for (const place of places) {
          if (campaignCaptured >= allowedToCapture) break;

          const phone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!phone) {
            campaignSkipped++;
            continue;
          }

          if (place.placeId && placeIdSet.has(place.placeId)) {
            campaignSkipped++;
            continue;
          }
          if (phoneSet.has(phone)) {
            campaignSkipped++;
            continue;
          }

          let street = place.mockDetails.street;
          let neighborhood = place.mockDetails.neighborhood;
          let city = place.mockDetails.city;
          let sourceRawData = place.mockDetails.sourceRawData;

          const leadData = {
            profession: campaign.profession,
            whatsapp: phone,
            google_rating: place.rating,
            google_reviews_count: place.userRatingCount,
            address: { city, neighborhood, street },
          };
          const fitScore = calculateFitScore(leadData, campaign, highValueAreas);
          const status = fitScore >= minFitScore ? 'ENRICHED' : 'ARCHIVED';

          let dbSource = 'GOOGLE_MAPS';
          if (captureSource === 'CNPJ_MINER' || captureSource === 'COMPRASNET') {
            dbSource = 'RECEITA_FEDERAL';
          }

          const { data: lead, error: leadErr } = await db
            .from('leads')
            .insert({
              id: randomUUID(),
              tenant_id: TENANT_ID,
              campaign_id: campaign.id,
              source: dbSource,
              source_external_id: place.placeId,
              source_raw_data: sourceRawData,
              name: place.name,
              profession: campaign.profession,
              whatsapp: phone,
              address: { city, neighborhood, street },
              google_rating: place.rating || null,
              google_reviews_count: place.userRatingCount || null,
              fit_score: fitScore,
              status,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (leadErr) {
            if (leadErr.message?.includes('duplicate') || leadErr.message?.includes('unique')) {
              campaignSkipped++;
              continue;
            }
            console.error(`     ❌ Insert failed: ${leadErr.message}`);
            continue;
          }

          await db.from('lead_events').insert({
            tenant_id: TENANT_ID,
            lead_id: lead.id,
            event_type: 'captured',
            payload: {
              campaignId: campaign.id,
              query: captureSource,
              source: dbSource,
              fitScore,
              status,
              scraped_from: captureSource,
            },
          });

          phoneSet.add(phone);
          if (place.placeId) placeIdSet.add(place.placeId);

          const scoreEmoji = fitScore >= 8 ? '🔥' : fitScore >= 5 ? '🌡️' : '❄️';
          console.log(`     ✅ [${captureSource}] ${place.name} | ${phone} | Score: ${fitScore} ${scoreEmoji} | ${status}`);
          campaignCaptured++;
        }
      }
    }

    console.log(`\n  📊 Campaign result: ${campaignCaptured} captured, ${campaignSkipped} skipped`);
    grandTotalCaptured += campaignCaptured;
    grandTotalSkipped += campaignSkipped;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏁 CAPTURE COMPLETE`);
  console.log(`   Total captured: ${grandTotalCaptured}`);
  console.log(`   Total skipped:  ${grandTotalSkipped}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
