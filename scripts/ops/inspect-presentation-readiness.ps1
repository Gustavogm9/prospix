$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$outPath = Join-Path $repoRoot '.tmp/presentation-readiness-2026-11-19.json'
$bstr = [IntPtr]::Zero

try {
  $linkedRef = Join-Path $repoRoot 'supabase/.temp/project-ref'
  if (-not (Test-Path -LiteralPath $linkedRef) -or (Get-Content -Raw -LiteralPath $linkedRef).Trim() -ne $projectRef) {
    throw 'Projeto local nao confere com o Prospix.'
  }
  $secureToken = Read-Host 'Supabase Prospix access token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $headers = @{ Authorization = "Bearer $token" }
  $projectApi = "https://api.supabase.com/v1/projects/$projectRef"
  $project = Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers
  if ($project.id -ne $projectRef -or $project.name -notmatch '(?i)prospix') { throw 'Projeto inesperado.' }

  $sql = @'
WITH targets AS (
  SELECT DISTINCT tenant_id AS id FROM public.users
  WHERE lower(email) = 'giovanerodrigues1234@gmail.com' AND deleted_at IS NULL
  UNION SELECT id FROM public.tenants WHERE id = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid
)
SELECT jsonb_build_object(
  'tenants', (SELECT jsonb_agg(jsonb_build_object(
    'id',t.id, 'name',t.name, 'status',t.status,
    'is_client', EXISTS (SELECT 1 FROM public.users u WHERE u.tenant_id=t.id AND lower(u.email)='giovanerodrigues1234@gmail.com' AND u.deleted_at IS NULL),
    'paused', (SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id=t.id),
    'business_context_present', EXISTS(SELECT 1 FROM public.tenant_business_context WHERE tenant_id=t.id),
    'approved_knowledge_count', (SELECT count(*) FROM public.commercial_knowledge_chunks WHERE tenant_id=t.id AND status='APPROVED' AND active),
    'legacy_channel', (SELECT jsonb_build_object('instance_name',evolution_instance_name,'base_url',evolution_base_url,'has_key',coalesce(evolution_api_key_encrypted,'')<>'','has_google_refresh',coalesce(google_oauth_refresh_encrypted,'')<>'','calendar_configured',coalesce(google_calendar_id,'')<>'') FROM public.tenant_secrets WHERE tenant_id=t.id),
    'channels',(SELECT jsonb_agg(jsonb_build_object('id',id,'provider',provider,'instance_name',instance_name,'active',active,'send_enabled',send_enabled,'receive_enabled',receive_enabled,'connection_status',connection_status,'external_state',external_state,'last_checked_at',last_checked_at)) FROM public.whatsapp_channels WHERE tenant_id=t.id),
    'campaigns',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'homologation_mode',homologation_mode,'discovery_auto_enabled',discovery_auto_enabled,'active_script_id',active_script_id,'icp_id',icp_id,'profession',profession,'cities',cities,'daily_limit',daily_limit)) FROM public.campaigns WHERE tenant_id=t.id),
    'scripts',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'status',status,'archived_at',archived_at,'ai_tools',ai_tools,'qualification_config',qualification_config)) FROM public.scripts WHERE tenant_id=t.id),
    'icps',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'min_fit_score',min_fit_score,'weights',weights)) FROM public.icps WHERE tenant_id=t.id),
    'qa_allowlist_count',(SELECT count(*) FROM public.campaign_qa_allowlist a JOIN public.campaigns c ON c.id=a.campaign_id WHERE c.tenant_id=t.id AND a.expires_at>now())
  )) FROM public.tenants t JOIN targets x ON x.id=t.id),
  'migrations',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
  'billing_imports',(SELECT count(*) FROM public.provider_cost_ledger WHERE source NOT IN ('ESTIMATE','SYSTEM'))
) AS snapshot;
'@
  $body = @{ query=$sql; read_only=$true } | ConvertTo-Json -Compress
  $rows = @(Invoke-RestMethod -Method Post -Uri "$projectApi/database/query" -Headers $headers -ContentType 'application/json' -Body $body)
  if ($rows.Count -ne 1) { throw 'Resultado de formato inesperado.' }
  $functionRows = Invoke-RestMethod -Method Get -Uri "$projectApi/functions" -Headers $headers
  $functions = @($functionRows | ForEach-Object { $_ } | Select-Object name,version,status,verify_jwt)
  $result = [ordered]@{ checked_at_utc=[DateTimeOffset]::UtcNow.ToString('o'); snapshot=$rows[0].snapshot; functions=$functions }
  [IO.File]::WriteAllText($outPath, ($result | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
  Write-Host 'Consulta de preparacao concluida. Resultado salvo sem credenciais.'
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  Write-Host "Consulta interrompida (HTTP $code). Nenhum dado foi alterado."
  Write-Host ($_.Exception.Message -replace 'sbp_[A-Za-z0-9_\-]+','[TOKEN]')
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Variable token,secureToken,headers -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
