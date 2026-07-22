'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, toast } from '@prospix/ui';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  UploadCloud,
} from 'lucide-react';
import { adminNextApi } from '@/lib/admin-api-fetch';

type TenantOption = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type GuardianVariable = {
  variable_key: string;
  label: string;
  description: string;
  value_type: string;
  value: unknown;
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

type Guardian = {
  guardian_key: string;
  name: string;
  description: string;
  layer: string | null;
  execution_stage: string | null;
  function_scope: string | null;
  enabled: boolean;
  mode: 'OFF' | 'OBSERVE' | 'WARN' | 'BLOCK' | 'HARD_BLOCK' | string;
  fail_policy: string;
  is_system_critical: boolean;
  sort_order: number;
  variables: GuardianVariable[];
};

type GuardianConfig = {
  tenant_id: string;
  status: 'ACTIVE' | 'DRAFT' | string;
  version: {
    id: string;
    version_number: number;
    status: string;
    config_hash: string;
    created_at: string;
    activated_at: string | null;
    notes: string | null;
  };
  guardians: Guardian[];
};

type GuardianAuditRow = {
  id: string;
  action: string;
  guardian_key: string | null;
  variable_key: string | null;
  reason: string | null;
  created_at: string;
};

type GuardianSimulation = {
  id: string;
  passed: boolean;
  result_payload: {
    checkedAt?: string;
    passed?: boolean;
    errors?: string[];
    warnings?: string[];
    checks?: string[];
  };
  created_at: string;
};

type GuardianDashboard = {
  tenants: TenantOption[];
  tenant: TenantOption;
  activeConfig: GuardianConfig | null;
  draftConfig: GuardianConfig | null;
  latestSimulation: GuardianSimulation | null;
  auditLog: GuardianAuditRow[];
};

const MODE_COPY: Record<string, { label: string; tone: string; description: string }> = {
  OFF: {
    label: 'Desligado',
    tone: 'bg-slate-50 text-slate-600 border-slate-200',
    description: 'Nao roda esta protecao.',
  },
  OBSERVE: {
    label: 'Observa',
    tone: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Registra evidencia sem interferir no fluxo.',
  },
  WARN: {
    label: 'Avisa',
    tone: 'bg-amber-50 text-amber-800 border-amber-300',
    description: 'Sinaliza risco e deixa a IA continuar.',
  },
  BLOCK: {
    label: 'Bloqueia',
    tone: 'bg-orange-50 text-orange-800 border-orange-300',
    description: 'Impede a acao quando a regra encontra risco.',
  },
  HARD_BLOCK: {
    label: 'Bloqueio forte',
    tone: 'bg-red-50 text-red-700 border-red-200',
    description: 'Protecao critica. Nao deve ser desligada sem revisao.',
  },
};

const GUARDIAN_COPY: Record<string, { title: string; purpose: string; risk: string }> = {
  G00_ENGINE_CONFIG: {
    title: 'Configuracao segura',
    purpose: 'Garante que a IA sempre use uma versao ativa e rastreavel das regras.',
    risk: 'Sem isso, a IA pode operar sem configuracao confiavel.',
  },
  G01_INBOUND_IDEMPOTENCY: {
    title: 'Evitar mensagens duplicadas',
    purpose: 'Agrupa entradas repetidas e evita responder duas vezes a mesma mensagem.',
    risk: 'Sem isso, o lead pode receber respostas repetidas.',
  },
  G02_LEAD_RELEVANCE: {
    title: 'Relevancia do lead',
    purpose: 'Impede abordagem de contatos sem aderencia ou sem evidencia suficiente.',
    risk: 'Sem isso, aumenta risco de spam e baixa qualidade comercial.',
  },
  G03_PHONE_ENTITY: {
    title: 'Telefone valido',
    purpose: 'Bloqueia numero invalido, fixo ou com sinais de contato comercial inadequado.',
    risk: 'Sem isso, o numero pode enviar para contatos ruins.',
  },
  G04_IDENTITY_PERSONALIZATION: {
    title: 'Nome e identidade corretos',
    purpose: 'Evita chamar a pessoa pelo nome errado ou usar tratamento nao verificado.',
    risk: 'Sem isso, a abordagem perde confianca rapidamente.',
  },
  G05_CONVERSATION_STATE: {
    title: 'Estado da conversa',
    purpose: 'Garante que a IA continue no ponto certo e nao reabra conversa encerrada.',
    risk: 'Sem isso, a IA pode parecer perdida ou insistente.',
  },
  G06_REFUSAL_CLOSURE: {
    title: 'Respeito a recusa',
    purpose: 'Fecha atendimento quando o lead demonstra desinteresse.',
    risk: 'Sem isso, a operacao pode insistir indevidamente.',
  },
  G07_ANTI_LOOP: {
    title: 'Anti-repeticao',
    purpose: 'Detecta conversas circulares e evita repetir perguntas ou respostas.',
    risk: 'Sem isso, a IA pode ficar travada no mesmo assunto.',
  },
  G08_OBJECTION_FRAMEWORK: {
    title: 'Tratamento de objecoes',
    purpose: 'Ajuda a responder objecoes comerciais com estrutura adequada.',
    risk: 'Sem isso, respostas comerciais podem perder consistencia.',
  },
  G09_QUALIFICATION: {
    title: 'Qualificacao consultiva',
    purpose: 'Controla perguntas para qualificar sem parecer interrogatorio.',
    risk: 'Sem isso, a conversa pode ficar generica ou pesada.',
  },
  G10_AGENDA: {
    title: 'Agenda e proximo passo',
    purpose: 'Protege convites de reuniao e evita prometer horario falso.',
    risk: 'Sem isso, a IA pode prometer disponibilidade inexistente.',
  },
  G11_SHORT_RESPONSES: {
    title: 'Respostas curtas',
    purpose: 'Mantem mensagens objetivas e faceis de ler no WhatsApp.',
    risk: 'Sem isso, a IA pode mandar textos longos demais.',
  },
  G12_STRUCTURED_OUTPUT: {
    title: 'Formato interno valido',
    purpose: 'Garante que a IA produza dados no formato que o sistema espera.',
    risk: 'Sem isso, pode quebrar envio ou classificacao.',
  },
  G13_PLACEHOLDER_LEAK: {
    title: 'Sem placeholders',
    purpose: 'Bloqueia mensagens com campos nao preenchidos como [nome].',
    risk: 'Sem isso, mensagens podem parecer automacao mal configurada.',
  },
  G14_INTERNAL_LEAK: {
    title: 'Sem vazamento interno',
    purpose: 'Impede expor IDs, termos tecnicos, JSON ou estrutura interna ao lead.',
    risk: 'Sem isso, a conversa fica insegura e pouco profissional.',
  },
  G15_PROMPT_INJECTION: {
    title: 'Protecao contra manipulacao',
    purpose: 'Ignora tentativas do lead de mudar regras ou extrair instrucoes internas.',
    risk: 'Sem isso, a IA pode obedecer comandos indevidos.',
  },
  G16_SEMANTIC_SCOPE: {
    title: 'Escopo da resposta',
    purpose: 'Impede promessa, dado externo ou assunto sem fonte aprovada.',
    risk: 'Sem isso, a IA pode inventar informacao.',
  },
  G17_NATURALNESS: {
    title: 'Naturalidade',
    purpose: 'Reduz frases roboticas, cliches e exageros.',
    risk: 'Sem isso, a abordagem pode parecer disparo automatico.',
  },
  G18_BUSINESS_HOURS: {
    title: 'Horario seguro',
    purpose: 'Controla janela de envio e distribuicao no inicio do dia.',
    risk: 'Sem isso, pode enviar em horario ruim ou concentrar disparos.',
  },
  G19_GLOBAL_CADENCE: {
    title: 'Ritmo global',
    purpose: 'Limita volume por minuto, hora e dia conforme estado do WhatsApp.',
    risk: 'Sem isso, cresce risco de bloqueio do numero.',
  },
  G20_CONTACT_CADENCE: {
    title: 'Ritmo por contato',
    purpose: 'Controla intervalo entre mensagens e follow-ups por lead.',
    risk: 'Sem isso, um lead pode receber contato excessivo.',
  },
  G21_CONCURRENCY_LOCK: {
    title: 'Trava contra duplicidade',
    purpose: 'Evita dois workers enviarem mensagens ao mesmo tempo.',
    risk: 'Sem isso, pode haver duplicidade e inconsistencia.',
  },
  G22_SEND_INTEGRITY: {
    title: 'Falhas de envio',
    purpose: 'Classifica erro transiente ou critico e suspende em falhas graves.',
    risk: 'Sem isso, o sistema pode insistir com WhatsApp desconectado.',
  },
  G23_OBSERVABILITY: {
    title: 'Rastreabilidade',
    purpose: 'Registra decisoes e evidencias dos guardioes.',
    risk: 'Sem isso, fica dificil auditar problemas.',
  },
  G24_ADMIN_CHANGE_CONTROL: {
    title: 'Controle de mudancas',
    purpose: 'Exige rascunho, motivo, validacao e auditoria para alterar regras.',
    risk: 'Sem isso, uma mudanca administrativa pode quebrar a operacao.',
  },
};

const GROUPS = [
  { id: 'reputation', title: 'Seguranca do numero', keys: ['G03_PHONE_ENTITY', 'G18_BUSINESS_HOURS', 'G19_GLOBAL_CADENCE', 'G20_CONTACT_CADENCE', 'G21_CONCURRENCY_LOCK', 'G22_SEND_INTEGRITY'] },
  { id: 'conversation', title: 'Qualidade da conversa', keys: ['G04_IDENTITY_PERSONALIZATION', 'G05_CONVERSATION_STATE', 'G06_REFUSAL_CLOSURE', 'G07_ANTI_LOOP', 'G08_OBJECTION_FRAMEWORK', 'G09_QUALIFICATION', 'G10_AGENDA', 'G11_SHORT_RESPONSES', 'G17_NATURALNESS'] },
  { id: 'safety', title: 'Privacidade e seguranca da IA', keys: ['G12_STRUCTURED_OUTPUT', 'G13_PLACEHOLDER_LEAK', 'G14_INTERNAL_LEAK', 'G15_PROMPT_INJECTION', 'G16_SEMANTIC_SCOPE'] },
  { id: 'admin', title: 'Controle operacional', keys: ['G00_ENGINE_CONFIG', 'G01_INBOUND_IDEMPOTENCY', 'G02_LEAD_RELEVANCE', 'G23_OBSERVABILITY', 'G24_ADMIN_CHANGE_CONTROL'] },
];

function modeLabel(mode: string): string {
  return MODE_COPY[mode]?.label || mode.replaceAll('_', ' ');
}

function modeClass(mode: string): string {
  return MODE_COPY[mode]?.tone || 'bg-surface-sunken text-text-secondary border-border';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'sem registro';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'sem registro';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanizeKey(key: string): string {
  const labels: Record<string, string> = {
    enabled: 'Ativo',
    business_start: 'Inicio do horario',
    business_end: 'Fim do horario',
    block_before_hour: 'Bloquear antes das',
    block_after_hour: 'Bloquear depois das',
    max_new_chats_per_hour: 'Novas conversas por hora',
    max_new_chats_per_day: 'Novas conversas por dia',
    max_messages_per_hour: 'Mensagens por hora',
    max_messages_per_minute: 'Mensagens por minuto',
    retry_max: 'Maximo de novas tentativas',
    retry_backoff_seconds: 'Intervalo das novas tentativas',
    max_followups_without_reply: 'Follow-ups sem resposta',
    same_lead_gap_without_reply_min_hours: 'Intervalo minimo sem resposta',
    same_lead_gap_without_reply_max_hours: 'Intervalo maximo sem resposta',
  };
  return labels[key] || key.replaceAll('_', ' ');
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function parseValue(text: string, variable: GuardianVariable): unknown {
  if (variable.value_type === 'boolean') return text === 'true';
  if (variable.value_type === 'integer' || variable.value_type === 'duration_seconds') return Number.parseInt(text, 10);
  if (variable.value_type === 'decimal') return Number.parseFloat(text);
  if (variable.value_type === 'json' || variable.value_type === 'string_array') return JSON.parse(text);
  return text;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function guardCopy(guardian: Guardian) {
  return GUARDIAN_COPY[guardian.guardian_key] || {
    title: guardian.name,
    purpose: guardian.description,
    risk: 'Alterar esta protecao pode afetar o comportamento da IA.',
  };
}

export default function AdminGuardiansPage() {
  const [data, setData] = useState<GuardianDashboard | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedGuardianKey, setSelectedGuardianKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draftReason, setDraftReason] = useState('');
  const [publishReason, setPublishReason] = useState('');
  const [editReason, setEditReason] = useState('');
  const [confirmCritical, setConfirmCritical] = useState(false);
  const [editorEnabled, setEditorEnabled] = useState(true);
  const [editorMode, setEditorMode] = useState('OBSERVE');
  const [editorFailPolicy, setEditorFailPolicy] = useState('FAIL_CLOSED');
  const [variableDrafts, setVariableDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async (tenantId?: string) => {
    setIsLoading(true);
    try {
      const query = tenantId ? `?tenant_id=${tenantId}` : '';
      const response = await adminNextApi.get(`/api/admin/guardians/config${query}`);
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao carregar.');
      const payload = response.data.data as GuardianDashboard;
      setData(payload);
      setSelectedTenantId(payload.tenant.id);
      const config = payload.draftConfig || payload.activeConfig;
      if (!selectedGuardianKey && config?.guardians?.[0]) {
        setSelectedGuardianKey(config.guardians[0].guardian_key);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar guardioes.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedGuardianKey]);

  useEffect(() => {
    void load(selectedTenantId || undefined);
    // Initial dashboard load only. Tenant changes reload explicitly through the selector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeConfig = data?.activeConfig || null;
  const draftConfig = data?.draftConfig || null;
  const workingConfig = draftConfig || activeConfig;
  const hasDraft = Boolean(draftConfig);
  const selectedGuardian = useMemo(
    () => workingConfig?.guardians.find((guardian) => guardian.guardian_key === selectedGuardianKey) || workingConfig?.guardians[0] || null,
    [selectedGuardianKey, workingConfig],
  );

  useEffect(() => {
    if (!selectedGuardian) return;
    setEditorEnabled(selectedGuardian.enabled);
    setEditorMode(selectedGuardian.mode);
    setEditorFailPolicy(selectedGuardian.fail_policy);
    setVariableDrafts(Object.fromEntries(
      selectedGuardian.variables.map((variable) => [variable.variable_key, valueToText(variable.value)]),
    ));
    setEditReason('');
    setConfirmCritical(false);
  }, [selectedGuardian?.guardian_key, selectedGuardian]);

  const summary = useMemo(() => {
    const guardians = workingConfig?.guardians || [];
    return {
      total: guardians.length,
      active: guardians.filter((guardian) => guardian.enabled && guardian.mode !== 'OFF').length,
      hardBlock: guardians.filter((guardian) => guardian.mode === 'HARD_BLOCK').length,
      observe: guardians.filter((guardian) => guardian.mode === 'OBSERVE').length,
      critical: guardians.filter((guardian) => guardian.is_system_critical).length,
    };
  }, [workingConfig]);

  const filteredGroups = useMemo(() => {
    const guardiansByKey = new Map((workingConfig?.guardians || []).map((guardian) => [guardian.guardian_key, guardian]));
    const term = search.trim().toLowerCase();
    return GROUPS.map((group) => ({
      ...group,
      guardians: group.keys
        .map((key) => guardiansByKey.get(key))
        .filter(Boolean)
        .filter((guardian) => {
          if (!term) return true;
          const copy = guardCopy(guardian as Guardian);
          return `${copy.title} ${copy.purpose} ${(guardian as Guardian).guardian_key}`.toLowerCase().includes(term);
        }) as Guardian[],
    })).filter((group) => group.guardians.length > 0);
  }, [search, workingConfig]);

  const createDraft = async () => {
    if (!selectedTenantId) return;
    if (draftReason.trim().length < 8) {
      toast.error('Motivo obrigatorio', 'Explique em poucas palavras por que o rascunho sera criado.');
      return;
    }
    setBusy('create_draft');
    try {
      const response = await adminNextApi.post('/api/admin/guardians/config', {
        action: 'create_draft',
        tenantId: selectedTenantId,
        reason: draftReason.trim(),
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao criar rascunho.');
      toast.success('Rascunho criado', 'As mudancas agora ficam isoladas ate serem publicadas.');
      setDraftReason('');
      await load(selectedTenantId);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao criar rascunho.');
    } finally {
      setBusy(null);
    }
  };

  const validateDraft = async () => {
    if (!selectedTenantId) return;
    setBusy('validate_draft');
    try {
      const response = await adminNextApi.post('/api/admin/guardians/config', {
        action: 'validate_draft',
        tenantId: selectedTenantId,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao validar.');
      const simulation = response.data.simulation as GuardianSimulation | undefined;
      if (simulation?.passed) {
        toast.success('Rascunho validado', 'Pode ser publicado com seguranca operacional.');
      } else {
        toast.error('Validacao encontrou bloqueios', 'Revise os pontos indicados antes de publicar.');
      }
      await load(selectedTenantId);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao validar rascunho.');
    } finally {
      setBusy(null);
    }
  };

  const publishDraft = async () => {
    if (!selectedTenantId) return;
    if (publishReason.trim().length < 10) {
      toast.error('Motivo obrigatorio', 'Informe o motivo da publicacao.');
      return;
    }
    setBusy('activate_draft');
    try {
      const response = await adminNextApi.post('/api/admin/guardians/config', {
        action: 'activate_draft',
        tenantId: selectedTenantId,
        reason: publishReason.trim(),
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao publicar.');
      toast.success('Guardioes publicados', 'A nova versao ativa sera usada nas proximas execucoes.');
      setPublishReason('');
      await load(selectedTenantId);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao publicar rascunho.');
    } finally {
      setBusy(null);
    }
  };

  const saveGuardian = async () => {
    if (!selectedTenantId || !selectedGuardian || !draftConfig) return;
    if (editReason.trim().length < 8) {
      toast.error('Motivo obrigatorio', 'Informe por que esta alteracao e necessaria.');
      return;
    }

    setBusy(`save:${selectedGuardian.guardian_key}`);
    try {
      const guardianResponse = await adminNextApi.patch('/api/admin/guardians/config', {
        action: 'update_guardian',
        tenantId: selectedTenantId,
        guardianKey: selectedGuardian.guardian_key,
        enabled: editorEnabled,
        mode: editorMode,
        failPolicy: editorFailPolicy,
        reason: editReason.trim(),
        confirmCritical,
      });
      if (!guardianResponse.data?.ok) throw new Error(guardianResponse.data?.message || 'Falha ao salvar guardiao.');

      for (const variable of selectedGuardian.variables) {
        const nextText = variableDrafts[variable.variable_key] ?? valueToText(variable.value);
        const nextValue = parseValue(nextText, variable);
        if (stableJson(nextValue) === stableJson(variable.value)) continue;
        const variableResponse = await adminNextApi.patch('/api/admin/guardians/config', {
          action: 'update_variable',
          tenantId: selectedTenantId,
          guardianKey: selectedGuardian.guardian_key,
          variableKey: variable.variable_key,
          value: nextValue,
          reason: editReason.trim(),
          confirmCritical,
        });
        if (!variableResponse.data?.ok) throw new Error(variableResponse.data?.message || `Falha em ${variable.variable_key}.`);
      }

      toast.success('Rascunho atualizado', 'Valide o rascunho antes de publicar.');
      await load(selectedTenantId);
    } catch (err: unknown) {
      toast.error('Erro', err instanceof Error ? err.message : 'Falha ao salvar alteracoes.');
    } finally {
      setBusy(null);
    }
  };

  const latestSimulation = data?.latestSimulation || null;
  const latestValidationPassed = Boolean(latestSimulation?.passed);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" aria-hidden />
            Protecoes da IA
          </h2>
          <p className="text-text-secondary text-xs mt-1 max-w-3xl">
            Configure guardioes de seguranca, qualidade e cadencia. Mudancas sao feitas em rascunho e so entram em operacao apos validacao e publicacao.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedTenantId}
            onChange={(event) => {
              setSelectedTenantId(event.target.value);
              setSelectedGuardianKey(null);
              void load(event.target.value);
            }}
            className="h-9 min-w-[260px] rounded-lg border border-border bg-white px-3 text-xs text-text focus:outline-none focus:border-primary/50"
          >
            {(data?.tenants || []).map((tenant) => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
          <Button onClick={() => load(selectedTenantId)} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Metric label="Guardioes" value={summary.total} />
        <Metric label="Ativos" value={summary.active} />
        <Metric label="Bloqueio forte" value={summary.hardBlock} tone="red" />
        <Metric label="Observando" value={summary.observe} tone="blue" />
        <Metric label="Criticos" value={summary.critical} tone="amber" />
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold text-text font-heading">Fluxo de mudanca segura</CardTitle>
              <CardDescription className="text-xs text-text-secondary mt-1">
                Versao ativa: {activeConfig?.version.version_number || 'n/d'} · Rascunho: {draftConfig?.version.version_number || 'nenhum'} · Ultima validacao: {latestSimulation ? formatDate(latestSimulation.created_at) : 'sem validacao'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={`text-[10px] px-2 py-0.5 border ${hasDraft ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-success-soft text-success-text border-success/30'}`}>
                {hasDraft ? 'Rascunho em edicao' : 'Sem rascunho'}
              </Badge>
              {latestSimulation && (
                <Badge className={`text-[10px] px-2 py-0.5 border ${latestSimulation.passed ? 'bg-success-soft text-success-text border-success/30' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {latestSimulation.passed ? 'Validado' : 'Validacao bloqueada'}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {!hasDraft ? (
            <div className="xl:col-span-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
              <Input value={draftReason} onChange={(event) => setDraftReason(event.target.value)} placeholder="Motivo para criar rascunho seguro" className="h-9 text-xs" />
              <Button onClick={createDraft} disabled={busy === 'create_draft'} className="bg-primary hover:bg-primary-hover text-white text-xs h-9 px-3 rounded-lg flex items-center gap-1.5">
                {busy === 'create_draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Criar rascunho
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
                Edite o rascunho, valide e publique. A versao ativa nao muda ate a publicacao.
              </div>
              <Button onClick={validateDraft} disabled={busy === 'validate_draft'} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs h-9 px-3 rounded-lg flex items-center gap-1.5 justify-center">
                {busy === 'validate_draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Validar rascunho
              </Button>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                <Input value={publishReason} onChange={(event) => setPublishReason(event.target.value)} placeholder="Motivo da publicacao" className="h-9 text-xs" />
                <Button onClick={publishDraft} disabled={busy === 'activate_draft' || !latestValidationPassed} className="bg-primary hover:bg-primary-hover text-white text-xs h-9 px-3 rounded-lg flex items-center gap-1.5 justify-center disabled:opacity-50">
                  {busy === 'activate_draft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  Publicar
                </Button>
              </div>
            </>
          )}
          {latestSimulation?.result_payload?.errors?.length ? (
            <div className="xl:col-span-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
              {latestSimulation.result_payload.errors.slice(0, 3).join(' | ')}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_430px] gap-4">
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-text-secondary absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar protecao por nome ou finalidade" className="pl-9 h-9 text-xs" />
          </div>

          {isLoading && !workingConfig ? (
            <Card className="bg-white border-border shadow-sm">
              <CardContent className="py-10 flex items-center justify-center text-sm text-text-secondary">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Carregando guardioes...
              </CardContent>
            </Card>
          ) : (
            filteredGroups.map((group) => (
              <Card key={group.id} className="bg-white border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold text-text font-heading">{group.title}</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-border/60">
                  {group.guardians.map((guardian) => {
                    const copy = guardCopy(guardian);
                    const selected = selectedGuardian?.guardian_key === guardian.guardian_key;
                    return (
                      <button
                        key={guardian.guardian_key}
                        onClick={() => setSelectedGuardianKey(guardian.guardian_key)}
                        className={`w-full text-left py-3 flex flex-col lg:flex-row lg:items-start justify-between gap-3 rounded-lg px-2 transition-colors ${selected ? 'bg-primary/5' : 'hover:bg-surface-sunken'}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {guardian.enabled ? <ToggleRight className="w-4 h-4 text-success-text" /> : <ToggleLeft className="w-4 h-4 text-text-secondary" />}
                            <span className="font-semibold text-sm text-text">{copy.title}</span>
                            {guardian.is_system_critical && <Badge className="text-[9px] px-1.5 py-0 border bg-red-50 text-red-700 border-red-200">critico</Badge>}
                          </div>
                          <p className="text-xs text-text-secondary mt-1 leading-relaxed">{copy.purpose}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${guardian.enabled ? 'bg-success-soft text-success-text border-success/30' : 'bg-surface-sunken text-text-secondary border-border'}`}>
                            {guardian.enabled ? 'ativo' : 'desativado'}
                          </Badge>
                          <Badge className={`text-[9px] px-1.5 py-0 border ${modeClass(guardian.mode)}`}>{modeLabel(guardian.mode)}</Badge>
                        </div>
                      </button>
                    );
                  })}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <GuardianEditor
          guardian={selectedGuardian}
          hasDraft={hasDraft}
          editorEnabled={editorEnabled}
          editorMode={editorMode}
          editorFailPolicy={editorFailPolicy}
          editReason={editReason}
          confirmCritical={confirmCritical}
          variableDrafts={variableDrafts}
          busy={busy}
          onEnabledChange={setEditorEnabled}
          onModeChange={setEditorMode}
          onFailPolicyChange={setEditorFailPolicy}
          onReasonChange={setEditReason}
          onConfirmCriticalChange={setConfirmCritical}
          onVariableChange={(key, value) => setVariableDrafts((drafts) => ({ ...drafts, [key]: value }))}
          onSave={saveGuardian}
        />
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-text font-heading">Historico recente</CardTitle>
          <CardDescription className="text-xs text-text-secondary mt-1">Alteracoes e publicacoes registradas para auditoria.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border/60">
            {(data?.auditLog || []).slice(0, 8).map((row) => (
              <div key={row.id} className="py-2 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-text">{row.action.replaceAll('_', ' ')}</span>
                  <span className="text-text-secondary"> · {row.guardian_key || 'configuracao'}{row.variable_key ? ` / ${row.variable_key}` : ''}</span>
                  {row.reason && <p className="text-text-secondary mt-0.5">{row.reason}</p>}
                </div>
                <span className="text-text-secondary whitespace-nowrap">{formatDate(row.created_at)}</span>
              </div>
            ))}
            {(data?.auditLog || []).length === 0 && (
              <p className="text-xs text-text-secondary py-4">Nenhuma alteracao registrada.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'red' | 'blue' | 'amber' }) {
  const toneClass = tone === 'red'
    ? 'text-red-700'
    : tone === 'blue'
      ? 'text-blue-700'
      : tone === 'amber'
        ? 'text-amber-800'
        : 'text-text';
  return (
    <Card className="bg-white border-border shadow-sm">
      <CardContent className="pt-4 pb-3">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">{label}</span>
        <div className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function GuardianEditor({
  guardian,
  hasDraft,
  editorEnabled,
  editorMode,
  editorFailPolicy,
  editReason,
  confirmCritical,
  variableDrafts,
  busy,
  onEnabledChange,
  onModeChange,
  onFailPolicyChange,
  onReasonChange,
  onConfirmCriticalChange,
  onVariableChange,
  onSave,
}: {
  guardian: Guardian | null;
  hasDraft: boolean;
  editorEnabled: boolean;
  editorMode: string;
  editorFailPolicy: string;
  editReason: string;
  confirmCritical: boolean;
  variableDrafts: Record<string, string>;
  busy: string | null;
  onEnabledChange: (value: boolean) => void;
  onModeChange: (value: string) => void;
  onFailPolicyChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onConfirmCriticalChange: (value: boolean) => void;
  onVariableChange: (key: string, value: string) => void;
  onSave: () => void;
}) {
  if (!guardian) {
    return (
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="py-10 text-center text-sm text-text-secondary">Selecione uma protecao.</CardContent>
      </Card>
    );
  }

  const copy = guardCopy(guardian);
  const disabled = !hasDraft;
  const isBusy = busy === `save:${guardian.guardian_key}`;

  return (
    <Card className="bg-white border-border shadow-sm xl:sticky xl:top-4 xl:self-start">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold text-text font-heading">{copy.title}</CardTitle>
            <CardDescription className="text-xs text-text-secondary mt-1 leading-relaxed">{copy.purpose}</CardDescription>
          </div>
          <Badge className={`text-[9px] px-1.5 py-0 border ${guardian.is_system_critical ? 'bg-red-50 text-red-700 border-red-200' : 'bg-surface-sunken text-text-secondary border-border'}`}>
            {guardian.is_system_critical ? 'critico' : 'padrao'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasDraft && (
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Crie um rascunho para editar. A versao ativa esta protegida contra mudanca direta.
          </div>
        )}

        <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-text-secondary">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>{copy.risk}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Estado">
            <select disabled={disabled} value={editorEnabled ? 'on' : 'off'} onChange={(event) => onEnabledChange(event.target.value === 'on')} className="w-full h-9 rounded-lg border border-border bg-white px-3 text-xs text-text disabled:bg-surface-sunken">
              <option value="on">Ativo</option>
              <option value="off">Desativado</option>
            </select>
          </Field>
          <Field label="Nivel de acao">
            <select disabled={disabled} value={editorMode} onChange={(event) => onModeChange(event.target.value)} className="w-full h-9 rounded-lg border border-border bg-white px-3 text-xs text-text disabled:bg-surface-sunken">
              {Object.entries(MODE_COPY).map(([mode, meta]) => <option key={mode} value={mode}>{meta.label}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Se houver falha interna">
          <select disabled={disabled} value={editorFailPolicy} onChange={(event) => onFailPolicyChange(event.target.value)} className="w-full h-9 rounded-lg border border-border bg-white px-3 text-xs text-text disabled:bg-surface-sunken">
            <option value="FAIL_CLOSED">Pausar por seguranca</option>
            <option value="FAIL_OPEN">Permitir continuar</option>
            <option value="USE_LAST_KNOWN_GOOD_CONFIG">Usar ultima configuracao boa</option>
          </select>
        </Field>

        <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
          <div className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">Variaveis</div>
          {guardian.variables.map((variable) => (
            <VariableInput
              key={variable.variable_key}
              variable={variable}
              value={variableDrafts[variable.variable_key] ?? ''}
              disabled={disabled}
              onChange={(value) => onVariableChange(variable.variable_key, value)}
            />
          ))}
        </div>

        <Field label="Motivo da alteracao">
          <Input disabled={disabled} value={editReason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Ex: reduzir risco de disparo excessivo" className="h-9 text-xs" />
        </Field>

        {(guardian.is_system_critical || guardian.variables.some((variable) => variable.requires_confirmation || variable.requires_owner)) && (
          <label className="flex items-start gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={confirmCritical} disabled={disabled} onChange={(event) => onConfirmCriticalChange(event.target.checked)} className="mt-0.5" />
            <span>Confirmo que entendo o impacto desta protecao critica.</span>
          </label>
        )}

        <Button onClick={onSave} disabled={disabled || isBusy} className="w-full bg-primary hover:bg-primary-hover text-white text-xs h-9 rounded-lg flex items-center justify-center gap-1.5">
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Salvar no rascunho
        </Button>

        <div className="text-[10px] text-text-secondary flex items-center gap-1.5">
          <Eye className="w-3 h-3" />
          {MODE_COPY[editorMode]?.description || 'Modo operacional selecionado.'}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold block mb-1">{label}</span>
      {children}
    </label>
  );
}

function VariableInput({ variable, value, disabled, onChange }: {
  variable: GuardianVariable;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const label = humanizeKey(variable.variable_key);
  const helper = [
    variable.unit ? `unidade: ${variable.unit}` : null,
    variable.min_value !== null ? `min ${variable.min_value}` : null,
    variable.max_value !== null ? `max ${variable.max_value}` : null,
  ].filter(Boolean).join(' · ');

  if (variable.value_type === 'boolean') {
    return (
      <Field label={label}>
        <select disabled={disabled} value={value === 'true' ? 'true' : 'false'} onChange={(event) => onChange(event.target.value)} className="w-full h-9 rounded-lg border border-border bg-white px-3 text-xs text-text disabled:bg-surface-sunken">
          <option value="true">Ligado</option>
          <option value="false">Desligado</option>
        </select>
      </Field>
    );
  }

  if (variable.allowed_values && Array.isArray(variable.allowed_values) && variable.allowed_values.length > 0 && variable.value_type !== 'json') {
    return (
      <Field label={label}>
        <select disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} className="w-full h-9 rounded-lg border border-border bg-white px-3 text-xs text-text disabled:bg-surface-sunken">
          {variable.allowed_values.map((option) => <option key={String(option)} value={String(option)}>{String(option).replaceAll('_', ' ')}</option>)}
        </select>
      </Field>
    );
  }

  if (variable.value_type === 'json' || variable.value_type === 'string_array') {
    return (
      <Field label={label}>
        <textarea disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} rows={5} className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-[11px] text-text disabled:bg-surface-sunken" />
        {helper && <span className="text-[10px] text-text-secondary mt-1 block">{helper}</span>}
      </Field>
    );
  }

  return (
    <Field label={label}>
      <Input
        disabled={disabled}
        type={variable.value_type === 'integer' || variable.value_type === 'decimal' || variable.value_type === 'duration_seconds' ? 'number' : 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 text-xs"
      />
      {helper && <span className="text-[10px] text-text-secondary mt-1 block">{helper}</span>}
    </Field>
  );
}
