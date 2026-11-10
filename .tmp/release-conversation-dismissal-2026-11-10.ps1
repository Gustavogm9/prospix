$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'C:\Users\User\OneDrive\Proejtos e Docs Guilds\GitHub\prospix'
$ref = 'yvbyplzfqfrlfujathii'
$version = '20261110110000'
$api = "https://api.supabase.com/v1/projects/$ref"
$statusFile = Join-Path $repo '.tmp/release-conversation-dismissal.status.txt'
$cli = (Get-Command supabase -ErrorAction Stop).Source
Set-Location -LiteralPath $repo

function Stage([string]$message) {
  [DateTimeOffset]::UtcNow.ToString('o') + ' ' + $message |
    Set-Content -LiteralPath $statusFile -Encoding UTF8
  Write-Host "[Prospix release] $message"
}

function Api([string]$method, [string]$path, [object]$body = $null) {
  $args = @{
    Method = $method
    Uri = "$api$path"
    Headers = @{ Authorization = "Bearer $script:pat" }
  }
  if ($null -ne $body) {
    $args.ContentType = 'application/json'
    $args.Body = $body | ConvertTo-Json -Depth 12 -Compress
  }
  try {
    return Invoke-RestMethod @args
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN]'
    if ($detail.Length -gt 350) { $detail = $detail.Substring(0, 350) }
    throw "Management API HTTP $code em $path`: $detail"
  }
}

function Sql([string]$query, [bool]$readOnly = $true) {
  $path = if ($readOnly) { '/database/query/read-only' } else { '/database/query' }
  return Api 'POST' $path @{ query = $query }
}

function Schema {
  $query = @'
SELECT
  to_regclass('public.conversations') IS NOT NULL AS conversations_exists,
  to_regclass('public.pending_outbound') IS NOT NULL AS queue_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'removed_at' AND NOT attisdropped) AS removed_at_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.conversations'::regclass AND attname = 'removed_by' AND NOT attisdropped) AS removed_by_exists,
  to_regprocedure('public.dismiss_conversation(uuid)') IS NOT NULL AS rpc_exists;
'@
  $rows = @(Sql $query)
  if ($rows.Count -ne 1) { throw 'Consulta de schema retornou formato inesperado.' }
  return $rows[0]
}

function FunctionState {
  $items = Api 'GET' '/functions'
  return $items | Where-Object { $_.slug -eq 'send-messages' -or $_.name -eq 'send-messages' } | Select-Object -First 1
}

