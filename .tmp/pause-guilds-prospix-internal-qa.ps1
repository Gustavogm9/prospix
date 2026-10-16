param([System.Security.SecureString]$AccessToken)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$campaignId = '97d1633f-0d9e-4fa6-8089-f0a38d11e4ad'
$conversationId = '4da0acfa-8299-488c-a9ef-f58788d0b65c'
$idempotencyKey = 'qa-guilds-prospix-internal-20261016-v1'

$patBstr = [IntPtr]::Zero
try {
  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  $query = @"
BEGIN;
UPDATE public.campaigns
SET status = 'PAUSED', discovery_auto_enabled = false, updated_at = statement_timestamp()
WHERE id = '$campaignId'::uuid AND tenant_id = '$tenantId'::uuid;

UPDATE public.campaign_qa_allowlist
SET expires_at = statement_timestamp()
WHERE campaign_id = '$campaignId'::uuid;

UPDATE public.conversations
SET status = 'CLOSED', ai_handling = false,
    closed_at = COALESCE(closed_at, statement_timestamp())
WHERE id = '$conversationId'::uuid AND tenant_id = '$tenantId'::uuid;

UPDATE public.pending_outbound
SET failed_at = statement_timestamp(), failed_reason = 'QA_INTERNAL_PAUSED_BY_OPERATOR'
WHERE tenant_id = '$tenantId'::uuid
  AND idempotency_key = '$idempotencyKey'
  AND sent_at IS NULL AND failed_at IS NULL;
COMMIT;

SELECT jsonb_build_object(
  'campaign_status', (SELECT status::text FROM public.campaigns WHERE id = '$campaignId'::uuid),
  'allowlist_active', EXISTS (SELECT 1 FROM public.campaign_qa_allowlist WHERE campaign_id = '$campaignId'::uuid AND expires_at > statement_timestamp()),
  'conversation_active', EXISTS (SELECT 1 FROM public.conversations WHERE id = '$conversationId'::uuid AND status IN ('ACTIVE','PAUSED')),
  'open_pending', EXISTS (SELECT 1 FROM public.pending_outbound WHERE idempotency_key = '$idempotencyKey' AND sent_at IS NULL AND failed_at IS NULL)
) AS verification;
"@

  $response = Invoke-RestMethod -Uri "$projectApi/database/query" -Method Post -Headers @{
    Authorization = "Bearer $patValue"
  } -ContentType 'application/json' -Body (@{ query = $query } | ConvertTo-Json -Compress)

  $verification = $response[0].verification
  $verification | ConvertTo-Json -Depth 6
  if (
    $verification.campaign_status -ne 'PAUSED' -or
    $verification.allowlist_active -or
    $verification.conversation_active -or
    $verification.open_pending
  ) {
    throw 'A pausa segura do teste interno nao foi confirmada.'
  }
  Write-Host '[Guilds QA] campanha interna pausada; nenhum registro foi apagado.'
} finally {
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $securePat = $null
  $patValue = $null
}
