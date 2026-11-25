-- Authorized preparation: no campaign activation, no messages, no credentials.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $prepare$
DECLARE
  v_tenant uuid := '220e676e-ef8d-4312-814d-fb4dca962c06';
  v_script uuid;
  v_icp uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE tenant_id=v_tenant AND lower(email)='giovanerodrigues1234@gmail.com' AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=v_tenant AND status='ACTIVE' AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.tenant_ai_outbound_controls WHERE tenant_id=v_tenant AND paused=true)
  THEN RAISE EXCEPTION 'CLIENT_SCOPE_OR_PAUSE_MISMATCH'; END IF;

  SELECT id INTO v_script FROM public.scripts WHERE tenant_id=v_tenant AND name='Qualificação consultiva · Apresentação 2026-11-19' AND archived_at IS NULL;
  IF v_script IS NOT NULL THEN
    RAISE NOTICE 'ALREADY_PREPARED: existing script is preserved'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_business_context WHERE tenant_id=v_tenant)
    OR EXISTS (SELECT 1 FROM public.commercial_knowledge_chunks WHERE tenant_id=v_tenant AND status='APPROVED' AND active)
  THEN RAISE EXCEPTION 'COMMERCIAL_CONTENT_CHANGED_REVIEW_BEFORE_WRITING'; END IF;

  v_script := gen_random_uuid();
  v_icp := gen_random_uuid();
  INSERT INTO public.icps(id,tenant_id,name,min_fit_score,weights,high_value_areas,created_at,updated_at)
  VALUES(v_icp,v_tenant,'ICP · Demonstração consultiva',6,
    '{"profession_match":3,"whatsapp_valid":2,"partner_or_owner":2,"high_value_area":1,"cnpj_age":1,"google_reputation":1}',
    ARRAY[]::text[],now(),now());

  INSERT INTO public.scripts(id,tenant_id,name,category,target_profession,status,base_message,ai_instructions,ai_tools,restrictions,variables,guardians_config,qualification_config,flow,created_at,updated_at)
  VALUES(v_script,v_tenant,'Qualificação consultiva · Apresentação 2026-11-19','APPROACH','DOCTOR','ACTIVE',
    'Olá, {{NOME}}! Sou a assistente virtual do time do Giovane. Posso fazer uma pergunta rápida sobre proteção de renda?',
    'Apresente-se como assistente virtual do time do Giovane. Responda primeiro à mensagem atual e faça no máximo uma pergunta pertinente por turno. Use somente fatos confirmados, o próximo critério pendente e materiais aprovados. Não repita perguntas respondidas. Não finja ser o corretor. Encaminhe interesse à equipe para confirmação de disponibilidade; não afirme que há reserva sem evento confirmado. Não dê cotações, garantias, condições contratuais ou estatísticas sem fonte aprovada.',
    '["ESCALATE"]',
    'Não coletar saúde, peso, tabagismo ou histórico médico. Não inventar profissão, gênero, nome, preço ou cobertura. Não insistir após recusa. Não citar origem da busca, score ou metadado interno. Sem reserva de agenda sem recibo de evento.',
    ARRAY['NOME','CIDADE','PROFISSAO'],
    '{"qualification_enabled":true,"objections_enabled":true,"short_responses_enabled":true}',
    '{"version":1,"framework":"METLIFE_PROTECTION_INCOME_V1","minimum_score":70,"max_questions_per_message":1,"collect_health_data":false,"criteria":[{"key":"professional_profile_confirmed","required":true,"weight":20,"values":[true,false],"accepted":[true],"question":"Hoje sua renda depende diretamente da sua atuação profissional?"},{"key":"decision_role","required":true,"weight":25,"values":["SELF","SHARED","OTHER","UNKNOWN"],"accepted":["SELF","SHARED"],"question":"Essa decisão costuma passar por você ou é compartilhada com alguém?"},{"key":"income_dependency","required":true,"weight":30,"values":["HIGH","MEDIUM","LOW","NONE","UNKNOWN"],"accepted":["HIGH","MEDIUM"],"question":"Um período sem trabalhar afetaria bastante sua renda?"},{"key":"protection_gap","required":true,"weight":25,"values":["NONE","PARTIAL","FULL","UNKNOWN"],"accepted":["NONE","PARTIAL","UNKNOWN"],"question":"Você já conta com alguma proteção específica para a renda em um afastamento?"}]}',
    '{"version":1,"nodes":[],"edges":[]}',now(),now());

  INSERT INTO public.tenant_business_context(tenant_id,persona_name,persona_role,business_description,common_objections,standard_approaches,tone_of_voice,created_at,updated_at)
  VALUES(v_tenant,'Assistente virtual do time do Giovane','Atendimento inicial e encaminhamento ao corretor',
    'Atendimento inicial de Giovane Rodrigues, corretor parceiro MetLife em São José do Rio Preto. A qualificação identifica interesse e contexto comercial. Condições de produto, cotações e cobertura devem ser confirmadas pelo corretor com o material vigente.',
    'Já tenho seguro; preço; falta de tempo; não tenho interesse. Respeitar a resposta e não insistir.',
    'Responder à dúvida antes de perguntar. Fazer uma pergunta por vez. Confirmar o interesse e encaminhar para atendimento humano quando necessário.',
    'Consultivo, direto e cordial. Frases curtas. Sem saudações repetidas ou elogios automáticos.',now(),now());

  INSERT INTO public.commercial_knowledge_chunks(tenant_id,script_id,kind,skill_key,title,content,keywords,status,active,priority)
  SELECT v_tenant,v_script,kind,skill,title,content,keywords,'APPROVED',true,70
  FROM (VALUES
    ('SKILL','opening','Apresentação transparente','Identifique-se como assistente virtual do time do Giovane. Dê contexto em uma frase e peça permissão para uma pergunta. Não prometa resultado.',ARRAY['olá','oi','quem']),
    ('SKILL','discovery','Escuta e contexto','Responda primeiro à última mensagem. Use os fatos já confirmados e pergunte apenas o próximo campo pendente. Uma pergunta nova por mensagem.',ARRAY['contexto','como']),
    ('SKILL','implication','Impacto sem alarmismo','Entenda como uma interrupção do trabalho afetaria a renda sem presumir situação financeira e sem perguntar doenças. Não explore medo.',ARRAY['afastamento','renda']),
    ('SKILL','qualification','Qualificação por evidência','Registre perfil profissional confirmado, papel na decisão, dependência da renda e proteção existente. Uma resposta curta só se liga à pergunta imediatamente anterior.',ARRAY['decido','proteção','trabalho']),
    ('SKILL','objection','Resposta a objeções','Reconheça a objeção sem contestar. Quando já houver seguro, pergunte se há proteção de renda específica; não diga que a cobertura é insuficiente. Preço depende de análise do corretor.',ARRAY['seguro','preço','caro']),
    ('SKILL','value','Valor sem promessa','Explique somente o objetivo da conversa: entender o contexto e verificar se faz sentido falar com o corretor. Não cite indenizações, rentabilidade, prêmio, retorno ou cobertura sem material aprovado.',ARRAY['valor','benefício']),
    ('SKILL','commitment','Próximo passo consentido','Quando houver interesse, pergunte se a pessoa deseja falar com a equipe. Interesse não é reunião marcada. Não invente disponibilidade.',ARRAY['reunião','agenda','horário']),
    ('SKILL','disqualification','Respeito à recusa','Se houver pedido para parar ou desinteresse claro, agradeça e encerre. Não envie insistência nem tente reverter um opt-out.',ARRAY['pare','não quero','sem interesse']),
    ('SKILL','handoff','Encaminhamento humano','Encaminhe preço, cobertura, análise técnica, pedido humano e disponibilidade ao corretor. Diga que a equipe precisa confirmar o próximo passo, sem prazo inventado.',ARRAY['humano','corretor','cobertura']),
    ('RESTRICTION','qualification','Não coletar saúde nesta etapa','Não solicite diagnóstico, peso, altura, tabagismo ou histórico de saúde na prospecção inicial.',ARRAY['saúde','doença']),
    ('RESTRICTION','value','Não inventar fatos comerciais','Não apresente nenhum número, condição de produto, garantia ou estatística sem fonte aprovada. Na dúvida, encaminhe ao corretor.',ARRAY['garantia','custo','cobertura'])
  ) AS items(kind,skill,title,content,keywords);

  INSERT INTO public.campaigns(id,tenant_id,name,profession,cities,neighborhoods,state,search_tags,capture_sources,daily_limit,hour_window_start,hour_window_end,discovery_daily_budget_cents,max_cost_per_eligible_lead_cents,max_provider_calls_per_run,discovery_auto_enabled,homologation_mode,homologation_lead_limit,active_script_id,icp_id,status,filters,total_captured,total_conversing,total_scheduled,total_closed_won,created_at,updated_at)
  VALUES(gen_random_uuid(),v_tenant,'QA TESTE 2026-11-19 · Apresentação','DOCTOR',ARRAY['São José do Rio Preto'],ARRAY[]::text[],'SP',ARRAY[]::text[],ARRAY['GOOGLE_MAPS'],1,9,18,0,0,1,false,true,1,v_script,v_icp,'PAUSED',
    '{"presentation_qa":true,"deep_enrichment":false,"one_source_per_run":true}',0,0,0,0,now(),now());
END;
$prepare$;

SELECT jsonb_build_object(
  'context_present',EXISTS(SELECT 1 FROM public.tenant_business_context WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
  'approved_skills',(SELECT count(*) FROM public.commercial_knowledge_chunks WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06' AND status='APPROVED' AND active),
  'active_campaigns',(SELECT count(*) FROM public.campaigns WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06' AND status='ACTIVE'),
  'outbound_paused',(SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06')
) AS verification;
ROLLBACK;