$bstr = [IntPtr]::Zero
$oldToken = $env:SUPABASE_ACCESS_TOKEN
$oldNoColor = $env:NO_COLOR
$oldTracking = $env:DO_NOT_TRACK
try {
  if ((Get-Content -Raw -LiteralPath 'supabase/.temp/project-ref').Trim() -ne $ref) {
    throw 'Projeto vinculado diferente do Prospix esperado.'
  }
  $migrationPath = "supabase/migrations/${version}_conversation_dismissal.sql"
  if (-not (Test-Path -LiteralPath $migrationPath)) { throw 'Migration local ausente.' }
  $migration = Get-Content -Raw -LiteralPath $migrationPath
  if ($migration -notmatch 'CREATE OR REPLACE FUNCTION public.dismiss_conversation' -or
      $migration -notmatch 'GRANT EXECUTE ON FUNCTION public.dismiss_conversation') {
    throw 'Migration local incompleta.'
  }

  $secure = Read-Host 'Supabase Prospix access token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $script:pat = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($script:pat)) { throw 'Token vazio.' }
  $env:SUPABASE_ACCESS_TOKEN = $script:pat
  $env:NO_COLOR = '1'
  $env:DO_NOT_TRACK = '1'

  Stage 'confirmando projeto'
  $project = Api 'GET' ''
  if ($project.id -ne $ref) { throw 'A API retornou outro projeto.' }
  Write-Host "Projeto confirmado: $($project.name) ($ref)"

  Stage 'conferindo backup'
  $backups = Api 'GET' '/database/backups'
  $latest = @($backups.backups | Where-Object { $_.status -eq 'COMPLETED' -and $_.inserted_at } |
    Sort-Object { [DateTimeOffset]::Parse($_.inserted_at) } -Descending | Select-Object -First 1)
  $backupAt = $null
  if ($backups.pitr_enabled -and $backups.physical_backup_data.latest_physical_backup_date_unix -gt 0) {
    $backupAt = [DateTimeOffset]::FromUnixTimeSeconds([int64]$backups.physical_backup_data.latest_physical_backup_date_unix)
    $backupKind = 'PITR'
  } elseif ($latest.Count -eq 1) {
    $backupAt = [DateTimeOffset]::Parse($latest[0].inserted_at)
    $backupKind = 'diario'
  }
  $now = [DateTimeOffset]::UtcNow
  if ($null -eq $backupAt -or ($now - $backupAt).TotalHours -gt 48 -or $backupAt -gt $now.AddMinutes(5)) {
    throw 'Sem backup concluido ou ponto PITR nas ultimas 48 horas. Nenhuma alteracao foi aplicada.'
  }
  Write-Host "Backup $backupKind`: $($backupAt.ToUniversalTime().ToString('o'))"

  Stage 'comparando historico remoto com os arquivos locais'
  $local = @(Get-ChildItem -LiteralPath 'supabase/migrations' -File -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d{8,14}_[A-Za-z0-9_\-]+\.sql$' } |
    ForEach-Object { $_.Name.Split('_')[0] } | Sort-Object -Unique)
  $remote = @(Api 'GET' '/database/migrations' |
    ForEach-Object { [string]$_.version } | Sort-Object -Unique)
  $remoteOnly = @($remote | Where-Object { $_ -notin $local })
  $pending = @($local | Where-Object { $_ -notin $remote })
  if ($remoteOnly.Count -gt 0) { throw "Versoes so no remoto: $($remoteOnly -join ', '). Nenhuma alteracao foi aplicada." }
  if ($pending.Count -ne 1 -or $pending[0] -ne $version) {
    throw "Pendencias inesperadas: $($pending -join ', '). Nenhuma alteracao foi aplicada."
  }
  $before = Schema
  if (-not $before.conversations_exists -or -not $before.queue_exists -or
      $before.removed_at_exists -or $before.removed_by_exists -or $before.rpc_exists) {
    throw 'Schema anterior diferente do esperado. Nenhuma alteracao foi aplicada.'
  }

  Stage 'conferindo CLI e dry-run'
  $null = & $cli migration list --linked 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'supabase migration list --linked falhou.' }
  $dry = & $cli db push --linked --dry-run --skip-vault 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'supabase db push --dry-run falhou.' }
  $versions = @([regex]::Matches(($dry | Out-String), '\b\d{8,14}_[A-Za-z0-9_\-]+\.sql\b') |
    ForEach-Object { $_.Value.Split('_')[0] } | Sort-Object -Unique)
  if ($versions.Count -ne 1 -or $versions[0] -ne $version) {
    throw "Dry-run nao selecionou apenas $version. Nenhuma alteracao foi aplicada."
  }

  Stage 'ensaiando o SQL com rollback'
  $body = $migration -replace '(?m)^\s*BEGIN;\s*\r?\n', ''
  $body = $body -replace '(?m)^\s*COMMIT;\s*$', ''
  $null = Sql "BEGIN;`n$body`nROLLBACK;" $false
  $afterRehearsal = Schema
  if ($afterRehearsal.removed_at_exists -or $afterRehearsal.rpc_exists) {
    throw 'Ensaio nao reverteu o schema. Publicacao interrompida.'
  }

  Stage 'aplicando migration versionada'
  & $cli db push --linked --skip-vault --yes
  if ($LASTEXITCODE -ne 0) { throw 'db push falhou. Conferir historico antes de nova tentativa.' }

  Stage 'verificando migration e permissoes'
  $after = Schema
  $verificationQuery = @'
SELECT
  has_function_privilege('authenticated', 'public.dismiss_conversation(uuid)', 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', 'public.dismiss_conversation(uuid)', 'EXECUTE') AS anon_can_execute,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.conversations'::regclass AND tgname = 'protect_conversation_removal_marker') AS trigger_exists;
'@
  $v = @(Sql $verificationQuery)
  $remoteAfter = @(Api 'GET' '/database/migrations' | ForEach-Object { [string]$_.version })
  if ($v.Count -ne 1 -or $version -notin $remoteAfter -or -not $after.removed_at_exists -or
      -not $after.removed_by_exists -or -not $after.rpc_exists -or
      -not $v[0].authenticated_can_execute -or $v[0].anon_can_execute -or -not $v[0].trigger_exists) {
    throw 'Verificacao pos-migration falhou. Nao publicar interface.'
  }

  Stage 'publicando send-messages'
  $functionBefore = FunctionState
  if (-not $functionBefore -or $functionBefore.status -ne 'ACTIVE') { throw 'send-messages nao esta ativa.' }
  & $cli functions deploy send-messages --project-ref $ref --use-api
  if ($LASTEXITCODE -ne 0) { throw 'Deploy de send-messages falhou.' }
  $functionAfter = FunctionState
  if (-not $functionAfter -or $functionAfter.status -ne 'ACTIVE' -or
      [int]$functionAfter.version -le [int]$functionBefore.version) {
    throw 'Nova versao de send-messages nao ficou ativa.'
  }
  Stage "SUPABASE_OK versao_send_messages=$($functionAfter.version) WEB_PENDENTE"
  Write-Host 'Nenhuma conversa existente foi removida.'
} catch {
  $safeError = "$($_.Exception.Message)" -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN]'
  Stage "INTERROMPIDO $safeError"
  Write-Error $safeError
} finally {
  $env:SUPABASE_ACCESS_TOKEN = $oldToken
  $env:NO_COLOR = $oldNoColor
  $env:DO_NOT_TRACK = $oldTracking
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  $script:pat = $null
  $secure = $null
}
