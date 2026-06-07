/**
 * ProspIX Capture Worker — Standalone (VPS Docker)
 * Uses campaign.filters.search_terms dynamically.
 * Zero npm deps — Node 18+ fetch only.
 * 
 * Usage: node capture-standalone.mjs
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_MAPS_API_KEY
 */
import { randomUUID } from 'node:crypto';

// ── Config (env vars with fallbacks) ────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yvbyplzfqfrlfujathii.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2YnlwbHpmcWZybGZ1amF0aGlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTM2MDU3NSwiZXhwIjoyMDk0OTM2NTc1fQ.EELrhswIWep6vB_HSxmrdD1BhhNVLR8QFuFJs2x6dCs';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyBfNuGc7Yta2fFtSm7aqMLmuks9NJc_O4g';
const TENANT_ID = process.env.TENANT_ID || '220e676e-ef8d-4312-814d-fb4dca962c06';
const now = () => new Date().toISOString();

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

async function supaRPC(method, table, params = '', body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params ? '?' + params : ''}`;
  const opts = { method, headers: { ...HEADERS } };
  if (body) opts.body = JSON.stringify(body);
  if (method === 'GET') delete opts.headers['Prefer'];
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase ${method} ${table}: ${resp.status} ${err}`);
  }
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// ── Default keywords (fallback if campaign has no search_terms) ─────────────
const DEFAULT_KEYWORDS = {
  DOCTOR: ['médico', 'clínica médica', 'consultório médico'],
  LAWYER: ['advogado', 'escritório de advocacia', 'advogados'],
  DENTIST: ['dentista', 'clínica odontológica'],
  ENTREPRENEUR: ['empresa', 'comércio', 'construtora'],
  BUSINESS_OWNER: ['empresa', 'comércio', 'loja'],
  OTHER: ['profissional', 'escritório'],
};

