param(
  [Parameter(Mandatory = $true)][string]$TenantId,
  [Parameter(Mandatory = $true)][string]$ExpectedTenantName,
  [string]$AppUrl = 'https://prospix.com.br'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$adminId = '48ad9c13-a509-495e-8249-14005d46ddc8'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$tokenBstr = [IntPtr]::Zero
$stage = 'validacao local'
$resultPath = Join-Path $env:TEMP 'prospix-owner-invite-status.json'

function Save-SafeStatus([string]$state, [string]$atStage) {
  $json = @{ state = $state; stage = $atStage; tenant_id = $TenantId } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($resultPath, $json, [Text.UTF8Encoding]::new($false))
}

function SqlLiteral([string]$value) {
  return "'" + $value.Replace("'", "''") + "'"
}

function New-InviteCode {
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 8
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $characters = foreach ($byte in $bytes) { $alphabet[[int]($byte % $alphabet.Length)] }
  $flat = -join $characters
  return "PRSPX-$($flat.Substring(0, 4))-$($flat.Substring(4, 4))"
}

function Invoke-ManagementQuery([string]$sql, [bool]$readOnly) {
  $body = @{ query = $sql; read_only = $readOnly } | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Uri "$projectApi/database/query" -Method Post -Headers @{
      Authorization = "Bearer $script:token"
    } -ContentType 'application/json' -Body $body
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    throw "Management API falhou (HTTP $status) na etapa $stage."
  }
}

