param([switch]$Apply)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$projectRef='yvbyplzfqfrlfujathii'
$organizationId='ptzmchfxjlzenbtiodbb'
$repoRoot=Split-Path -Parent $PSScriptRoot
$resultDir=Join-Path $repoRoot '.local/client-access-2026-11-24'
$resultPath=Join-Path $resultDir 'grant-result-v4.json'
$bstr=[IntPtr]::Zero
$metadataAttempted=$false
$authId='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'
$tenantId='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$receipt=[ordered]@{checked_at_utc=[DateTimeOffset]::UtcNow.ToString('o');applied=$false;apply_requested=[bool]$Apply;stage='preflight'}
function Invoke-Sql([string]$query,[bool]$readOnly) {
 $body=@{query=$query;read_only=$readOnly}|ConvertTo-Json -Compress
 return @(Invoke-RestMethod -Method Post -Uri "$script:projectApi/database/query" -Headers $script:headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)))
}
function Set-AuthScope($roleValue,$tenantValue) {
 $body=@{app_metadata=@{role=$roleValue;tenant_id=$tenantValue}}|ConvertTo-Json -Compress
 return Invoke-RestMethod -Method Put -Uri "$script:authApi/admin/users/$script:authId" -Headers $script:serviceHeaders -UserAgent 'Prospix-Authorized-Account-Operation/1.0' -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
}
$verificationQuery=@'
SELECT jsonb_build_object('profile_count',(SELECT count(*) FROM public.users u WHERE lower(u.email)='gustavo.macedo@guilds.com.br'),
 'desired_profile_count',(SELECT count(*) FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email) WHERE u.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid AND lower(u.email)='gustavo.macedo@guilds.com.br' AND u.tenant_id='6de57a0c-f8f5-4990-b9c3-87a83d95e75d'::uuid AND u.role::text='OWNER' AND u.deleted_at IS NULL),
 'old_profile_count',(SELECT count(*) FROM public.users u WHERE u.id='99999999-9999-9999-9999-999999999999'::uuid),
 'other_admin_count',(SELECT count(*) FROM public.users u JOIN auth.users a ON a.id=u.id AND lower(a.email)=lower(u.email) WHERE u.id NOT IN ('99999999-9999-9999-9999-999999999999'::uuid,'2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid) AND u.role::text='GUILDS_ADMIN' AND u.tenant_id IS NULL AND u.deleted_at IS NULL),
 'auth_role',(SELECT a.raw_app_meta_data->>'role' FROM auth.users a WHERE a.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid),
 'auth_tenant',(SELECT a.raw_app_meta_data->>'tenant_id' FROM auth.users a WHERE a.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid)) AS state;
'@
$claimsGuard=@'
DO $claims$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id='2f2b1e54-6b03-4a40-aba3-7333d5e8a9c9'::uuid
 AND lower(a.email)='gustavo.macedo@guilds.com.br' AND a.raw_app_meta_data->>'role'='OWNER'
 AND a.raw_app_meta_data->>'tenant_id'='6de57a0c-f8f5-4990-b9c3-87a83d95e75d')
 THEN RAISE EXCEPTION 'AUTH_METADATA_NOT_ALIGNED'; END IF;
