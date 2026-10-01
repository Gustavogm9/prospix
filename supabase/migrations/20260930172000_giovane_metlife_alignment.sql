-- Align the authorized QA tenant with the documented Tenant #1 positioning.
-- This migration is deliberately guarded by the known tenant/campaign ids and
-- keeps the campaign plus tenant outbound paused after applying the config.

BEGIN;

DO $$
DECLARE
  v_tenant_id UUID := '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::UUID;
  v_campaign_id UUID := 'e11fce13-79a9-41f9-afc0-e341a5ad7759'::UUID;
  v_qa_lead_id UUID := '1848688e-55e6-4093-a0a5-0e967452a398'::UUID;
  v_script_id UUID;
  v_icp_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = v_tenant_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = v_campaign_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE NOTICE 'Giovane alignment skipped: target tenant/campaign is not present in this environment.';
    RETURN;
  END IF;

  SELECT icp_id INTO v_icp_id
  FROM public.campaigns
  WHERE id = v_campaign_id AND tenant_id = v_tenant_id;

  SELECT id INTO v_script_id
  FROM public.scripts
  WHERE tenant_id = v_tenant_id
    AND name = 'Médicos · Proteção de renda · v1'
    AND archived_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_script_id IS NULL THEN
    v_script_id := gen_random_uuid();
    INSERT INTO public.scripts (
      id, tenant_id, name, category, target_profession, status,
      base_message, ai_instructions, ai_tools, restrictions,
      variables, guardians_config, qualification_config, flow,
      created_at, updated_at
    ) VALUES (
      v_script_id,
      v_tenant_id,
      'Médicos · Proteção de renda · v1',
      'APPROACH',
      'DOCTOR',
      'ACTIVE',
      'Oi {{NOME}}, tudo bem? Aqui é o Giovane, corretor parceiro da MetLife em São José do Rio Preto. Trabalho com proteção de renda para profissionais que dependem da própria atuação. Posso te fazer uma pergunta rápida?',
      $instructions$
Você é assistente do Giovane Carrara, corretor parceiro da MetLife em São José do Rio Preto.

Objetivo, nesta ordem:
1. Responder primeiro ao que o lead perguntou.
2. Entender com naturalidade se a renda depende da própria atuação, se a pessoa decide sobre a proteção e se existe uma lacuna de proteção de renda.
3. Fazer no máximo uma pergunta por mensagem, usando apenas o próximo campo pendente informado pelo estado estruturado.
4. Só sugerir conversa com o Giovane quando a qualificação estiver completa ou quando o lead pedir atendimento humano.

Tom: consultivo, caloroso, direto, sem pressão, com frases curtas e sem fingir ser o próprio Giovane. Use dados enriquecidos somente quando houver evidência e nunca mencione score, origem da busca, banco de dados ou enriquecimento.

Compliance: não informe prêmio, não prometa cobertura, não garanta aceitação, não apresente IPCA + 3% ou qualquer condição contratual sem material aprovado. Encaminhe perguntas específicas de produto ao Giovane.

Nesta fase não pergunte peso, altura, doença, tabagismo, histórico familiar ou qualquer dado de saúde. Esses dados pertencem a uma fase posterior, com base legal e consentimento próprios.
      $instructions$,
      '["ESCALATE"]'::JSONB,
      $restrictions$
Nunca se apresentar como se fosse o próprio Giovane; nunca inventar nome, título, gênero, profissão ou fatos; nunca expor score interno; nunca prometer cobertura, aprovação, preço ou retorno; nunca marcar horário sem agenda real; nunca coletar dado de saúde nesta fase; nunca insistir após recusa ou opt-out.
      $restrictions$,
      ARRAY['NOME', 'CIDADE', 'PROFISSAO']::TEXT[],
      '{"objections_enabled":true,"qualification_enabled":true,"short_responses_enabled":true}'::JSONB,
      $qualification$
{
  "version": 1,
  "framework": "METLIFE_PROTECTION_INCOME_V1",
  "minimum_score": 70,
  "max_questions_per_message": 1,
  "collect_health_data": false,
  "criteria": [
    {"key":"professional_profile_confirmed","required":true,"weight":20,"values":[true,false],"accepted":[true],"question":"Hoje sua renda depende diretamente da sua atuação profissional?"},
    {"key":"decision_role","required":true,"weight":25,"values":["SELF","SHARED","OTHER","UNKNOWN"],"accepted":["SELF","SHARED"],"question":"Essa decisão de proteção financeira passa por você ou costuma ser compartilhada com alguém?"},
    {"key":"income_dependency","required":true,"weight":30,"values":["HIGH","MEDIUM","LOW","NONE","UNKNOWN"],"accepted":["HIGH","MEDIUM"],"question":"Se você precisasse ficar um período sem atender, isso afetaria bastante sua renda?"},
    {"key":"protection_gap","required":true,"weight":25,"values":["NONE","PARTIAL","FULL","UNKNOWN"],"accepted":["NONE","PARTIAL","UNKNOWN"],"question":"Hoje você já tem alguma proteção específica para manter a renda durante um afastamento?"},
    {"key":"urgency","required":false,"weight":0,"values":["NOW","LATER","UNKNOWN"],"question":"Faz sentido olhar isso agora ou é algo mais para frente?"}
  ]
}
      $qualification$::JSONB,
      $flow$
{
  "version": 1,
  "nodes": [
    {"id":"start","type":"trigger","data":{"title":"Abertura","message":"Apresente o contexto em uma frase e peça permissão para uma pergunta."}},
    {"id":"profile","type":"qualification","data":{"title":"Dependência da atuação","criterion":"professional_profile_confirmed"}},
    {"id":"authority","type":"qualification","data":{"title":"Decisão","criterion":"decision_role"}},
    {"id":"need","type":"qualification","data":{"title":"Impacto na renda","criterion":"income_dependency"}},
    {"id":"gap","type":"qualification","data":{"title":"Proteção atual","criterion":"protection_gap"}},
    {"id":"handoff","type":"handoff","data":{"title":"Próximo passo","message":"Ofereça encaminhamento ao Giovane somente após qualificação ou pedido explícito."}}
  ],
  "edges": [
    {"source":"start","target":"profile"},
    {"source":"profile","target":"authority"},
    {"source":"authority","target":"need"},
    {"source":"need","target":"gap"},
    {"source":"gap","target":"handoff"}
  ]
}
      $flow$::JSONB,
      statement_timestamp(),
      statement_timestamp()
    );

    INSERT INTO public.script_variations (
      id, tenant_id, script_id, variant_letter, message, weight,
      total_sent, total_responded, total_converted, active, created_at, updated_at
    ) VALUES
      (gen_random_uuid(), v_tenant_id, v_script_id, 'A',
       'Oi {{NOME}}, tudo bem? Aqui é do time do Giovane, corretor parceiro da MetLife em Rio Preto. Ele trabalha com proteção de renda para quem depende da própria atuação. Posso te fazer uma pergunta rápida?',
       0.34, 0, 0, 0, true, statement_timestamp(), statement_timestamp()),
      (gen_random_uuid(), v_tenant_id, v_script_id, 'B',
       'Oi {{NOME}}, tudo bem? Trabalho com o Giovane na parte de proteção financeira para profissionais de saúde. Hoje sua renda depende diretamente dos seus atendimentos?',
       0.33, 0, 0, 0, true, statement_timestamp(), statement_timestamp()),
      (gen_random_uuid(), v_tenant_id, v_script_id, 'C',
       'Oi {{NOME}}, tudo certo? Sou assistente do time do Giovane. Uma dúvida rápida: se você precisasse se afastar por um tempo, sua renda sentiria bastante?',
       0.33, 0, 0, 0, true, statement_timestamp(), statement_timestamp());

    INSERT INTO public.objections (
      id, tenant_id, script_id, title, pattern, response, created_at, updated_at
    ) VALUES
      (gen_random_uuid(), v_tenant_id, v_script_id, 'Já tenho seguro', 'já tenho seguro|já sou segurado',
       'Perfeito — não quero substituir nada sem entender. A pergunta é só se a proteção atual também cobre a perda de renda em um afastamento. Você sabe se cobre?', statement_timestamp(), statement_timestamp()),
      (gen_random_uuid(), v_tenant_id, v_script_id, 'Preço', 'quanto custa|preço|valor|caro',
       'O valor depende do perfil e da análise, então eu não consigo te passar algo responsável por aqui. Antes disso, sua prioridade seria proteger a renda ou outro ponto?', statement_timestamp(), statement_timestamp()),
      (gen_random_uuid(), v_tenant_id, v_script_id, 'Sem tempo', 'sem tempo|correria|ocupado',
       'Entendo a correria. Posso deixar só uma pergunta objetiva e, se não fizer sentido, encerramos por aqui: um afastamento hoje afetaria sua renda?', statement_timestamp(), statement_timestamp()),
      (gen_random_uuid(), v_tenant_id, v_script_id, 'Não tenho interesse', 'não quero|sem interesse|pare',
       'Tudo certo. Obrigado por avisar — não vou insistir.', statement_timestamp(), statement_timestamp());
  END IF;

  UPDATE public.campaigns
  SET
    name = 'Médicos · Proteção de renda · SJRP',
    profession = 'DOCTOR',
    cities = ARRAY['São José do Rio Preto']::TEXT[],
    neighborhoods = ARRAY[]::TEXT[],
    state = 'SP',
    search_tags = ARRAY[
      'cardiologista', 'ortopedista', 'dermatologista',
      'pediatra', 'clínica médica', 'consultório médico'
    ]::TEXT[],
    capture_sources = ARRAY['GOOGLE_MAPS']::TEXT[],
    daily_limit = 20,
    hour_window_start = 9,
    hour_window_end = 18,
    discovery_daily_budget_cents = 200,
    max_cost_per_eligible_lead_cents = 50,
    max_provider_calls_per_run = 60,
    discovery_auto_enabled = false,
    homologation_mode = true,
    homologation_lead_limit = 20,
    active_script_id = v_script_id,
    status = 'PAUSED',
    filters = COALESCE(filters, '{}'::JSONB) || $filters$
      {
        "segment":"medical_income_protection",
        "deep_enrichment":false,
        "one_source_per_run":true,
        "search_terms":{"DOCTOR":["cardiologista","ortopedista","dermatologista","pediatra","clínica médica","consultório médico"]}
      }
    $filters$::JSONB,
    updated_at = statement_timestamp()
  WHERE id = v_campaign_id AND tenant_id = v_tenant_id;

  -- Do not let messages generated with the superseded entrepreneur/Vanguarda
  -- context leave the queue after this campaign is eventually resumed.
  UPDATE public.pending_outbound pending
  SET failed_at = statement_timestamp(),
      failed_reason = 'CAMPAIGN_CONTEXT_REPLACED'
  FROM public.conversations conversation
  JOIN public.leads lead
    ON lead.id = conversation.lead_id
   AND lead.tenant_id = conversation.tenant_id
  WHERE pending.conversation_id = conversation.id
    AND pending.tenant_id = v_tenant_id
    AND lead.campaign_id = v_campaign_id
    AND pending.sent_at IS NULL
    AND pending.failed_at IS NULL;

  -- The already-authorized CEO QA conversation must use the same structured
  -- script as the campaign; other existing conversations are left untouched.
  UPDATE public.conversations
  SET script_id = v_script_id
  WHERE tenant_id = v_tenant_id
    AND lead_id = v_qa_lead_id;

  -- Keep only user-confirmed QA facts. The CEO is simulating the target lead;
  -- a medical profession must be confirmed in the conversation, not invented.
  UPDATE public.leads
  SET
    name = 'Gustavo',
    profession = NULL,
    partner_or_owner = NULL,
    fit_score = 10,
    metadata = COALESCE(metadata, '{}'::JSONB) || jsonb_build_object(
      'qa_run', 'QA_EVOLUTION_GUILDS_20260930_QUALIFICATION_V2',
      'authorized', true,
      'job_title', 'CEO',
      'company_name', 'Guilds',
      'enrichment_source', 'user_authorized_qa'
    ),
    updated_at = statement_timestamp()
  WHERE id = v_qa_lead_id
    AND tenant_id = v_tenant_id;

  IF v_icp_id IS NOT NULL THEN
    UPDATE public.icps
    SET
      name = 'ICP · Médicos · Proteção de renda',
      min_fit_score = 6,
      weights = '{"profession_match":3,"whatsapp_valid":2,"partner_or_owner":2,"high_value_area":1,"cnpj_age":1,"google_reputation":1}'::JSONB,
      high_value_areas = ARRAY[]::TEXT[],
      min_google_rating = 4.5,
      min_reviews = 10,
      updated_at = statement_timestamp()
    WHERE id = v_icp_id AND tenant_id = v_tenant_id;
  END IF;

  INSERT INTO public.tenant_business_context (
    tenant_id, persona_name, persona_role, business_description,
    common_objections, standard_approaches, tone_of_voice, created_at, updated_at
  ) VALUES (
    v_tenant_id,
    'Assistente do time do Giovane',
    'Atendimento inicial de Giovane Carrara, corretor parceiro da MetLife',
    'Giovane atua em São José do Rio Preto com proteção financeira e proteção de renda para profissionais liberais. A conversa inicial entende o cenário e encaminha ao Giovane; não cota nem promete cobertura pelo WhatsApp.',
    'Já tenho seguro; preço; falta de tempo; prefiro investir; não tenho interesse. Responder de forma curta, validar a objeção e fazer no máximo uma pergunta pertinente.',
    'Responder primeiro à dúvida; usar uma pergunta por turno; confirmar fatos em vez de inferir; encaminhar ao Giovane após qualificação ou pedido explícito.',
    'Consultivo, caloroso e direto. Frases curtas, sem pressão e sem fingir ser uma pessoa humana específica.',
    statement_timestamp(), statement_timestamp()
  )
  ON CONFLICT (tenant_id) DO UPDATE
  SET
    persona_name = EXCLUDED.persona_name,
    persona_role = EXCLUDED.persona_role,
    business_description = EXCLUDED.business_description,
    common_objections = EXCLUDED.common_objections,
    standard_approaches = EXCLUDED.standard_approaches,
    tone_of_voice = EXCLUDED.tone_of_voice,
    updated_at = statement_timestamp();

  UPDATE public.tenants
  SET
    segment = 'insurance_metlife',
    ai_voice_profile = COALESCE(ai_voice_profile, '{}'::JSONB) || $voice$
      {
        "status":"NEEDS_TENANT_VALIDATION",
        "broker":{"name":"Giovane Carrara","preferred_name":"Giovane","partner_brand":"MetLife","city":"São José do Rio Preto"},
        "tone":{"description":"Consultivo, caloroso e direto; frases curtas; sem pressão; desconstrói a ideia de que proteção é apenas para morte."},
        "compliance_never":["informar prêmio sem cotação","garantir aprovação","prometer cobertura","coletar saúde na fase inicial"]
      }
    $voice$::JSONB,
    updated_at = statement_timestamp()
  WHERE id = v_tenant_id;

  UPDATE public.tenant_guardian_settings settings
  SET mode = 'BLOCK',
      fail_policy = 'FAIL_CLOSED',
      updated_at = statement_timestamp()
  FROM public.guardian_config_versions versions
  WHERE settings.config_version_id = versions.id
    AND settings.tenant_id = v_tenant_id
    AND versions.tenant_id = v_tenant_id
    AND versions.status = 'ACTIVE'
    AND settings.guardian_key = 'G09_QUALIFICATION';

  IF EXISTS (SELECT 1 FROM public.leads WHERE id = v_qa_lead_id AND tenant_id = v_tenant_id) THEN
    INSERT INTO public.campaign_qa_allowlist (
      campaign_id, lead_id, reason, expires_at
    ) VALUES (
      v_campaign_id, v_qa_lead_id,
      'Contato de homologação autorizado pelo CEO em 30/09/2026',
      statement_timestamp() + INTERVAL '14 days'
    )
    ON CONFLICT (campaign_id, lead_id) DO UPDATE
    SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at;
  END IF;

  PERFORM public.set_tenant_ai_outbound_pause(
    v_tenant_id,
    true,
    NULL,
    'Intervenção de ICP, custos e qualificação; retomada exige homologação',
    jsonb_build_object('source', 'migration', 'campaign_id', v_campaign_id)
  );
END;
$$;

COMMIT;
