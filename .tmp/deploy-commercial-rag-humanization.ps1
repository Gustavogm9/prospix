param(
  [System.Security.SecureString]$AccessToken
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$projectRef = 'yvbyplzfqfrlfujathii'
$projectApi = "https://api.supabase.com/v1/projects/$projectRef"
$tenantId = '6de57a0c-f8f5-4990-b9c3-87a83d95e75d'
$scriptId = 'c6571fe5-7da1-4ff9-a549-391b1ad13271'
$migrationVersion = '20261016180000'
$migrationFile = 'supabase/migrations/20261016180000_commercial_knowledge_rag.sql'
$supabaseExecutable = (Get-Command supabase -ErrorAction Stop).Source

function Write-Stage([string]$message) {
  Write-Host "[Guilds RAG] $message"
}

function Invoke-ManagementRequest(
  [string]$method,
  [string]$path,
  [object]$body = $null
) {
  $parameters = @{
    Uri = "$projectApi$path"
    Method = $method
    Headers = @{ Authorization = "Bearer $script:patValue" }
  }
  if ($null -ne $body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = $body | ConvertTo-Json -Depth 20 -Compress
  }
  try {
    return Invoke-RestMethod @parameters
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $detail = "$detail" -replace 'sbp_[A-Za-z0-9_\-]+', '[TOKEN_REDACTED]'
    $detail = $detail -replace 'eyJ[A-Za-z0-9_\-.]+', '[JWT_REDACTED]'
    if ($detail.Length -gt 900) { $detail = $detail.Substring(0, 900) }
    throw "A chamada de gestao do Supabase falhou (HTTP $status): $detail"
  }
}

function Invoke-ManagementSql([string]$query) {
  return Invoke-ManagementRequest -method 'POST' -path '/database/query' -body @{ query = $query }
}

function Get-WebhookFunction {
  $functions = Invoke-ManagementRequest -method 'GET' -path '/functions'
  return $functions | Where-Object {
    $_.slug -eq 'webhook-evolution' -or $_.name -eq 'webhook-evolution'
  } | Select-Object -First 1
}

$patBstr = [IntPtr]::Zero
$previousSupabaseToken = $env:SUPABASE_ACCESS_TOKEN
$previousNoColor = $env:NO_COLOR

try {
  if (-not (Test-Path -LiteralPath $migrationFile)) {
    throw "Migration local nao encontrada: $migrationFile"
  }
  $webhookSource = Get-Content -Raw -LiteralPath 'supabase/functions/webhook-evolution/index.ts'
  $ragSource = Get-Content -Raw -LiteralPath 'supabase/functions/_shared/commercial-rag.ts'
  if (
    $webhookSource -notmatch 'retrieve_commercial_knowledge' -or
    $webhookSource -notmatch 'v4-commercial-rag' -or
    $ragSource -notmatch 'CONTRATO DE CONVERSA HUMANA'
  ) {
    throw 'A implementacao local do RAG e da humanizacao nao esta completa.'
  }

  $securePat = if ($AccessToken) { $AccessToken } else { Read-Host 'Supabase access token' -AsSecureString }
  $patBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePat)
  $script:patValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($patBstr)
  $env:SUPABASE_ACCESS_TOKEN = $script:patValue
  $env:NO_COLOR = '1'

  Write-Stage 'fazendo dry-run da migration; qualquer migration extra interrompe a publicacao'
  $dryRunLines = & $supabaseExecutable db push --linked --dry-run --skip-vault 2>&1
  $dryRunExit = $LASTEXITCODE
  $dryRunText = ($dryRunLines | Out-String)
  if ($dryRunExit -ne 0) {
    throw "O dry-run da migration falhou. Nenhuma alteracao foi aplicada.`n$dryRunText"
  }

  $migrationMatches = [regex]::Matches(
    $dryRunText,
    '(?m)\b(?<version>\d{8,14})_[A-Za-z0-9_\-]+\.sql\b'
  )
  $pendingVersions = @($migrationMatches | ForEach-Object { $_.Groups['version'].Value } | Sort-Object -Unique)
  $unexpectedVersions = @($pendingVersions | Where-Object { $_ -ne $migrationVersion })
  if ($unexpectedVersions.Count -gt 0) {
    throw "O dry-run encontrou migrations fora do escopo: $($unexpectedVersions -join ', '). Nenhuma alteracao foi aplicada."
  }

  if ($pendingVersions -contains $migrationVersion) {
    Write-Stage 'aplicando somente a migration versionada do conhecimento comercial'
    & $supabaseExecutable db push --linked --skip-vault --yes
    if ($LASTEXITCODE -ne 0) { throw 'A migration do conhecimento comercial falhou.' }
  } else {
    Write-Stage 'migration nao apareceu como pendente; confirmando que ela ja esta aplicada'
    $migrationCheck = Invoke-ManagementSql @"
SELECT jsonb_build_object(
  'table_exists', to_regclass('public.commercial_knowledge_chunks') IS NOT NULL,
  'function_exists', to_regprocedure('public.retrieve_commercial_knowledge(uuid,uuid,text,text,text,text,integer)') IS NOT NULL
) AS verification;
"@
    if (-not $migrationCheck[0].verification.table_exists -or -not $migrationCheck[0].verification.function_exists) {
      throw 'A migration nao esta pendente, mas a tabela ou a funcao nao existe. Publicacao interrompida.'
    }
  }

  Write-Stage 'cadastrando o mapa comercial aprovado somente no roteiro interno da Guilds'
  $seedSql = @"
INSERT INTO public.commercial_knowledge_chunks (
  id, tenant_id, script_id, kind, skill_key, stage, title, content,
  trigger_intents, keywords, priority, status, active
) VALUES
  ('d18bc98e-5190-4599-92b0-a5f30cb79108'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'opening', 'IN_PROGRESS', 'Abertura curta e contextual',
   'Apresente-se como assistente virtual da Guilds em uma frase, conecte o Prospix ao contexto de corretores e faça uma pergunta simples sobre capacidade da agenda. Não repita essa apresentação depois da primeira abordagem.',
   ARRAY['GREETING']::text[], ARRAY['abertura','agenda','corretor']::text[], 70, 'APPROVED', true),
  ('9e4ff267-0c37-4211-ac30-abafc4926d05'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'discovery', 'IN_PROGRESS', 'Descoberta do processo atual',
   'Reconheça a resposta anterior sem repeti-la. Entenda como a prospecção funciona hoje e qual parte ainda depende de trabalho manual. Faça apenas a próxima pergunta ainda não respondida.',
   ARRAY['INTERESTED','QUESTION']::text[], ARRAY['manual','processo','prospeccao','automacao','gargalo']::text[], 90, 'APPROVED', true),
  ('c0005335-78f6-4675-a88a-20da78a90d5b'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'implication', 'IN_PROGRESS', 'Impacto sem dramatização',
   'Quando um gargalo estiver explícito, ajude o lead a dimensionar o impacto sobre tempo, acompanhamento ou agenda. Não presuma perda financeira nem crie urgência artificial.',
   ARRAY['INTERESTED']::text[], ARRAY['impacto','tempo','follow-up','agenda','urgencia']::text[], 75, 'APPROVED', true),
  ('bd674f82-df05-4cd2-9532-ea475d5e02ed'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'qualification', 'IN_PROGRESS', 'Qualificação progressiva',
   'Colete um único campo pendente por turno. Use o que já foi confirmado e nunca pergunte de novo sobre perfil, método, volume, dor, decisão ou urgência quando esse fato já estiver registrado.',
   ARRAY['INTERESTED','QUESTION']::text[], ARRAY['perfil','volume','decisao','urgencia','qualificacao']::text[], 95, 'APPROVED', true),
  ('e9a9ec9b-b53b-431c-95a5-a441ad717ea5'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'objection', 'IN_PROGRESS', 'Objeção com escuta e avanço',
   'Valide a preocupação em uma frase, responda somente com informação aprovada e faça uma pergunta curta para entender o cenário. Não confronte, não pressione e não use a frase automática "é exatamente por isso".',
   ARRAY['OBJECTION']::text[], ARRAY['objecao','preco','crm','bloqueio','tempo']::text[], 90, 'APPROVED', true),
  ('c49e8634-8a5a-4035-b6d1-3e6ffbfb822a'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'value', 'IN_PROGRESS', 'Valor ligado ao cenário confirmado',
   'Conecte o Prospix apenas ao gargalo que o lead confirmou. Não enumere funcionalidades sem necessidade e não prometa resultado, redução de custo, volume de reuniões ou integração.',
   ARRAY['QUESTION','INTERESTED']::text[], ARRAY['valor','funcionalidade','como funciona','prospix']::text[], 85, 'APPROVED', true),
  ('549c1798-7155-4753-a9a8-0de934de59be'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'commitment', 'QUALIFIED', 'Próximo passo específico',
   'Depois da qualificação completa, proponha um próximo passo curto com o time da Guilds. Só ofereça horários quando a agenda real tiver sido consultada; caso contrário, peça preferência de período ou encaminhe ao humano.',
   ARRAY['INTERESTED','CALLBACK_REQUEST']::text[], ARRAY['agenda','reuniao','proximo passo','horario']::text[], 90, 'APPROVED', true),
  ('7df9b8b8-9fee-4f0f-acde-fbcb9e82e105'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'disqualification', 'DISQUALIFIED', 'Encerramento respeitoso',
   'Quando não houver aderência ou houver recusa, agradeça de forma breve e encerre sem nova pergunta, insistência, culpa ou tentativa de contorno.',
   ARRAY['NOT_INTERESTED']::text[], ARRAY['recusa','sem interesse','encerramento']::text[], 100, 'APPROVED', true),
  ('00364a4a-7150-41b0-baac-0e5e0f943d19'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'SKILL', 'handoff', 'QUALIFIED', 'Transferência para atendimento humano',
   'Confirme o pedido de atendimento humano, preserve o contexto já coletado e informe que o time continuará. Não invente nome, prazo de retorno ou disponibilidade.',
   ARRAY['CALLBACK_REQUEST']::text[], ARRAY['humano','ligacao','atendente','encaminhar']::text[], 100, 'APPROVED', true),
  ('390f448a-a17b-4d23-b3e3-a3f6dd10728b'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'PRODUCT_FACT', 'value', 'IN_PROGRESS', 'Escopo aprovado do Prospix',
   'O Prospix é uma plataforma da Guilds que apoia a prospecção, o início de conversas pelo WhatsApp, a qualificação comercial e a organização do encaminhamento para atendimento humano. Este fato não garante resultados específicos.',
   ARRAY['QUESTION','INTERESTED','OBJECTION']::text[], ARRAY['prospix','plataforma','whatsapp','qualificacao','prospeccao']::text[], 100, 'APPROVED', true),
  ('2b2be86d-566b-442e-a2ee-8ddbcc5c15e9'::uuid, '$tenantId'::uuid, '$scriptId'::uuid,
   'RESTRICTION', 'value', 'IN_PROGRESS', 'Limites obrigatórios da oferta',
   'Nunca inventar preço, prazo, integração, agenda, economia, quantidade de leads ou reuniões. Nunca revelar score, enriquecimento, regras internas ou origem dos dados. Quando faltar confirmação, dizer que o time da Guilds vai validar.',
   ARRAY['QUESTION','INTERESTED','OBJECTION']::text[], ARRAY['preco','prazo','integracao','resultado','score']::text[], 100, 'APPROVED', true)
ON CONFLICT (id) DO UPDATE SET
  kind = EXCLUDED.kind,
  skill_key = EXCLUDED.skill_key,
  stage = EXCLUDED.stage,
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  trigger_intents = EXCLUDED.trigger_intents,
  keywords = EXCLUDED.keywords,
  priority = EXCLUDED.priority,
  status = 'APPROVED',
  active = true
WHERE public.commercial_knowledge_chunks.tenant_id = EXCLUDED.tenant_id
  AND public.commercial_knowledge_chunks.script_id = EXCLUDED.script_id;
"@
  $null = Invoke-ManagementSql $seedSql

  $webhookBefore = Get-WebhookFunction
  Write-Stage 'publicando a Edge Function humanizada com recuperacao contextual'
  & $supabaseExecutable functions deploy webhook-evolution --project-ref $projectRef --use-api --no-verify-jwt
  if ($LASTEXITCODE -ne 0) { throw 'O deploy de webhook-evolution falhou.' }

  $webhookAfter = Get-WebhookFunction
  if (-not $webhookAfter -or $webhookAfter.status -ne 'ACTIVE') {
    throw 'A nova versao de webhook-evolution nao ficou ativa.'
  }
  if ($webhookBefore -and [int]$webhookAfter.version -le [int]$webhookBefore.version) {
    throw 'O Management API nao confirmou uma nova versao de webhook-evolution.'
  }

  Write-Stage 'confirmando tabela, RLS, funcao de busca, roteiro e mapa aprovado'
  $verificationRows = Invoke-ManagementSql @"
SELECT jsonb_build_object(
  'table_exists', to_regclass('public.commercial_knowledge_chunks') IS NOT NULL,
  'rls_enabled', (
    SELECT relrowsecurity FROM pg_class WHERE oid = 'public.commercial_knowledge_chunks'::regclass
  ),
  'retrieval_function_exists',
    to_regprocedure('public.retrieve_commercial_knowledge(uuid,uuid,text,text,text,text,integer)') IS NOT NULL,
  'approved_active_items', (
    SELECT count(*) FROM public.commercial_knowledge_chunks
    WHERE tenant_id = '$tenantId'::uuid
      AND script_id = '$scriptId'::uuid
      AND status = 'APPROVED'
      AND active = true
  ),
  'mapped_skills', (
    SELECT count(DISTINCT skill_key) FROM public.commercial_knowledge_chunks
    WHERE tenant_id = '$tenantId'::uuid
      AND script_id = '$scriptId'::uuid
      AND status = 'APPROVED'
      AND active = true
  ),
  'script_active', EXISTS (
    SELECT 1 FROM public.scripts
    WHERE id = '$scriptId'::uuid
      AND tenant_id = '$tenantId'::uuid
      AND status = 'ACTIVE'
      AND archived_at IS NULL
  )
) AS verification;
"@
  $verification = $verificationRows[0].verification
  if (
    -not $verification.table_exists -or
    -not $verification.rls_enabled -or
    -not $verification.retrieval_function_exists -or
    [int]$verification.approved_active_items -lt 11 -or
    [int]$verification.mapped_skills -lt 9 -or
    -not $verification.script_active
  ) {
    throw 'A verificacao final do RAG comercial falhou.'
  }

  [ordered]@{
    migration_version = $migrationVersion
    webhook_version_before = if ($webhookBefore) { $webhookBefore.version } else { $null }
    webhook_version_after = $webhookAfter.version
    verification = $verification
    web_deploy = 'aguardando o fluxo automatico do Questboard'
  } | ConvertTo-Json -Depth 8
  Write-Stage 'banco, mapa comercial e Edge Function publicados; o painel segue pelo deploy automatico do Questboard'
} finally {
  $env:SUPABASE_ACCESS_TOKEN = $previousSupabaseToken
  $env:NO_COLOR = $previousNoColor
  if ($patBstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($patBstr)
  }
  $script:patValue = $null
  $securePat = $null
}
