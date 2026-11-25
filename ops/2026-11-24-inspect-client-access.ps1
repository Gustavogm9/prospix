$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$targetEmail = 'gustavo.macedo@guilds.com.br'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resultDir = Join-Path $repoRoot '.local/client-access-2026-11-24'
$resultPath = Join-Path $resultDir 'inspection.json'
$bstr = [IntPtr]::Zero
$receipt = [ordered]@{ checked_at_utc = [DateTimeOffset]::UtcNow.ToString('o'); read_only = $true; completed = $false }
try {
  if ((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef) { throw 'PROJECT_LINK_MISMATCH' }
  $secureToken = Read-Host 'Supabase Prospix access token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $headers = @{ Authorization = "Bearer $token" }
  $projectApi = "https://api.supabase.com/v1/projects/$projectRef"
  $project = Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers
  if ($project.id -ne $projectRef -or $project.name -notmatch '(?i)prospix') { throw 'PROJECT_IDENTITY_MISMATCH' }
  $organizations = @(Invoke-RestMethod -Method Get -Uri 'https://api.supabase.com/v1/organizations' -Headers $headers)
  if (-not ($organizations | Where-Object { $_.id -eq $project.organization_id -or $_.slug -eq $project.organization_slug })) { throw 'PROJECT_ORGANIZATION_NOT_ACCESSIBLE' }
  $receipt.project_id = $project.id
  $receipt.organization_id = $project.organization_id
  $query = @"
SELECT jsonb_build_object(
 'tenant', (SELECT jsonb_build_object('id', t.id, 'name', t.name, 'status', t.status, 'deleted', t.deleted_at IS NOT NULL) FROM public.tenants t WHERE t.id='$tenantId'::uuid),
 'profiles', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'role',u.role,'tenant_id',u.tenant_id,'deleted',u.deleted_at IS NOT NULL,'email_matches',lower(u.email)='$targetEmail')) FROM public.users u WHERE lower(u.email)='$targetEmail'),'[]'::jsonb),
 'identities', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'email_matches',lower(a.email)='$targetEmail','email_confirmed',a.email_confirmed_at IS NOT NULL,'banned_until',a.banned_until,'password_present',a.encrypted_password IS NOT NULL AND a.encrypted_password<>'')) FROM auth.users a WHERE lower(a.email)='$targetEmail' OR a.id IN (SELECT u.id FROM public.users u WHERE lower(u.email)='$targetEmail')),'[]'::jsonb),
 'active_owner_count', (SELECT count(*) FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email) WHERE u.tenant_id='$tenantId'::uuid AND u.role='OWNER' AND u.deleted_at IS NULL),
 'active_invite_count', (SELECT count(*) FROM public.tenant_invitations i WHERE i.tenant_id='$tenantId'::uuid AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()),
 'user_columns', (SELECT jsonb_agg(jsonb_build_object('name',column_name,'nullable',is_nullable,'has_default',column_default IS NOT NULL)) FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name IN ('id','email','name','tenant_id','role','whatsapp','password_hash','must_change_password','deleted_at'))
) AS result;
"@
  $body = @{ query = $query; read_only = $true } | ConvertTo-Json -Compress
  $rows = @(Invoke-RestMethod -Method Post -Uri "$projectApi/database/query" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)))
  if ($rows.Count -ne 1 -or -not $rows[0].result) { throw 'INSPECTION_RESPONSE_INVALID' }
  $receipt.inspection = $rows[0].result
  $receipt.completed = $true
  Write-Host 'Consulta concluida. Nenhum acesso foi alterado.'
} catch {
  $receipt.error = $true
  $receipt.detail = if ($_.Exception.Response) { 'HTTP_' + [int]$_.Exception.Response.StatusCode } else { $_.Exception.Message -replace 'sbp_[A-Za-z0-9_-]+','[TOKEN]' }
  Write-Host ('Consulta interrompida: ' + $receipt.detail)
} finally {
  New-Item -ItemType Directory -Path $resultDir -Force | Out-Null
  [IO.File]::WriteAllText($resultPath, ($receipt | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable token,secureToken,headers -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'