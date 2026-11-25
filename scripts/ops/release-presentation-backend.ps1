param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRef = 'yvbyplzfqfrlfujathii'
$version = '20261110110000'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resultPath = Join-Path $repoRoot '.tmp/presentation-backend-release-2026-11-19.json'
$bstr = [IntPtr]::Zero
$receipt = [ordered]@{ checked_at_utc=[DateTimeOffset]::UtcNow.ToString('o'); applied=$false; migration_applied=$false; functions_deployed=@() }

function Invoke-Sql([string]$query, [bool]$readOnly) {
  $body = @{ query=$query; read_only=$readOnly } | ConvertTo-Json -Compress
  return @(Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)))
}

try {
  if ((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef) { throw 'PROJECT_LINK_MISMATCH' }
  $secureToken=Read-Host 'Supabase Prospix access token' -AsSecureString
  $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $script:headers=@{ Authorization="Bearer $token" }
  $script:projectApi="https://api.supabase.com/v1/projects/$projectRef"
  $project=Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers
  if($project.id -ne $projectRef -or $project.name -notmatch '(?i)prospix'){throw 'PROJECT_IDENTITY_MISMATCH'}

  $remote=@(Invoke-Sql 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;' $true | ForEach-Object { $_.version })
  $local=@(Get-ChildItem (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql' | ForEach-Object { ($_.BaseName -split '_')[0] })
  $drift=@(Compare-Object $local $remote | Where-Object { $_.InputObject -ne $version })
  if($drift.Count -gt 0){throw 'MIGRATION_HISTORY_DRIFT'}

  $backups=Invoke-RestMethod -Method Get -Uri "$projectApi/database/backups" -Headers $headers
  $recent=@($backups.backups | Where-Object { $_.status -eq 'COMPLETED' -and [DateTimeOffset]$_.inserted_at -gt [DateTimeOffset]::UtcNow.AddHours(-48) })
  $pitrRecent=$backups.pitr_enabled -and $backups.physical_backup_data.latest_physical_backup_date_unix -gt [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeSeconds()
  $receipt.backup_recent=($recent.Count -gt 0 -or $pitrRecent)
  if(-not $receipt.backup_recent){throw 'RECENT_BACKUP_NOT_CONFIRMED_NO_WRITES_PERFORMED'}

  $migrationPath=Join-Path $repoRoot 'supabase/migrations/20261110110000_conversation_dismissal.sql'
  $sql=[IO.File]::ReadAllText($migrationPath,[Text.Encoding]::UTF8)
  if($sql -notmatch '(?s)COMMIT;\s*$'){throw 'MIGRATION_TRANSACTION_INVALID'}
  if($remote -notcontains $version){
    $commitIndex=$sql.LastIndexOf('COMMIT;')
    $null=Invoke-Sql ($sql.Substring(0,$commitIndex)+'ROLLBACK;') $false
    $receipt.rollback_rehearsal=$true
    if($Apply){
      $history="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('$version','conversation_dismissal',ARRAY[`$migration_source`$$sql`$migration_source`$]);"
      $null=Invoke-Sql ($sql.Substring(0,$commitIndex)+$history+"`nNOTIFY pgrst, 'reload schema';`nCOMMIT;") $false
      $receipt.migration_applied=$true
    }
  }

  if($Apply){
    $env:SUPABASE_ACCESS_TOKEN=$token
    Push-Location $repoRoot
    try {
      & supabase functions deploy webhook-evolution --project-ref $projectRef --no-verify-jwt --use-api
      if($LASTEXITCODE -ne 0){throw 'WEBHOOK_DEPLOY_FAILED'}
      $receipt.functions_deployed+= 'webhook-evolution'
      & supabase functions deploy send-messages --project-ref $projectRef --use-api
      if($LASTEXITCODE -ne 0){throw 'SEND_WORKER_DEPLOY_FAILED'}
      $receipt.functions_deployed+= 'send-messages'
    } finally { Pop-Location; Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue }
    $receipt.applied=$true
  }
  $receipt.schema_verification=Invoke-Sql @'
SELECT jsonb_build_object(
 'migration_recorded',EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261110110000'),
 'removed_columns',(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='conversations' AND column_name IN ('removed_at','removed_by')),
 'rpc_present',to_regprocedure('public.dismiss_conversation(uuid)') IS NOT NULL,
 'anon_cannot_execute',CASE WHEN to_regprocedure('public.dismiss_conversation(uuid)') IS NULL THEN NULL ELSE NOT has_function_privilege('anon',to_regprocedure('public.dismiss_conversation(uuid)'), 'EXECUTE') END,
 'authenticated_can_execute',CASE WHEN to_regprocedure('public.dismiss_conversation(uuid)') IS NULL THEN NULL ELSE has_function_privilege('authenticated',to_regprocedure('public.dismiss_conversation(uuid)'), 'EXECUTE') END
) AS verification;
'@ $true
  $functionRows=Invoke-RestMethod -Method Get -Uri "$projectApi/functions" -Headers $headers
  $receipt.functions=@($functionRows | ForEach-Object { $_ } | Where-Object { $_.name -in @('webhook-evolution','send-messages') } | Select-Object name,version,status,verify_jwt)
  Write-Host 'Backend conferido. A publicacao da interface segue pelo Questboard.'
} catch {
  $receipt.error=$true
  $detail=if($_.ErrorDetails.Message){$_.ErrorDetails.Message}else{$_.Exception.Message}
  $detail=$detail -replace 'sbp_[A-Za-z0-9_\-]+','[TOKEN]'
  if($detail.Length -gt 2000){$detail=$detail.Substring(0,2000)}
  $receipt.detail=$detail
  Write-Host 'Etapa interrompida. Consulte o recibo antes de repetir.'
  Write-Host $detail
} finally {
  [IO.File]::WriteAllText($resultPath,($receipt | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
  if($bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
  Remove-Variable token,secureToken,headers -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
