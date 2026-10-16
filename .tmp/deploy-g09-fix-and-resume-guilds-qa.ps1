param(
  [System.Security.SecureString]$AccessToken
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$functionBase = "https://$projectRef.supabase.co/functions/v1"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$conversationId = '4da0acfa-8299-488c-a9ef-f58788d0b65c'
$supabaseExecutable = (Get-Command supabase -ErrorAction Stop).Source

function Write-Stage([string]$message) {
  Write-Host "[Guilds QA] $message"
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
    $parameters.Body = $body | ConvertTo-Json -Depth 30 -Compress
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN_REDACTED]'
    $detail = $detail -replace 'eyJ[A-Za-z0-9_\-.]+', '[JWT_REDACTED]'
    if ($detail.Length -gt 900) { $detail = $detail.Substring(0, 900) }
    throw "A chamada de gestao do Supabase falhou (HTTP $status): $detail"
  }
}

function Invoke-ManagementSql([string]$query) {
  return Invoke-ManagementRequest -method 'POST' -path '/database/query' -body @{ query = $query }
}

function Read-ReplayTarget {
  $query = @"
SELECT jsonb_build_object(
  'ledger_id', ledger.id,
  'payload', ledger.payload,
  'inbound_message_id', candidate.inbound_message_id,
  'idempotency_prefix', 'ai-$conversationId-' || candidate.inbound_message_id::text || '-',
  'blocked_reasons', decision.evidence->'reasons',
  'decision_at', decision.created_at
) AS target
FROM public.guardian_decisions decision
JOIN public.ai_message_candidates candidate ON candidate.id = decision.candidate_id
JOIN public.evolution_webhook_processing_events ledger
  ON ledger.message_id::text = candidate.inbound_message_id
WHERE decision.tenant_id = '$tenantId'::uuid
  AND decision.conversation_id = '$conversationId'::uuid
  AND decision.guardian_key = 'G09_QUALIFICATION'
  AND decision.reason_code = 'G09_QUALIFICATION_BLOCKED'
  AND decision.decision IN ('BLOCK', 'HARD_BLOCK')
  AND ledger.status = 'PROCESSED'
  AND ledger.from_me = false
ORDER BY decision.created_at DESC
LIMIT 1;
"@
  $rows = Invoke-ManagementSql $query
  return $rows[0].target
}

function Read-QueueState([string]$prefix) {
  $escapedPrefix = $prefix.Replace("'", "''")
  $query = @"
SELECT jsonb_build_object(
  'matching', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'idempotency_key', idempotency_key,
    'message_type', message_type,
    'scheduled_for', scheduled_for,
    'sent_at', sent_at,
    'failed_at', failed_at,
    'failed_reason', failed_reason,
    'attempts', attempts,
    'provider_receipt_expected', whatsapp_provider IS NOT NULL
  ) ORDER BY created_at), '[]'::jsonb),
  'other_open_pending', (
    SELECT count(*)
    FROM public.pending_outbound other
    WHERE other.tenant_id = '$tenantId'::uuid
      AND other.sent_at IS NULL
      AND other.failed_at IS NULL
      AND other.idempotency_key NOT LIKE '$escapedPrefix%'
  )
)
AS state
FROM public.pending_outbound
WHERE tenant_id = '$tenantId'::uuid
  AND conversation_id = '$conversationId'::uuid
  AND idempotency_key LIKE '$escapedPrefix%';
"@
  $rows = Invoke-ManagementSql $query
  return $rows[0].state
}

function Read-FinalState([string]$prefix, [datetime]$startedAt) {
  $escapedPrefix = $prefix.Replace("'", "''")
  $startedAtIso = $startedAt.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $query = @"
SELECT jsonb_build_object(
  'queue_count', (SELECT count(*) FROM public.pending_outbound WHERE tenant_id = '$tenantId'::uuid AND idempotency_key LIKE '$escapedPrefix%'),
  'queue_sent', (SELECT count(*) FROM public.pending_outbound WHERE tenant_id = '$tenantId'::uuid AND idempotency_key LIKE '$escapedPrefix%' AND sent_at IS NOT NULL),
  'queue_failed', (SELECT count(*) FROM public.pending_outbound WHERE tenant_id = '$tenantId'::uuid AND idempotency_key LIKE '$escapedPrefix%' AND failed_at IS NOT NULL),
  'provider_receipts', (
    SELECT count(*)
    FROM public.messages
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND direction = 'OUTBOUND'
      AND created_at >= '$startedAtIso'::timestamptz
      AND provider_message_id IS NOT NULL
  ),
  'qualification', (
    SELECT jsonb_build_object(
      'status', status,
      'score', score,
      'current_question_key', current_question_key,
      'question_count', question_count,
      'missing_fields', missing_fields
    )
    FROM public.qualification_sessions
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
  ),
  'latest_g09', (
    SELECT jsonb_build_object('decision', decision, 'reason_code', reason_code, 'created_at', created_at)
    FROM public.guardian_decisions
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND guardian_key = 'G09_QUALIFICATION'
    ORDER BY created_at DESC
    LIMIT 1
  )
) AS verification;
"@
  $rows = Invoke-ManagementSql $query
  return $rows[0].verification
}

$patBstr = [IntPtr]::Zero
$previousSupabaseToken = $env:SUPABASE_ACCESS_TOKEN
$previousNoColor = $env:NO_COLOR
$serviceRoleKey = $null

