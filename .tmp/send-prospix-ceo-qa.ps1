$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$functionUrl = "https://$projectRef.supabase.co/functions/v1/send-messages"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$campaignId = 'e11fce13-79a9-41f9-afc0-e341a5ad7759'
$scriptId = $null
$channelId = '24d3a1e4-7f70-4ea3-a66e-8bc7a8952e30'
$conversationId = 'c30fc22e-acde-4f24-b0bf-6a36e23ea5b1'
$pendingId = [guid]::NewGuid().ToString()
$qaRun = 'QA_EVOLUTION_GUILDS_20260930_QUALIFICATION_V2'
$idempotencyKey = 'qa-evolution-guilds-20260930-qualification-v2'
$sshTarget = 'root@2.28.205.33'
$sshKey = 'C:\Users\User\.ssh\hetzner_guilds_2026'
$minimumSendMessagesVersion = 54

function Write-Stage([string]$message) {
  Write-Host "[Prospix QA] $message"
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
    $parameters.Body = $body | ConvertTo-Json -Depth 12 -Compress
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace '\+?55\D*\d{2}\D*9\D*\d{4}\D*\d{4}', '[PHONE_REDACTED]'
    $detail = $detail -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN_REDACTED]'
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
  $securePat = Read-Host 'Supabase access token' -AsSecureString
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  $secureExpectedPhone = Read-Host 'CEO test phone' -AsSecureString
  $phoneBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureExpectedPhone)
  $expectedPhone = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($phoneBstr)) -replace '\D', ''

  Write-Stage 'confirmando destino autorizado e chave de servico'
  $phone = (Invoke-SshCommand 'docker exec guilds-reports-api printenv CEO_WHATSAPP_NUMBER') -replace '\D', ''
  if ($phone -notmatch '^55\d{2}9\d{8}$') {
    throw 'O numero autorizado na VPS nao tem formato movel brasileiro valido.'
  }
  if ($phone -ne $expectedPhone) {
    throw 'O numero confirmado pelo usuario diverge do destino protegido na VPS.'
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
    throw 'A versao com o gate de homologacao de send-messages nao esta ativa; nenhum dado foi criado.'
  }

  $scriptRows = Invoke-ManagementSql @"
SELECT id::text AS id
FROM public.scripts
WHERE tenant_id = '$tenantId'::uuid
  AND name = 'Médicos · Proteção de renda · v1'
  AND status = 'ACTIVE'
  AND archived_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
"@
  $scriptId = @($scriptRows)[0].id
  if (-not $scriptId) { throw 'O roteiro estruturado de qualificacao nao foi localizado.' }

  Write-Stage 'criando canal, estado operacional e registros QA em uma transacao'
  $sqlTemplate = @'
