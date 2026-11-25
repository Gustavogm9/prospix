param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sqlPath = Join-Path $PSScriptRoot 'prepare-client-presentation.sql'
$resultPath = Join-Path $repoRoot '.tmp/client-presentation-preparation-2026-11-19.json'
$bstr = [IntPtr]::Zero

function Invoke-ProjectSql([string]$query, [bool]$readOnly) {
  $body = @{ query=$query; read_only=$readOnly } | ConvertTo-Json -Compress
  return @(Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)))
}

try {
  $linked = (Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim()
  if ($linked -ne $projectRef) { throw 'Vinculo de projeto inesperado.' }
  $secureToken = Read-Host 'Supabase Prospix access token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $script:headers = @{ Authorization="Bearer $token" }
  $script:projectApi = "https://api.supabase.com/v1/projects/$projectRef"
  $project = Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers
  if ($project.id -ne $projectRef -or $project.name -notmatch '(?i)prospix') { throw 'Projeto inesperado.' }

  $backup = Invoke-ProjectSql @'
SELECT jsonb_build_object(
 'context',(SELECT jsonb_agg(to_jsonb(c)) FROM public.tenant_business_context c WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
 'knowledge',(SELECT jsonb_agg(to_jsonb(k)) FROM public.commercial_knowledge_chunks k WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
 'script_ids',(SELECT jsonb_agg(id) FROM public.scripts WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
 'campaign_ids',(SELECT jsonb_agg(id) FROM public.campaigns WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
 'icp_ids',(SELECT jsonb_agg(id) FROM public.icps WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06')
) AS before;
'@ $true
  $backupDir = Join-Path $repoRoot '.local/presentation-2026-11-19'
  $null = New-Item -ItemType Directory -Path $backupDir -Force
  $backupPath = Join-Path $backupDir ('before-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '.json')
  [IO.File]::WriteAllText($backupPath, ($backup | ConvertTo-Json -Depth 25), [Text.UTF8Encoding]::new($false))

  $sql = [IO.File]::ReadAllText($sqlPath, [Text.Encoding]::UTF8)
  if ($sql -notmatch '(?s)ROLLBACK;\s*$') { throw 'Roteiro sem ROLLBACK final.' }
  Write-Host 'Ensaiando a preparacao com ROLLBACK; campanhas seguem pausadas.'
  $preview = Invoke-ProjectSql $sql $false
  $applied = $false
  if ($Apply) {
    $applySql = [regex]::Replace($sql, 'ROLLBACK;\s*$', 'COMMIT;')
    Write-Host 'Aplicando o contexto, o roteiro e a base consultiva autorizados.'
    $null = Invoke-ProjectSql $applySql $false
    $applied = $true
  }
  $verification = Invoke-ProjectSql @'
SELECT jsonb_build_object(
 'context_present',EXISTS(SELECT 1 FROM public.tenant_business_context WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06'),
 'approved_skills',(SELECT count(*) FROM public.commercial_knowledge_chunks WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06' AND status='APPROVED' AND active),
 'prepared_script_ids',(SELECT jsonb_agg(id) FROM public.scripts WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06' AND name='Qualificação consultiva · Apresentação 2026-11-19'),
 'active_campaigns',(SELECT count(*) FROM public.campaigns WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06' AND status='ACTIVE'),
 'outbound_paused',(SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id='220e676e-ef8d-4312-814d-fb4dca962c06')
) AS verification;
'@ $true
  $result = [ordered]@{ checked_at_utc=[DateTimeOffset]::UtcNow.ToString('o'); project=$project.name; applied=$applied; preview=$preview; verification=$verification }
  [IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Write-Host 'Preparacao verificada. Nenhuma mensagem foi enviada e nenhuma campanha foi ativada.'
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  $detail = $detail -replace 'sbp_[A-Za-z0-9_\-]+','[TOKEN]'
  if ($detail.Length -gt 2000) { $detail=$detail.Substring(0,2000) }
  [IO.File]::WriteAllText($resultPath, (@{ error=$true; http_status=$code; detail=$detail } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Write-Host "Preparacao interrompida (HTTP $code). Consulte o resultado antes de repetir."
  Write-Host ($_.Exception.Message -replace 'sbp_[A-Za-z0-9_\-]+','[TOKEN]')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable token,secureToken,headers -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
