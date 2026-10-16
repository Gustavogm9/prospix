param(
  [System.Security.SecureString]$AccessToken,
  [System.Security.SecureString]$ExpectedPhone
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$functionUrl = "https://$projectRef.supabase.co/functions/v1/send-messages"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$previousCampaignId = 'e11fce13-79a9-41f9-afc0-e341a5ad7759'
$icpId = '2ba41a5f-cb9e-47a1-86e5-1a4451f7a3f8'
$scriptId = 'c6571fe5-7da1-4ff9-a549-391b1ad13271'
$campaignId = '97d1633f-0d9e-4fa6-8089-f0a38d11e4ad'
$conversationId = '4da0acfa-8299-488c-a9ef-f58788d0b65c'
$channelId = '24d3a1e4-7f70-4ea3-a66e-8bc7a8952e30'
$pendingId = [guid]::NewGuid().ToString()
$qaRun = 'QA_GUILDS_PROSPIX_INTERNAL_20261016_V1'
$idempotencyKey = 'qa-guilds-prospix-internal-20261016-v1'
$sshTarget = 'root@2.28.205.33'
$sshKey = 'C:\Users\User\.ssh\hetzner_guilds_2026'
$minimumSendMessagesVersion = 58

function Write-Stage([string]$message) {
  Write-Host "[Guilds QA] $message"
}

function Invoke-SshCommand([string]$remoteCommand) {
  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = 'ssh'
  foreach ($argument in @(
      '-i', $sshKey,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      $sshTarget,
      $remoteCommand
    )) {
    $null = $processInfo.ArgumentList.Add($argument)
  }
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $processInfo
  $null = $process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "A leitura segura na VPS falhou (codigo $($process.ExitCode))."
  }
  return $stdout.Trim()
}

function Invoke-ManagementRequest(
  [string]$method,
  [string]$path,
  [object]$body = $null
) {
  $parameters = @{
    Uri = "$projectApi$path"
    Method = $method
    Headers = @{ Authorization = "Bearer $script:patValue" }
  }
  if ($null -ne $body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = $body | ConvertTo-Json -Depth 20 -Compress
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace '\+?55\D*\d{2}\D*9\D*\d{4}\D*\d{4}', '[PHONE_REDACTED]'
    $detail = $detail -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN_REDACTED]'
    $detail = $detail -replace 'eyJ[A-Za-z0-9_\-.]+', '[JWT_REDACTED]'
    if ($detail.Length -gt 900) { $detail = $detail.Substring(0, 900) }
    throw "A chamada de gestao do Supabase falhou (HTTP $status): $detail"
  }
}

function Invoke-ManagementSql([string]$query) {
  return Invoke-ManagementRequest -method 'POST' -path '/database/query' -body @{ query = $query }
}

$patBstr = [IntPtr]::Zero
$phoneBstr = [IntPtr]::Zero
try {
  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  $secureExpectedPhone = if ($ExpectedPhone) { $ExpectedPhone } else { Read-Host 'CEO internal test phone' -AsSecureString }
  $phoneBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureExpectedPhone)
  $expectedPhoneDigits = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($phoneBstr)) -replace '\D', ''

  Write-Stage 'validando destino interno, projeto e versao do worker'
  $phone = (Invoke-SshCommand 'docker exec guilds-reports-api printenv CEO_WHATSAPP_NUMBER') -replace '\D', ''
  if ($phone -notmatch '^55\d{2}9\d{8}$') {
    throw 'O numero interno autorizado na VPS nao tem formato movel brasileiro valido.'
  }
  if ($phone -ne $expectedPhoneDigits) {
    throw 'O numero confirmado diverge do destino interno protegido na VPS.'
  }

  $apiKeys = Invoke-ManagementRequest -method 'GET' -path '/api-keys?reveal=true'
  $serviceRoleEntry = $apiKeys | Where-Object { $_.type -eq 'secret' } | Select-Object -First 1
  if (-not $serviceRoleEntry) {
    $serviceRoleEntry = $apiKeys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1
  }
  $serviceRoleKey = if ($serviceRoleEntry.api_key) { $serviceRoleEntry.api_key } else { $serviceRoleEntry.apiKey }
  if (-not $serviceRoleKey) { throw 'A chave service_role nao foi localizada pelo Management API.' }

  $functions = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $sendFunction = $functions | Where-Object {
    $_.slug -eq 'send-messages' -or $_.name -eq 'send-messages'
  } | Select-Object -First 1
  if (-not $sendFunction -or [int]$sendFunction.version -lt $minimumSendMessagesVersion -or $sendFunction.status -ne 'ACTIVE') {
    throw 'A versao homologada de send-messages nao esta ativa; nenhum dado foi criado.'
  }

  Write-Stage 'criando perfil Guilds, ICP, roteiro e campanha isolada em uma transacao'
  $sqlTemplate = @'
