$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$projectRef='yvbyplzfqfrlfujathii'
$organizationId='ptzmchfxjlzenbtiodbb'
$repoRoot=Split-Path -Parent $PSScriptRoot
$resultDir=Join-Path $repoRoot '.local/new-client-2026-11-25'
$diagnosticPath=Join-Path $resultDir 'diagnostic.json'
$continuePath=Join-Path $resultDir 'continue.json'
$sqlPath=Join-Path $PSScriptRoot '2026-11-25-separate-new-client.sql'
$runnerPath=Join-Path $PSScriptRoot '2026-11-25-separate-new-client.ps1'
$pointer=[IntPtr]::Zero
$result=[ordered]@{started_at_utc=[DateTimeOffset]::UtcNow.ToString('o');writes_committed=$false;stage='preflight'}
function Query-Project([string]$query,[bool]$readOnly){
 $body=@{query=$query;read_only=$readOnly}|ConvertTo-Json -Compress
 $rows=Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 45
 return $rows|ForEach-Object {$_}
}
try{
 New-Item -ItemType Directory -Path $resultDir -Force|Out-Null
 if(Test-Path -LiteralPath $continuePath){Remove-Item -LiteralPath $continuePath}
 if((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef){throw 'PROJECT_LINK_MISMATCH'}
 $secureToken=Read-Host 'Supabase Prospix access token (sera usado somente nesta operacao)' -AsSecureString
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
 $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $script:headers=@{Authorization="Bearer $token"}
 $script:projectApi="https://api.supabase.com/v1/projects/$projectRef"
 $project=Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers -TimeoutSec 20
 if($project.id -ne $projectRef -or $project.organization_id -ne $organizationId -or $project.name -notmatch '(?i)prospix'){throw 'PROJECT_IDENTITY_MISMATCH'}
 $result.stage='read_only_catalogs'
 $catalogSql=@'
SELECT jsonb_build_object(
 'policies',(SELECT jsonb_agg(jsonb_build_object('table',p.tablename,'name',p.policyname,'command',p.cmd,'permissive',p.permissive,'roles',p.roles,'using',p.qual,'check',p.with_check) ORDER BY p.tablename,p.policyname)
   FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN ('tenants','users','leads','conversations','messages','meetings','campaigns','scripts')),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='auth' AND p.proname IN ('tenant_id','user_role')) OR (n.nspname='public' AND p.proname IN ('current_tenant_id','current_user_role'))),
 'current_profile_tenant',(SELECT u.tenant_id FROM public.users u WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid),
 'new_tenant_exists',EXISTS(SELECT 1 FROM public.tenants t WHERE t.id='dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid)
) AS diagnostic;
'@
 $result.catalogs=@(Query-Project $catalogSql $true)[0].diagnostic
 if($result.catalogs.new_tenant_exists -or $result.catalogs.current_profile_tenant -ne '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'){throw 'ACCOUNT_STATE_CHANGED_STOP_BEFORE_REPLAY'}
 $sql=[IO.File]::ReadAllText($sqlPath)
 if($sql -notmatch 'ROLLBACK;\s*$' -or $sql -match 'COMMIT;'){throw 'DIAGNOSTIC_MUST_ROLL_BACK'}
 $result.stage='rollback_diagnostic'
 try{$result.rehearsal=@(Query-Project $sql $false);$result.rehearsal_passed=$true}catch{
  $detail=if($_.ErrorDetails.Message){$_.ErrorDetails.Message}else{$_.Exception.Message}
  $result.rehearsal_error=$detail.Replace($token,'[TOKEN]')
 }
 $result.stage='awaiting_reviewed_fix'
 [IO.File]::WriteAllText($diagnosticPath,($result|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
 $pointer=[IntPtr]::Zero
 Remove-Variable token,headers -ErrorAction SilentlyContinue
 Write-Host 'Diagnostico salvo. Mantenha esta janela aberta enquanto o ajuste e conferido.'
 Write-Host 'O token fica apenas na memoria desta janela, por ate 15 minutos. Depois o roteiro pedira a senha atual para testar o acesso.'
 $timer=[Diagnostics.Stopwatch]::StartNew()
 $ready=$false
 while($timer.Elapsed.TotalMinutes -lt 15){
  if(Test-Path -LiteralPath $continuePath){
   $manifest=Get-Content -Raw -LiteralPath $continuePath|ConvertFrom-Json
   if($manifest.operation -eq '2026-11-25-separate-new-client' -and $manifest.sql_hash -eq (Get-FileHash -LiteralPath $sqlPath -Algorithm SHA256).Hash -and $manifest.runner_hash -eq (Get-FileHash -LiteralPath $runnerPath -Algorithm SHA256).Hash){$ready=$true;break}
   throw 'REVIEWED_SOURCE_HASH_MISMATCH'
  }
  Start-Sleep -Seconds 1
 }
 if(-not $ready){throw 'REVIEW_WAIT_TIMED_OUT_NO_CHANGE_COMMITTED'}
 $result.stage='resuming_authorized_operation'
 [IO.File]::WriteAllText($diagnosticPath,($result|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
 & $runnerPath -AccessToken $secureToken
 $result.stage='runner_finished'
}catch{
 $result.error=$true
 $result.detail=if($_.Exception.Response){'HTTP_'+[int]$_.Exception.Response.StatusCode}else{$_.Exception.Message}
 Write-Host ('Diagnostico interrompido: '+$result.detail)
}finally{
 if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 if($secureToken){$secureToken.Dispose()}
 Remove-Variable secureToken,token,headers,AccessToken -ErrorAction SilentlyContinue
 [IO.File]::WriteAllText($diagnosticPath,($result|ConvertTo-Json -Depth 30),[Text.UTF8Encoding]::new($false))
}
Read-Host 'Pressione Enter para fechar'
