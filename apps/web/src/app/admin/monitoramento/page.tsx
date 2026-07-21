'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input, toast } from '@prospix/ui';
import {
  Bell,
  CheckCircle2,
  Clock3,
  Loader2,
  PlayCircle,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { adminNextApi } from '@/lib/admin-api-fetch';

type Recipient = {
  id: string;
  label: string;
  whatsapp: string;
  active: boolean;
  report_enabled: boolean;
  disconnect_alerts_enabled: boolean;
  notes: string | null;
  created_at: string;
};

type Schedule = {
  id: string;
  name: string;
  recipient_id: string;
  active: boolean;
  interval_minutes: number;
  window_minutes: number;
  tenant_ids: string[] | null;
  include_numbers: boolean;
  include_recent_messages: boolean;
  next_run_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  admin_monitoring_recipients?: { id: string; label: string; whatsapp: string; active: boolean } | null;
};

type ReportRun = {
  id: string;
  schedule_id: string | null;
  recipient_id: string;
  status: string;
  period_start: string;
  period_end: string;
  ai_summary: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

type DisconnectDelivery = {
  id: string;
  tenant_id: string;
  recipient_id: string;
  status: string;
  reason_code: string;
  external_state: string | null;
  ai_summary: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  tenants?: { id: string; name: string; slug: string } | null;
  admin_monitoring_recipients?: { id: string; label: string; whatsapp: string } | null;
};

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

type Dashboard = {
  channel: {
    configured: boolean;
    source: string;
    instanceName: string | null;
    baseUrlConfigured: boolean;
    dispatcherReachable?: boolean;
    dispatcherError?: string | null;
  };
  summary: {
    recipients: number;
    activeRecipients: number;
    activeSchedules: number;
    failedReports24h: number;
    disconnectAlerts24h: number;
  };
  recipients: Recipient[];
  schedules: Schedule[];
  reportRuns: ReportRun[];
  disconnectDeliveries: DisconnectDelivery[];
  tenants: Tenant[];
};

const STATUS_STYLE: Record<string, string> = {
  SENT: 'bg-success-soft text-success-text border-success/30',
  RUNNING: 'bg-blue-50 text-blue-700 border-blue-200',
  PENDING: 'bg-amber-50 text-amber-800 border-amber-300',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  SKIPPED: 'bg-surface-sunken text-text-secondary border-border',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return 'n/d';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'n/d';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string): string {
  return STATUS_STYLE[status] || 'bg-surface-sunken text-text-secondary border-border';
}

export default function AdminMonitoringPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [createRecipientOpen, setCreateRecipientOpen] = useState(false);
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);

  const [recipientForm, setRecipientForm] = useState({
    label: '',
    whatsapp: '',
    reportEnabled: true,
    disconnectAlertsEnabled: true,
    notes: '',
  });

  const [scheduleForm, setScheduleForm] = useState({
    name: '',
    recipientId: '',
    intervalMinutes: 60,
    windowMinutes: 60,
    tenantScope: 'all',
    tenantId: '',
    includeNumbers: true,
    includeRecentMessages: true,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminNextApi.get('/api/admin/monitoring');
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao carregar.');
      setData(response.data as Dashboard);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar monitoramento.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeRecipients = useMemo(
    () => (data?.recipients || []).filter((recipient) => recipient.active),
    [data?.recipients],
  );

  const createRecipient = async () => {
    if (!recipientForm.label.trim() || !recipientForm.whatsapp.trim()) {
      toast.error('Campos obrigatorios', 'Informe nome e WhatsApp.');
      return;
    }

    setBusyKey('recipient:create');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'create_recipient',
        ...recipientForm,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao salvar destinatario.');
      toast.success('Destinatario salvo');
      setCreateRecipientOpen(false);
      setRecipientForm({ label: '', whatsapp: '', reportEnabled: true, disconnectAlertsEnabled: true, notes: '' });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao salvar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const createSchedule = async () => {
    if (!scheduleForm.name.trim() || !scheduleForm.recipientId) {
      toast.error('Campos obrigatorios', 'Informe nome e destinatario.');
      return;
    }

    setBusyKey('schedule:create');
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'create_schedule',
        name: scheduleForm.name,
        recipientId: scheduleForm.recipientId,
        intervalMinutes: scheduleForm.intervalMinutes,
        windowMinutes: scheduleForm.windowMinutes,
        tenantIds: scheduleForm.tenantScope === 'one' && scheduleForm.tenantId ? [scheduleForm.tenantId] : null,
        includeNumbers: scheduleForm.includeNumbers,
        includeRecentMessages: scheduleForm.includeRecentMessages,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao criar agenda.');
      toast.success('Agenda criada');
      setCreateScheduleOpen(false);
      setScheduleForm({
        name: '',
        recipientId: '',
        intervalMinutes: 60,
        windowMinutes: 60,
        tenantScope: 'all',
        tenantId: '',
        includeNumbers: true,
        includeRecentMessages: true,
      });
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao criar agenda.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const patchItem = async (type: 'recipient' | 'schedule', id: string, patch: Record<string, unknown>) => {
    setBusyKey(`${type}:${id}`);
    try {
      const response = await adminNextApi.patch('/api/admin/monitoring', { type, id, ...patch });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao atualizar.');
      toast.success('Atualizado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao atualizar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const deleteItem = async (type: 'recipient' | 'schedule', id: string) => {
    if (!confirm(type === 'recipient' ? 'Excluir destinatario?' : 'Excluir agenda?')) return;
    setBusyKey(`${type}:delete:${id}`);
    try {
      const response = await adminNextApi.delete(`/api/admin/monitoring?type=${type}&id=${id}`);
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao excluir.');
      toast.success('Excluido');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao excluir.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const sendTest = async (recipientId: string) => {
    setBusyKey(`test:${recipientId}`);
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'send_test',
        recipientId,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha no teste.');
      const result = response.data?.result?.result;
      if (result?.ok === false) throw new Error(result.error || 'Envio recusado pelo canal.');
      toast.success('Teste enviado');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha no teste.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const runScheduleNow = async (scheduleId: string) => {
    setBusyKey(`run:${scheduleId}`);
    try {
      const response = await adminNextApi.post('/api/admin/monitoring', {
        action: 'run_schedule_now',
        scheduleId,
      });
      if (!response.data?.ok) throw new Error(response.data?.message || 'Falha ao executar.');
      toast.success('Execucao solicitada');
      await load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao executar.';
      toast.error('Erro', message);
    } finally {
      setBusyKey(null);
    }
  };

  const channel = data?.channel;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Radio className="w-5 h-5 text-primary" aria-hidden />
            Monitoramento ativo
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Relatorios programados, alertas de desconexao e trilha auditavel de entregas administrativas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={load} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
            Atualizar
          </Button>
          <Button onClick={() => setCreateRecipientOpen((open) => !open)} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" aria-hidden />
            Destinatario
          </Button>
          <Button onClick={() => setCreateScheduleOpen((open) => !open)} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <Clock3 className="w-3.5 h-3.5" aria-hidden />
            Nova agenda
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card className="bg-white shadow-sm border-border">
          <CardContent className="pt-4 pb-3">
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Canal</span>
            <div className="mt-2 flex items-center gap-2">
              {channel?.configured ? <CheckCircle2 className="w-4 h-4 text-success-text" /> : <XCircle className="w-4 h-4 text-error-text" />}
              <span className="text-sm font-semibold text-text">{channel?.configured ? 'Configurado' : 'Pendente'}</span>
            </div>
            <p className="text-[10px] text-text-secondary mt-1 truncate">{channel?.source || 'n/d'}</p>
            {channel?.dispatcherReachable === false && (
              <p className="text-[10px] text-red-600 mt-1 truncate">dispatcher indisponivel</p>
            )}
          </CardContent>
        </Card>
        <MetricCard label="Destinatarios ativos" value={data?.summary.activeRecipients ?? 0} />
        <MetricCard label="Agendas ativas" value={data?.summary.activeSchedules ?? 0} />
        <MetricCard label="Falhas recentes" value={data?.summary.failedReports24h ?? 0} tone={(data?.summary.failedReports24h ?? 0) > 0 ? 'red' : 'normal'} />
        <MetricCard label="Alertas recentes" value={data?.summary.disconnectAlerts24h ?? 0} />
      </div>

      {createRecipientOpen && (
        <Card className="bg-white border-primary/30 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-heading text-text">Cadastrar destinatario</CardTitle>
            <CardDescription className="text-text-secondary text-xs">Numero em E.164; exemplo +5517999999999.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Nome">
                <Input value={recipientForm.label} onChange={(event) => setRecipientForm((form) => ({ ...form, label: event.target.value }))} className="h-9 text-xs" />
              </Field>
              <Field label="WhatsApp">
                <Input value={recipientForm.whatsapp} onChange={(event) => setRecipientForm((form) => ({ ...form, whatsapp: event.target.value }))} placeholder="+5517999999999" className="h-9 text-xs font-mono" />
              </Field>
              <Field label="Notas">
                <Input value={recipientForm.notes} onChange={(event) => setRecipientForm((form) => ({ ...form, notes: event.target.value }))} className="h-9 text-xs" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
              <CheckboxLabel checked={recipientForm.reportEnabled} onChange={(checked) => setRecipientForm((form) => ({ ...form, reportEnabled: checked }))} label="Receber relatorios" />
              <CheckboxLabel checked={recipientForm.disconnectAlertsEnabled} onChange={(checked) => setRecipientForm((form) => ({ ...form, disconnectAlertsEnabled: checked }))} label="Receber quedas" />
              <Button onClick={createRecipient} disabled={busyKey === 'recipient:create'} className="ml-auto bg-primary hover:bg-primary-hover text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
                {busyKey === 'recipient:create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Salvar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {createScheduleOpen && (
        <Card className="bg-white border-primary/30 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-heading text-text">Criar agenda</CardTitle>
            <CardDescription className="text-text-secondary text-xs">A primeira execucao fica programada para o fim do intervalo informado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <Field label="Nome">
                <Input value={scheduleForm.name} onChange={(event) => setScheduleForm((form) => ({ ...form, name: event.target.value }))} className="h-9 text-xs" />
              </Field>
              <Field label="Destinatario">
                <select value={scheduleForm.recipientId} onChange={(event) => setScheduleForm((form) => ({ ...form, recipientId: event.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50">
                  <option value="">Selecione</option>
                  {activeRecipients.map((recipient) => <option key={recipient.id} value={recipient.id}>{recipient.label}</option>)}
                </select>
              </Field>
              <Field label="Intervalo min">
                <Input type="number" min={5} max={1440} value={scheduleForm.intervalMinutes} onChange={(event) => setScheduleForm((form) => ({ ...form, intervalMinutes: Number(event.target.value) }))} className="h-9 text-xs" />
              </Field>
              <Field label="Janela min">
                <Input type="number" min={5} max={10080} value={scheduleForm.windowMinutes} onChange={(event) => setScheduleForm((form) => ({ ...form, windowMinutes: Number(event.target.value) }))} className="h-9 text-xs" />
              </Field>
              <Field label="Escopo">
                <select value={scheduleForm.tenantScope} onChange={(event) => setScheduleForm((form) => ({ ...form, tenantScope: event.target.value, tenantId: '' }))} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50">
                  <option value="all">Todos</option>
                  <option value="one">Um tenant</option>
                </select>
              </Field>
            </div>
            {scheduleForm.tenantScope === 'one' && (
              <Field label="Tenant">
                <select value={scheduleForm.tenantId} onChange={(event) => setScheduleForm((form) => ({ ...form, tenantId: event.target.value }))} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50">
                  <option value="">Selecione</option>
                  {(data?.tenants || []).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
                </select>
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-secondary">
              <CheckboxLabel checked={scheduleForm.includeNumbers} onChange={(checked) => setScheduleForm((form) => ({ ...form, includeNumbers: checked }))} label="Mostrar numeros" />
              <CheckboxLabel checked={scheduleForm.includeRecentMessages} onChange={(checked) => setScheduleForm((form) => ({ ...form, includeRecentMessages: checked }))} label="Mostrar mensagens recentes" />
              <Button onClick={createSchedule} disabled={busyKey === 'schedule:create'} className="ml-auto bg-primary hover:bg-primary-hover text-white text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
                {busyKey === 'schedule:create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock3 className="w-3.5 h-3.5" />}
                Salvar agenda
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && !data ? (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="py-10 flex items-center justify-center text-text-secondary text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Carregando monitoramento...
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Destinatarios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-text-secondary border-b border-border">
                    <tr>
                      <th className="py-2 pr-3">Nome</th>
                      <th className="py-2 pr-3">WhatsApp</th>
                      <th className="py-2 pr-3">Relatorio</th>
                      <th className="py-2 pr-3">Quedas</th>
                      <th className="py-2 pr-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.recipients || []).map((recipient) => (
                      <tr key={recipient.id} className="border-b border-border/50">
                        <td className="py-3 pr-3 font-semibold text-text">{recipient.label}</td>
                        <td className="py-3 pr-3 font-mono text-text-secondary">{recipient.whatsapp}</td>
                        <td className="py-3 pr-3"><BooleanBadge value={recipient.report_enabled} /></td>
                        <td className="py-3 pr-3"><BooleanBadge value={recipient.disconnect_alerts_enabled} /></td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <ActionButton title="Teste" busy={busyKey === `test:${recipient.id}`} onClick={() => sendTest(recipient.id)} icon={Send} />
                            <ActionButton title={recipient.active ? 'Pausar' : 'Ativar'} busy={busyKey === `recipient:${recipient.id}`} onClick={() => patchItem('recipient', recipient.id, { active: !recipient.active })} icon={recipient.active ? XCircle : CheckCircle2} />
                            <ActionButton title="Excluir" busy={busyKey === `recipient:delete:${recipient.id}`} onClick={() => deleteItem('recipient', recipient.id)} icon={Trash2} danger />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(data?.recipients || []).length === 0 && <EmptyRow columns={5} label="Nenhum destinatario cadastrado." />}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold font-heading text-text">Agendas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-text-secondary border-b border-border">
                    <tr>
                      <th className="py-2 pr-3">Nome</th>
                      <th className="py-2 pr-3">Destinatario</th>
                      <th className="py-2 pr-3">Intervalo</th>
                      <th className="py-2 pr-3">Proxima</th>
                      <th className="py-2 pr-3">Ultimo erro</th>
                      <th className="py-2 pr-3 text-right">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.schedules || []).map((schedule) => (
                      <tr key={schedule.id} className="border-b border-border/50">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-text">{schedule.name}</div>
                          <div className="text-[10px] text-text-secondary">{schedule.active ? 'Ativa' : 'Pausada'} - janela {schedule.window_minutes}min</div>
                        </td>
                        <td className="py-3 pr-3 text-text-secondary">{schedule.admin_monitoring_recipients?.label || schedule.recipient_id}</td>
                        <td className="py-3 pr-3 font-mono text-text-secondary">{schedule.interval_minutes}min</td>
                        <td className="py-3 pr-3 text-text-secondary">{formatDate(schedule.next_run_at)}</td>
                        <td className="py-3 pr-3 text-text-secondary max-w-[260px] truncate">{schedule.last_error || '-'}</td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center justify-end gap-2">
                            <ActionButton title="Executar" busy={busyKey === `run:${schedule.id}`} onClick={() => runScheduleNow(schedule.id)} icon={PlayCircle} />
                            <ActionButton title={schedule.active ? 'Pausar' : 'Ativar'} busy={busyKey === `schedule:${schedule.id}`} onClick={() => patchItem('schedule', schedule.id, { active: !schedule.active })} icon={schedule.active ? XCircle : CheckCircle2} />
                            <ActionButton title="Excluir" busy={busyKey === `schedule:delete:${schedule.id}`} onClick={() => deleteItem('schedule', schedule.id)} icon={Trash2} danger />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(data?.schedules || []).length === 0 && <EmptyRow columns={6} label="Nenhuma agenda cadastrada." />}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card className="bg-white border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold font-heading text-text">Ultimos relatorios</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.reportRuns || []).map((run) => (
                  <div key={run.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Badge className={`text-[9px] px-1.5 py-0 border ${statusClass(run.status)}`}>{run.status}</Badge>
                      <span className="text-[10px] text-text-secondary">{formatDate(run.created_at)}</span>
                    </div>
                    <p className="text-xs text-text mt-2 line-clamp-2">{run.ai_summary || run.error || 'Sem resumo registrado.'}</p>
                  </div>
                ))}
                {(data?.reportRuns || []).length === 0 && <p className="text-xs text-text-secondary py-4">Nenhum relatorio executado.</p>}
              </CardContent>
            </Card>

            <Card className="bg-white border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-bold font-heading text-text">Alertas de desconexao</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(data?.disconnectDeliveries || []).map((delivery) => (
                  <div key={delivery.id} className="border border-border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge className={`text-[9px] px-1.5 py-0 border ${statusClass(delivery.status)}`}>{delivery.status}</Badge>
                        <span className="text-xs font-semibold text-text truncate">{delivery.tenants?.name || delivery.tenant_id}</span>
                      </div>
                      <span className="text-[10px] text-text-secondary">{formatDate(delivery.sent_at || delivery.created_at)}</span>
                    </div>
                    <p className="text-[10px] font-mono text-text-secondary mt-2">{delivery.reason_code} / {delivery.external_state || 'sem estado'}</p>
                    <p className="text-xs text-text mt-1 line-clamp-2">{delivery.ai_summary || delivery.error || 'Sem resumo registrado.'}</p>
                  </div>
                ))}
                {(data?.disconnectDeliveries || []).length === 0 && <p className="text-xs text-text-secondary py-4">Nenhum alerta de desconexao entregue.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'red' }) {
  return (
    <Card className={`bg-white shadow-sm ${tone === 'red' ? 'border-red-300' : 'border-border'}`}>
      <CardContent className="pt-4 pb-3">
        <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">{label}</span>
        <span className={`text-2xl font-bold font-heading font-mono ${tone === 'red' ? 'text-error-text' : 'text-text'}`}>{value}</span>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">{label}</span>
      {children}
    </label>
  );
}

function CheckboxLabel({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30" />
      <span>{label}</span>
    </label>
  );
}

function BooleanBadge({ value }: { value: boolean }) {
  return (
    <Badge className={`text-[9px] px-1.5 py-0 border ${value ? 'bg-success-soft text-success-text border-success/30' : 'bg-surface-sunken text-text-secondary border-border'}`}>
      {value ? 'ON' : 'OFF'}
    </Badge>
  );
}

function ActionButton({
  title,
  busy,
  onClick,
  icon: Icon,
  danger = false,
}: {
  title: string;
  busy: boolean;
  onClick: () => void;
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={busy}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
        danger
          ? 'border-red-100 text-red-600 hover:bg-red-50'
          : 'border-border text-text-secondary hover:text-text hover:bg-surface-sunken'
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  );
}

function EmptyRow({ columns, label }: { columns: number; label: string }) {
  return (
    <tr>
      <td colSpan={columns} className="py-8 text-center text-xs text-text-secondary">{label}</td>
    </tr>
  );
}
