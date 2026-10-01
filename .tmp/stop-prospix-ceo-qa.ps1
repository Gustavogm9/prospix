$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$campaignId = 'e11fce13-79a9-41f9-afc0-e341a5ad7759'
$qaLeadId = '1848688e-55e6-4093-a0a5-0e967452a398'

$patBstr = [IntPtr]::Zero
try {
  $securePat = Read-Host 'Supabase access token' -AsSecureString
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  $query = @"
DO `$qa`$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.campaigns
    WHERE id = '$campaignId'::uuid AND tenant_id = '$tenantId'::uuid
  ) THEN
    RAISE EXCEPTION 'QA_CAMPAIGN_NOT_FOUND';
  END IF;

  UPDATE public.campaigns
  SET status = 'PAUSED', discovery_auto_enabled = false,
      updated_at = statement_timestamp()
  WHERE id = '$campaignId'::uuid AND tenant_id = '$tenantId'::uuid;

  UPDATE public.campaign_qa_allowlist
  SET expires_at = statement_timestamp()
  WHERE campaign_id = '$campaignId'::uuid AND lead_id = '$qaLeadId'::uuid;

  UPDATE public.pending_outbound pending
  SET failed_at = statement_timestamp(), failed_reason = 'QA_WINDOW_CLOSED'
  FROM public.conversations conversation
  WHERE pending.conversation_id = conversation.id
    AND pending.tenant_id = '$tenantId'::uuid
    AND conversation.lead_id = '$qaLeadId'::uuid
    AND pending.sent_at IS NULL
    AND pending.failed_at IS NULL;
END
`$qa`$;

SELECT jsonb_build_object(
  'campaign_status', (SELECT status::text FROM public.campaigns WHERE id = '$campaignId'::uuid),
  'tenant_outbound_paused', (SELECT paused FROM public.tenant_ai_outbound_controls WHERE tenant_id = '$tenantId'::uuid),
  'open_qa_pending', (
    SELECT count(*)
    FROM public.pending_outbound pending
    JOIN public.conversations conversation ON conversation.id = pending.conversation_id
    WHERE pending.tenant_id = '$tenantId'::uuid
      AND conversation.lead_id = '$qaLeadId'::uuid
      AND pending.sent_at IS NULL
      AND pending.failed_at IS NULL
  )
) AS verification;
"@

  $result = Invoke-RestMethod -Uri "$projectApi/database/query" -Method 'POST' -Headers @{
    Authorization = "Bearer $patValue"
  } -ContentType 'application/json' -Body (@{ query = $query } | ConvertTo-Json -Compress)

  $verification = @($result)[-1].verification
  if (
    $verification.campaign_status -ne 'PAUSED' -or
    -not $verification.tenant_outbound_paused -or
    [int]$verification.open_qa_pending -ne 0
  ) {
    throw 'O fechamento da janela QA nao passou na verificacao final.'
  }

  Write-Host '[Prospix QA] Janela encerrada: campanha pausada, allowlist expirada e fila QA fechada.'
} finally {
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $patValue = $null
  $securePat = $null
}
