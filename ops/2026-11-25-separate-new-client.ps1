param([System.Security.SecureString]$AccessToken)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$projectRef='yvbyplzfqfrlfujathii'
$organizationId='ptzmchfxjlzenbtiodbb'
$authId='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'
$oldTenant='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$newTenant='dda78e66-575f-45d4-b136-4d7ad5dc4de7'
$targetEmail='gustavo.macedo@guilds.com.br'
$repoRoot=Split-Path -Parent $PSScriptRoot
$resultDir=Join-Path $repoRoot '.local/new-client-2026-11-25'
$resultPath=Join-Path $resultDir 'result.json'
$tokenPointer=[IntPtr]::Zero
$passwordPointer=[IntPtr]::Zero
$metadataAttempted=$false
$migrationVersion='20261125135500'
$migrationPath=Join-Path $repoRoot 'supabase/migrations/20261125135500_fix_user_tenant_visibility.sql'
$approvalPath=Join-Path $resultDir 'policy-approval.json'
$agentName='Prospix-Authorized-Account-Operation/1.0'
$receipt=[ordered]@{checked_at_utc=[DateTimeOffset]::UtcNow.ToString('o');applied=$false;login_verified=$false;empty_workspace_verified=$false;stage='preflight'}

function Invoke-Sql([string]$query,[bool]$readOnly){
 $body=@{query=$query;read_only=$readOnly}|ConvertTo-Json -Compress
 $response=Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:managementHeaders -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 45
 return $response | ForEach-Object {$_}
}
function Set-AuthMetadata($appMetadata,$userMetadata){
 $body=@{app_metadata=$appMetadata;user_metadata=$userMetadata}|ConvertTo-Json -Depth 25 -Compress
 return Invoke-RestMethod -Method Put -Uri "$script:authApi/admin/users/$script:authId" -Headers $script:adminHeaders -UserAgent $script:agentName -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 25
}
function Password-Login{
 $body=@{email=$script:targetEmail;password=$script:currentPassword}|ConvertTo-Json -Compress
 return Invoke-RestMethod -Method Post -Uri "$script:authApi/token?grant_type=password" -Headers @{apikey=$script:publicKey} -UserAgent $script:agentName -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 25
}
$stateSql=@'
SELECT jsonb_build_object(
 'profile_count',(SELECT count(*) FROM public.users u WHERE lower(u.email)='gustavo.macedo@guilds.com.br'),
 'identity_count',(SELECT count(*) FROM auth.users a WHERE lower(a.email)='gustavo.macedo@guilds.com.br'),
 'profile_tenant',(SELECT u.tenant_id FROM public.users u WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid AND u.deleted_at IS NULL AND u.role::text='OWNER'),
 'auth_tenant',(SELECT a.raw_app_meta_data->>'tenant_id' FROM auth.users a WHERE a.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid),
 'auth_role',(SELECT a.raw_app_meta_data->>'role' FROM auth.users a WHERE a.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid),
 'new_tenant_exists',EXISTS(SELECT 1 FROM public.tenants t WHERE t.id='dda78e66-575f-45d4-b136-4d7ad5dc4de7'::uuid),
 'source_members',(SELECT count(*) FROM public.users u WHERE u.tenant_id='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid),
 'profile_reset',EXISTS(SELECT 1 FROM public.users u WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid AND u.name='Gustavo Macedo' AND u.whatsapp='' AND u.city IS NULL AND u.susep IS NULL AND u.avatar_url IS NULL AND u.bio IS NULL AND u.partner_brand IS NULL AND u.partner_code IS NULL AND u.preferences::jsonb='{}'::jsonb)
) AS state;
'@
try{
 if((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef){throw 'PROJECT_LINK_MISMATCH'}
 $secureToken=if($AccessToken){$AccessToken}else{Read-Host 'Supabase Prospix access token' -AsSecureString}
 $tokenPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
 $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
 $script:managementHeaders=@{Authorization="Bearer $token"}
 $script:projectApi="https://api.supabase.com/v1/projects/$projectRef"
 $project=Invoke-RestMethod -Method Get -Uri $projectApi -Headers $managementHeaders -TimeoutSec 20
 if($project.id -ne $projectRef -or $project.organization_id -ne $organizationId -or $project.name -notmatch '(?i)prospix'){throw 'PROJECT_IDENTITY_MISMATCH'}
 $receipt.before=@(Invoke-Sql $stateSql $true)[0].state
 if($receipt.before.profile_count -ne 1 -or $receipt.before.identity_count -ne 1 -or $receipt.before.profile_tenant -ne $oldTenant -or $receipt.before.auth_tenant -ne $oldTenant -or $receipt.before.auth_role -ne 'OWNER' -or $receipt.before.new_tenant_exists){throw 'ACCOUNT_SCOPE_CHANGED_DO_NOT_REPEAT'}

 $apiKeys=Invoke-RestMethod -Method Get -Uri "$projectApi/api-keys?reveal=true" -Headers $managementHeaders -TimeoutSec 20
 $candidates=@($apiKeys|Where-Object {$_.api_key -is [string] -and ($_.api_key.StartsWith('sb_secret_') -or ($_.name -eq 'service_role' -and $_.api_key.StartsWith('eyJ')))}|Sort-Object @{Expression={if($_.api_key.StartsWith('sb_secret_')){0}else{1}}}|Select-Object -First 3)
 $publicCandidates=@($apiKeys|Where-Object {$_.api_key -is [string] -and ($_.api_key.StartsWith('sb_publishable_') -or $_.name -eq 'anon')}|Sort-Object @{Expression={if($_.api_key.StartsWith('sb_publishable_')){0}else{1}}})
 if($candidates.Count -eq 0 -or $publicCandidates.Count -eq 0){throw 'EXISTING_KEYS_UNAVAILABLE'}
 $script:publicKey=([string]$publicCandidates[0].api_key).Trim()
 $script:authApi="https://$projectRef.supabase.co/auth/v1"
 $authBefore=$null
 foreach($candidate in $candidates){
  $serviceKey=([string]$candidate.api_key).Trim()
  if($serviceKey -match '\s'){throw 'INVALID_KEY_FORMAT'}
  $script:adminHeaders=@{apikey=$serviceKey}
  if(-not $serviceKey.StartsWith('sb_secret_')){$script:adminHeaders.Authorization="Bearer $serviceKey"}
  try{
   $candidateUser=Invoke-RestMethod -Method Get -Uri "$authApi/admin/users/$authId" -Headers $adminHeaders -UserAgent $agentName -TimeoutSec 20
   if($candidateUser.id -eq $authId -and $candidateUser.email.ToLowerInvariant() -eq $targetEmail){$authBefore=$candidateUser;break}
  }catch{}
 }
 if(-not $authBefore -or $authBefore.app_metadata.role -ne 'OWNER' -or $authBefore.app_metadata.tenant_id -ne $oldTenant){throw 'AUTH_ADMIN_SCOPE_CHANGED'}

 $receipt.stage='policy_preflight'
 $remoteVersions=@(Invoke-Sql 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;' $true|ForEach-Object {$_.version})
 $localVersions=@(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'supabase/migrations') -Filter '*.sql'|ForEach-Object {($_.BaseName -split '_')[0]})
 $drift=@(Compare-Object $localVersions $remoteVersions|Where-Object {$_.InputObject -notin @($migrationVersion,'20261110110000')})
 if($drift.Count -gt 0){throw 'MIGRATION_HISTORY_DRIFT'}
 $receipt.unrelated_pending_conversation_migration=($remoteVersions -notcontains '20261110110000')
 $receipt.policy_migration_pending=($remoteVersions -notcontains $migrationVersion)
 $receipt.backup_recent=$false
 try{
  $backups=Invoke-RestMethod -Method Get -Uri "$projectApi/database/backups" -Headers $managementHeaders -TimeoutSec 20
  $recent=@($backups.backups|Where-Object {$_.status -eq 'COMPLETED' -and [DateTimeOffset]$_.inserted_at -gt [DateTimeOffset]::UtcNow.AddHours(-48)})
  $pitrRecent=$backups.pitr_enabled -and $backups.physical_backup_data.latest_physical_backup_date_unix -gt [DateTimeOffset]::UtcNow.AddHours(-24).ToUnixTimeSeconds()
  $receipt.backup_recent=($recent.Count -gt 0 -or $pitrRecent)
 }catch{$receipt.backup_check_http_status=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0}}
 $policyRows=@(Invoke-Sql "SELECT pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression FROM pg_policy p WHERE p.polrelid='public.users'::regclass AND p.polname='tenant_isolation_users';" $true)
 if($policyRows.Count -ne 1){throw 'POLICY_SNAPSHOT_MISSING'}
 $receipt.policy_before=$policyRows[0]
 New-Item -ItemType Directory -Path $resultDir -Force|Out-Null
 $restore='BEGIN; SET LOCAL lock_timeout = ''5s''; DROP POLICY tenant_isolation_users ON public.users; CREATE POLICY tenant_isolation_users ON public.users FOR ALL TO public USING ('+$policyRows[0].using_expression+')'
 if($policyRows[0].check_expression){$restore+=' WITH CHECK ('+$policyRows[0].check_expression+')'}
 $restore+='; COMMIT;'
 [IO.File]::WriteAllText((Join-Path $resultDir 'user-policy-before.sql'),$restore,[Text.UTF8Encoding]::new($false))

 $receipt.stage='encrypted_profile_copy'
 $backupSql="SELECT jsonb_build_object('profile',to_jsonb(u)-'password_hash','app_metadata',a.raw_app_meta_data,'user_metadata',a.raw_user_meta_data) AS backup FROM public.users u JOIN auth.users a ON a.id=u.id WHERE u.id='$authId'::uuid;"
 $backup=@(Invoke-Sql $backupSql $true)[0].backup
 $backupSecure=ConvertTo-SecureString -String ($backup|ConvertTo-Json -Depth 30 -Compress) -AsPlainText -Force
 $encryptedBackup=ConvertFrom-SecureString -SecureString $backupSecure
 New-Item -ItemType Directory -Path $resultDir -Force|Out-Null
 [IO.File]::WriteAllText((Join-Path $resultDir 'before-profile.dpapi'),$encryptedBackup,[Text.UTF8Encoding]::new($false))
 $backupSecure.Dispose()
 $receipt.local_profile_copy_encrypted=$true

 $receipt.stage='rollback_rehearsal'
 $sql=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '2026-11-25-separate-new-client.sql'))
 $migrationSql=[IO.File]::ReadAllText($migrationPath)
 if($migrationSql -notmatch '^--[\s\S]*?BEGIN;' -or $migrationSql -notmatch 'COMMIT;\s*$'){throw 'MIGRATION_TRANSACTION_INVALID'}
 $migrationBody=[regex]::Replace($migrationSql,'^[\s\S]*?BEGIN;','')
 $migrationBody=[regex]::Replace($migrationBody,'COMMIT;\s*$','')
 $start='BEGIN ISOLATION LEVEL REPEATABLE READ;'
 $nl=[string][char]10
 $previewPrefix=$start+$nl+'SAVEPOINT policy_restore_rehearsal;'+$nl+$migrationBody+$nl+'ROLLBACK TO SAVEPOINT policy_restore_rehearsal;'+$nl
 $originalPolicyQuoted="'"+$policyRows[0].using_expression.Replace("'","''")+"'"
 $restoreGuard='DO $restore$ BEGIN IF (SELECT pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p WHERE p.polrelid=''public.users''::regclass AND p.polname=''tenant_isolation_users'') IS DISTINCT FROM '+$originalPolicyQuoted+' THEN RAISE EXCEPTION ''POLICY_ROLLBACK_FAILED''; END IF; END; $restore$;'
 $previewSql=$sql.Replace($start,($previewPrefix+$restoreGuard+$nl+$migrationBody))
 $receipt.preview=@(Invoke-Sql $previewSql $false|Where-Object {$_.verification})
 if($receipt.preview.Count -ne 1 -or -not $receipt.preview[0].verification.profile_reset -or -not $receipt.preview[0].verification.fresh_claims_isolation_passed){throw 'REHEARSAL_FAILED'}
 $receipt.after_rollback=@(Invoke-Sql $stateSql $true)[0].state
 if(($receipt.before|ConvertTo-Json -Compress) -ne ($receipt.after_rollback|ConvertTo-Json -Compress)){throw 'ROLLBACK_STATE_MISMATCH'}
 $receipt.policy_restore_rehearsal_passed=$true
 $receipt.stage='awaiting_policy_approval'
 [IO.File]::WriteAllText($resultPath,($receipt|ConvertTo-Json -Depth 25),[Text.UTF8Encoding]::new($false))
 Write-Host 'Ensaio aprovado: conta nova vazia, administradores protegidos e acesso legitimo preservado.'
 Write-Host 'Aguardando autorizacao para corrigir a regra compartilhada de usuarios. Mantenha esta janela aberta.'
 $approvalTimer=[Diagnostics.Stopwatch]::StartNew()
 while(-not (Test-Path -LiteralPath $approvalPath) -and $approvalTimer.Elapsed.TotalMinutes -lt 20){Start-Sleep -Seconds 1}
 if(-not (Test-Path -LiteralPath $approvalPath)){throw 'POLICY_APPROVAL_WAIT_EXPIRED'}
 $approval=Get-Content -Raw -LiteralPath $approvalPath|ConvertFrom-Json
 if($approval.version -ne $migrationVersion -or $approval.operation -ne 'new-client-and-user-policy' -or $approval.migration_hash -ne (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -or $approval.sql_hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '2026-11-25-separate-new-client.sql') -Algorithm SHA256).Hash){throw 'POLICY_APPROVAL_SCOPE_MISMATCH'}
 if(-not $receipt.backup_recent -and $approval.allow_missing_full_backup -ne $true){throw 'RECENT_BACKUP_NOT_CONFIRMED'}
 $receipt.owner_approval_recorded=$true
 $receipt.backup_exception= -not $receipt.backup_recent

 $receipt.stage='password_precheck'
 $securePassword=Read-Host 'Senha atual desta conta, somente para conferir o acesso (nao sera alterada)' -AsSecureString
 $passwordPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
 $script:currentPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
 $preLogin=Password-Login
 if($preLogin.user.id -ne $authId -or -not $preLogin.access_token){throw 'CURRENT_PASSWORD_NOT_CONFIRMED'}

 $receipt.stage='auth_workspace_update'
 $metadataAttempted=$true
 $userPatch=@{name='Gustavo Macedo';full_name='Gustavo Macedo';tenant_id=$newTenant;avatar_url=$null;picture=$null;city=$null;susep=$null;whatsapp=$null;bio=$null;company=$null;company_name=$null;business_name=$null}
 $authUpdated=Set-AuthMetadata @{role='OWNER';tenant_id=$newTenant} $userPatch
 if($authUpdated.id -ne $authId -or $authUpdated.app_metadata.tenant_id -ne $newTenant -or $authUpdated.app_metadata.role -ne 'OWNER'){throw 'AUTH_WORKSPACE_NOT_CONFIRMED'}

 $receipt.stage='workspace_commit'
 $applySql=[regex]::Replace($sql,'ROLLBACK;\s*$','COMMIT;')
 if($applySql -eq $sql){throw 'INVALID_COMMIT_SOURCE'}
 $history=''
 if($receipt.policy_migration_pending){
  $quotedMigration="'"+$migrationSql.Replace("'","''")+"'"
  $history="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('$migrationVersion','fix_user_tenant_visibility',ARRAY[$quotedMigration]);"
 }
 $applySql=$applySql.Replace($start,($start+$nl+$migrationBody+$nl+$history))
 $claimsGuard="DO `$guard`$ BEGIN IF NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id='$authId'::uuid AND a.raw_app_meta_data->>'tenant_id'='$newTenant' AND a.raw_app_meta_data->>'role'='OWNER') THEN RAISE EXCEPTION 'AUTH_SCOPE_NOT_ALIGNED'; END IF; END; `$guard`$;"
 $applySql=$applySql.Replace('BEGIN ISOLATION LEVEL REPEATABLE READ;',('BEGIN ISOLATION LEVEL REPEATABLE READ;'+[char]10+$claimsGuard))
 $receipt.application=@(Invoke-Sql $applySql $false|Where-Object {$_.verification})
 $receipt.after=@(Invoke-Sql $stateSql $true)[0].state
 if($receipt.after.profile_tenant -ne $newTenant -or $receipt.after.auth_tenant -ne $newTenant -or $receipt.after.auth_role -ne 'OWNER' -or -not $receipt.after.profile_reset -or $receipt.after.source_members -ne ($receipt.before.source_members-1)){throw 'FINAL_MEMBERSHIP_CHECK_FAILED'}
 $receipt.applied=$true

 $receipt.stage='fresh_login_verification'
 $login=Password-Login
 if($login.user.id -ne $authId -or $login.user.app_metadata.tenant_id -ne $newTenant -or -not $login.access_token){throw 'FRESH_LOGIN_SCOPE_FAILED'}
 $receipt.login_verified=$true
 $sessionHeaders=@{apikey=$publicKey;Authorization="Bearer $($login.access_token)"}
 $profile=Invoke-RestMethod -Method Get -Uri "https://$projectRef.supabase.co/rest/v1/users?select=id,name,tenant_id,role,whatsapp,city,susep,avatar_url,bio,partner_brand,partner_code,preferences&id=eq.$authId" -Headers $sessionHeaders -UserAgent $agentName -TimeoutSec 20
 $profileRows=@($profile|ForEach-Object {$_})
 if($profileRows.Count -ne 1 -or $profileRows[0].tenant_id -ne $newTenant -or $profileRows[0].name -ne 'Gustavo Macedo' -or $profileRows[0].whatsapp -ne ''){throw 'FRESH_PROFILE_FAILED'}
 $checks=@(@{table='tenants';query="select=id&id=eq.$oldTenant"},@{table='leads';query='select=id&limit=1'},@{table='conversations';query='select=id&limit=1'},@{table='messages';query='select=id&limit=1'},@{table='meetings';query='select=id&limit=1'},@{table='campaigns';query='select=id&limit=1'},@{table='scripts';query='select=id&limit=1'},@{table='commercial_knowledge_chunks';query='select=id&limit=1'},@{table='whatsapp_channels';query='select=id&limit=1'})
 foreach($check in $checks){
  $rows=Invoke-RestMethod -Method Get -Uri ("https://$projectRef.supabase.co/rest/v1/"+$check.table+'?'+$check.query) -Headers $sessionHeaders -UserAgent $agentName -TimeoutSec 20
  if(@($rows|ForEach-Object {$_}).Count -ne 0){throw 'FRESH_WORKSPACE_NOT_EMPTY_OR_ISOLATED'}
 }
 $receipt.empty_workspace_verified=$true
 $receipt.stage='completed'
 Write-Host 'Conta separada e vazia confirmada: Gustavo Macedo.'
 Write-Host 'Perfil OWNER preservado, senha mantida e nenhum dado comercial copiado.'
 Write-Host 'Entre novamente em https://www.prospix.com.br/login para iniciar a configuracao do novo cliente.'
}catch{
 $receipt.error=$true
 $receipt.http_status=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0}
 $detail=if($_.ErrorDetails.Message){$_.ErrorDetails.Message}else{$_.Exception.Message}
 foreach($sensitive in @($token,$serviceKey,$publicKey,$currentPassword)){if($sensitive){$detail=$detail.Replace($sensitive,'[REDACTED]')}}
 if($detail.Length -gt 1800){$detail=$detail.Substring(0,1800)}
 $receipt.detail=$detail
 Write-Host ('Operacao interrompida na etapa '+$receipt.stage+'. Consulte o recibo; nao repita automaticamente.')
 Write-Host $detail
 try{
  $receipt.reconciliation=@(Invoke-Sql $stateSql $true)[0].state
  if($metadataAttempted -and $receipt.reconciliation.profile_tenant -eq $oldTenant -and $receipt.reconciliation.auth_tenant -eq $newTenant){
   $restoreUser=@{}
   foreach($key in $userPatch.Keys){$restoreUser[$key]=$null}
   foreach($property in $authBefore.user_metadata.PSObject.Properties){$restoreUser[$property.Name]=$property.Value}
   $null=Set-AuthMetadata @{role='OWNER';tenant_id=$oldTenant} $restoreUser
   $receipt.after_compensation=@(Invoke-Sql $stateSql $true)[0].state
   $receipt.auth_scope_restored=($receipt.after_compensation.auth_tenant -eq $oldTenant)
  }
 }catch{$receipt.reconciliation_unavailable=$true}
}finally{
 $sessionToken=if($login -and $login.access_token){$login.access_token}elseif($preLogin -and $preLogin.access_token){$preLogin.access_token}else{$null}
 if($sessionToken -and $publicKey){
  $scope=if($receipt.applied -or ($receipt.reconciliation -and $receipt.reconciliation.profile_tenant -eq $newTenant)){'global'}else{'local'}
  try{
   $null=Invoke-RestMethod -Method Post -Uri "$authApi/logout?scope=$scope" -Headers @{apikey=$publicKey;Authorization="Bearer $sessionToken"} -UserAgent $agentName -TimeoutSec 15
   $receipt.sessions_signout_scope=$scope
   $receipt.sessions_signout_confirmed=$true
  }catch{$receipt.sessions_signout_confirmed=$false}
 }
 New-Item -ItemType Directory -Path $resultDir -Force|Out-Null
 [IO.File]::WriteAllText($resultPath,($receipt|ConvertTo-Json -Depth 25),[Text.UTF8Encoding]::new($false))
 if($tokenPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)}
 if($passwordPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)}
 if($secureToken){$secureToken.Dispose()}
 if($securePassword){$securePassword.Dispose()}
 Remove-Variable token,currentPassword,serviceKey,publicKey,apiKeys,candidates,publicCandidates,candidate,authBefore,authUpdated,candidateUser,preLogin,login,sessionToken,sessionHeaders,managementHeaders,adminHeaders,backup,backupSecure,encryptedBackup,secureToken,securePassword -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