try {
  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  Write-Stage 'confirmando o falso bloqueio e o evento exato a reprocessar'
  $target = Read-ReplayTarget
  if (-not $target -or -not $target.payload -or -not $target.idempotency_prefix) {
    throw 'Nao foi localizado um evento processado e bloqueado por G09 para esta conversa.'
  }
  if (@($target.blocked_reasons) -notcontains 'premature_agenda') {
    throw 'O bloqueio mais recente nao foi o falso positivo de agenda; a operacao foi interrompida.'
  }

  $before = Read-QueueState -prefix $target.idempotency_prefix
  $matchingBefore = @($before.matching)
  $alreadySent = @($matchingBefore | Where-Object { $null -ne $_.sent_at })
  if ($alreadySent.Count -gt 0) {
    Write-Stage 'a resposta deste evento ja foi enviada; nenhuma republicacao ou repeticao foi feita'
    exit 0
  }
  if ([int]$before.other_open_pending -ne 0) {
    throw 'Existe outro item aberto no tenant; o reprocessamento isolado foi interrompido.'
  }

  $apiKeys = Invoke-ManagementRequest -method 'GET' -path '/api-keys?reveal=true'
  $serviceRoleEntry = $apiKeys | Where-Object { $_.type -eq 'secret' } | Select-Object -First 1
  if (-not $serviceRoleEntry) {
    $serviceRoleEntry = $apiKeys | Where-Object { $_.name -eq 'service_role' } | Select-Object -First 1
  }
  $serviceRoleKey = if ($serviceRoleEntry.api_key) { $serviceRoleEntry.api_key } else { $serviceRoleEntry.apiKey }
  if (-not $serviceRoleKey) { throw 'A chave de servico nao foi localizada pelo Management API.' }

  $functionsBefore = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $webhookBefore = $functionsBefore | Where-Object { $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution' } | Select-Object -First 1

  Write-Stage 'publicando a correcao do guardiao G09 no webhook-evolution'
  $env:SUPABASE_ACCESS_TOKEN = $script:patValue
  $env:NO_COLOR = '1'
  & $supabaseExecutable functions deploy webhook-evolution --project-ref $projectRef --use-api --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { throw 'O deploy de webhook-evolution falhou.' }

  $functionsAfter = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $webhookAfter = $functionsAfter | Where-Object { $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution' } | Select-Object -First 1
  if (-not $webhookAfter -or $webhookAfter.status -ne 'ACTIVE') {
    throw 'A nova versao de webhook-evolution nao ficou ativa.'
  }
  if ($webhookBefore -and [int]$webhookAfter.version -le [int]$webhookBefore.version) {
    throw 'O Management API nao confirmou uma nova versao do webhook-evolution.'
  }

  $operationStartedAt = Get-Date
  $matchingBefore = @((Read-QueueState -prefix $target.idempotency_prefix).matching)
  if ($matchingBefore.Count -eq 0) {
    Write-Stage 'reprocessando somente a ultima resposta bloqueada, sem duplicar a mensagem recebida'
    $replayBody = $target.payload | ConvertTo-Json -Depth 50 -Compress
    $null = Invoke-RestMethod -Uri "$functionBase/webhook-evolution" -Method 'POST' -Headers @{
      Authorization = "Bearer $serviceRoleKey"
      apikey = $serviceRoleKey
      'X-Prospix-Reprocess-Existing' = 'true'
    } -ContentType 'application/json' -Body $replayBody -TimeoutSec 30
  }

  $queue = $null
  foreach ($attempt in 1..2) {
    Start-Sleep -Seconds 12
    $queue = Read-QueueState -prefix $target.idempotency_prefix
    if (@($queue.matching).Count -gt 0) { break }
  }
  if (@($queue.matching).Count -eq 0) {
    throw 'O webhook corrigido nao criou a resposta na fila apos duas verificacoes.'
  }
  if (@($queue.matching | Where-Object { $null -ne $_.failed_at }).Count -gt 0) {
    throw 'A resposta reprocessada entrou na fila como falha.'
  }

  Write-Stage 'acionando o worker somente para o tenant de homologacao'
  $workerBody = @{ tenant_id = $tenantId; skip_admin_monitoring = $true } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Uri "$functionBase/send-messages" -Method 'POST' -Headers @{
    Authorization = "Bearer $serviceRoleKey"
    apikey = $serviceRoleKey
  } -ContentType 'application/json' -Body $workerBody -TimeoutSec 120

  $verification = Read-FinalState -prefix $target.idempotency_prefix -startedAt $operationStartedAt
  [ordered]@{
    webhook_version_before = if ($webhookBefore) { $webhookBefore.version } else { $null }
    webhook_version_after = $webhookAfter.version
    blocked_reason_corrected = 'premature_agenda_false_positive'
    verification = $verification
  } | ConvertTo-Json -Depth 10

  if ([int]$verification.queue_count -lt 1 -or [int]$verification.queue_sent -ne [int]$verification.queue_count) {
    throw 'A fila nao confirmou o envio de todas as partes da resposta.'
  }
  if ([int]$verification.queue_failed -ne 0) {
    throw 'A fila registrou falha no envio da resposta.'
  }
  if ([int]$verification.provider_receipts -lt 1) {
    throw 'O banco nao confirmou recibo do provedor para a resposta.'
  }
  if ($verification.latest_g09.decision -ne 'PASS') {
    throw 'O guardiao G09 ainda nao confirmou PASS apos a correcao.'
  }

  Write-Stage 'correcao publicada e qualificacao retomada com resposta confirmada pelo provedor'
} finally {
  $env:SUPABASE_ACCESS_TOKEN = $previousSupabaseToken
  $env:NO_COLOR = $previousNoColor
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $script:patValue = $null
  $securePat = $null
  $serviceRoleKey = $null
}
