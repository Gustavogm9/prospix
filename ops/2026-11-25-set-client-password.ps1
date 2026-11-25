$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$organizationId = 'ptzmchfxjlzenbtiodbb'
$authId = '2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$targetEmail = 'gustavo.macedo@guilds.com.br'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resultDir = Join-Path $repoRoot '.local/client-password-2026-11-25'
$resultPath = Join-Path $resultDir 'result.json'
$tokenPointer = [IntPtr]::Zero
$passwordPointer = [IntPtr]::Zero
$receipt = [ordered]@{ checked_at_utc = [DateTimeOffset]::UtcNow.ToString('o'); password_updated = $false; password_login_verified = $false; profile_verified = $false; stage = 'preflight' }
$agentName = 'Prospix-Authorized-Account-Operation/1.0'

function Read-AccountState {
  $query = @'
SELECT jsonb_build_object(
 'profile_count',(SELECT count(*) FROM public.users u WHERE lower(u.email)='gustavo.macedo@guilds.com.br'),
 'identity_count',(SELECT count(*) FROM auth.users a WHERE lower(a.email)='gustavo.macedo@guilds.com.br'),
 'matched_active_account',EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email)
   JOIN public.tenants t ON t.id=u.tenant_id WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid
   AND lower(u.email)='gustavo.macedo@guilds.com.br' AND u.role::text='OWNER' AND u.deleted_at IS NULL
   AND t.id='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid AND t.name='Corretora de Teste'
   AND t.status::text='ACTIVE' AND t.deleted_at IS NULL AND a.email_confirmed_at IS NOT NULL
   AND (a.banned_until IS NULL OR a.banned_until<=now()) AND a.raw_app_meta_data->>'role'='OWNER'
   AND a.raw_app_meta_data->>'tenant_id'=t.id::text)) AS state;
'@
  $body = @{ query = $query; read_only = $true } | ConvertTo-Json -Compress
  $rows = Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:managementHeaders -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
  return $rows[0].state
}