DO $guilds_qa$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_lead_id uuid;
  v_existing_lead_id uuid;
  v_existing_marker text;
  v_previous_guardian_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = '__TENANT__'::uuid AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'GUILDS_QA_TENANT_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_ai_outbound_controls
    WHERE tenant_id = '__TENANT__'::uuid AND paused = true
  ) THEN
    RAISE EXCEPTION 'GUILDS_QA_TENANT_OUTBOUND_MUST_REMAIN_PAUSED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_channels
    WHERE id = '__CHANNEL__'::uuid
      AND tenant_id = '__TENANT__'::uuid
      AND provider = 'EVOLUTION'
      AND instance_name = 'guilds'
      AND active = true
      AND send_enabled = true
      AND receive_enabled = true
      AND connection_status = 'CONNECTED'
      AND external_state = 'open'
  ) THEN
    RAISE EXCEPTION 'GUILDS_QA_CHANNEL_NOT_READY';
  END IF;

  SELECT status INTO v_previous_guardian_status
  FROM public.whatsapp_guardian_status
  WHERE tenant_id = '__TENANT__'::uuid
  FOR UPDATE;

  INSERT INTO public.whatsapp_guardian_status (
    tenant_id, status, external_state, external_checked_at, connected_at,
    quarantined_until, circuit_open_until, state_entered_at, state_reason_code,
    state_source, locked_at, created_at, updated_at
  ) VALUES (
    '__TENANT__'::uuid, 'NORMAL', 'open', v_now, v_now,
    NULL, NULL, v_now, NULL, 'qa-guilds-internal', NULL, v_now, v_now
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    status = 'NORMAL',
    external_state = 'open',
    external_checked_at = v_now,
    connected_at = COALESCE(whatsapp_guardian_status.connected_at, v_now),
    last_disconnect_reason_code = NULL,
    quarantined_until = NULL,
    circuit_open_until = NULL,
    state_entered_at = v_now,
    state_reason_code = NULL,
    state_source = 'qa-guilds-internal',
    locked_at = NULL,
    updated_at = v_now;

  UPDATE public.whatsapp_guardian_state_transitions
  SET exited_at = v_now,
      duration_seconds = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - entered_at))))::integer
  WHERE tenant_id = '__TENANT__'::uuid
    AND exited_at IS NULL;

  INSERT INTO public.whatsapp_guardian_state_transitions (
    tenant_id, previous_status, status, external_state, reason_code, source,
    impact_level, operation_state, operator_summary, allow_send,
    allow_new_active, entered_at, metadata
  ) VALUES (
    '__TENANT__'::uuid, v_previous_guardian_status, 'NORMAL', 'open',
    'QA_GUILDS_INTERNAL_SINGLE_CONTACT', 'codex-authorized-test',
    'INFO', 'ACTIVE', 'Canal liberado para teste interno isolado e autorizado da Guilds.',
    true, true, v_now,
    jsonb_build_object('qa_run', '__QA_RUN__', 'campaign_id', '__CAMPAIGN__')
  );

  IF EXISTS (
    SELECT 1 FROM public.optouts
    WHERE tenant_id = '__TENANT__'::uuid AND whatsapp = '__PHONE__'
  ) THEN
    RAISE EXCEPTION 'GUILDS_QA_DESTINATION_OPTED_OUT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pending_outbound
    WHERE tenant_id = '__TENANT__'::uuid
      AND sent_at IS NULL
      AND failed_at IS NULL
      AND idempotency_key <> '__IDEMPOTENCY__'
  ) THEN
    RAISE EXCEPTION 'GUILDS_QA_OTHER_PENDING_OUTBOUND_EXISTS';
  END IF;

  INSERT INTO public.icps (
    id, tenant_id, name, min_fit_score, weights, high_value_areas,
    min_google_rating, min_reviews, created_at, updated_at
  ) VALUES (
    '__ICP__'::uuid, '__TENANT__'::uuid,
    'ICP · Corretores com agenda para preencher · Guilds', 7,
    '{"insurance_broker_match":3,"agenda_growth_need":3,"whatsapp_valid":2,"partner_or_owner":1,"business_pain":1,"google_reputation":0}'::jsonb,
    ARRAY[]::text[], 0, 0, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    min_fit_score = EXCLUDED.min_fit_score,
    weights = EXCLUDED.weights,
    high_value_areas = EXCLUDED.high_value_areas,
    min_google_rating = EXCLUDED.min_google_rating,
    min_reviews = EXCLUDED.min_reviews,
    updated_at = v_now
  WHERE public.icps.tenant_id = '__TENANT__'::uuid;

  INSERT INTO public.scripts (
    id, tenant_id, name, category, target_profession, status,
    base_message, ai_instructions, ai_tools, restrictions, variables,
    guardians_config, qualification_config, flow, context_documents,
    created_at, updated_at
  ) VALUES (
    '__SCRIPT__'::uuid, '__TENANT__'::uuid,
    'Guilds · Prospix para corretores · qualificação v1',
    'APPROACH', 'ENTREPRENEUR', 'ACTIVE',
    'Oi {{NOME}}, tudo bem? Aqui é a assistente virtual da Guilds. O Prospix ajuda corretores a gerar e qualificar conversas para preencher a agenda comercial. Hoje sua agenda tem espaço para mais reuniões qualificadas?',
    $instructions$
Você é a assistente virtual comercial da Guilds para apresentar o Prospix a corretores e equipes de seguros.

Objetivo, nesta ordem:
1. Responder primeiro ao que o lead perguntou.
2. Confirmar se o lead atua com seguros e entender a capacidade da agenda, como a prospecção funciona hoje, o volume trabalhado, o principal gargalo, quem decide e a urgência.
3. Fazer no máximo uma pergunta por mensagem, usando somente o próximo campo pendente da qualificação estruturada.
4. Só sugerir uma conversa com o time da Guilds quando a qualificação estiver completa ou quando o lead pedir atendimento humano.

O Prospix ajuda a localizar leads, iniciar conversas no WhatsApp, qualificar interesse e organizar o encaminhamento comercial. Não prometa resultado, volume, economia, integração, agenda ou prazo sem confirmação. Não invente informações sobre o lead. Use apenas nome, empresa, cargo e fatos presentes no cadastro ou confirmados na conversa. Nunca mencione score, enriquecimento, banco de dados ou fonte de captura.

Seja transparente: você é uma assistente virtual da Guilds. Escreva como atendimento humano cuidadoso, com frases curtas, pausas naturais e sem parecer um questionário.
    $instructions$,
    '["ESCALATE"]'::jsonb,
    $restrictions$
Nunca fingir ser uma pessoa específica; nunca inventar fatos; nunca expor score interno; nunca garantir vendas, reuniões, redução de custo ou ausência de bloqueio no WhatsApp; nunca marcar horário sem agenda real; nunca pedir dado sensível; nunca insistir após recusa ou opt-out; nunca fazer mais de uma pergunta por mensagem.
    $restrictions$,
    ARRAY['NOME', 'EMPRESA', 'CARGO']::text[],
    '{"objections_enabled":true,"qualification_enabled":true,"short_responses_enabled":true}'::jsonb,
    $qualification$
{
  "version": 1,
  "framework": "GUILDS_PROSPIX_B2B_V1",
  "minimum_score": 70,
  "max_questions_per_message": 1,
  "collect_health_data": false,
  "criteria": [
    {"key":"agenda_capacity","required":true,"weight":20,"values":["OPEN_SLOTS","LOW_OCCUPANCY","WANTS_GROWTH","FULL_STABLE","UNKNOWN"],"accepted":["OPEN_SLOTS","LOW_OCCUPANCY","WANTS_GROWTH"],"question":"Hoje sua agenda comercial tem espaço para mais reuniões qualificadas ou o volume já está no limite?"},
    {"key":"insurance_profile","required":true,"weight":15,"values":["BROKER","BROKER_TEAM","SALES_LEADER","OTHER","UNKNOWN"],"accepted":["BROKER","BROKER_TEAM","SALES_LEADER"],"question":"Você atua diretamente como corretor de seguros ou lidera uma equipe comercial?"},
    {"key":"current_prospecting_method","required":true,"weight":15,"values":["MANUAL","MIXED","AUTOMATED","NONE","UNKNOWN"],"accepted":["MANUAL","MIXED","AUTOMATED","NONE"],"question":"Hoje a prospecção e a primeira qualificação ficam no manual ou vocês já usam alguma automação?"},
    {"key":"monthly_lead_volume","required":true,"weight":10,"values":["UP_TO_100","FROM_101_TO_500","FROM_501_TO_2000","ABOVE_2000","UNKNOWN"],"accepted":["UP_TO_100","FROM_101_TO_500","FROM_501_TO_2000","ABOVE_2000"],"question":"Em média, quantos novos contatos vocês tentam trabalhar por mês?"},
    {"key":"primary_pain","required":true,"weight":15,"values":["FIND_LEADS","START_CONVERSATIONS","QUALIFY","FOLLOW_UP","COST","NO_PROCESS","UNKNOWN"],"accepted":["FIND_LEADS","START_CONVERSATIONS","QUALIFY","FOLLOW_UP","COST","NO_PROCESS"],"question":"O que mais pesa hoje: encontrar leads, iniciar a conversa, qualificar ou manter o acompanhamento?"},
    {"key":"decision_role","required":true,"weight":15,"values":["DECISION_MAKER","SHARED","INFLUENCER","OTHER","UNKNOWN"],"accepted":["DECISION_MAKER","SHARED","INFLUENCER"],"question":"Você decide esse tipo de ferramenta ou costuma avaliar com mais alguém?"},
    {"key":"urgency","required":true,"weight":10,"values":["NOW","THIRTY_DAYS","QUARTER","LATER","UNKNOWN"],"accepted":["NOW","THIRTY_DAYS","QUARTER"],"question":"Se fizer sentido, vocês querem preencher melhor essa agenda agora, neste trimestre ou mais para frente?"}
  ]
}
    $qualification$::jsonb,
    $flow$
{
  "version": 1,
  "nodes": [
    {"id":"start","type":"trigger","data":{"title":"Abertura","message":"Apresente-se como assistente virtual da Guilds, contextualize o Prospix em uma frase e peça permissão para uma pergunta."}},
    {"id":"agenda","type":"qualification","data":{"title":"Capacidade da agenda","criterion":"agenda_capacity"}},
    {"id":"profile","type":"qualification","data":{"title":"Perfil de seguros","criterion":"insurance_profile"}},
    {"id":"process","type":"qualification","data":{"title":"Processo atual","criterion":"current_prospecting_method"}},
    {"id":"volume","type":"qualification","data":{"title":"Volume","criterion":"monthly_lead_volume"}},
    {"id":"pain","type":"qualification","data":{"title":"Gargalo","criterion":"primary_pain"}},
    {"id":"authority","type":"qualification","data":{"title":"Decisão","criterion":"decision_role"}},
    {"id":"urgency","type":"qualification","data":{"title":"Urgência","criterion":"urgency"}},
    {"id":"handoff","type":"handoff","data":{"title":"Próximo passo","message":"Ofereça encaminhamento ao time da Guilds somente após qualificação ou pedido explícito."}}
  ],
  "edges": [
    {"source":"start","target":"agenda"},
    {"source":"agenda","target":"profile"},
    {"source":"profile","target":"process"},
    {"source":"process","target":"volume"},
    {"source":"volume","target":"pain"},
    {"source":"pain","target":"authority"},
    {"source":"authority","target":"urgency"},
    {"source":"urgency","target":"handoff"}
  ]
}
    $flow$::jsonb,
    '[{"title":"Oferta aprovada","content":"Prospix é uma plataforma da Guilds para apoiar prospecção, conversas iniciais e qualificação comercial via WhatsApp para corretores e equipes de seguros. Não prometer resultados específicos."}]'::jsonb,
    v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    target_profession = EXCLUDED.target_profession,
    status = 'ACTIVE',
    base_message = EXCLUDED.base_message,
    ai_instructions = EXCLUDED.ai_instructions,
    ai_tools = EXCLUDED.ai_tools,
    restrictions = EXCLUDED.restrictions,
    variables = EXCLUDED.variables,
    guardians_config = EXCLUDED.guardians_config,
    qualification_config = EXCLUDED.qualification_config,
    flow = EXCLUDED.flow,
    context_documents = EXCLUDED.context_documents,
    archived_at = NULL,
    updated_at = v_now
  WHERE public.scripts.tenant_id = '__TENANT__'::uuid;

  INSERT INTO public.script_variations (
    id, tenant_id, script_id, variant_letter, message, weight,
    total_sent, total_responded, total_converted, active, created_at, updated_at
  ) VALUES
    ('9a12c522-9308-4908-ad53-ffbfbc778e23'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid, 'A',
     'Oi {{NOME}}, tudo bem? Aqui é a assistente virtual da Guilds. O Prospix ajuda corretores a gerar e qualificar conversas para preencher a agenda comercial. Hoje sua agenda tem espaço para mais reuniões qualificadas?',
     0.34, 0, 0, 0, true, v_now, v_now),
    ('bb0ad479-b9f7-497b-bb7f-3a0b7fa89d96'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid, 'B',
     'Oi {{NOME}}, tudo certo? Sou a assistente virtual da Guilds. O Prospix ajuda equipes de seguros a ocupar a agenda com conversas qualificadas. Hoje vocês ainda têm horários que gostariam de preencher?',
     0.33, 0, 0, 0, true, v_now, v_now),
    ('294c1dee-71f2-43bf-9e0d-a68ef0d2d838'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid, 'C',
     'Oi {{NOME}}! Aqui é a assistente virtual da Guilds. Uma pergunta rápida: para completar melhor a agenda, o maior gargalo hoje está em encontrar leads, iniciar conversas ou qualificar quem tem potencial?',
     0.33, 0, 0, 0, true, v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET
    message = EXCLUDED.message,
    weight = EXCLUDED.weight,
    active = true,
    updated_at = v_now;

  INSERT INTO public.objections (
    id, tenant_id, script_id, title, pattern, response, created_at, updated_at
  ) VALUES
    ('49b211d5-6360-4439-b560-76d33981dc7e'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Já uso CRM', 'já uso crm|temos crm|uso sistema',
     'Ótimo — o Prospix não precisa substituir o seu CRM. A questão é entender se a captação e a primeira qualificação já chegam organizadas nele. Como isso acontece hoje?', v_now, v_now),
    ('2c0bbb7c-b405-496c-8d36-1e95095d5c1d'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Risco de bloqueio', 'banimento|bloqueio|whatsapp bloquear',
     'Faz sentido ter esse cuidado. A operação precisa respeitar cadência, consentimento e os limites do canal; não existe promessa de risco zero. Hoje vocês já têm alguma regra para os envios?', v_now, v_now),
    ('51bab793-7da8-42d8-b0d8-56c08952ff88'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Preço', 'quanto custa|preço|valor|caro',
     'Posso explicar os planos, mas prefiro indicar o tamanho certo depois de entender o volume e a operação. Quantos contatos vocês trabalham por mês?', v_now, v_now),
    ('0b1b9d20-1089-4cb0-b3d8-678d132243e8'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'IA parece fria', 'robô|ia fria|mensagem automática|automatizado',
     'Entendo. A proposta é usar contexto, mensagens curtas e encaminhamento humano quando necessário, sem fingir que a IA é uma pessoa. Em qual parte do atendimento vocês não abririam mão do humano?', v_now, v_now),
    ('054ccab1-4d1f-4f92-97b1-85ee6e02192a'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Sem tempo', 'sem tempo|correria|ocupado',
     'Sem problema. Posso deixar só uma pergunta objetiva: hoje essa etapa comercial toma tempo de quem vende ou de alguém do atendimento?', v_now, v_now),
    ('c255fcbd-8592-43fd-a73b-b2ddd501c564'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Sem interesse', 'não quero|sem interesse|pare|não me chame',
     'Tudo certo. Obrigado por avisar — vou encerrar por aqui e não insistir.', v_now, v_now),
    ('e6c1ec69-09fd-44f6-a7c3-ff0405d905dd'::uuid, '__TENANT__'::uuid, '__SCRIPT__'::uuid,
     'Agenda já está cheia', 'agenda cheia|sem horário|não cabe mais cliente',
     'Ótimo sinal. Nesse caso, não faria sentido gerar demanda sem capacidade. A prioridade de vocês hoje é manter a agenda ou crescer a equipe?', v_now, v_now)
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    pattern = EXCLUDED.pattern,
    response = EXCLUDED.response,
    updated_at = v_now;

  INSERT INTO public.campaigns (
    id, tenant_id, name, profession, cities, neighborhoods, state,
    search_tags, capture_sources, daily_limit, hour_window_start, hour_window_end,
    discovery_daily_budget_cents, max_cost_per_eligible_lead_cents,
    max_provider_calls_per_run, discovery_auto_enabled, homologation_mode,
    homologation_lead_limit, active_script_id, icp_id, status, filters,
    total_captured, total_conversing, total_scheduled, total_closed_won,
    created_at, updated_at
  ) VALUES (
    '__CAMPAIGN__'::uuid, '__TENANT__'::uuid,
    'QA interno · Guilds vende Prospix', 'ENTREPRENEUR',
    ARRAY['São José do Rio Preto']::text[], ARRAY[]::text[], 'SP',
    ARRAY['corretora de seguros','corretor de seguros','consultoria de seguros','seguro empresarial']::text[],
    ARRAY['GOOGLE_MAPS']::text[], 1, 9, 18,
    0, 0, 1, false, true, 1,
    '__SCRIPT__'::uuid, '__ICP__'::uuid, 'ACTIVE',
    '{"segment":"insurance_broker_b2b","qa_internal":true,"deep_enrichment":false,"one_source_per_run":true}'::jsonb,
    0, 0, 0, 0, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    profession = EXCLUDED.profession,
    cities = EXCLUDED.cities,
    neighborhoods = EXCLUDED.neighborhoods,
    state = EXCLUDED.state,
    search_tags = EXCLUDED.search_tags,
    capture_sources = EXCLUDED.capture_sources,
    daily_limit = 1,
    hour_window_start = EXCLUDED.hour_window_start,
    hour_window_end = EXCLUDED.hour_window_end,
    discovery_daily_budget_cents = 0,
    max_cost_per_eligible_lead_cents = 0,
    max_provider_calls_per_run = 1,
    discovery_auto_enabled = false,
    homologation_mode = true,
    homologation_lead_limit = 1,
    active_script_id = '__SCRIPT__'::uuid,
    icp_id = '__ICP__'::uuid,
    status = 'ACTIVE',
    filters = EXCLUDED.filters,
    archived_at = NULL,
    updated_at = v_now
  WHERE public.campaigns.tenant_id = '__TENANT__'::uuid;

  UPDATE public.campaigns
  SET status = 'PAUSED', discovery_auto_enabled = false, updated_at = v_now
  WHERE id = '__PREVIOUS_CAMPAIGN__'::uuid
    AND tenant_id = '__TENANT__'::uuid
    AND id <> '__CAMPAIGN__'::uuid;

  INSERT INTO public.tenant_business_context (
    tenant_id, persona_name, persona_role, business_description,
    common_objections, standard_approaches, tone_of_voice, created_at, updated_at
  ) VALUES (
    '__TENANT__'::uuid,
    'Assistente virtual da Guilds',
    'Atendimento comercial inicial do Prospix',
    'A Guilds oferece o Prospix para ajudar corretores e equipes de seguros com capacidade disponível a gerar e qualificar conversas para preencher melhor a agenda comercial pelo WhatsApp. A conversa confirma perfil de seguros, espaço na agenda, processo atual, volume, gargalo, decisão e urgência antes de encaminhar ao time. Não há promessa de resultado específico.',
    'CRM existente; risco de bloqueio no WhatsApp; preço; receio de atendimento frio; falta de tempo; ausência de interesse; agenda já cheia. Validar a preocupação, responder com transparência e fazer no máximo uma pergunta pertinente.',
    'Responder primeiro à dúvida; uma pergunta por turno; usar somente fatos cadastrados ou confirmados; assumir claramente que é assistente virtual; encaminhar ao time da Guilds após qualificação ou pedido explícito.',
    'Educado, direto, consultivo e natural. Frases curtas, sem pressão, sem jargão e sem fingir ser uma pessoa humana específica.',
    v_now, v_now
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    persona_name = EXCLUDED.persona_name,
    persona_role = EXCLUDED.persona_role,
    business_description = EXCLUDED.business_description,
    common_objections = EXCLUDED.common_objections,
    standard_approaches = EXCLUDED.standard_approaches,
    tone_of_voice = EXCLUDED.tone_of_voice,
    updated_at = v_now;

  UPDATE public.tenants
  SET ai_voice_profile = COALESCE(ai_voice_profile, '{}'::jsonb) || jsonb_build_object(
        'active_profile', 'guilds_prospix_internal',
        'profiles', jsonb_build_object(
          'guilds_prospix_internal', jsonb_build_object(
            'status', 'QA_INTERNAL',
            'persona', 'Assistente virtual da Guilds',
            'offer', 'Prospix para corretores e equipes de seguros',
            'qualification_framework', 'GUILDS_PROSPIX_B2B_V1',
            'approved_at', v_now
          )
        )
      ),
      updated_at = v_now
  WHERE id = '__TENANT__'::uuid;

  SELECT id, COALESCE(metadata->>'qa_run', '')
  INTO v_existing_lead_id, v_existing_marker
  FROM public.leads
  WHERE tenant_id = '__TENANT__'::uuid AND whatsapp = '__PHONE__'
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL
    AND v_existing_marker NOT LIKE 'QA_%' THEN
    RAISE EXCEPTION 'GUILDS_QA_DESTINATION_ALREADY_BELONGS_TO_NON_QA_LEAD';
  END IF;

  INSERT INTO public.leads (
    tenant_id, campaign_id, source, source_external_id, source_raw_data,
    name, profession, whatsapp, whatsapp_valid, status, pipeline_stage,
    metadata, tags, fit_score, relevance_score, relevance_status,
    phone_validation_status, phone_validation_confidence, entity_type,
    identity_confidence, title_verified, gender_confidence,
    lead_guardian_flags, created_at, updated_at
  ) VALUES (
    '__TENANT__'::uuid, '__CAMPAIGN__'::uuid, 'MANUAL',
    'qa-guilds-prospix-internal-20261016', jsonb_build_object('qa', true, 'internal', true),
    'Gustavo', 'ENTREPRENEUR', '__PHONE__', true, 'ENRICHED', 'QA',
    jsonb_build_object(
      'qa_run', '__QA_RUN__',
      'authorized', true,
      'internal_test', true,
      'job_title', 'CEO',
      'company_name', 'Guilds',
      'simulation_role', 'gestor de corretora avaliando o Prospix',
      'enrichment_source', 'user_authorized_internal_qa'
    ),
    ARRAY['QA','GUILDS_INTERNAL','PROSPIX','CEO_TEST']::text[],
    10, 1, 'ELIGIBLE', 'VALID', 1, 'PERSON', 1, true, 1,
    jsonb_build_object('qa_authorized', true, 'internal_only', true), v_now, v_now
  )
  ON CONFLICT (tenant_id, whatsapp) DO UPDATE SET
    campaign_id = EXCLUDED.campaign_id,
    source_external_id = EXCLUDED.source_external_id,
    source_raw_data = EXCLUDED.source_raw_data,
    name = EXCLUDED.name,
    profession = EXCLUDED.profession,
    whatsapp_valid = true,
    status = 'ENRICHED',
    pipeline_stage = 'QA',
    metadata = COALESCE(public.leads.metadata, '{}'::jsonb) || EXCLUDED.metadata,
    tags = EXCLUDED.tags,
    fit_score = EXCLUDED.fit_score,
    relevance_score = EXCLUDED.relevance_score,
    relevance_status = EXCLUDED.relevance_status,
    phone_validation_status = EXCLUDED.phone_validation_status,
    phone_validation_confidence = EXCLUDED.phone_validation_confidence,
    entity_type = EXCLUDED.entity_type,
    identity_confidence = EXCLUDED.identity_confidence,
    title_verified = EXCLUDED.title_verified,
    gender_confidence = EXCLUDED.gender_confidence,
    lead_guardian_flags = EXCLUDED.lead_guardian_flags,
    deleted_at = NULL,
    updated_at = v_now
  RETURNING id INTO v_lead_id;

  UPDATE public.conversations
  SET status = 'CLOSED', ai_handling = false,
      closed_at = COALESCE(closed_at, v_now), last_message_at = COALESCE(last_message_at, v_now)
  WHERE tenant_id = '__TENANT__'::uuid
    AND lead_id = v_lead_id
    AND id <> '__CONVERSATION__'::uuid
    AND status IN ('ACTIVE', 'PAUSED');

  INSERT INTO public.conversations (
    id, tenant_id, lead_id, status, ai_handling, script_id,
    current_node_id, message_count, started_at, last_message_at
  ) VALUES (
    '__CONVERSATION__'::uuid, '__TENANT__'::uuid, v_lead_id,
    'ACTIVE', true, '__SCRIPT__'::uuid, 'start', 0, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    status = 'ACTIVE',
    ai_handling = true,
    script_id = '__SCRIPT__'::uuid,
    current_node_id = 'start',
    closed_at = NULL,
    escalated_reason = NULL,
    last_message_at = v_now;

  INSERT INTO public.campaign_qa_allowlist (
    campaign_id, lead_id, reason, expires_at
  ) VALUES (
    '__CAMPAIGN__'::uuid, v_lead_id,
    'Homologação interna da Guilds autorizada pelo CEO em 16/10/2026',
    v_now + interval '14 days'
  )
  ON CONFLICT (campaign_id, lead_id) DO UPDATE SET
    reason = EXCLUDED.reason,
    expires_at = EXCLUDED.expires_at;

  IF NOT EXISTS (
    SELECT 1 FROM public.pending_outbound WHERE idempotency_key = '__IDEMPOTENCY__'
  ) THEN
    INSERT INTO public.pending_outbound (
      id, tenant_id, conversation_id, content, scheduled_for,
      idempotency_key, attempts, message_type, priority,
      validation_status, validation_reason_code, final_guardian_checked_at,
      final_guardian_decision, whatsapp_provider, whatsapp_channel_id, created_at
    ) VALUES (
      '__PENDING__'::uuid, '__TENANT__'::uuid, '__CONVERSATION__'::uuid,
      $message$Oi, Gustavo! Aqui é a assistente virtual da Guilds, em um teste interno autorizado do Prospix. Vou simular a prospecção para um corretor de seguros. Hoje sua agenda comercial tem espaço para mais reuniões qualificadas ou o volume já está no limite?$message$,
      v_now, '__IDEMPOTENCY__', 0, 'OUTBOUND_START', 0,
      'APPROVED', 'QA_AUTHORIZED_INTERNAL_TEST', v_now, 'PASS',
      'EVOLUTION', '__CHANNEL__'::uuid, v_now
    );
  END IF;

  UPDATE public.pending_outbound
  SET scheduled_for = v_now,
      failed_reason = NULL,
      processing_owner = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      validation_status = 'APPROVED',
      validation_reason_code = 'QA_AUTHORIZED_INTERNAL_TEST',
      final_guardian_checked_at = v_now,
      final_guardian_decision = 'PASS',
      whatsapp_provider = 'EVOLUTION',
      whatsapp_channel_id = '__CHANNEL__'::uuid
  WHERE tenant_id = '__TENANT__'::uuid
    AND idempotency_key = '__IDEMPOTENCY__'
    AND sent_at IS NULL
    AND failed_at IS NULL;
END
$guilds_qa$;
'@

  $sql = $sqlTemplate.Replace('__TENANT__', $tenantId).
    Replace('__PREVIOUS_CAMPAIGN__', $previousCampaignId).
    Replace('__ICP__', $icpId).
    Replace('__SCRIPT__', $scriptId).
    Replace('__CAMPAIGN__', $campaignId).
    Replace('__CONVERSATION__', $conversationId).
    Replace('__CHANNEL__', $channelId).
    Replace('__PENDING__', $pendingId).
    Replace('__QA_RUN__', $qaRun).
    Replace('__IDEMPOTENCY__', $idempotencyKey).
    Replace('__PHONE__', $phone)

  $null = Invoke-ManagementSql $sql

  Write-Stage 'acionando somente o tenant e o contato interno allowlisted'
  $workerBody = @{
    tenant_id = $tenantId
    skip_admin_monitoring = $true
  } | ConvertTo-Json -Compress
  try {
    $workerResult = Invoke-RestMethod -Uri $functionUrl -Method 'POST' -Headers @{
      Authorization = "Bearer $serviceRoleKey"
      apikey = $serviceRoleKey
    } -ContentType 'application/json' -Body $workerBody -TimeoutSec 90
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "O worker de envio falhou (HTTP $status). O item permaneceu idempotente para reconciliacao."
  }

  Write-Stage 'relendo perfil, campanha, recibo do provedor e isolamento'
  $verifySql = @"
SELECT jsonb_build_object(
  'active_profile', (SELECT ai_voice_profile->>'active_profile' FROM public.tenants WHERE id = '$tenantId'::uuid),
  'business_persona', (SELECT persona_name FROM public.tenant_business_context WHERE tenant_id = '$tenantId'::uuid),
  'icp', (SELECT jsonb_build_object('id', id, 'name', name, 'min_fit_score', min_fit_score) FROM public.icps WHERE id = '$icpId'::uuid AND tenant_id = '$tenantId'::uuid),
  'script', (SELECT jsonb_build_object('id', id, 'name', name, 'status', status, 'framework', qualification_config->>'framework', 'criteria', jsonb_array_length(qualification_config->'criteria')) FROM public.scripts WHERE id = '$scriptId'::uuid AND tenant_id = '$tenantId'::uuid),
  'campaign', (SELECT jsonb_build_object('id', id, 'name', name, 'status', status, 'homologation_mode', homologation_mode, 'discovery_auto_enabled', discovery_auto_enabled, 'daily_limit', daily_limit, 'budget_cents', discovery_daily_budget_cents, 'lead_limit', homologation_lead_limit) FROM public.campaigns WHERE id = '$campaignId'::uuid AND tenant_id = '$tenantId'::uuid),
  'previous_campaign_paused', COALESCE((SELECT status::text = 'PAUSED' FROM public.campaigns WHERE id = '$previousCampaignId'::uuid AND tenant_id = '$tenantId'::uuid), true),
  'tenant_outbound_paused', (SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id = '$tenantId'::uuid),
  'qa_allowlisted', EXISTS (SELECT 1 FROM public.campaign_qa_allowlist a JOIN public.leads l ON l.id = a.lead_id WHERE a.campaign_id = '$campaignId'::uuid AND l.tenant_id = '$tenantId'::uuid AND l.whatsapp = '$phone' AND a.expires_at > statement_timestamp()),
  'active_conversations_for_lead', (SELECT count(*) FROM public.conversations c JOIN public.leads l ON l.id = c.lead_id WHERE c.tenant_id = '$tenantId'::uuid AND l.whatsapp = '$phone' AND c.status IN ('ACTIVE','PAUSED')),
  'conversation_script_ok', EXISTS (SELECT 1 FROM public.conversations c JOIN public.leads l ON l.id = c.lead_id WHERE c.id = '$conversationId'::uuid AND c.tenant_id = '$tenantId'::uuid AND l.whatsapp = '$phone' AND c.script_id = '$scriptId'::uuid AND c.status = 'ACTIVE' AND c.ai_handling = true),
  'channel', (SELECT jsonb_build_object('provider', provider, 'active', active, 'send_enabled', send_enabled, 'receive_enabled', receive_enabled, 'connection_status', connection_status, 'external_state', external_state) FROM public.whatsapp_channels WHERE id = '$channelId'::uuid),
  'guardian', (SELECT jsonb_build_object('status', status, 'external_state', external_state, 'locked', locked_at IS NOT NULL, 'quarantined', quarantined_until IS NOT NULL, 'circuit_open', circuit_open_until IS NOT NULL) FROM public.whatsapp_guardian_status WHERE tenant_id = '$tenantId'::uuid),
  'pending', (SELECT jsonb_build_object('id', id, 'sent', sent_at IS NOT NULL, 'failed', failed_at IS NOT NULL, 'attempts', attempts, 'provider', whatsapp_provider, 'channel_id', whatsapp_channel_id) FROM public.pending_outbound WHERE idempotency_key = '$idempotencyKey'),
  'outbound_messages', (SELECT count(*) FROM public.messages message JOIN public.pending_outbound pending ON pending.idempotency_key = '$idempotencyKey' WHERE message.conversation_id = '$conversationId'::uuid AND message.direction = 'OUTBOUND' AND message.content = pending.content AND message.created_at >= pending.created_at),
  'provider_receipts', (SELECT count(*) FROM public.messages message JOIN public.pending_outbound pending ON pending.idempotency_key = '$idempotencyKey' WHERE message.conversation_id = '$conversationId'::uuid AND message.direction = 'OUTBOUND' AND message.content = pending.content AND message.created_at >= pending.created_at AND message.provider_message_id IS NOT NULL),
  'other_open_pending', (SELECT count(*) FROM public.pending_outbound WHERE tenant_id = '$tenantId'::uuid AND sent_at IS NULL AND failed_at IS NULL AND idempotency_key <> '$idempotencyKey')
) AS verification;
"@
  $verification = (Invoke-ManagementSql $verifySql)[0].verification
  $workerSummary = @($workerResult.results | ForEach-Object {
      [ordered]@{ sent = $_.sent; queued = $_.queued; failed = $_.failed }
    })
  [ordered]@{
    worker = $workerSummary
    verification = $verification
  } | ConvertTo-Json -Depth 12

  if ($verification.active_profile -ne 'guilds_prospix_internal') {
    throw 'O perfil ativo da Guilds nao foi confirmado no banco.'
  }
  if ($verification.business_persona -ne 'Assistente virtual da Guilds') {
    throw 'O contexto comercial da Guilds nao foi confirmado no banco.'
  }
  if ($verification.script.framework -ne 'GUILDS_PROSPIX_B2B_V1' -or [int]$verification.script.criteria -ne 7) {
    throw 'O roteiro ou as regras de qualificacao nao foram confirmados.'
  }
  if (
    $verification.campaign.status -ne 'ACTIVE' -or
    -not $verification.campaign.homologation_mode -or
    $verification.campaign.discovery_auto_enabled -or
    [int]$verification.campaign.daily_limit -ne 1 -or
    [int]$verification.campaign.budget_cents -ne 0 -or
    [int]$verification.campaign.lead_limit -ne 1
  ) {
    throw 'A campanha interna nao permaneceu isolada no modo de homologacao.'
  }
  if (
    -not $verification.previous_campaign_paused -or
    -not $verification.tenant_outbound_paused -or
    -not $verification.qa_allowlisted -or
    [int]$verification.active_conversations_for_lead -ne 1 -or
    -not $verification.conversation_script_ok -or
    [int]$verification.other_open_pending -ne 0
  ) {
    throw 'A verificacao de isolamento do contato interno falhou.'
  }
  if (-not $verification.pending.sent) {
    throw 'O provedor ainda nao confirmou o envio; o item ficou idempotente para diagnostico.'
  }
  if ([int]$verification.outbound_messages -ne 1 -or [int]$verification.provider_receipts -ne 1) {
    throw 'O banco nao confirmou exatamente uma mensagem com recibo do provedor.'
  }

  Write-Stage 'perfil Guilds ativo e primeira mensagem interna enviada exatamente uma vez'
} finally {
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  if ($phoneBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($phoneBstr)
  }
  $script:patValue = $null
  $securePat = $null
  $secureExpectedPhone = $null
  $expectedPhoneDigits = $null
  $serviceRoleKey = $null
  $phone = $null
}