DO $qa$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_existing_lead_id uuid;
  v_existing_marker text;
  v_lead_id uuid;
  v_previous_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = '__TENANT__'::uuid
  ) THEN
    RAISE EXCEPTION 'QA_TENANT_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = '__CAMPAIGN__'::uuid
      AND tenant_id = '__TENANT__'::uuid
      AND status = 'PAUSED'
  ) THEN
    RAISE EXCEPTION 'QA_CAMPAIGN_NOT_PAUSED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.scripts
    WHERE id = '__SCRIPT__'::uuid
      AND tenant_id = '__TENANT__'::uuid
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'QA_SCRIPT_NOT_ACTIVE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_secrets
    WHERE evolution_instance_name = 'guilds'
      AND tenant_id IS DISTINCT FROM '__TENANT__'::uuid
  ) THEN
    RAISE EXCEPTION 'QA_INSTANCE_LEGACY_OWNER_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_channels
    WHERE provider = 'EVOLUTION'
      AND instance_name = 'guilds'
      AND tenant_id IS DISTINCT FROM '__TENANT__'::uuid
      AND active = true
  ) THEN
    RAISE EXCEPTION 'QA_INSTANCE_CHANNEL_OWNER_CONFLICT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_ai_outbound_controls
    WHERE tenant_id = '__TENANT__'::uuid AND paused = true
  ) THEN
    RAISE EXCEPTION 'QA_TENANT_AI_OUTBOUND_MUST_REMAIN_PAUSED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.optouts
    WHERE tenant_id = '__TENANT__'::uuid AND whatsapp = '__PHONE__'
  ) THEN
    RAISE EXCEPTION 'QA_DESTINATION_OPTED_OUT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pending_outbound
    WHERE tenant_id = '__TENANT__'::uuid
      AND sent_at IS NULL
      AND failed_at IS NULL
      AND idempotency_key <> '__IDEMPOTENCY__'
  ) THEN
    RAISE EXCEPTION 'QA_OTHER_PENDING_OUTBOUND_EXISTS';
  END IF;

  INSERT INTO public.whatsapp_channels (
    id, owner_type, tenant_id, provider, label, base_url, instance_name,
    api_key_encrypted, webhook_secret, send_enabled, receive_enabled, active,
    connection_status, external_state, connected_at, last_checked_at,
    last_error, metadata, created_at, updated_at
  ) VALUES (
    '__CHANNEL__'::uuid, 'TENANT', '__TENANT__'::uuid, 'EVOLUTION',
    'Evolution guilds - QA autorizado', 'https://evolution.guilds.com.br', 'guilds',
    NULL, NULL, true, true, true, 'CONNECTED', 'open', v_now, v_now,
    NULL, jsonb_build_object('qa_run', '__QA_RUN__', 'authorized', true), v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    owner_type = EXCLUDED.owner_type,
    tenant_id = EXCLUDED.tenant_id,
    provider = EXCLUDED.provider,
    label = EXCLUDED.label,
    base_url = EXCLUDED.base_url,
    instance_name = EXCLUDED.instance_name,
    api_key_encrypted = COALESCE(whatsapp_channels.api_key_encrypted, EXCLUDED.api_key_encrypted),
    webhook_secret = COALESCE(whatsapp_channels.webhook_secret, EXCLUDED.webhook_secret),
    send_enabled = true,
    receive_enabled = true,
    active = true,
    connection_status = 'CONNECTED',
    external_state = 'open',
    connected_at = v_now,
    last_checked_at = v_now,
    last_error = NULL,
    metadata = EXCLUDED.metadata,
    updated_at = v_now;

  SELECT status INTO v_previous_status
  FROM public.whatsapp_guardian_status
  WHERE tenant_id = '__TENANT__'::uuid
  FOR UPDATE;

  INSERT INTO public.whatsapp_guardian_status (
    tenant_id, status, external_state, external_checked_at, connected_at,
    quarantined_until, circuit_open_until, state_entered_at, state_reason_code,
    state_source, locked_at, created_at, updated_at
  ) VALUES (
    '__TENANT__'::uuid, 'NORMAL', 'open', v_now, v_now,
    NULL, NULL, v_now, NULL, 'qa-evolution-activation', NULL, v_now, v_now
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
    state_source = 'qa-evolution-activation',
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
    '__TENANT__'::uuid, v_previous_status, 'NORMAL', 'open',
    'QA_EVOLUTION_GUILDS_ACTIVATION', 'codex-authorized-test',
    'INFO', 'ACTIVE', 'Canal Evolution validado para teste isolado autorizado.',
    true, true, v_now, jsonb_build_object('qa_run', '__QA_RUN__')
  );

  IF EXISTS (
    SELECT 1 FROM public.pending_outbound WHERE idempotency_key = '__IDEMPOTENCY__'
  ) THEN
    RETURN;
  END IF;

  SELECT id, COALESCE(metadata->>'qa_run', '')
  INTO v_existing_lead_id, v_existing_marker
  FROM public.leads
  WHERE tenant_id = '__TENANT__'::uuid AND whatsapp = '__PHONE__'
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL
    AND v_existing_marker NOT LIKE 'QA_EVOLUTION_GUILDS_%' THEN
    RAISE EXCEPTION 'QA_DESTINATION_ALREADY_BELONGS_TO_NON_QA_LEAD';
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
    'qa-evolution-guilds-20260930', jsonb_build_object('qa', true),
    'Gustavo', NULL, '__PHONE__', true, 'ENRICHED', 'QA',
    jsonb_build_object(
      'qa_run', '__QA_RUN__', 'authorized', true,
      'job_title', 'CEO', 'company_name', 'Guilds',
      'enrichment_source', 'user_authorized_qa'
    ),
    ARRAY['QA', 'EVOLUTION', 'CEO_TEST']::text[],
    10, 1, 'ELIGIBLE', 'VALID', 1, 'PERSON', 1, true, 1,
    jsonb_build_object('qa_authorized', true), v_now, v_now
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
    metadata = COALESCE(leads.metadata, '{}'::jsonb) || EXCLUDED.metadata,
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

  INSERT INTO public.campaign_qa_allowlist (
    campaign_id, lead_id, reason, expires_at
  ) VALUES (
    '__CAMPAIGN__'::uuid, v_lead_id,
    'Homologacao de qualificacao autorizada pelo CEO em 30/09/2026',
    v_now + interval '14 days'
  )
  ON CONFLICT (campaign_id, lead_id) DO UPDATE
  SET reason = EXCLUDED.reason,
      expires_at = EXCLUDED.expires_at;

  INSERT INTO public.conversations (
    id, tenant_id, lead_id, status, ai_handling, script_id,
    message_count, started_at, last_message_at
  ) VALUES (
    '__CONVERSATION__'::uuid, '__TENANT__'::uuid, v_lead_id,
    'ACTIVE', true, '__SCRIPT__'::uuid, 0, v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    status = 'ACTIVE',
    ai_handling = true,
    script_id = EXCLUDED.script_id;

  UPDATE public.campaigns
  SET status = 'ACTIVE',
      homologation_mode = true,
      discovery_auto_enabled = false,
      updated_at = v_now
  WHERE id = '__CAMPAIGN__'::uuid
    AND tenant_id = '__TENANT__'::uuid;

  INSERT INTO public.pending_outbound (
    id, tenant_id, conversation_id, content, scheduled_for,
    idempotency_key, attempts, message_type, priority,
    validation_status, validation_reason_code, final_guardian_checked_at,
    final_guardian_decision, whatsapp_provider, whatsapp_channel_id, created_at
  ) VALUES (
    '__PENDING__'::uuid, '__TENANT__'::uuid, '__CONVERSATION__'::uuid,
    $message$Olá, Gustavo! Aqui é a IA da Prospix em um teste autorizado da nova infraestrutura. Vou simular uma qualificação da MetLife. Você pode responder como um potencial cliente? Primeira pergunta: hoje sua renda depende diretamente da sua atuação profissional?$message$,
    v_now, '__IDEMPOTENCY__', 0, 'OUTBOUND_START', 0,
    'APPROVED', 'QA_AUTHORIZED_TEST', v_now, 'PASS',
    'EVOLUTION', '__CHANNEL__'::uuid, v_now
  );
END
$qa$;
'@
  $sql = $sqlTemplate.Replace('__TENANT__', $tenantId).
    Replace('__CAMPAIGN__', $campaignId).
    Replace('__SCRIPT__', $scriptId).
    Replace('__CHANNEL__', $channelId).
    Replace('__CONVERSATION__', $conversationId).
    Replace('__PENDING__', $pendingId).
    Replace('__QA_RUN__', $qaRun).
    Replace('__IDEMPOTENCY__', $idempotencyKey).
    Replace('__PHONE__', $phone)
  $null = Invoke-ManagementSql $sql

  Write-Stage 'acionando somente o tenant de teste, sem dispatcher administrativo'
  $workerBody = @{
    tenant_id = $tenantId
    skip_admin_monitoring = $true
  } | ConvertTo-Json -Compress
  try {
    $workerResult = Invoke-RestMethod -Uri $functionUrl -Method 'POST' -Headers @{
      Authorization = "Bearer $serviceRoleKey"
      apikey = $serviceRoleKey
    } -ContentType 'application/json' -Body $workerBody -TimeoutSec 75
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "O worker de envio falhou (HTTP $status). O registro QA permaneceu idempotente na fila."
  }

  Write-Stage 'relendo banco para confirmar recibo do provedor e isolamento'
  $verifySql = @"
SELECT jsonb_build_object(
  'campaign_status', (SELECT status::text FROM public.campaigns WHERE id = '$campaignId'::uuid),
  'tenant_outbound_paused', (SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id = '$tenantId'::uuid),
  'qa_allowlisted', EXISTS (SELECT 1 FROM public.campaign_qa_allowlist WHERE campaign_id = '$campaignId'::uuid AND expires_at > statement_timestamp()),
  'channel', (SELECT jsonb_build_object('id', id, 'provider', provider, 'active', active, 'send_enabled', send_enabled, 'receive_enabled', receive_enabled, 'connection_status', connection_status, 'external_state', external_state) FROM public.whatsapp_channels WHERE id = '$channelId'::uuid),
  'guardian', (SELECT jsonb_build_object('status', status, 'external_state', external_state, 'locked', locked_at IS NOT NULL, 'quarantined', quarantined_until IS NOT NULL, 'circuit_open', circuit_open_until IS NOT NULL) FROM public.whatsapp_guardian_status WHERE tenant_id = '$tenantId'::uuid),
  'pending', (SELECT jsonb_build_object('id', id, 'sent', sent_at IS NOT NULL, 'failed', failed_at IS NOT NULL, 'failed_reason', failed_reason, 'attempts', attempts, 'provider', whatsapp_provider, 'channel_id', whatsapp_channel_id, 'scheduled_for', scheduled_for) FROM public.pending_outbound WHERE idempotency_key = '$idempotencyKey'),
  'outbound_messages', (SELECT count(*) FROM public.messages WHERE conversation_id = '$conversationId'::uuid AND direction = 'OUTBOUND'),
  'provider_receipts', (SELECT count(*) FROM public.messages WHERE conversation_id = '$conversationId'::uuid AND direction = 'OUTBOUND' AND provider_message_id IS NOT NULL),
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

  if (-not $verification.pending.sent) {
    throw 'O provedor ainda nao confirmou o envio; a fila foi preservada para diagnostico sem duplicacao.'
  }
  if ([int]$verification.outbound_messages -ne 1 -or [int]$verification.provider_receipts -ne 1) {
    throw 'A confirmacao do banco nao encontrou exatamente uma mensagem com recibo do provedor.'
  }
  if (
    $verification.campaign_status -ne 'ACTIVE' -or
    -not $verification.tenant_outbound_paused -or
    -not $verification.qa_allowlisted -or
    [int]$verification.other_open_pending -ne 0
  ) {
    throw 'A verificacao de isolamento da campanha ou da fila falhou.'
  }

  Write-Stage 'mensagem inicial aceita pelo provedor e registrada uma unica vez'
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
  $expectedPhone = $null
  $serviceRoleKey = $null
  $phone = $null
}
