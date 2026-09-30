$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$functionBase = "https://$projectRef.supabase.co/functions/v1"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$evolutionBase = 'https://evolution.guilds.com.br'
$evolutionHost = 'evolution.guilds.com.br'
$evolutionInstance = 'guilds'
$sshTarget = 'root@2.28.205.33'
$sshKey = 'C:\Users\User\.ssh\hetzner_guilds_2026'
$basicUser = 'prospix'
$supabaseExecutable = (Get-Command supabase -ErrorAction Stop).Source

function Write-Stage([string]$message) {
  Write-Host "[Prospix QA] $message"
}

function New-UrlSafeSecret([int]$byteCount = 32) {
  $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes($byteCount)
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-SshCommand([string]$remoteCommand, [string]$stdinValue = '') {
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
  $processInfo.RedirectStandardInput = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $processInfo
  $null = $process.Start()
  if ($stdinValue) {
    $process.StandardInput.WriteLine($stdinValue)
  }
  $process.StandardInput.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $null = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    throw "A operacao SSH falhou (codigo $($process.ExitCode))."
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
    throw "A chamada de gestao do Supabase falhou (HTTP $status)."
  }
}

function Invoke-ManagementSql([string]$query) {
  return Invoke-ManagementRequest -method 'POST' -path '/database/query' -body @{ query = $query }
}

function Invoke-SafeRest([hashtable]$parameters, [string]$label) {
  try {
    return Invoke-RestMethod @parameters
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "$label falhou (HTTP $status)."
  }
}

$patBstr = [IntPtr]::Zero
$previousSupabaseToken = $env:SUPABASE_ACCESS_TOKEN
$previousNoColor = $env:NO_COLOR

