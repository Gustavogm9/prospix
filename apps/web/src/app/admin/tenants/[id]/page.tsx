'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent, toast } from '@prospix/ui';
import {
  ArrowLeft, Building, Users, Settings as SettingsIcon, Ban, Play, AlertOctagon,
  CheckCircle2, AlertCircle, Loader2, RefreshCw, MessageSquare, Calendar,
  FileText, ShieldAlert, DollarSign, Activity, Zap, Mail, Copy, XCircle, Plus,
} from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

interface TenantUser { id: string; name: string; email: string; role: string; }

interface TenantInvitation {
  id: string;
  code: string;
  tenantId: string;
  role: string;
  createdById: string;
  expiresAt: string;
  usedAt: string | null;
  usedByUserId: string | null;
  revokedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface CredentialState {
  exists: boolean;
  evolution: { baseUrlConfigured: boolean; instanceConfigured: boolean; tokenConfigured: boolean; webhookConfigured: boolean };
  google: { calendarConfigured: boolean; oauthConnected: boolean; oauthScope: string | null; mapsConfigured: boolean };
  ai: { provider: string | null; openaiConfigured: boolean; anthropicConfigured: boolean; googleConfigured: boolean };
  telephony: { accountConfigured: boolean; tokenConfigured: boolean };
  updatedAt: string | null;
}

interface IntegrationHealth {
  status: 'excellent' | 'good' | 'fair' | 'critical';
  missing: string[];
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  segment: string | null;
  mrrCents: number;
  setupPaidCents: number | null;
  contractSignedAt: string | null;
  goLiveAt: string | null;
  createdAt: string;
  users: TenantUser[];
  credentialState: CredentialState;
  integrationHealth: IntegrationHealth;
}

interface InsightsPayload {
  counts: {
    leads: number;
    conversationsActive: number;
    conversationsTotal: number;
    scriptsActive: number;
    lgpdPending: number;
    meetingsScheduled: number;
  };
  usage3m: Array<{
    periodMonth: string;
    llmCostCents: number;
    whatsappCostCents: number;
    googleMapsCostCents: number;
    totalCostCents: number;
    llmTokensInput: number;
    llmTokensOutput: number;
    whatsappMessagesSent: number;
  }>;
  billing: Array<{
    id: string;
    periodMonth: string;
    totalCents: number;
    status: string;
    dueAt: string;
    paidAt: string | null;
  }>;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-success-soft text-success-text border-success/30',
  SUSPENDED: 'bg-red-50 text-red-700 border-red-200',
  CHURNING: 'bg-amber-50 text-amber-800 border-amber-300',
  ONBOARDING: 'bg-blue-50 text-blue-700 border-blue-200',
};

function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export default function TenantDetail() {
  const params = useParams();
  const id = params!.id as string;
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<'suspend' | 'resume' | 'churn' | null>(null);
  const [activeTab, setActiveTab] = useState<'visao-geral' | 'integracoes' | 'usuarios' | 'convites' | 'faturamento'>('visao-geral');
  const [invitations, setInvitations] = useState<TenantInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationBusy, setInvitationBusy] = useState<string | null>(null);