try {
  if ((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef) { throw 'PROJECT_LINK_MISMATCH' }
  $secureToken = Read-Host 'Supabase Prospix access token' -AsSecureString
  $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  $script:managementHeaders = @{ Authorization = "Bearer $token" }
  $script:projectApi = "https://api.supabase.com/v1/projects/$projectRef"
  $project = Invoke-RestMethod -Method Get -Uri $projectApi -Headers $managementHeaders -TimeoutSec 20
  if ($project.id -ne $projectRef -or $project.organization_id -ne $organizationId -or $project.name -notmatch '(?i)prospix') { throw 'PROJECT_IDENTITY_MISMATCH' }
  $receipt.before = Read-AccountState
  if ($receipt.before.profile_count -ne 1 -or $receipt.before.identity_count -ne 1 -or -not $receipt.before.matched_active_account) { throw 'ACCOUNT_SCOPE_CHANGED' }

  # Assign REST arrays directly: wrapping the cmdlet result in @() can nest the array.
  $apiKeys = Invoke-RestMethod -Method Get -Uri "$projectApi/api-keys?reveal=true" -Headers $managementHeaders -TimeoutSec 20
  $candidates = @($apiKeys | Where-Object { $_.api_key -is [string] -and ($_.api_key.StartsWith('sb_secret_') -or ($_.name -eq 'service_role' -and $_.api_key.StartsWith('eyJ'))) } | Sort-Object @{Expression={if($_.api_key.StartsWith('sb_secret_')){0}else{1}}} | Select-Object -First 3)
  $publicCandidates = @($apiKeys | Where-Object { $_.api_key -is [string] -and ($_.api_key.StartsWith('sb_publishable_') -or $_.name -eq 'anon') } | Sort-Object @{Expression={if($_.api_key.StartsWith('sb_publishable_')){0}else{1}}})
  if ($candidates.Count -eq 0 -or $publicCandidates.Count -eq 0) { throw 'EXISTING_API_KEYS_NOT_AVAILABLE' }
  $publicKey = ([string]$publicCandidates[0].api_key).Trim()
  if ($publicKey -match '\s') { throw 'PUBLIC_KEY_NOT_SCALAR' }
  $authApi = "https://$projectRef.supabase.co/auth/v1"
  $currentUser = $null
  foreach ($candidate in $candidates) {
    $serviceKey = ([string]$candidate.api_key).Trim()
    if ($serviceKey -match '\s') { throw 'ADMIN_KEY_NOT_SCALAR' }
    $adminHeaders = @{ apikey = $serviceKey }
    if (-not $serviceKey.StartsWith('sb_secret_')) { $adminHeaders.Authorization = "Bearer $serviceKey" }
    try {
      $candidateUser = Invoke-RestMethod -Method Get -Uri "$authApi/admin/users/$authId" -Headers $adminHeaders -UserAgent $agentName -TimeoutSec 20
      if ($candidateUser.id -eq $authId -and $candidateUser.email.ToLowerInvariant() -eq $targetEmail) { $currentUser = $candidateUser; break }
    } catch { }
  }
  if (-not $currentUser -or $currentUser.app_metadata.role -ne 'OWNER' -or $currentUser.app_metadata.tenant_id -ne $tenantId) { throw 'AUTH_ADMIN_PREFLIGHT_FAILED' }

  $securePassword = Read-Host 'Digite a nova senha solicitada para esta conta (entrada mascarada)' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $newPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
  if ([string]::IsNullOrEmpty($newPassword)) { throw 'EMPTY_PASSWORD' }
  $receipt.stage = 'password_update'
  $passwordBody = @{ password = $newPassword } | ConvertTo-Json -Compress
  $updatedUser = Invoke-RestMethod -Method Put -Uri "$authApi/admin/users/$authId" -Headers $adminHeaders -UserAgent $agentName -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($passwordBody)) -TimeoutSec 25
  if ($updatedUser.id -ne $authId -or $updatedUser.email.ToLowerInvariant() -ne $targetEmail) { throw 'PASSWORD_UPDATE_RESPONSE_MISMATCH' }
  $receipt.password_updated = $true

  $receipt.stage = 'password_login_verification'
  $loginBody = @{ email = $targetEmail; password = $newPassword } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod -Method Post -Uri "$authApi/token?grant_type=password" -Headers @{apikey=$publicKey} -UserAgent $agentName -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($loginBody)) -TimeoutSec 25
  if ($login.user.id -ne $authId -or -not $login.access_token -or $login.user.app_metadata.role -ne 'OWNER' -or $login.user.app_metadata.tenant_id -ne $tenantId) { throw 'PASSWORD_LOGIN_NOT_CONFIRMED' }
  $receipt.password_login_verified = $true

  $profileResponse = Invoke-RestMethod -Method Get -Uri "https://$projectRef.supabase.co/rest/v1/users?select=id,role,tenant_id,deleted_at&id=eq.$authId" -Headers @{apikey=$publicKey;Authorization="Bearer $($login.access_token)"} -UserAgent $agentName -TimeoutSec 20
  $profiles = @($profileResponse | ForEach-Object { $_ })
  if ($profiles.Count -ne 1 -or $profiles[0].id -ne $authId -or $profiles[0].role -ne 'OWNER' -or $profiles[0].tenant_id -ne $tenantId -or $profiles[0].deleted_at) { throw 'LOGIN_PROFILE_NOT_CONFIRMED' }
  $receipt.profile_verified = $true
  $receipt.after = Read-AccountState
  if (-not $receipt.after.matched_active_account -or $receipt.after.profile_count -ne 1 -or $receipt.after.identity_count -ne 1) { throw 'FINAL_ACCOUNT_STATE_MISMATCH' }
  $receipt.stage = 'completed'
  Write-Host 'Senha alterada e login com a nova senha confirmado.'
  Write-Host 'Acesso OWNER da Corretora de Teste preservado.'
} catch {
  $receipt.error = $true
  $receipt.http_status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  $safeCodes = @('PROJECT_LINK_MISMATCH','PROJECT_IDENTITY_MISMATCH','ACCOUNT_SCOPE_CHANGED','EXISTING_API_KEYS_NOT_AVAILABLE','PUBLIC_KEY_NOT_SCALAR','ADMIN_KEY_NOT_SCALAR','AUTH_ADMIN_PREFLIGHT_FAILED','EMPTY_PASSWORD','PASSWORD_UPDATE_RESPONSE_MISMATCH','PASSWORD_LOGIN_NOT_CONFIRMED','LOGIN_PROFILE_NOT_CONFIRMED','FINAL_ACCOUNT_STATE_MISMATCH')
  $receipt.error_code = if ($_.Exception.Message -in $safeCodes) { $_.Exception.Message } else { 'PROVIDER_REQUEST_FAILED' }
  Write-Host ('Etapa interrompida: ' + $receipt.stage + ' / ' + $receipt.error_code + ' / HTTP ' + $receipt.http_status)
  if ($receipt.password_updated) { Write-Host 'O provedor confirmou a troca. Nao repita a alteracao; confira somente a verificacao do login.' }
} finally {
  if ($login -and $login.access_token -and $publicKey) {
    try {
      $null = Invoke-RestMethod -Method Post -Uri "$authApi/logout?scope=local" -Headers @{apikey=$publicKey;Authorization="Bearer $($login.access_token)"} -UserAgent $agentName -TimeoutSec 15
      $receipt.verification_session_closed = $true
    } catch { $receipt.verification_session_closed = $false }
  }
  New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
  [IO.File]::WriteAllText($resultPath,($receipt | ConvertTo-Json -Depth 15),[Text.UTF8Encoding]::new($false))
  if ($tokenPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
  if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  if ($secureToken) { $secureToken.Dispose() }
  if ($securePassword) { $securePassword.Dispose() }
  Remove-Variable token,newPassword,passwordBody,loginBody,login,serviceKey,publicKey,apiKeys,candidates,publicCandidates,candidate,currentUser,candidateUser,updatedUser,managementHeaders,adminHeaders,secureToken,securePassword -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