try {
  $securePat = Read-Host 'Supabase access token' -AsSecureString
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  Write-Stage 'validando projeto, tenant e isolamento do canal'
  $project = Invoke-ManagementRequest -method 'GET' -path ''
  if ($project.ref -ne $projectRef) {
    throw 'O token nao resolveu para o projeto Supabase esperado.'
  }

  $preflightSql = @"
SELECT jsonb_build_object(
  'tenant_exists', EXISTS (
    SELECT 1 FROM public.tenants WHERE id = '$tenantId'::uuid
  ),
  'campaign_paused', EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = 'e11fce13-79a9-41f9-afc0-e341a5ad7759'::uuid
      AND tenant_id = '$tenantId'::uuid
      AND status = 'PAUSED'
  ),
  'script_active', EXISTS (
    SELECT 1 FROM public.scripts
    WHERE id = '83ecb6fd-9727-461c-b12c-7a45a25810a7'::uuid
      AND tenant_id = '$tenantId'::uuid
      AND status = 'ACTIVE'
  ),
  'guilds_owned_elsewhere', EXISTS (
    SELECT 1 FROM public.whatsapp_channels
    WHERE provider = 'EVOLUTION'
      AND instance_name = '$evolutionInstance'
      AND tenant_id IS DISTINCT FROM '$tenantId'::uuid
      AND active = true
  ),
  'other_null_key_evolution_channels', (
    SELECT count(*) FROM public.whatsapp_channels
    WHERE provider = 'EVOLUTION'
      AND active = true
      AND api_key_encrypted IS NULL
      AND lower(regexp_replace(base_url, '/+$', '')) <> lower('$evolutionBase')
  )
) AS checks;
"@
  $preflight = (Invoke-ManagementSql $preflightSql)[0].checks
  if (-not $preflight.tenant_exists) { throw 'Tenant de teste nao encontrado.' }
  if (-not $preflight.campaign_paused) { throw 'A campanha geral nao esta pausada; disparo interrompido.' }
  if (-not $preflight.script_active) { throw 'O roteiro de teste nao esta ativo.' }
  if ($preflight.guilds_owned_elsewhere) { throw 'A instancia guilds ja esta vinculada a outro tenant.' }
  if ([int]$preflight.other_null_key_evolution_channels -gt 0) {
    throw 'Ha outro canal Evolution ativo dependente da chave global; configuracao interrompida.'
  }

  $remoteHost = Invoke-SshCommand 'hostname'
  if ($remoteHost -ne 'guilds-prod') { throw 'A chave SSH nao resolveu para guilds-prod.' }

  $remoteEvolutionKey = Invoke-SshCommand 'docker exec guilds-reports-api printenv EVOLUTION_API_KEY'
  $remoteEvolutionInstance = Invoke-SshCommand 'docker exec guilds-reports-api printenv EVOLUTION_INSTANCE'
  if (-not $remoteEvolutionKey) { throw 'A chave da Evolution nao foi encontrada no container autorizado.' }
  if ($remoteEvolutionInstance -ne $evolutionInstance) { throw 'O container nao aponta para a instancia guilds.' }

  Write-Stage 'criando credencial Basic dedicada e preservando backup do arquivo atual'
  $basicPassword = New-UrlSafeSecret
  $remoteBasicCommand = 'set -eu; f=/etc/easypanel/traefik/evolution.htpasswd; test -f "$f"; cp -a "$f" "$f.bak.$(date -u +%Y%m%dT%H%M%SZ)"; IFS= read -r p; printf "%s\n" "$p" | htpasswd -iB "$f" prospix >/dev/null; chmod 600 "$f"; printf "%s\n" "$p" | htpasswd -vi "$f" prospix >/dev/null; docker restart --time 20 evolution-api-1 >/dev/null; for i in $(seq 1 20); do s=$(docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}running{{end}}" evolution-api-1 2>/dev/null || true); if [ "$s" = healthy ] || [ "$s" = running ]; then exit 0; fi; sleep 2; done; exit 1'
  $null = Invoke-SshCommand -remoteCommand $remoteBasicCommand -stdinValue $basicPassword
  $basicB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$basicUser`:$basicPassword"))

  $evolutionHeaders = @{
    Authorization = "Basic $basicB64"
    apikey = $remoteEvolutionKey
  }
  $connectionState = ''
  for ($attempt = 1; $attempt -le 15; $attempt += 1) {
    $connectionResponse = Invoke-WebRequest -Uri "$evolutionBase/instance/connectionState/$evolutionInstance" -Method 'GET' -Headers $evolutionHeaders -SkipHttpErrorCheck
    if ([int]$connectionResponse.StatusCode -eq 200) {
      $connection = $connectionResponse.Content | ConvertFrom-Json
      $connectionState = if ($connection.instance.state) { $connection.instance.state } else { $connection.state }
      if ("$connectionState".ToLowerInvariant() -eq 'open') { break }
    }
    Start-Sleep -Seconds 3
  }
  if ("$connectionState".ToLowerInvariant() -ne 'open') {
    throw 'A instancia Evolution nao esta aberta; nenhum deploy ou disparo foi feito.'
  }

  Write-Stage 'gravando quatro segredos no cofre das Edge Functions'
  $webhookSecret = New-UrlSafeSecret
  $secretPayload = @(
    @{ name = 'EVOLUTION_GUILDS_API_KEY'; value = $remoteEvolutionKey },
    @{ name = 'EVOLUTION_BASIC_AUTH_B64'; value = $basicB64 },
    @{ name = 'EVOLUTION_BASIC_AUTH_HOST'; value = $evolutionHost },
    @{ name = 'EVOLUTION_WEBHOOK_SECRET'; value = $webhookSecret }
  )
  $null = Invoke-ManagementRequest -method 'POST' -path '/secrets' -body $secretPayload
  $secretInventory = Invoke-ManagementRequest -method 'GET' -path '/secrets'
  $secretNames = @($secretInventory | ForEach-Object { $_.name })
  foreach ($requiredName in @(
      'EVOLUTION_GUILDS_API_KEY',
      'EVOLUTION_BASIC_AUTH_B64',
      'EVOLUTION_BASIC_AUTH_HOST',
      'EVOLUTION_WEBHOOK_SECRET'
    )) {
    if ($requiredName -notin $secretNames) {
      throw "O segredo $requiredName nao apareceu no inventario remoto."
    }
  }

  Write-Stage 'publicando send-messages'
  $env:SUPABASE_ACCESS_TOKEN = $script:patValue
  $env:NO_COLOR = '1'
  & $supabaseExecutable functions deploy send-messages --project-ref $projectRef --use-api
  if ($LASTEXITCODE -ne 0) { throw 'O deploy de send-messages falhou.' }

  Write-Stage 'publicando webhook-evolution sem JWT de usuario e com segredo proprio'
  & $supabaseExecutable functions deploy webhook-evolution --project-ref $projectRef --use-api --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { throw 'O deploy de webhook-evolution falhou.' }

  $functions = Invoke-ManagementRequest -method 'GET' -path '/functions'
  $sendFunction = @($functions | Where-Object { $_.slug -eq 'send-messages' -or $_.name -eq 'send-messages' })
  $webhookFunction = @($functions | Where-Object { $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution' })
  if ($sendFunction.Count -ne 1 -or $webhookFunction.Count -ne 1) {
    throw 'As duas Edge Functions nao foram encontradas depois do deploy.'
  }

  Write-Stage 'testando rejeicao sem credencial e aceite com o segredo dedicado'
  $smokeBody = @{ event = 'QA_SMOKE_TEST' } | ConvertTo-Json -Compress
  $unauthorized = Invoke-WebRequest -Uri "$functionBase/webhook-evolution" -Method 'POST' -ContentType 'application/json' -Body $smokeBody -SkipHttpErrorCheck
  if ([int]$unauthorized.StatusCode -ne 401) {
    throw 'O webhook nao rejeitou a requisicao sem credencial.'
  }

  $webhookUrl = "$functionBase/webhook-evolution?webhook_secret=$([Uri]::EscapeDataString($webhookSecret))"
  $authorizedSmoke = Invoke-SafeRest -label 'O smoke test autenticado do webhook' -parameters @{
    Uri = $webhookUrl
    Method = 'POST'
    ContentType = 'application/json'
    Body = $smokeBody
  }
  if (-not $authorizedSmoke.ok -or -not $authorizedSmoke.skipped) {
    throw 'O webhook autenticado nao aceitou o evento inofensivo.'
  }

  Write-Stage 'configurando o webhook da instancia guilds'
  $webhookPayload = @{
    webhook = @{
      enabled = $true
      url = $webhookUrl
      webhookByEvents = $false
      webhookBase64 = $false
      events = @('MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED')
    }
  }
  $null = Invoke-SafeRest -label 'A configuracao do webhook na Evolution' -parameters @{
    Uri = "$evolutionBase/webhook/set/$evolutionInstance"
    Method = 'POST'
    Headers = $evolutionHeaders
    ContentType = 'application/json'
    Body = $webhookPayload | ConvertTo-Json -Depth 8 -Compress
  }

  $webhookInfo = Invoke-SafeRest -label 'A releitura do webhook na Evolution' -parameters @{
    Uri = "$evolutionBase/webhook/find/$evolutionInstance"
    Method = 'GET'
    Headers = $evolutionHeaders
  }
  $webhookInfoJson = $webhookInfo | ConvertTo-Json -Depth 12 -Compress
  if (-not $webhookInfoJson.Contains("$projectRef.supabase.co/functions/v1/webhook-evolution")) {
    throw 'A Evolution nao confirmou o endpoint do projeto Prospix.'
  }
  if (-not $webhookInfoJson.Contains('MESSAGES_UPSERT')) {
    throw 'A Evolution nao confirmou os eventos de mensagem.'
  }

  Write-Stage 'infraestrutura pronta para criar o registro QA e disparar'
} finally {
  $env:SUPABASE_ACCESS_TOKEN = $previousSupabaseToken
  $env:NO_COLOR = $previousNoColor
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $script:patValue = $null
  $securePat = $null
  $basicPassword = $null
  $basicB64 = $null
  $webhookSecret = $null
  $remoteEvolutionKey = $null
}