try {
  Save-SafeStatus 'started' $stage
  $parsedTenantId = [guid]::Empty
  if (-not [guid]::TryParse($TenantId, [ref]$parsedTenantId)) {
    throw 'TenantId invalido.'
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedTenantName)) {
    throw 'ExpectedTenantName vazio.'
  }
  if ($AppUrl.TrimEnd('/') -notin @('https://prospix.com.br', 'https://app.prospix.com.br')) {
    throw 'AppUrl fora dos dominios permitidos.'
  }
  $ownerEmail = (Read-Host 'E-mail alternativo para o novo OWNER').Trim().ToLowerInvariant()
  $emailParts = $ownerEmail.Split('@')
  $domainLabels = if ($emailParts.Count -eq 2) { $emailParts[1].Split('.') } else { @() }
  if ($ownerEmail.Length -gt 254 -or $emailParts.Count -ne 2 -or
      $emailParts[0].Length -gt 64 -or $emailParts[0] -notmatch '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+$' -or
      $domainLabels.Count -lt 2 -or
      @($domainLabels | Where-Object { $_ -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' }).Count -gt 0 -or
      $domainLabels[-1] -notmatch '^[a-z]{2,63}$') {
    throw 'E-mail alternativo invalido.'
  }
  $secureToken = Read-Host 'Supabase Prospix access token' -AsSecureString
  $tokenBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $script:token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenBstr)

  $stage = 'preflight de tenant e identidades'
  $emailSql = SqlLiteral $ownerEmail
  $tenantSql = SqlLiteral $TenantId
  $adminSql = SqlLiteral $adminId
  $preflightSql = @'
SELECT jsonb_build_object(
  'tenant_name', (SELECT name FROM public.tenants WHERE id = __TENANT__::uuid),
  'tenant_status', (SELECT status::text FROM public.tenants WHERE id = __TENANT__::uuid),
  'admin_role', (SELECT role::text FROM public.users WHERE id = __ADMIN__::uuid AND deleted_at IS NULL),
  'admin_tenant', (SELECT tenant_id::text FROM public.users WHERE id = __ADMIN__::uuid AND deleted_at IS NULL),
  'admin_name', (SELECT name FROM public.users WHERE id = __ADMIN__::uuid AND deleted_at IS NULL),
  'admin_whatsapp', (SELECT whatsapp FROM public.users WHERE id = __ADMIN__::uuid AND deleted_at IS NULL),
  'owner_count', (SELECT count(*) FROM public.users WHERE tenant_id = __TENANT__::uuid AND role = 'OWNER' AND deleted_at IS NULL),
  'active_invite_count', (SELECT count(*) FROM public.tenant_invitations WHERE tenant_id = __TENANT__::uuid AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()),
  'public_email_count', (SELECT count(*) FROM public.users WHERE lower(email) = __EMAIL__ AND deleted_at IS NULL),
  'auth_email_count', (SELECT count(*) FROM auth.users WHERE lower(email) = __EMAIL__)
) AS result;
'@
  $preflightSql = $preflightSql.Replace('__TENANT__', $tenantSql).Replace('__ADMIN__', $adminSql).Replace('__EMAIL__', $emailSql)
  $preflightRows = @(Invoke-ManagementQuery $preflightSql $true)
  if ($preflightRows.Count -ne 1 -or -not $preflightRows[0].result) {
    throw 'Resposta inesperada no preflight; nada foi gravado.'
  }
  $preflight = $preflightRows[0].result
  if ($preflight -is [string]) { $preflight = $preflight | ConvertFrom-Json }
  if ($preflight.tenant_name -cne $ExpectedTenantName) {
    throw "Tenant diverge do esperado; nada foi gravado. Encontrado: $($preflight.tenant_name)"
  }
  if ($preflight.tenant_status -notin @('ACTIVE', 'ONBOARDING')) {
    throw 'Tenant indisponivel para convite; nada foi gravado.'
  }
  if ($preflight.admin_role -ne 'GUILDS_ADMIN' -or $preflight.admin_tenant) {
    throw 'O acesso Super-Admin mudou; nada foi gravado.'
  }
  if ([int]$preflight.owner_count -ne 0 -or [int]$preflight.active_invite_count -ne 0) {
    throw 'Ja existe OWNER ou convite ativo neste tenant; nada foi gravado.'
  }
  if ([int]$preflight.public_email_count -ne 0 -or [int]$preflight.auth_email_count -ne 0) {
    throw 'O e-mail ja pertence a uma conta; nada foi gravado.'
  }
  $ownerName = [string]$preflight.admin_name
  $ownerPhone = ([string]$preflight.admin_whatsapp) -replace '\D', ''
  if ([string]::IsNullOrWhiteSpace($ownerName) -or $ownerName.Length -gt 160) {
    throw 'Nome do administrador indisponivel ou invalido; nada foi gravado.'
  }
  if ($ownerPhone -notmatch '^55\d{10,11}$') {
    $ownerPhone = (Read-Host 'WhatsApp do novo OWNER, com 55 e DDD') -replace '\D', ''
  }
  if ($ownerPhone -notmatch '^55\d{10,11}$') { throw 'WhatsApp invalido; nada foi gravado.' }

  $ownerId = [guid]::NewGuid().ToString()
  $inviteId = [guid]::NewGuid().ToString()
  $inviteCode = New-InviteCode
  $stage = 'criacao atomica do perfil e convite'
  $writeSql = @'
DO $prospix_owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE id = __TENANT__::uuid
      AND name = __NAME__ AND status::text IN ('ACTIVE','ONBOARDING')
  ) THEN RAISE EXCEPTION 'TENANT_CHANGED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = __ADMIN__::uuid
      AND role = 'GUILDS_ADMIN' AND tenant_id IS NULL AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'ADMIN_CHANGED'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.users WHERE tenant_id = __TENANT__::uuid
      AND role = 'OWNER' AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'OWNER_EXISTS'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.tenant_invitations WHERE tenant_id = __TENANT__::uuid
      AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  ) THEN RAISE EXCEPTION 'INVITE_EXISTS'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE lower(email) = __EMAIL__ AND deleted_at IS NULL)
     OR EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = __EMAIL__)
  THEN RAISE EXCEPTION 'EMAIL_EXISTS'; END IF;

  INSERT INTO public.users (id, tenant_id, role, name, email, whatsapp, updated_at)
  VALUES (__OWNER_ID__::uuid, __TENANT__::uuid, 'OWNER', __OWNER_NAME__, __EMAIL__, __PHONE__, now());

  INSERT INTO public.tenant_invitations
    (id, code, tenant_id, role, created_by_id, expires_at, notes)
  VALUES
    (__INVITE_ID__::uuid, __CODE__, __TENANT__::uuid, 'OWNER',
     __ADMIN__::uuid, now() + interval '14 days', 'Acesso OWNER de teste autorizado');

  INSERT INTO public.audit_log
    (user_id, action, target_type, target_id, payload)
  VALUES
    (__ADMIN__::uuid, 'tenant.invitation_created', 'tenant',
     __TENANT__::uuid, jsonb_build_object('invitation_id', __INVITE_ID__::uuid));
