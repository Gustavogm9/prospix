param(
  [System.Security.SecureString]$AccessToken
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$bstr = [IntPtr]::Zero

try {
  if (-not $AccessToken) { $AccessToken = Read-Host 'Supabase Prospix access token' -AsSecureString }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AccessToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

  $query = @"
SELECT 'tenant' AS kind, id::text AS id, name AS label, status::text AS detail
FROM public.tenants WHERE id = '$tenantId'::uuid
UNION ALL
SELECT 'admin', id::text, role::text, COALESCE(tenant_id::text, '<none>')
FROM public.users WHERE lower(email) = lower('gustavo.lima@guilds.com.br')
UNION ALL
SELECT 'owner', u.id::text, u.role::text,
       CASE WHEN a.id IS NULL THEN 'auth_missing' ELSE 'auth_present' END
FROM public.users u LEFT JOIN auth.users a ON a.id = u.id
WHERE u.tenant_id = '$tenantId'::uuid AND u.role = 'OWNER'
UNION ALL
SELECT 'connected_channels', count(*)::text, 'CONNECTED', ''
FROM public.whatsapp_channels
WHERE tenant_id = '$tenantId'::uuid AND connection_status = 'CONNECTED'
UNION ALL
SELECT 'active_campaigns', count(*)::text, 'ACTIVE', ''
FROM public.campaigns
WHERE tenant_id = '$tenantId'::uuid AND status = 'ACTIVE';
"@

  $body = @{ query = $query; read_only = $true } | ConvertTo-Json -Compress
  $response = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$projectRef/database/query" -Method Post -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
  $safeResult = $response | ConvertTo-Json -Depth 6
  $resultPath = Join-Path $env:TEMP 'prospix-owner-inspection.json'
  [IO.File]::WriteAllText($resultPath, $safeResult, [Text.UTF8Encoding]::new($false))
  Write-Host "Consulta concluida. Resultado seguro salvo em: $resultPath"
  $safeResult
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  Write-Error "Consulta somente leitura ao Management API falhou (HTTP $status)."
  exit 1
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable token -ErrorAction SilentlyContinue
}
