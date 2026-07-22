import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, supabaseAdmin } from '../../_lib/auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(['OFF', 'OBSERVE', 'WARN', 'BLOCK', 'HARD_BLOCK']);
const FAIL_POLICIES = new Set(['FAIL_OPEN', 'FAIL_CLOSED', 'USE_LAST_KNOWN_GOOD_CONFIG']);

type GuardianVersion = {
  id: string;
  tenant_id: string;
  version_number: number;
  status: 'DRAFT' | 'ACTIVE' | 'ROLLED_BACK' | 'ARCHIVED';
  config_hash: string;
  created_at: string;
  activated_at: string | null;
  notes: string | null;
};

type GuardianVariableDefinition = {
  guardian_key: string;
  variable_key: string;
  label: string;
  description: string;
  value_type: string;
  default_value: unknown;
  min_value: number | null;
  max_value: number | null;
  allowed_values: unknown[] | null;
  validation_regex: string | null;
  unit: string | null;
  is_required: boolean;
  is_sensitive: boolean;
  requires_confirmation: boolean;
  requires_owner: boolean;
};

function errorResponse(message: string, status = 400, code = 'VALIDATION') {
  return NextResponse.json({ ok: false, error: code, message }, { status });
}

function assertUuid(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw new Error(`${label}_INVALID`);
  return id;
}