END
$prospix_owner$;
'@
  $writeSql = $writeSql.Replace('__TENANT__', $tenantSql).
    Replace('__NAME__', (SqlLiteral $ExpectedTenantName)).
    Replace('__ADMIN__', $adminSql).
    Replace('__EMAIL__', $emailSql).
    Replace('__OWNER_ID__', (SqlLiteral $ownerId)).
    Replace('__OWNER_NAME__', (SqlLiteral $ownerName)).
    Replace('__PHONE__', (SqlLiteral $ownerPhone)).
    Replace('__INVITE_ID__', (SqlLiteral $inviteId)).
    Replace('__CODE__', (SqlLiteral $inviteCode))
  $null = Invoke-ManagementQuery $writeSql $false

  $stage = 'verificacao no banco'
  $verifySql = @'
SELECT
  EXISTS (SELECT 1 FROM public.users WHERE id = __OWNER_ID__::uuid
    AND tenant_id = __TENANT__::uuid AND role = 'OWNER' AND lower(email) = __EMAIL__) AS owner_created,
  EXISTS (SELECT 1 FROM public.tenant_invitations WHERE id = __INVITE_ID__::uuid
    AND tenant_id = __TENANT__::uuid AND code = __CODE__
    AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS invite_active,
  EXISTS (SELECT 1 FROM public.users WHERE id = __ADMIN__::uuid
    AND role = 'GUILDS_ADMIN' AND tenant_id IS NULL AND deleted_at IS NULL) AS admin_intact;
'@
  $verifySql = $verifySql.Replace('__OWNER_ID__', (SqlLiteral $ownerId)).
    Replace('__TENANT__', $tenantSql).
    Replace('__EMAIL__', $emailSql).
    Replace('__INVITE_ID__', (SqlLiteral $inviteId)).
    Replace('__CODE__', (SqlLiteral $inviteCode)).
    Replace('__ADMIN__', $adminSql)
  $verification = @(Invoke-ManagementQuery $verifySql $true)
  if ($verification.Count -ne 1 -or -not $verification[0].owner_created -or
      -not $verification[0].invite_active -or -not $verification[0].admin_intact) {
    throw 'Verificacao no banco falhou. Pare e revise antes de repetir.'
  }

  $stage = 'verificacao do convite no aplicativo'
  $appBody = @{ code = $inviteCode } | ConvertTo-Json -Compress
  try {
    $appCheck = Invoke-RestMethod -Uri "$($AppUrl.TrimEnd('/'))/api/auth/invitations/verify" -Method Post -ContentType 'application/json' -Body $appBody
  } catch {
    throw 'Perfil e convite criados no banco, mas o aplicativo nao confirmou o convite. Nao repita a criacao.'
  }
  if ($appCheck.data.tenant_name -cne $ExpectedTenantName -or $appCheck.data.role -ne 'OWNER') {
    throw 'Perfil e convite criados, mas a verificacao do aplicativo divergiu. Nao repita a criacao.'
  }

  Save-SafeStatus 'app_verified' $stage
  Write-Host 'OWNER pendente e convite ativo confirmados. Super-Admin preservado.'
  Write-Host "Abra no navegador: $($AppUrl.TrimEnd('/'))/cadastro"
  Write-Host "Codigo de convite (use somente na tela de cadastro): $inviteCode"
  Write-Host 'Defina a senha somente no aplicativo. Nao cole o codigo ou a senha no chat.'
} catch {
  Save-SafeStatus 'failed' $stage
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($tokenBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenBstr) }
  Remove-Variable token -Scope Script -ErrorAction SilentlyContinue
}