  const fetchAll = async () => {
    if (!id) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [detailRes, insightsRes] = await Promise.all([
        adminApiClient.get(`/admin/tenants/${id}`),
        adminApiClient.get(`/admin/tenants/${id}/insights`),
      ]);
      setTenant(detailRes.data?.data ?? null);
      setInsights(insightsRes.data?.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao carregar tenant.'
        : 'Falha ao carregar tenant.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInvitations = async () => {
    if (!id) return;
    setInvitationsLoading(true);
    try {
      const res = await adminApiClient.get(`/admin/tenants/${id}/invitations`);
      setInvitations(res.data?.data ?? []);
    } catch {
      // silently fail, invitations are secondary data
    } finally {
      setInvitationsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    fetchInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const getInvitationStatus = (inv: TenantInvitation): 'active' | 'used' | 'expired' | 'revoked' => {
    if (inv.revokedAt) return 'revoked';
    if (inv.usedAt) return 'used';
    if (new Date(inv.expiresAt) < new Date()) return 'expired';
    return 'active';
  };

  const INVITATION_STATUS_STYLE: Record<string, string> = {
    active: 'bg-success-soft text-success-text border-success/30',
    used: 'bg-blue-50 text-blue-700 border-blue-200',
    expired: 'bg-red-50 text-red-700 border-red-200',
    revoked: 'bg-surface-sunken text-text-secondary border-border',
  };

  const INVITATION_STATUS_LABEL: Record<string, string> = {
    active: 'Ativo',
    used: 'Usado',
    expired: 'Expirado',
    revoked: 'Revogado',
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    if (!tenant) return;
    if (!confirm('Deseja revogar este convite? Ele não poderá mais ser utilizado.')) return;
    setInvitationBusy(invitationId);
    try {
      await adminApiClient.delete(`/admin/tenants/${tenant.id}/invitations/${invitationId}`);
      toast.success('Convite revogado com sucesso.');
      await fetchInvitations();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao revogar convite.' : 'Falha ao revogar convite.';
      toast.error('Erro', message);
    } finally {
      setInvitationBusy(null);
    }
  };

  const handleCreateInvitation = async () => {
    if (!tenant) return;
    const notes = prompt('Notas internas (opcional):') ?? undefined;
    setInvitationBusy('create');
    try {
      await adminApiClient.post(`/admin/tenants/${tenant.id}/invitations`, { notes });
      toast.success('Convite gerado com sucesso.');
      await fetchInvitations();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao gerar convite.' : 'Falha ao gerar convite.';
      toast.error('Erro', message);
    } finally {
      setInvitationBusy(null);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => toast.success('Código copiado!'),
      () => toast.error('Erro', 'Falha ao copiar código.'),
    );
  };

  const handleSuspend = async () => {
    if (!tenant) return;
    const reason = prompt('Motivo da suspensão (visível no audit log):');
    if (!reason) return;
    setActionBusy('suspend');
    try {
      await adminApiClient.post(`/admin/tenants/${tenant.id}/suspend`, { reason });
      toast.success('Tenant suspenso', `${tenant.name} agora está SUSPENDED.`);
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleResume = async () => {
    if (!tenant) return;
    setActionBusy('resume');
    try {
      await adminApiClient.post(`/admin/tenants/${tenant.id}/resume`);
      toast.success('Tenant reativado');
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleChurn = async () => {
    if (!tenant) return;
    if (!confirm(`Marcar ${tenant.name} como CHURNING? Isso inicia o período de grace de 7 dias antes da exclusão.`)) return;
    const reason = prompt('Motivo do churn (mandatory):');
    if (!reason) return;
    setActionBusy('churn');
    try {
      await adminApiClient.post(`/admin/tenants/${tenant.id}/churn`, { reason });
      toast.success('Tenant marcado como churning');
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setActionBusy(null);
    }
  };

  const monthlyCostTrend = useMemo(() => {
    if (!insights) return { current: 0, previous: 0, delta: 0, deltaPercent: 0 };
    const sorted = [...insights.usage3m];
    const current = sorted[sorted.length - 1]?.totalCostCents ?? 0;
    const previous = sorted[sorted.length - 2]?.totalCostCents ?? 0;
    const delta = current - previous;
    const deltaPercent = previous > 0 ? Math.round((delta / previous) * 100) : 0;
    return { current, previous, delta, deltaPercent };
  }, [insights]);

  const margin = useMemo(() => {
    if (!tenant || !insights) return null;
    const currentCost = insights.usage3m[insights.usage3m.length - 1]?.totalCostCents ?? 0;
    const mrr = tenant.mrrCents;
    const m = mrr - currentCost;
    const percent = mrr > 0 ? Math.round((m / mrr) * 100) : 0;
    return { amount: m, percent };
  }, [tenant, insights]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" role="status">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" aria-label="Carregando tenant" />
      </div>
    );
  }

  if (loadError || !tenant) {
    return (
      <Card className="bg-white border-error/30 shadow-sm">
        <CardContent className="py-10 text-center">
          <AlertCircle className="w-8 h-8 text-error-text mx-auto mb-2" aria-hidden />
          <p className="text-sm text-text font-semibold">{loadError || 'Tenant não encontrado.'}</p>
          <Button onClick={() => router.push('/admin/tenants')} className="mt-4 bg-primary text-white text-xs px-4 h-9 rounded-lg">
            Voltar para lista
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <button
        type="button"
        onClick={() => router.push('/admin/tenants')}
        className="text-xs text-text-secondary hover:text-text flex items-center gap-1"
      >
        <ArrowLeft className="w-3 h-3" aria-hidden /> voltar para tenants
      </button>

      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
              <Building className="w-5 h-5 text-primary" aria-hidden />
              {tenant.name}
            </h2>
            <Badge className={`text-[10px] px-2 py-0.5 border ${STATUS_COLOR[tenant.status] ?? 'bg-surface-sunken text-text-secondary border-border'}`}>
              {tenant.status}
            </Badge>
            <Badge className="bg-primary-soft text-primary border border-primary/20 text-[10px] px-2 py-0.5">
              {tenant.plan}
            </Badge>
          </div>
          <div className="text-[11px] text-text-secondary font-mono flex flex-wrap gap-x-4 gap-y-1">
            <span>slug: {tenant.slug}</span>
            <span>id: {tenant.id.slice(0, 8)}…</span>
            <span>segmento: {tenant.segment || '—'}</span>
            <span>criado: {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}</span>
            {tenant.goLiveAt && <span>go-live: {new Date(tenant.goLiveAt).toLocaleDateString('pt-BR')}</span>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={fetchAll}
            className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Atualizar
          </Button>
          {tenant.status === 'SUSPENDED' ? (
            <Button onClick={handleResume} disabled={actionBusy !== null} className="bg-success-text hover:opacity-90 text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
              {actionBusy === 'resume' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              Reativar
            </Button>
          ) : (
            <Button onClick={handleSuspend} disabled={actionBusy !== null} className="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
              {actionBusy === 'suspend' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />}
              Suspender
            </Button>
          )}
          {tenant.status !== 'CHURNING' && (
            <Button onClick={handleChurn} disabled={actionBusy !== null} className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
              {actionBusy === 'churn' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertOctagon className="w-3.5 h-3.5" />}
              Churn
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="MRR" value={formatBRL(tenant.mrrCents)} icon={DollarSign} />
        <KpiCard
          label="Margem mês"
          value={margin ? formatBRL(margin.amount) : '—'}
          sub={margin ? `${margin.percent}%` : ''}
          tone={margin && margin.percent < 30 ? 'warn' : margin && margin.percent < 0 ? 'danger' : 'good'}
          icon={Activity}
        />
        <KpiCard
          label="Custo mês"
          value={formatBRL(monthlyCostTrend.current)}
          sub={monthlyCostTrend.deltaPercent !== 0 ? `${monthlyCostTrend.deltaPercent > 0 ? '+' : ''}${monthlyCostTrend.deltaPercent}% vs mês ant.` : ''}
          tone={monthlyCostTrend.deltaPercent > 20 ? 'warn' : 'neutral'}
          icon={Zap}
        />
        <KpiCard label="Leads" value={String(insights?.counts.leads ?? '—')} icon={Users} />
        <KpiCard label="Conv. ativas" value={String(insights?.counts.conversationsActive ?? '—')} icon={MessageSquare} sub={`/ ${insights?.counts.conversationsTotal ?? 0} total`} />
        <KpiCard label="LGPD pendentes" value={String(insights?.counts.lgpdPending ?? 0)} icon={ShieldAlert} tone={(insights?.counts.lgpdPending ?? 0) > 0 ? 'warn' : 'good'} />
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="usuarios">Usuários ({tenant.users.length})</TabsTrigger>
          <TabsTrigger value="convites">Convites ({invitations.length})</TabsTrigger>
          <TabsTrigger value="faturamento">Faturamento</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral" className="space-y-4 mt-4">
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Custos últimos 3 meses</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                LLM + WhatsApp + Maps por mês. Variação mês-a-mês destaca aumentos acima de 20%.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!insights || insights.usage3m.length === 0 ? (
                <div className="text-xs text-text-secondary py-4 text-center">Sem dados de uso ainda.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                        <th className="text-left py-2 px-2">Período</th>
                        <th className="text-right py-2 px-2">LLM</th>
                        <th className="text-right py-2 px-2">WhatsApp</th>
                        <th className="text-right py-2 px-2">Maps</th>
                        <th className="text-right py-2 px-2 font-bold">Total</th>
                        <th className="text-right py-2 px-2">Tokens IO</th>
                        <th className="text-right py-2 px-2">Msgs WA</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {insights.usage3m.map((u) => (
                        <tr key={u.periodMonth} className="hover:bg-surface-sunken/40">
                          <td className="py-2 px-2 font-mono">{u.periodMonth}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatBRL(u.llmCostCents)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatBRL(u.whatsappCostCents)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatBRL(u.googleMapsCostCents)}</td>
                          <td className="py-2 px-2 text-right font-mono font-bold">{formatBRL(u.totalCostCents)}</td>
                          <td className="py-2 px-2 text-right font-mono text-text-secondary">{(u.llmTokensInput + u.llmTokensOutput).toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right font-mono text-text-secondary">{u.whatsappMessagesSent.toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ActivityCard label="Scripts ativos" value={insights?.counts.scriptsActive ?? 0} icon={FileText} />
            <ActivityCard label="Reuniões agendadas" value={insights?.counts.meetingsScheduled ?? 0} icon={Calendar} />
            <ActivityCard
              label="Saúde integrações"
              value={tenant.integrationHealth.status}
              icon={Activity}
              tone={tenant.integrationHealth.status === 'critical' ? 'danger' : tenant.integrationHealth.status === 'fair' ? 'warn' : 'good'}
            />
          </div>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-4">
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-text-secondary" aria-hidden />
                Estado das integrações
              </CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Read-only. Use o painel do tenant para alterar credenciais reais.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <IntegrationGroup title="Evolution API (WhatsApp)">
                <CredCheck label="Base URL" ok={tenant.credentialState.evolution.baseUrlConfigured} />
                <CredCheck label="Instance" ok={tenant.credentialState.evolution.instanceConfigured} />
                <CredCheck label="API Token" ok={tenant.credentialState.evolution.tokenConfigured} />
                <CredCheck label="Webhook secret" ok={tenant.credentialState.evolution.webhookConfigured} />
              </IntegrationGroup>
              <IntegrationGroup title="Google">
                <CredCheck label="Calendar ID" ok={tenant.credentialState.google.calendarConfigured} />
                <CredCheck label="OAuth refresh" ok={tenant.credentialState.google.oauthConnected} />
                <CredCheck label="Maps API key" ok={tenant.credentialState.google.mapsConfigured} />
              </IntegrationGroup>
              <IntegrationGroup title={`AI · provider: ${tenant.credentialState.ai.provider ?? '—'}`}>
                <CredCheck label="OpenAI" ok={tenant.credentialState.ai.openaiConfigured} />
                <CredCheck label="Anthropic" ok={tenant.credentialState.ai.anthropicConfigured} />
                <CredCheck label="Google AI" ok={tenant.credentialState.ai.googleConfigured} />
              </IntegrationGroup>
              {tenant.integrationHealth.missing.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-[11px] text-amber-900">
                  <strong>Pendentes:</strong> {tenant.integrationHealth.missing.join(', ')}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usuarios" className="mt-4">
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Usuários do tenant</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                {tenant.users.length} usuário(s) cadastrado(s).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tenant.users.length === 0 ? (
                <div className="text-xs text-text-secondary py-4 text-center">Nenhum usuário cadastrado.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                        <th className="text-left py-2 px-2">Nome</th>
                        <th className="text-left py-2 px-2">E-mail</th>
                        <th className="text-left py-2 px-2">Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {tenant.users.map((u) => (
                        <tr key={u.id} className="hover:bg-surface-sunken/40">
                          <td className="py-2 px-2">{u.name}</td>
                          <td className="py-2 px-2 font-mono text-text-secondary">{u.email}</td>
                          <td className="py-2 px-2">
                            <Badge className="bg-surface-sunken text-text-secondary border border-border/60 text-[9px] px-1.5 py-0">{u.role}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="convites" className="mt-4">
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                    <Mail className="w-4 h-4 text-text-secondary" aria-hidden />
                    Convites de acesso
                  </CardTitle>
                  <CardDescription className="text-text-secondary text-xs">
                    Códigos de convite para registro de usuários neste tenant.
                  </CardDescription>
                </div>
                <Button
                  onClick={handleCreateInvitation}
                  disabled={invitationBusy !== null}
                  className="bg-primary hover:bg-primary-hover text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5"
                >
                  {invitationBusy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Gerar Novo Convite
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {invitationsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
                </div>
              ) : invitations.length === 0 ? (
                <div className="text-xs text-text-secondary py-4 text-center">Nenhum convite gerado.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                        <th className="text-left py-2 px-2">Código</th>
                        <th className="text-left py-2 px-2">Role</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Criado em</th>
                        <th className="text-left py-2 px-2">Expira em</th>
                        <th className="text-left py-2 px-2">Notas</th>
                        <th className="text-right py-2 px-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {invitations.map((inv) => {
                        const status = getInvitationStatus(inv);
                        return (
                          <tr key={inv.id} className="hover:bg-surface-sunken/40">
                            <td className="py-2 px-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-semibold text-text">{inv.code}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopyCode(inv.code)}
                                  className="text-text-secondary hover:text-text p-0.5 rounded"
                                  title="Copiar código"
                                >
                                  <Copy className="w-3 h-3" aria-hidden />
                                </button>
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <Badge className="bg-surface-sunken text-text-secondary border border-border/60 text-[9px] px-1.5 py-0">{inv.role}</Badge>
                            </td>
                            <td className="py-2 px-2">
                              <Badge className={`text-[9px] px-1.5 py-0 border ${INVITATION_STATUS_STYLE[status]}`}>
                                {INVITATION_STATUS_LABEL[status]}
                              </Badge>
                            </td>
                            <td className="py-2 px-2 text-text-secondary">{new Date(inv.createdAt).toLocaleDateString('pt-BR')}</td>
                            <td className="py-2 px-2 text-text-secondary">{new Date(inv.expiresAt).toLocaleDateString('pt-BR')}</td>
                            <td className="py-2 px-2 text-text-secondary truncate max-w-[150px]" title={inv.notes ?? ''}>{inv.notes || '—'}</td>
                            <td className="py-2 px-2 text-right">
                              {status === 'active' && (
                                <Button
                                  onClick={() => handleRevokeInvitation(inv.id)}
                                  disabled={invitationBusy !== null}
                                  className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[10px] px-2 h-7 rounded-md flex items-center gap-1 ml-auto"
                                >
                                  {invitationBusy === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                  Revogar
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faturamento" className="mt-4">
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Histórico de faturamento</CardTitle>
              <CardDescription className="text-text-secondary text-xs">
                Últimos 6 ciclos de cobrança · status atual + datas de vencimento e pagamento.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!insights || insights.billing.length === 0 ? (
                <div className="text-xs text-text-secondary py-4 text-center">Sem cobranças registradas.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                        <th className="text-left py-2 px-2">Período</th>
                        <th className="text-right py-2 px-2">Valor</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Vencimento</th>
                        <th className="text-left py-2 px-2">Pago em</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {insights.billing.map((b) => (
                        <tr key={b.id} className="hover:bg-surface-sunken/40">
                          <td className="py-2 px-2 font-mono">{b.periodMonth}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatBRL(b.totalCents)}</td>
                          <td className="py-2 px-2">
                            <Badge
                              className={`text-[9px] px-1.5 py-0 border ${
                                b.status === 'PAID' ? 'bg-success-soft text-success-text border-success/20'
                                  : b.status === 'OVERDUE' ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-300'
                              }`}
                            >
                              {b.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-text-secondary">{new Date(b.dueAt).toLocaleDateString('pt-BR')}</td>
                          <td className="py-2 px-2 text-text-secondary">{b.paidAt ? new Date(b.paidAt).toLocaleDateString('pt-BR') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  label, value, sub, icon: Icon, tone = 'neutral',
}: { label: string; value: string; sub?: string; icon: typeof DollarSign; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
  const toneClass = tone === 'good' ? 'text-success-text' : tone === 'warn' ? 'text-amber-700' : tone === 'danger' ? 'text-error-text' : 'text-text';
  return (
    <Card className="bg-white border-border shadow-sm">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">{label}</span>
            <span className={`text-lg font-bold font-heading font-mono block truncate ${toneClass}`} title={value}>{value}</span>
            {sub && <span className="text-[10px] text-text-secondary block mt-0.5">{sub}</span>}
          </div>
          <Icon className={`w-4 h-4 shrink-0 ${toneClass} opacity-70`} aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityCard({ label, value, icon: Icon, tone = 'neutral' }: { label: string; value: string | number; icon: typeof FileText; tone?: 'neutral' | 'good' | 'warn' | 'danger' }) {
  const toneClass = tone === 'good' ? 'text-success-text' : tone === 'warn' ? 'text-amber-700' : tone === 'danger' ? 'text-error-text' : 'text-text';
  return (
    <Card className="bg-white border-border shadow-sm">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">{label}</span>
            <span className={`text-base font-bold font-heading capitalize ${toneClass}`}>{value}</span>
          </div>
          <Icon className={`w-4 h-4 ${toneClass} opacity-70`} aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}

function IntegrationGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-bold text-text mb-2">{title}</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{children}</div>
    </div>
  );
}

function CredCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[10px] ${ok ? 'bg-success-soft/40 border-success/20 text-success-text' : 'bg-surface-sunken border-border text-text-secondary'}`}>
      {ok ? <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden /> : <AlertCircle className="w-3 h-3 shrink-0 opacity-60" aria-hidden />}
      <span className="font-medium truncate">{label}</span>
    </div>
  );
}
