param(
  [System.Security.SecureString]$AccessToken
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
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
    $parameters.Body = $body | ConvertTo-Json -Depth 20 -Compress
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

function Read-QualificationState {
  $query = @"
SELECT jsonb_build_object(
  'status', session.status,
  'score', session.score,
  'question_count', session.question_count,
  'current_question_key', session.current_question_key,
  'monthly_lead_volume', session.facts->>'monthly_lead_volume',
  'monthly_lead_volume_pending', 'monthly_lead_volume' = ANY(session.missing_fields),
  'latest_inbound_at', (
    SELECT max(created_at)
    FROM public.messages
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND direction = 'INBOUND'
  ),
  'latest_outbound_at', (
    SELECT max(created_at)
    FROM public.messages
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND direction = 'OUTBOUND'
  ),
  'open_queue_items', (
    SELECT count(*)
    FROM public.pending_outbound
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND sent_at IS NULL
      AND failed_at IS NULL
  )
) AS state
FROM public.qualification_sessions session
WHERE session.tenant_id = '$tenantId'::uuid
  AND session.conversation_id = '$conversationId'::uuid;
"@
  $rows = Invoke-ManagementSql $query
  return $rows[0].state
}

$patBstr = [IntPtr]::Zero
$previousSupabaseToken = $env:SUPABASE_ACCESS_TOKEN
$previousNoColor = $env:NO_COLOR

try {
  $source = Get-Content -Raw 'supabase/functions/_shared/qualification.ts'
  if ($source -notmatch 'monthlyLeadVolumeRange' -or $source -notmatch 'monthly_lead_volume') {
    throw 'A correcao de normalizacao de volume nao foi localizada no codigo local.'
  }

  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  Write-Stage 'lendo o estado atual da qualificacao sem alterar dados'
  $stateBefore = Read-QualificationState
  if (-not $stateBefore) {
    throw 'A sessao de qualificacao da homologacao nao foi localizada.'
  }

  $functionsBefore = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $webhookBefore = $functionsBefore | Where-Object {
    $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution'
  } | Select-Object -First 1

  Write-Stage 'publicando somente a normalizacao de volume no webhook-evolution'
  $env:SUPABASE_ACCESS_TOKEN = $script:patValue
  $env:NO_COLOR = '1'
  & $supabaseExecutable functions deploy webhook-evolution --project-ref $projectRef --use-api --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { throw 'O deploy de webhook-evolution falhou.' }

  $functionsAfter = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $webhookAfter = $functionsAfter | Where-Object {
    $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution'
  } | Select-Object -First 1
  if (-not $webhookAfter -or $webhookAfter.status -ne 'ACTIVE') {
    throw 'A nova versao de webhook-evolution nao ficou ativa.'
  }
  if ($webhookBefore -and [int]$webhookAfter.version -le [int]$webhookBefore.version) {
    throw 'O Management API nao confirmou uma nova versao do webhook-evolution.'
  }

  $stateAfter = Read-QualificationState
  [ordered]@{
    webhook_version_before = if ($webhookBefore) { $webhookBefore.version } else { $null }
    webhook_version_after = $webhookAfter.version
    qualification_before = $stateBefore
    qualification_after = $stateAfter
  } | ConvertTo-Json -Depth 8

  if ($stateAfter.monthly_lead_volume_pending) {
    Write-Stage 'correcao publicada; envie no WhatsApp: Confirmando, sao 120 contatos por mes.'
  } else {
    Write-Stage 'correcao publicada; o volume mensal ja foi registrado e a qualificacao pode continuar normalmente'
  }
} finally {
  $env:SUPABASE_ACCESS_TOKEN = $previousSupabaseToken
  $env:NO_COLOR = $previousNoColor
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $script:patValue = $null
  $securePat = $null
}