function cleanReason(value: unknown): string {
  return String(value || '').trim();
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function hashConfig(config: any): string {
  const minimal = {
    tenant_id: config?.tenant_id || null,
    guardians: (config?.guardians || []).map((guardian: any) => ({
      guardian_key: guardian.guardian_key,
      enabled: guardian.enabled,
      mode: guardian.mode,
      fail_policy: guardian.fail_policy,
      sort_order: guardian.sort_order,
      variables: (guardian.variables || []).map((variable: any) => ({
        variable_key: variable.variable_key,
        value: variable.value,
      })),
    })),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(stable(minimal))).digest('hex')}`;
}

function normalizeJsonValue(value: unknown, definition: GuardianVariableDefinition): unknown {
  if (definition.value_type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('Valor deve ser ligado/desligado.');
    return value;
  }

  if (definition.value_type === 'integer' || definition.value_type === 'duration_seconds') {
    const numberValue = Number(value);
    if (!Number.isInteger(numberValue)) throw new Error('Valor deve ser um numero inteiro.');
    validateNumericRange(numberValue, definition);
    return numberValue;
  }

  if (definition.value_type === 'decimal') {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error('Valor deve ser numerico.');
    validateNumericRange(numberValue, definition);
    return numberValue;
  }

  if (definition.value_type === 'string_array') {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error('Valor deve ser uma lista de textos.');
    }
    return value;
  }

  if (definition.value_type === 'json') {
    if (value === undefined) throw new Error('Valor JSON ausente.');
    return value;
  }

  const text = String(value ?? '').trim();
  if (definition.is_required && !text) throw new Error('Valor obrigatorio.');

  if (definition.allowed_values && Array.isArray(definition.allowed_values) && definition.allowed_values.length > 0) {
    const allowed = definition.allowed_values.map((item) => String(item));
    if (!allowed.includes(text)) {
      throw new Error(`Valor permitido: ${allowed.join(', ')}.`);
    }
  }

  if (definition.validation_regex) {
    const regex = new RegExp(definition.validation_regex);
    if (!regex.test(text)) throw new Error('Valor nao atende ao formato esperado.');
  }

  return text;
}

function validateNumericRange(value: number, definition: GuardianVariableDefinition) {
  if (definition.min_value !== null && value < Number(definition.min_value)) {
    throw new Error(`Valor minimo: ${definition.min_value}.`);
  }
  if (definition.max_value !== null && value > Number(definition.max_value)) {
    throw new Error(`Valor maximo: ${definition.max_value}.`);
  }
}

async function audit(params: {
  tenantId: string;
  actorUserId: string;
  action: string;
  guardianKey?: string | null;
  variableKey?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  configVersionId?: string | null;
  reason?: string | null;
  request: NextRequest;
}) {
  await supabaseAdmin.from('guardian_admin_audit_log').insert({
    tenant_id: params.tenantId,
    actor_user_id: params.actorUserId,
    action: params.action,
    guardian_key: params.guardianKey || null,
    variable_key: params.variableKey || null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    config_version_id: params.configVersionId || null,
    reason: params.reason || null,
    ip_address: params.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: params.request.headers.get('user-agent') || null,
  });
}

async function loadTenants() {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, name, slug, status')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function loadVersions(tenantId: string): Promise<GuardianVersion[]> {
  const { data, error } = await supabaseAdmin
    .from('guardian_config_versions')
    .select('id, tenant_id, version_number, status, config_hash, created_at, activated_at, notes')
    .eq('tenant_id', tenantId)
    .order('version_number', { ascending: false });

  if (error) throw error;
  return (data || []) as GuardianVersion[];
}

async function loadDefinitions() {
  const [guardianDefs, variableDefs] = await Promise.all([
    supabaseAdmin
      .from('guardian_definitions')
      .select('guardian_key, name, description, layer, execution_stage, function_scope, is_system_critical, sort_order')
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('guardian_variable_definitions')
      .select('guardian_key, variable_key, label, description, value_type, default_value, min_value, max_value, allowed_values, validation_regex, unit, is_required, is_sensitive, requires_confirmation, requires_owner')
      .order('guardian_key', { ascending: true })
      .order('variable_key', { ascending: true }),
  ]);

  if (guardianDefs.error) throw guardianDefs.error;
  if (variableDefs.error) throw variableDefs.error;
  return {
    guardianByKey: new Map((guardianDefs.data || []).map((definition: any) => [definition.guardian_key, definition])),
    variableByKey: new Map((variableDefs.data || []).map((definition: any) => [`${definition.guardian_key}.${definition.variable_key}`, definition as GuardianVariableDefinition])),
  };
}

async function loadConfigByVersion(tenantId: string, version: GuardianVersion | null) {
  if (!version) return null;

  const [{ guardianByKey, variableByKey }, settingsResult, valuesResult] = await Promise.all([
    loadDefinitions(),
    supabaseAdmin
      .from('tenant_guardian_settings')
      .select('guardian_key, enabled, mode, fail_policy, sort_order')
      .eq('tenant_id', tenantId)
      .eq('config_version_id', version.id)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('tenant_guardian_variable_values')
      .select('guardian_key, variable_key, value')
      .eq('tenant_id', tenantId)
      .eq('config_version_id', version.id)
      .order('guardian_key', { ascending: true })
      .order('variable_key', { ascending: true }),
  ]);

  if (settingsResult.error) throw settingsResult.error;
  if (valuesResult.error) throw valuesResult.error;

  const valuesByGuardian = new Map<string, any[]>();
  for (const value of valuesResult.data || []) {
    const list = valuesByGuardian.get(value.guardian_key) || [];
    list.push(value);
    valuesByGuardian.set(value.guardian_key, list);
  }

  const guardians = (settingsResult.data || []).map((setting: any) => {
    const definition: any = guardianByKey.get(setting.guardian_key) || {};
    const variables = (valuesByGuardian.get(setting.guardian_key) || []).map((value) => {
      const variableDefinition = variableByKey.get(`${value.guardian_key}.${value.variable_key}`) as GuardianVariableDefinition | undefined;
      return {
        variable_key: value.variable_key,
        label: variableDefinition?.label || value.variable_key,
        description: variableDefinition?.description || '',
        value_type: variableDefinition?.value_type || 'json',
        value: value.value,
        default_value: variableDefinition?.default_value ?? null,
        min_value: variableDefinition?.min_value ?? null,
        max_value: variableDefinition?.max_value ?? null,
        allowed_values: variableDefinition?.allowed_values ?? null,
        validation_regex: variableDefinition?.validation_regex ?? null,
        unit: variableDefinition?.unit ?? null,
        is_required: variableDefinition?.is_required ?? true,
        is_sensitive: variableDefinition?.is_sensitive ?? false,
        requires_confirmation: variableDefinition?.requires_confirmation ?? false,
        requires_owner: variableDefinition?.requires_owner ?? false,
      };
    });

    return {
      guardian_key: setting.guardian_key,
      name: definition.name || setting.guardian_key,
      description: definition.description || '',
      layer: definition.layer || null,
      execution_stage: definition.execution_stage || null,
      function_scope: definition.function_scope || null,
      enabled: setting.enabled,
      mode: setting.mode,
      fail_policy: setting.fail_policy,
      is_system_critical: Boolean(definition.is_system_critical),
      sort_order: setting.sort_order,
      variables,
    };
  });

  return {
    tenant_id: tenantId,
    active_version: version.status === 'ACTIVE'
      ? {
          id: version.id,
          version_number: version.version_number,
          config_hash: version.config_hash,
          activated_at: version.activated_at,
        }
      : null,
    draft_version: version.status === 'DRAFT'
      ? {
          id: version.id,
          version_number: version.version_number,
          config_hash: version.config_hash,
          created_at: version.created_at,
        }
      : null,
    status: version.status,
    version,
    guardians,
  };
}

async function loadLatestSimulation(tenantId: string, configVersionId: string | null) {
  if (!configVersionId) return null;
  const { data, error } = await supabaseAdmin
    .from('guardian_simulation_runs')
    .select('id, passed, input_payload, result_payload, created_at')
    .eq('tenant_id', tenantId)
    .eq('config_version_id', configVersionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function loadRecentAudit(tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('guardian_admin_audit_log')
    .select('id, action, guardian_key, variable_key, old_value, new_value, reason, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw error;
  return data || [];
}

async function loadDashboard(tenantIdFromQuery: string | null) {
  const tenants = await loadTenants();
  const tenantId = tenantIdFromQuery && UUID_RE.test(tenantIdFromQuery)
    ? tenantIdFromQuery
    : tenants[0]?.id;

  if (!tenantId) throw new Error('TENANT_NOT_FOUND');

  const tenant = tenants.find((item: any) => item.id === tenantId);
  if (!tenant) throw new Error('TENANT_NOT_FOUND');

  const versions = await loadVersions(tenantId);
  const activeVersion = versions.find((version) => version.status === 'ACTIVE') || null;
  const draftVersion = versions.find((version) => version.status === 'DRAFT') || null;
  const [activeConfig, draftConfig, latestSimulation, auditLog] = await Promise.all([
    loadConfigByVersion(tenantId, activeVersion),
    loadConfigByVersion(tenantId, draftVersion),
    loadLatestSimulation(tenantId, draftVersion?.id || null),
    loadRecentAudit(tenantId),
  ]);

  return {
    ok: true,
    data: {
      tenants,
      tenant,
      config: activeConfig,
      activeConfig,
      draftConfig,
      versions,
      latestSimulation,
      auditLog,
    },
  };
}

async function refreshDraftHash(tenantId: string, configVersionId: string) {
  const versions = await loadVersions(tenantId);
  const draft = versions.find((version) => version.id === configVersionId && version.status === 'DRAFT');
  if (!draft) return null;

  const config = await loadConfigByVersion(tenantId, draft);
  const configHash = hashConfig(config);
  const { error } = await supabaseAdmin
    .from('guardian_config_versions')
    .update({ config_hash: configHash })
    .eq('id', configVersionId)
    .eq('tenant_id', tenantId)
    .eq('status', 'DRAFT');

  if (error) throw error;
  return configHash;
}

async function getDraftVersion(tenantId: string): Promise<GuardianVersion> {
  const versions = await loadVersions(tenantId);
  const draft = versions.find((version) => version.status === 'DRAFT');
  if (!draft) throw new Error('DRAFT_NOT_FOUND');
  return draft;
}

async function validateDraftConfig(tenantId: string, configVersionId: string, actorUserId: string, request: NextRequest) {
  const versions = await loadVersions(tenantId);
  const draft = versions.find((version) => version.id === configVersionId && version.status === 'DRAFT');
  if (!draft) throw new Error('DRAFT_NOT_FOUND');

  const config = await loadConfigByVersion(tenantId, draft);
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];

  if (!config?.guardians?.length) {
    errors.push('Nenhum guardiao encontrado no rascunho.');
  } else {
    checks.push(`${config.guardians.length} guardioes carregados.`);
  }

  for (const guardian of config?.guardians || []) {
    if (guardian.is_system_critical && (!guardian.enabled || guardian.mode === 'OFF')) {
      errors.push(`${guardian.name} e critico e nao pode ficar desligado em uma publicacao comum.`);
    }
    if (!MODES.has(guardian.mode)) errors.push(`${guardian.name}: modo invalido.`);
    if (!FAIL_POLICIES.has(guardian.fail_policy)) errors.push(`${guardian.name}: politica de falha invalida.`);

    for (const variable of guardian.variables || []) {
      try {
        normalizeJsonValue(variable.value, {
          guardian_key: guardian.guardian_key,
          variable_key: variable.variable_key,
          label: variable.label,
          description: variable.description,
          value_type: variable.value_type,
          default_value: variable.default_value,
          min_value: variable.min_value,
          max_value: variable.max_value,
          allowed_values: variable.allowed_values,
          validation_regex: variable.validation_regex,
          unit: variable.unit,
          is_required: variable.is_required,
          is_sensitive: variable.is_sensitive,
          requires_confirmation: variable.requires_confirmation,
          requires_owner: variable.requires_owner,
        });
      } catch (err: any) {
        errors.push(`${guardian.name} / ${variable.label}: ${err.message || 'valor invalido'}`);
      }
    }
  }

  if ((config?.guardians || []).some((guardian: any) => guardian.mode === 'OBSERVE')) {
    warnings.push('Existem guardioes em observacao: eles registram evidencia, mas nao bloqueiam o fluxo.');
  }

  const passed = errors.length === 0;
  const payload = {
    checkedAt: new Date().toISOString(),
    passed,
    errors,
    warnings,
    checks,
  };

  const { data: simulation, error } = await supabaseAdmin
    .from('guardian_simulation_runs')
    .insert({
      tenant_id: tenantId,
      config_version_id: configVersionId,
      actor_user_id: actorUserId,
      input_payload: { type: 'admin_guardian_config_validation' },
      result_payload: payload,
      passed,
    })
    .select('id, passed, input_payload, result_payload, created_at')
    .single();

  if (error) throw error;

  await audit({
    tenantId,
    actorUserId,
    action: 'RUN_SIMULATION',
    configVersionId,
    reason: 'Validacao administrativa do rascunho Guardian.',
    newValue: payload,
    request,
  });

  return simulation;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenant_id');

  try {
    return NextResponse.json(await loadDashboard(tenantId));
  } catch (err) {
    console.error('admin/guardians/config GET failed', err);
    return errorResponse('Falha ao carregar configuracao dos guardioes.', 500, 'INTERNAL');
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    const action = String(body.action || '').trim();
    const tenantId = assertUuid(body.tenantId, 'TENANT_ID');
    const reason = cleanReason(body.reason);

    if (action === 'create_draft') {
      if (reason.length < 8) return errorResponse('Informe um motivo claro para criar o rascunho.');

      const { data, error } = await supabaseAdmin.rpc('guardian_create_draft_from_active', {
        p_tenant_id: tenantId,
        p_actor_user_id: auth.adminId,
        p_reason: reason,
      });

      if (error) throw error;
      return NextResponse.json({ ...(await loadDashboard(tenantId)), draftVersionId: data });
    }

    if (action === 'validate_draft') {
      const draft = await getDraftVersion(tenantId);
      const configHash = await refreshDraftHash(tenantId, draft.id);
      const simulation = await validateDraftConfig(tenantId, draft.id, auth.adminId, request);
      return NextResponse.json({ ...(await loadDashboard(tenantId)), configHash, simulation });
    }

    if (action === 'activate_draft') {
      if (reason.length < 10) return errorResponse('Informe um motivo de publicacao com pelo menos 10 caracteres.');
      const draft = await getDraftVersion(tenantId);
      await refreshDraftHash(tenantId, draft.id);

      const { data, error } = await supabaseAdmin.rpc('guardian_activate_draft_version', {
        p_tenant_id: tenantId,
        p_config_version_id: draft.id,
        p_actor_user_id: auth.adminId,
        p_reason: reason,
      });

      if (error) throw error;
      return NextResponse.json({ ...(await loadDashboard(tenantId)), activatedVersionId: data });
    }

    return errorResponse('Acao nao reconhecida.', 400, 'UNKNOWN_ACTION');
  } catch (err: any) {
    console.error('admin/guardians/config POST failed', err);
    const message = String(err?.message || err || 'Falha ao executar acao dos guardioes.');
    if (message.includes('DRAFT_REQUIRES_PASSED_VALIDATION')) {
      return errorResponse('Valide o rascunho novamente antes de publicar.', 409, 'DRAFT_REQUIRES_VALIDATION');
    }
    if (message.includes('DRAFT_NOT_FOUND')) {
      return errorResponse('Crie um rascunho antes de editar ou publicar.', 404, 'DRAFT_NOT_FOUND');
    }
    return errorResponse('Falha ao executar acao dos guardioes.', 500, 'INTERNAL');
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse('JSON invalido.', 400);
  }

  try {
    const action = String(body.action || '').trim();
    const tenantId = assertUuid(body.tenantId, 'TENANT_ID');
    const reason = cleanReason(body.reason);
    if (reason.length < 8) return errorResponse('Informe um motivo claro para alterar guardioes.');

    const draft = await getDraftVersion(tenantId);

    if (action === 'update_guardian') {
      const guardianKey = String(body.guardianKey || '').trim();
      if (!guardianKey) return errorResponse('guardianKey ausente.');

      const { guardianByKey } = await loadDefinitions();
      const definition: any = guardianByKey.get(guardianKey);
      if (!definition) return errorResponse('Guardiao nao encontrado.', 404, 'GUARDIAN_NOT_FOUND');

      const { data: current, error: currentError } = await supabaseAdmin
        .from('tenant_guardian_settings')
        .select('enabled, mode, fail_policy, sort_order')
        .eq('tenant_id', tenantId)
        .eq('config_version_id', draft.id)
        .eq('guardian_key', guardianKey)
        .single();

      if (currentError) throw currentError;

      const next = {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : Boolean(current.enabled),
        mode: MODES.has(String(body.mode)) ? String(body.mode) : String(current.mode),
        fail_policy: FAIL_POLICIES.has(String(body.failPolicy)) ? String(body.failPolicy) : String(current.fail_policy),
      };

      const isCriticalDisable = definition.is_system_critical && (!next.enabled || next.mode === 'OFF');
      if (isCriticalDisable && body.confirmCritical !== true) {
        return errorResponse('Este guardiao e critico. Confirme o impacto antes de desligar ou colocar em OFF.', 409, 'CRITICAL_CONFIRMATION_REQUIRED');
      }

      const { error } = await supabaseAdmin
        .from('tenant_guardian_settings')
        .update(next)
        .eq('tenant_id', tenantId)
        .eq('config_version_id', draft.id)
        .eq('guardian_key', guardianKey);

      if (error) throw error;

      await audit({
        tenantId,
        actorUserId: auth.adminId,
        action: 'UPDATE_GUARDIAN',
        guardianKey,
        oldValue: current,
        newValue: next,
        configVersionId: draft.id,
        reason,
        request,
      });

      const configHash = await refreshDraftHash(tenantId, draft.id);
      return NextResponse.json({ ...(await loadDashboard(tenantId)), configHash });
    }

    if (action === 'update_variable') {
      const guardianKey = String(body.guardianKey || '').trim();
      const variableKey = String(body.variableKey || '').trim();
      if (!guardianKey || !variableKey) return errorResponse('guardianKey e variableKey sao obrigatorios.');

      const { variableByKey } = await loadDefinitions();
      const definition = variableByKey.get(`${guardianKey}.${variableKey}`) as GuardianVariableDefinition | undefined;
      if (!definition) return errorResponse('Variavel nao encontrada.', 404, 'VARIABLE_NOT_FOUND');
      if ((definition.requires_confirmation || definition.requires_owner) && body.confirmCritical !== true) {
        return errorResponse('Esta variavel exige confirmacao antes da alteracao.', 409, 'VARIABLE_CONFIRMATION_REQUIRED');
      }

      let normalizedValue: unknown;
      try {
        normalizedValue = normalizeJsonValue(body.value, definition);
      } catch (err: any) {
        return errorResponse(err?.message || 'Valor invalido.');
      }

      const { data: current, error: currentError } = await supabaseAdmin
        .from('tenant_guardian_variable_values')
        .select('value')
        .eq('tenant_id', tenantId)
        .eq('config_version_id', draft.id)
        .eq('guardian_key', guardianKey)
        .eq('variable_key', variableKey)
        .single();

      if (currentError) throw currentError;

      const { error } = await supabaseAdmin
        .from('tenant_guardian_variable_values')
        .update({ value: normalizedValue })
        .eq('tenant_id', tenantId)
        .eq('config_version_id', draft.id)
        .eq('guardian_key', guardianKey)
        .eq('variable_key', variableKey);

      if (error) throw error;

      await audit({
        tenantId,
        actorUserId: auth.adminId,
        action: 'UPDATE_VARIABLE',
        guardianKey,
        variableKey,
        oldValue: current?.value ?? null,
        newValue: normalizedValue,
        configVersionId: draft.id,
        reason,
        request,
      });

      const configHash = await refreshDraftHash(tenantId, draft.id);
      return NextResponse.json({ ...(await loadDashboard(tenantId)), configHash });
    }

    return errorResponse('Acao nao reconhecida.', 400, 'UNKNOWN_ACTION');
  } catch (err: any) {
    console.error('admin/guardians/config PATCH failed', err);
    const message = String(err?.message || err || 'Falha ao atualizar guardioes.');
    if (message.includes('DRAFT_NOT_FOUND')) {
      return errorResponse('Crie um rascunho antes de editar.', 404, 'DRAFT_NOT_FOUND');
    }
    return errorResponse('Falha ao atualizar guardioes.', 500, 'INTERNAL');
  }
}