END;
$claims$;
'@
try {
 if((Get-Content -Raw (Join-Path $repoRoot 'supabase/.temp/project-ref')).Trim() -ne $projectRef){throw 'PROJECT_LINK_MISMATCH'}
 $secureToken=Read-Host 'Supabase Prospix access token' -AsSecureString
 $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
 $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
 $script:headers=@{Authorization="Bearer $token"}
 $script:projectApi="https://api.supabase.com/v1/projects/$projectRef"
 $project=Invoke-RestMethod -Method Get -Uri $projectApi -Headers $headers
 if($project.id -ne $projectRef -or $project.organization_id -ne $organizationId -or $project.name -notmatch '(?i)prospix'){throw 'PROJECT_IDENTITY_MISMATCH'}
 $receipt.before=(Invoke-Sql $verificationQuery $true)[0].state
 if($receipt.before.profile_count -ne 1 -or $receipt.before.other_admin_count -lt 1){throw 'PROFILE_OR_ADMIN_SCOPE_CHANGED'}
 $sql=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '2026-11-24-grant-client-access.sql'))
 $receipt.stage='rollback_rehearsal'
 $preview=@(Invoke-Sql $sql $false)
 $receipt.preview=@($preview|Where-Object {$_.verification})
 $receipt.after_rollback=(Invoke-Sql $verificationQuery $true)[0].state
 if(($receipt.before|ConvertTo-Json -Compress) -ne ($receipt.after_rollback|ConvertTo-Json -Compress)){throw 'ROLLBACK_STATE_MISMATCH'}
 if($receipt.preview.Count -ne 1 -or -not $receipt.preview[0].verification.matched_identity_profile){throw 'PREVIEW_VERIFICATION_FAILED'}
 if($Apply){
  $receipt.stage='auth_metadata_preflight'
  $apiKeys=Invoke-RestMethod -Method Get -Uri "$projectApi/api-keys?reveal=true" -Headers $headers
  $candidates=@($apiKeys | Where-Object { $_.api_key -and (([string]$_.api_key).StartsWith('sb_secret_') -or ($_.name -eq 'service_role' -and ([string]$_.api_key).StartsWith('eyJ'))) } | Sort-Object @{Expression={if(([string]$_.api_key).StartsWith('sb_secret_')){0}else{1}}} | Select-Object -First 3)
  if($candidates.Count -eq 0){throw 'NO_EXISTING_ADMIN_KEY_AVAILABLE'}
  $receipt.key_checks=@()
  $script:authApi="https://$projectRef.supabase.co/auth/v1"
  $authCurrent=$null
  foreach($candidate in $candidates){
   if($candidate.api_key -isnot [string]){throw 'ADMIN_KEY_MUST_BE_SINGLE_STRING'}
   $serviceKey=([string]$candidate.api_key).Trim()
   if($serviceKey -match '\s'){throw 'ADMIN_KEY_CONTAINS_WHITESPACE'}
   if($serviceKey.StartsWith('eyJ')){
    $parts=$serviceKey.Split('.')
    if($parts.Count -ne 3){throw 'ADMIN_JWT_FORMAT_INVALID'}
    $encoded=$parts[1].Replace('-','+').Replace('_','/')
    $encoded=$encoded.PadRight($encoded.Length+(4-$encoded.Length%4)%4,'=')
    $keyClaims=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))|ConvertFrom-Json
    if($keyClaims.role -ne 'service_role' -or $keyClaims.ref -ne $projectRef){throw 'ADMIN_KEY_SCOPE_MISMATCH'}
   }
   $isSecret=$serviceKey.StartsWith('sb_secret_')
   $script:serviceHeaders=@{apikey=$serviceKey}
   if(-not $isSecret){$script:serviceHeaders.Authorization="Bearer $serviceKey"}
   $keyCheck=[ordered]@{format=$(if($isSecret){'secret'}else{'legacy_jwt'});accepted=$false}
   try {
    $candidateUser=Invoke-RestMethod -Method Get -Uri "$authApi/admin/users/$authId" -Headers $serviceHeaders -UserAgent 'Prospix-Authorized-Account-Operation/1.0'
    if($candidateUser.id -ne $authId){throw 'AUTH_RESPONSE_ID_MISMATCH'}
    $authCurrent=$candidateUser
    $keyCheck.accepted=$true
   } catch {
    $keyCheck.http_status=if($_.Exception.Response){[int]$_.Exception.Response.StatusCode}else{0}
   }
   $receipt.key_checks+=[PSCustomObject]$keyCheck
   if($authCurrent){break}
  }
  if(-not $authCurrent){throw 'NO_CURRENT_AUTH_ADMIN_KEY_ACCEPTED'}
  if($authCurrent.id -ne $authId -or $authCurrent.email.ToLowerInvariant() -ne 'gustavo.macedo@guilds.com.br'){throw 'AUTH_IDENTITY_CHANGED'}
  if($authCurrent.app_metadata.role -ne $receipt.before.auth_role -or $authCurrent.app_metadata.tenant_id -ne $receipt.before.auth_tenant){throw 'AUTH_SCOPE_CHANGED'}
  $receipt.stage='auth_metadata_update'
  $metadataAttempted=$true
  $authUpdated=Set-AuthScope 'OWNER' $tenantId
  if($authUpdated.id -ne $authId -or $authUpdated.app_metadata.role -ne 'OWNER' -or $authUpdated.app_metadata.tenant_id -ne $tenantId){throw 'AUTH_SCOPE_UPDATE_NOT_CONFIRMED'}
  $receipt.auth_scope_updated=$true
  $receipt.stage='commit_sent'
  $applySql=[regex]::Replace($sql,'ROLLBACK;\s*$','COMMIT;')
  if($applySql -eq $sql){throw 'APPLY_TRANSACTION_INVALID'}
  $nl=[string][char]10
  $applySql=$applySql.Replace(('BEGIN;'+$nl+'SET LOCAL lock_timeout'),('BEGIN;'+$nl+$claimsGuard+$nl+'SET LOCAL lock_timeout'))
  if($applySql -notmatch 'AUTH_METADATA_NOT_ALIGNED'){throw 'CLAIMS_GUARD_MISSING'}
  $receipt.application=@(Invoke-Sql $applySql $false|Where-Object {$_.verification})
  $receipt.stage='verification'
  $receipt.after=(Invoke-Sql $verificationQuery $true)[0].state
  if($receipt.after.desired_profile_count -ne 1 -or $receipt.after.old_profile_count -ne 0 -or $receipt.after.profile_count -ne 1 -or $receipt.after.other_admin_count -ne $receipt.before.other_admin_count -or $receipt.after.auth_role -ne 'OWNER' -or $receipt.after.auth_tenant -ne $tenantId){throw 'FINAL_STATE_MISMATCH_DO_NOT_REPEAT'}
  $receipt.applied=$true
  Write-Host 'Acesso de cliente liberado e verificado: OWNER da Corretora de Teste.'
  Write-Host 'Identidade e perfil alinhados. Senha atual preservada.'
  Write-Host 'Saia da sessao antiga e entre em https://www.prospix.com.br/login com o mesmo e-mail e senha.'
 } else {Write-Host 'Ensaio concluido e revertido. Nenhuma alteracao persistida.'}
 $receipt.stage='completed'
} catch {
 $receipt.error=$true
 $detail=if($_.ErrorDetails.Message){$_.ErrorDetails.Message}else{$_.Exception.Message}
 $detail=$detail -replace 'sbp_[A-Za-z0-9_-]+','[TOKEN]'
 if($serviceKey){$detail=$detail.Replace($serviceKey,'[SECRET]')}
 if($detail.Length -gt 1800){$detail=$detail.Substring(0,1800)}
 $receipt.detail=$detail
 Write-Host 'Operacao interrompida. Nao repita sem conferir o recibo.'
 Write-Host $detail
 try {
  $receipt.reconciliation=(Invoke-Sql $verificationQuery $true)[0].state
  if($metadataAttempted -and $receipt.reconciliation.old_profile_count -eq 1 -and $receipt.reconciliation.desired_profile_count -eq 0 -and $receipt.reconciliation.auth_role -eq 'OWNER' -and $receipt.reconciliation.auth_tenant -eq $tenantId){
   $null=Set-AuthScope $receipt.before.auth_role $receipt.before.auth_tenant
   $receipt.after_compensation=(Invoke-Sql $verificationQuery $true)[0].state
   $receipt.auth_scope_restored=($receipt.after_compensation.auth_role -eq $receipt.before.auth_role -and $receipt.after_compensation.auth_tenant -eq $receipt.before.auth_tenant)
  }
 } catch {$receipt.reconciliation_unavailable=$true}
} finally {
 New-Item -ItemType Directory -Path $resultDir -Force|Out-Null
 [IO.File]::WriteAllText($resultPath,($receipt|ConvertTo-Json -Depth 25),[Text.UTF8Encoding]::new($false))
 if($bstr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
 Remove-Variable token,secureToken,headers,serviceKey,serviceHeaders,apiKeys,serviceKeys,authCurrent,authUpdated,candidates,candidate,candidateUser,keyClaims,parts,encoded -ErrorAction SilentlyContinue
}
Read-Host 'Pressione Enter para fechar'