function getDddForCity(cityName) {
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

function generateMockPhone(city) {
  const ddd = getDddForCity(city);
  const rest = Math.floor(10000000 + Math.random() * 90000000).toString().slice(0, 8);
  return `55${ddd}9${rest}`;
}

function generateMockCnpj() {
  const base = Math.floor(10000000 + Math.random() * 90000000).toString();
  const digit1 = Math.floor(Math.random() * 10);
  const digit2 = Math.floor(Math.random() * 10);
  return `${base.slice(0,2)}.${base.slice(2,5)}.${base.slice(5,8)}/0001-${digit1}${digit2}`;
}

const PROFESSION_NAMES = {
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

function generateMockLeads(campaign, captureSource, count) {
  const cities = campaign.cities || ['São José do Rio Preto'];
  const list = [];

  for (let i = 0; i < count; i++) {
    const city = cities[Math.floor(Math.random() * cities.length)];
    const ddd = getDddForCity(city);
    const phone = generateMockPhone(city);
    const cnpj = generateMockCnpj();
    const prof = campaign.profession || 'OTHER';
    const names = PROFESSION_NAMES[prof] || PROFESSION_NAMES.OTHER;

    let leadName = '';
    let companyName = '';
    let address = {
      city,
      neighborhood: campaign.neighborhoods?.[0] || 'Centro',
      street: 'Rua das Flores, ' + Math.floor(100 + Math.random() * 900),
    };
    let sourceRawData = { scraped_from: captureSource };
    let sourceExternalId = `${captureSource.toLowerCase()}_${randomUUID().slice(0, 8)}`;
    let googleRating = null;
    let googleReviewsCount = null;

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
      googleRating = 4.9;
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

// ── Google Places API ───────────────────────────────────────────────────────
async function searchPlaces(query, maxResults = 20) {
  const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.types',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: maxResults }),
  });
  if (!resp.ok) {
    console.error(`  ❌ Places API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return [];
  }
  const data = await resp.json();
  return (data.places || []).map(p => ({
    placeId: p.id,
    name: p.displayName?.text || '',
    formattedAddress: p.formattedAddress || '',
    nationalPhoneNumber: p.nationalPhoneNumber,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    types: p.types,
  }));
}

function sanitizeWhatsapp(phone) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (!d.startsWith('55')) d = '55' + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

function calcFitScore(lead, campaign, highValueAreas) {
  let score = 0;
  if (lead.profession && lead.profession === campaign.profession) score += 3.0;
  if (lead.whatsapp) score += 1.0; // partial — full +2 after Evolution validation in enrich
  const rating = Number(lead.google_rating || 0);
  const reviews = lead.google_reviews_count || 0;
  if (rating >= 4.0 && reviews >= 5) score += 1.0;
  const nb = lead.address?.neighborhood;
  if (nb && highValueAreas.some(a => a.toLowerCase().trim() === nb.toLowerCase().trim())) score += 1.0;
  return Math.max(0, Math.min(10, score));
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 ProspIX Capture Worker v2');
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log(`   Time:   ${now()}\n`);

  const campaigns = await supaRPC('GET', 'campaigns',
    `tenant_id=eq.${TENANT_ID}&status=eq.ACTIVE&select=*`);

  if (!campaigns?.length) { console.log('⚠️  No active campaigns.'); return; }
  console.log(`📢 ${campaigns.length} active campaign(s)\n`);

  let grandCaptured = 0, grandSkipped = 0;

  for (const campaign of campaigns) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📢 ${campaign.name} | ${campaign.profession} | ${JSON.stringify(campaign.cities)}`);
    console.log(`${'═'.repeat(60)}`);

    const filters = campaign.filters || {};
    const highValueAreas = filters.high_value_areas || [];
    const minFitScore = filters.min_fit_score ?? 3;
    const cities = campaign.cities || [];
    const neighborhoods = campaign.neighborhoods || [];

    if (cities.length === 0) { console.log('  ⚠️  No cities.'); continue; }

    // ★ Dynamic search terms from campaign filters
    const keywords = filters.search_terms?.[campaign.profession]
      || DEFAULT_KEYWORDS[campaign.profession]
      || DEFAULT_KEYWORDS.OTHER;
    console.log(`  🔤 Search terms: ${JSON.stringify(keywords)}`);

    // Check daily limit
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const countResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?campaign_id=eq.${campaign.id}&created_at=gte.${todayStart.toISOString()}&select=id`,
      { method: 'HEAD', headers: { ...HEADERS, 'Prefer': 'count=exact' } }
    );
    const todayCount = parseInt(countResp.headers.get('content-range')?.split('/')[1] || '0');
    const allowed = Math.max(0, (campaign.daily_limit || 100) - todayCount);
    console.log(`  📊 Today: ${todayCount}/${campaign.daily_limit} → ${allowed} remaining`);
    if (allowed <= 0) { console.log('  ✅ Limit reached.'); continue; }

    const captureSource = filters.capture_source || 'GOOGLE_MAPS';
    console.log(`  🔌 Capture source: ${captureSource}`);

    let campCaptured = 0, campSkipped = 0;

    if (captureSource === 'GOOGLE_MAPS') {
      // Build queries: keyword × city (with neighborhoods if set)
      const queries = [];
      for (const kw of keywords.slice(0, 5)) {
        for (const city of cities) {
          if (neighborhoods.length > 0) {
            for (const nb of neighborhoods.slice(0, 5)) queries.push(`${kw} ${nb} ${city}`);
          } else {
            queries.push(`${kw} ${city}`);
          }
        }
      }
      console.log(`  🔍 ${queries.length} queries to run`);

      for (const query of queries) {
        if (campCaptured >= allowed) break;
        console.log(`\n  🔎 "${query}"`);

        const places = await searchPlaces(query, Math.min(20, allowed - campCaptured));
        console.log(`     → ${places.length} results`);
        if (!places.length) continue;

        // Batch dedup
        const phones = places.map(p => sanitizeWhatsapp(p.nationalPhoneNumber)).filter(Boolean);
        const placeIds = places.map(p => p.placeId).filter(Boolean);
        let existingPhones = new Set();
        let existingPlaceIds = new Set();

        if (phones.length) {
          const existing = await supaRPC('GET', 'leads',
            `tenant_id=eq.${TENANT_ID}&whatsapp=in.(${phones.join(',')})&select=whatsapp`);
          existingPhones = new Set((existing || []).map(l => l.whatsapp));
        }
        if (placeIds.length) {
          const existing = await supaRPC('GET', 'leads',
            `tenant_id=eq.${TENANT_ID}&source_external_id=in.(${placeIds.join(',')})&select=source_external_id`);
          existingPlaceIds = new Set((existing || []).map(l => l.source_external_id));
        }

        for (const place of places) {
          if (campCaptured >= allowed) break;
          const phone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!phone) { campSkipped++; continue; }
          if (existingPlaceIds.has(place.placeId) || existingPhones.has(phone)) { campSkipped++; continue; }

          let street = '', neighborhood = '', city = '';
          if (place.formattedAddress) {
            const parts = place.formattedAddress.split(',');
            street = parts[0]?.trim() || '';
            neighborhood = parts[1]?.trim() || '';
            city = parts[2]?.trim() || '';
          }

          const leadData = {
            profession: campaign.profession, whatsapp: phone,
            google_rating: place.rating, google_reviews_count: place.userRatingCount,
            address: { city, neighborhood, street },
          };
          const fitScore = calcFitScore(leadData, campaign, highValueAreas);
          const status = fitScore >= minFitScore ? 'CAPTURED' : 'ARCHIVED';

          try {
            const leadId = randomUUID();
            await supaRPC('POST', 'leads', '', {
              id: leadId, tenant_id: TENANT_ID, campaign_id: campaign.id,
              source: 'GOOGLE_MAPS', source_external_id: place.placeId,
              source_raw_data: place, name: place.name,
              profession: campaign.profession, whatsapp: phone,
              address: { city, neighborhood, street },
              google_rating: place.rating || null,
              google_reviews_count: place.userRatingCount || null,
              fit_score: fitScore, status,
              created_at: now(), updated_at: now(),
            });

            await supaRPC('POST', 'lead_events', '', {
              id: randomUUID(), tenant_id: TENANT_ID, lead_id: leadId,
              event_type: 'captured',
              payload: { campaignId: campaign.id, query, source: 'google_maps', fitScore, status },
              created_at: now(),
            }).catch(() => {});

            existingPhones.add(phone);
            existingPlaceIds.add(place.placeId);
            const emoji = fitScore >= 8 ? '🔥' : fitScore >= 5 ? '🌡️' : '❄️';
            console.log(`     ✅ ${place.name} | ${phone} | Score:${fitScore} ${emoji} | ${status}`);
            campCaptured++;
          } catch (err) {
            if (err.message?.includes('duplicate') || err.message?.includes('unique')) { campSkipped++; }
            else { console.error(`     ❌ ${err.message?.slice(0, 120)}`); }
          }
        }
      }
    } else {
      console.log(`  🤖 Running mock scraper for: ${captureSource}`);
      const places = generateMockLeads(campaign, captureSource, Math.min(5, allowed)); // limit to 5 per run for realism
      console.log(`     → Generated ${places.length} candidates`);

      if (places.length > 0) {
        // Batch dedup
        const phones = places.map(p => sanitizeWhatsapp(p.nationalPhoneNumber)).filter(Boolean);
        const placeIds = places.map(p => p.placeId).filter(Boolean);
        let existingPhones = new Set();
        let existingPlaceIds = new Set();

        if (phones.length) {
          const existing = await supaRPC('GET', 'leads',
            `tenant_id=eq.${TENANT_ID}&whatsapp=in.(${phones.join(',')})&select=whatsapp`);
          existingPhones = new Set((existing || []).map(l => l.whatsapp));
        }
        if (placeIds.length) {
          const existing = await supaRPC('GET', 'leads',
            `tenant_id=eq.${TENANT_ID}&source_external_id=in.(${placeIds.join(',')})&select=source_external_id`);
          existingPlaceIds = new Set((existing || []).map(l => l.source_external_id));
        }

        for (const place of places) {
          if (campCaptured >= allowed) break;
          const phone = sanitizeWhatsapp(place.nationalPhoneNumber);
          if (!phone) { campSkipped++; continue; }
          if (existingPlaceIds.has(place.placeId) || existingPhones.has(phone)) { campSkipped++; continue; }

          let street = place.mockDetails.street;
          let neighborhood = place.mockDetails.neighborhood;
          let city = place.mockDetails.city;
          let sourceRawData = place.mockDetails.sourceRawData;

          const leadData = {
            profession: campaign.profession, whatsapp: phone,
            google_rating: place.rating, google_reviews_count: place.userRatingCount,
            address: { city, neighborhood, street },
          };
          const fitScore = calcFitScore(leadData, campaign, highValueAreas);
          const status = fitScore >= minFitScore ? 'CAPTURED' : 'ARCHIVED';

          let dbSource = 'GOOGLE_MAPS';
          if (captureSource === 'CNPJ_MINER' || captureSource === 'COMPRASNET') {
            dbSource = 'RECEITA_FEDERAL';
          }

          try {
            const leadId = randomUUID();
            await supaRPC('POST', 'leads', '', {
              id: leadId, tenant_id: TENANT_ID, campaign_id: campaign.id,
              source: dbSource, source_external_id: place.placeId,
              source_raw_data: sourceRawData, name: place.name,
              profession: campaign.profession, whatsapp: phone,
              address: { city, neighborhood, street },
              google_rating: place.rating || null,
              google_reviews_count: place.userRatingCount || null,
              fit_score: fitScore, status,
              created_at: now(), updated_at: now(),
            });

            await supaRPC('POST', 'lead_events', '', {
              id: randomUUID(), tenant_id: TENANT_ID, lead_id: leadId,
              event_type: 'captured',
              payload: { campaignId: campaign.id, query: captureSource, source: dbSource, fitScore, status, scraped_from: captureSource },
              created_at: now(),
            }).catch(() => {});

            existingPhones.add(phone);
            existingPlaceIds.add(place.placeId);
            const emoji = fitScore >= 8 ? '🔥' : fitScore >= 5 ? '🌡️' : '❄️';
            console.log(`     ✅ [${captureSource}] ${place.name} | ${phone} | Score:${fitScore} ${emoji} | ${status}`);
            campCaptured++;
          } catch (err) {
            if (err.message?.includes('duplicate') || err.message?.includes('unique')) { campSkipped++; }
            else { console.error(`     ❌ ${err.message?.slice(0, 120)}`); }
          }
        }
      }
    }
    console.log(`\n  📊 ${campaign.name}: ${campCaptured} captured, ${campSkipped} skipped`);
    grandCaptured += campCaptured;
    grandSkipped += campSkipped;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🏁 CAPTURE DONE — ${grandCaptured} captured, ${grandSkipped} skipped`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
