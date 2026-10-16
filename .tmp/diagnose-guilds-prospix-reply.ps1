param(
  [System.Security.SecureString]$AccessToken
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$conversationId = '4da0acfa-8299-488c-a9ef-f58788d0b65c'

function Invoke-ManagementSql([string]$query) {
  try {
    return Invoke-RestMethod -Uri "$projectApi/database/query" -Method 'POST' -Headers @{
      Authorization = "Bearer $script:patValue"
    } -ContentType 'application/json' -Body (@{ query = $query } | ConvertTo-Json -Compress)
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN_REDACTED]'
    $detail = $detail -replace 'eyJ[A-Za-z0-9_\-.]+', '[JWT_REDACTED]'
    if ($detail.Length -gt 900) { $detail = $detail.Substring(0, 900) }
    throw "A consulta de diagnostico falhou (HTTP $status): $detail"
  }
}

$patBstr = [IntPtr]::Zero
try {
  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)

  Write-Host '[Guilds QA] consultando webhook, conversa, fila e worker (somente leitura)'
  $sql = @"
SELECT jsonb_build_object(
  'server_now_brt', to_char(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS'),
  'conversation', (
    SELECT jsonb_build_object(
      'status', status,
      'ai_handling', ai_handling,
      'last_inbound_at', last_inbound_at,
      'last_message_at', last_message_at,
      'message_count', message_count
    )
    FROM public.conversations
    WHERE id = '$conversationId'::uuid AND tenant_id = '$tenantId'::uuid
  ),
  'message_timeline', (
    SELECT jsonb_build_object(
      'inbound_count', count(*) FILTER (WHERE direction = 'INBOUND'),
      'outbound_count', count(*) FILTER (WHERE direction = 'OUTBOUND'),
      'latest_inbound_at', max(created_at) FILTER (WHERE direction = 'INBOUND'),
      'latest_outbound_at', max(created_at) FILTER (WHERE direction = 'OUTBOUND'),
      'latest_inbound_has_provider_id', COALESCE(bool_or(whatsapp_message_id IS NOT NULL) FILTER (WHERE direction = 'INBOUND'), false)
    )
    FROM public.messages
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND created_at >= '2026-10-16 15:00:00-03'::timestamptz
  ),
  'latest_evolution_webhook', (
    SELECT jsonb_build_object(
      'status', status,
      'event_name', event_name,
      'instance_name', instance_name,
      'from_me', from_me,
      'tenant_matched', tenant_id = '$tenantId'::uuid,
      'conversation_matched', conversation_id = '$conversationId'::uuid,
      'skip_reason', skip_reason,
      'error_message', left(COALESCE(error_message, ''), 300),
      'accepted_at', accepted_at,
      'processed_at', processed_at,
      'failed_at', failed_at,
      'attempts', attempts
    )
    FROM public.evolution_webhook_processing_events
    WHERE instance_name = 'guilds'
      AND accepted_at >= '2026-10-16 15:00:00-03'::timestamptz
    ORDER BY accepted_at DESC
    LIMIT 1
  ),
  'webhook_health', (
    SELECT to_jsonb(health) FROM public.evolution_webhook_operational_health health
  ),
  'reactive_queue', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'message_type', message_type,
      'created_at', created_at,
      'scheduled_for', scheduled_for,
      'sent_at', sent_at,
      'failed_at', failed_at,
      'failed_reason', failed_reason,
      'attempts', attempts,
      'validation_status', validation_status,
      'validation_reason_code', validation_reason_code,
      'final_guardian_decision', final_guardian_decision,
      'processing_started_at', processing_started_at,
      'processing_expires_at', processing_expires_at
    ) ORDER BY created_at DESC), '[]'::jsonb)
    FROM public.pending_outbound
    WHERE tenant_id = '$tenantId'::uuid
      AND conversation_id = '$conversationId'::uuid
      AND message_type IN ('REACTIVE_REPLY', 'CHAT_CONTINUATION', 'LOOKUP_REPLY')
      AND created_at >= '2026-10-16 15:00:00-03'::timestamptz
  ),
  'recent_events', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'event_type', event_type,
      'created_at', created_at,
      'reason_code', payload->>'reason_code',
      'action', payload->>'action',
      'scheduled_for', payload->>'scheduled_for'
    ) ORDER BY created_at DESC), '[]'::jsonb)
    FROM (
      SELECT event_type, created_at, payload
      FROM public.lead_events
      WHERE tenant_id = '$tenantId'::uuid
        AND payload->>'conversation_id' = '$conversationId'
        AND created_at >= '2026-10-16 15:00:00-03'::timestamptz
      ORDER BY created_at DESC
      LIMIT 20
    ) events
  ),
  'worker_schedule', (
    SELECT jsonb_build_object('schedule', schedule, 'active', active)
    FROM cron.job
    WHERE jobname = 'send-messages'
    ORDER BY jobid DESC
    LIMIT 1
  ),
  'worker_last_runs', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'status', status,
      'start_time', start_time,
      'end_time', end_time,
      'return_message', left(COALESCE(return_message, ''), 250)
    ) ORDER BY start_time DESC), '[]'::jsonb)
    FROM (
      SELECT details.status, details.start_time, details.end_time, details.return_message
      FROM cron.job_run_details details
      JOIN cron.job job ON job.jobid = details.jobid
      WHERE job.jobname = 'send-messages'
      ORDER BY details.start_time DESC
      LIMIT 5
    ) runs
  )
) AS diagnosis;
"@

  $result = Invoke-ManagementSql $sql
  if (-not $result -or -not $result[0].diagnosis) {
    throw 'O banco nao retornou o diagnostico esperado.'
  }
  $result[0].diagnosis | ConvertTo-Json -Depth 12
} finally {
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $script:patValue = $null
  $securePat = $null
}
