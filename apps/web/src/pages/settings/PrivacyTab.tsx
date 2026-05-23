/**
 * Settings · Privacidade & Dados (AUD-P2-033).
 *
 * UX operacional dos direitos do titular LGPD:
 *  - Solicitar exportação de dados (art. 18 V)
 *  - Solicitar exclusão de lead específico (art. 18 VI)
 *  - Solicitar exclusão completa do tenant (art. 18 VI)
 *  - Confirmação da existência de dados (art. 18 I)
 *  - Cancelar solicitação ainda PENDING
 *
 * Backend: /v1/tenant/lgpd/requests
 * Schema model: LgpdRequest (PENDING -> PROCESSING -> COMPLETED | REJECTED | CANCELED)
 */
import { useState, useEffect } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  Badge,
  Modal,
  Skeleton,
  toast,
} from '@prospix/ui';
import { Download, Trash2, FileText, AlertTriangle, Clock, X, RotateCw, Inbox } from 'lucide-react';
import { apiClient } from '../../lib/api-client';

type LgpdRequestType =
  | 'EXPORT_DATA'
  | 'DELETE_TENANT_DATA'
  | 'DELETE_LEAD_DATA'
  | 'CORRECT_DATA'
  | 'CONFIRM_DATA';

type LgpdRequestStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'REJECTED' | 'CANCELED';

interface LgpdRequestView {
  id: string;
  type: LgpdRequestType;
  status: LgpdRequestStatus;
  scope?: Record<string, unknown> | null;
  downloadUrl?: string | null;
  downloadExpiresAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  processedAt?: string | null;
  updatedAt: string;
}

const TYPE_LABELS: Record<LgpdRequestType, string> = {
  EXPORT_DATA: 'Exportar meus dados',
  DELETE_TENANT_DATA: 'Excluir minha conta',
  DELETE_LEAD_DATA: 'Excluir dados de um lead',
  CORRECT_DATA: 'Corrigir dados',
  CONFIRM_DATA: 'Confirmar dados',
};

const STATUS_LABELS: Record<LgpdRequestStatus, string> = {
  PENDING: 'Aguardando',
  PROCESSING: 'Em processamento',
  COMPLETED: 'Concluída',
  REJECTED: 'Recusada',
  CANCELED: 'Cancelada',
};

function statusBadge(status: LgpdRequestStatus) {
  switch (status) {
    case 'PENDING':
      return <Badge variant="warning">{STATUS_LABELS[status]}</Badge>;
    case 'PROCESSING':
      return <Badge variant="primary">{STATUS_LABELS[status]}</Badge>;
    case 'COMPLETED':
      return <Badge variant="success">{STATUS_LABELS[status]}</Badge>;
    case 'REJECTED':
      return <Badge variant="error">{STATUS_LABELS[status]}</Badge>;
    case 'CANCELED':
      return <Badge variant="neutral">{STATUS_LABELS[status]}</Badge>;
  }
}

export default function PrivacyTab() {
  const [requests, setRequests] = useState<LgpdRequestView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Modal states
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [deleteLeadModalOpen, setDeleteLeadModalOpen] = useState(false);
  const [deleteAccountModalOpen, setDeleteAccountModalOpen] = useState(false);
  const [leadWhatsapp, setLeadWhatsapp] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const fetchRequests = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await apiClient.get<{ data: LgpdRequestView[] }>('/tenant/lgpd/requests');
      setRequests(response.data?.data ?? []);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Não foi possível carregar suas solicitações LGPD.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const createRequest = async (
    type: LgpdRequestType,
    scope?: Record<string, unknown>,
  ): Promise<boolean> => {
    setIsCreating(true);
    try {
      await apiClient.post('/tenant/lgpd/requests', { type, scope });
      toast.success(
        'Solicitação registrada',
        'Resposta em até 15 dias úteis conforme LGPD art. 19.',
      );
      await fetchRequests();
      return true;
    } catch (err: unknown) {
      const error = err as {
        response?: { status?: number; data?: { error?: { code?: string; message?: string } } };
      };
      const code = error?.response?.data?.error?.code;
      const message = error?.response?.data?.error?.message;

      if (code === 'RATE_LIMITED') {
        toast.error('Limite atingido', message || 'Aguarde solicitações em andamento serem processadas.');
      } else if (code === 'VALIDATION_ERROR') {
        toast.error('Dados inválidos', message || 'Confira os campos da solicitação.');
      } else {
        toast.error('Erro ao registrar', message || 'Tente novamente em instantes.');
      }
      return false;
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    try {
      await apiClient.post(`/tenant/lgpd/requests/${requestId}/cancel`);
      toast.success('Solicitação cancelada', 'A solicitação foi marcada como cancelada.');
      await fetchRequests();
    } catch (err) {
      toast.error('Erro ao cancelar', 'Não foi possível cancelar agora. Tente novamente.');
    }
  };

  const handleExport = async () => {
    const ok = await createRequest('EXPORT_DATA');
    if (ok) setExportModalOpen(false);
  };

  const handleDeleteLead = async () => {
    if (!leadWhatsapp.trim()) {
      toast.error('Campo obrigatório', 'Informe o WhatsApp do lead a ser excluído.');
      return;
    }
    const ok = await createRequest('DELETE_LEAD_DATA', { lead_whatsapp: leadWhatsapp.trim() });
    if (ok) {
      setDeleteLeadModalOpen(false);
      setLeadWhatsapp('');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'EXCLUIR MINHA CONTA') {
      toast.error('Confirmação inválida', 'Digite exatamente "EXCLUIR MINHA CONTA" para confirmar.');
      return;
    }
    const ok = await createRequest('DELETE_TENANT_DATA');
    if (ok) {
      setDeleteAccountModalOpen(false);
      setDeleteConfirmText('');
    }
  };

  return (
    <div className="space-y-6" data-testid="privacy-tab">
      {/* ── Informações sobre direitos LGPD ──────────────────────────────── */}
      <Card className="bg-primary-soft border-primary/20 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Seus direitos LGPD
          </CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, art. 18), você tem o direito
            de solicitar exportação, correção, exclusão e confirmação dos seus dados. SLA de resposta:
            <strong className="text-text"> 15 dias úteis</strong>.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* ── Ações disponíveis ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-white border-border shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-primary-soft flex items-center justify-center mb-2">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-sm font-bold text-text">Exportar meus dados</CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Receba ZIP com leads, conversas, reuniões e roteiros (art. 18 V).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="compact"
              onClick={() => setExportModalOpen(true)}
              className="w-full"
              data-testid="lgpd-export-trigger"
            >
              Solicitar exportação
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-white border-border shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-warning-soft flex items-center justify-center mb-2">
              <Trash2 className="w-5 h-5 text-warning-text" />
            </div>
            <CardTitle className="text-sm font-bold text-text">Excluir dados de um lead</CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Atende solicitação do próprio lead via WhatsApp (art. 18 VI).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="compact"
              onClick={() => setDeleteLeadModalOpen(true)}
              className="w-full"
              data-testid="lgpd-delete-lead-trigger"
            >
              Solicitar exclusão de lead
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-white border-error/20 shadow-sm hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="w-10 h-10 rounded-lg bg-error-soft flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-error-text" />
            </div>
            <CardTitle className="text-sm font-bold text-text">Excluir minha conta</CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Apaga tenant inteiro · ação irreversível (art. 18 VI).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="compact"
              onClick={() => setDeleteAccountModalOpen(true)}
              className="w-full text-error-text border-error/40 hover:bg-error-soft"
              data-testid="lgpd-delete-account-trigger"
            >
              Solicitar encerramento
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Histórico de solicitações ───────────────────────────────────── */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold font-heading text-text">
              Histórico de solicitações
            </CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Últimas 100 solicitações LGPD do seu tenant.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="compact"
            onClick={fetchRequests}
            className="flex items-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3" data-testid="lgpd-loading-state">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={`lgpd-skel-${idx}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border-subtle"
                >
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-2 w-24" />
                  </div>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div
              className="flex flex-col items-center justify-center gap-3 py-10"
              data-testid="lgpd-error-state"
            >
              <div className="w-12 h-12 rounded-full bg-error-soft flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-error-text" />
              </div>
              <div className="text-center max-w-md">
                <div className="text-sm font-semibold text-text">Erro ao carregar histórico</div>
                <div className="text-xs text-text-secondary mt-1">{loadError}</div>
              </div>
              <Button
                variant="outline"
                size="compact"
                onClick={fetchRequests}
                className="flex items-center gap-1.5"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : requests.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-3 py-10"
              data-testid="lgpd-empty-state"
            >
              <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center">
                <Inbox className="w-6 h-6 text-text-muted" />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold text-text">Nenhuma solicitação registrada</div>
                <div className="text-xs text-text-secondary mt-1 max-w-md">
                  Quando você (ou um lead seu via WhatsApp) registrar uma solicitação LGPD, ela
                  aparece aqui com status em tempo real.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border-subtle hover:bg-surface-sunken/40 transition-all"
                  data-testid={`lgpd-request-${r.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-text">{TYPE_LABELS[r.type]}</span>
                      {statusBadge(r.status)}
                    </div>
                    <div className="text-[11px] text-text-muted font-mono">
                      ID: {r.id} · criada em {new Date(r.createdAt).toLocaleDateString('pt-BR')}
                      {r.scope?.lead_whatsapp ? ` · lead ${String(r.scope.lead_whatsapp)}` : ''}
                    </div>
                    {r.rejectionReason && (
                      <div className="text-[11px] text-error-text mt-1">{r.rejectionReason}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    {r.status === 'COMPLETED' && r.downloadUrl && (
                      <a
                        href={r.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        Baixar
                      </a>
                    )}
                    {r.status === 'PENDING' && (
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => handleCancelRequest(r.id)}
                        className="text-[10px] font-bold text-text-secondary hover:text-error"
                      >
                        <X className="w-3 h-3 mr-1" />
                        Cancelar
                      </Button>
                    )}
                    {r.status === 'PROCESSING' && (
                      <span className="text-[10px] text-text-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Em andamento
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Modal: Exportar dados ───────────────────────────────────────── */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Exportar meus dados"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="compact"
              onClick={() => setExportModalOpen(false)}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="compact"
              onClick={handleExport}
              disabled={isCreating}
              data-testid="lgpd-export-confirm"
            >
              {isCreating ? 'Registrando...' : 'Confirmar solicitação'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-secondary">
          Você receberá um arquivo ZIP com seus leads, conversas, reuniões, roteiros e configurações
          do tenant. O link de download fica disponível por 7 dias após a geração.
        </p>
        <p className="text-xs text-text-muted mt-3">
          SLA: até 15 dias úteis (LGPD art. 19). Você pode cancelar enquanto a solicitação estiver PENDING.
        </p>
      </Modal>

      {/* ── Modal: Excluir dados de lead ────────────────────────────────── */}
      <Modal
        isOpen={deleteLeadModalOpen}
        onClose={() => {
          setDeleteLeadModalOpen(false);
          setLeadWhatsapp('');
        }}
        title="Excluir dados de um lead"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="compact"
              onClick={() => {
                setDeleteLeadModalOpen(false);
                setLeadWhatsapp('');
              }}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="compact"
              onClick={handleDeleteLead}
              disabled={isCreating || !leadWhatsapp.trim()}
              data-testid="lgpd-delete-lead-confirm"
            >
              {isCreating ? 'Registrando...' : 'Solicitar exclusão'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-secondary mb-3">
          Use quando um lead solicitar a exclusão dos próprios dados (LGPD art. 18 VI). Operação
          afeta: mensagens, eventos do lead, perfil; mantém apenas registro em <code>optouts</code> para
          evitar reabordagem futura.
        </p>
        <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
          WhatsApp do lead
        </label>
        <Input
          value={leadWhatsapp}
          onChange={(e) => setLeadWhatsapp(e.target.value)}
          placeholder="+5517998764422"
          className="bg-white border-border text-text text-xs h-10"
          data-testid="lgpd-delete-lead-input"
        />
        <p className="text-xs text-text-muted mt-3">
          SLA: 15 dias úteis. Após COMPLETED, dados são anonimizados (não é possível restaurar).
        </p>
      </Modal>

      {/* ── Modal: Excluir conta inteira ────────────────────────────────── */}
      <Modal
        isOpen={deleteAccountModalOpen}
        onClose={() => {
          setDeleteAccountModalOpen(false);
          setDeleteConfirmText('');
        }}
        title="Encerrar e excluir minha conta"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="compact"
              onClick={() => {
                setDeleteAccountModalOpen(false);
                setDeleteConfirmText('');
              }}
              disabled={isCreating}
            >
              Manter conta
            </Button>
            <Button
              variant="danger"
              size="compact"
              onClick={handleDeleteAccount}
              disabled={isCreating || deleteConfirmText !== 'EXCLUIR MINHA CONTA'}
              data-testid="lgpd-delete-account-confirm"
            >
              {isCreating ? 'Registrando...' : 'Solicitar encerramento'}
            </Button>
          </div>
        }
      >
        <div className="bg-error-soft border border-error/20 rounded-lg p-3 mb-4">
          <p className="text-sm text-error-text font-semibold mb-2">⚠️ Esta ação é irreversível</p>
          <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
            <li>Todos os leads, conversas e reuniões serão deletados após período de carência (7 dias)</li>
            <li>Integrações WhatsApp/Calendar serão desconectadas</li>
            <li>Faturas em aberto seguem ativas (cobrança continua até quitar)</li>
            <li>Dados de auditoria fiscal são preservados por obrigação legal (5 anos)</li>
          </ul>
        </div>
        <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
          Digite <strong>EXCLUIR MINHA CONTA</strong> para confirmar:
        </label>
        <Input
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder="EXCLUIR MINHA CONTA"
          className="bg-white border-border text-text text-xs h-10"
          data-testid="lgpd-delete-account-confirmation-input"
        />
        <p className="text-xs text-text-muted mt-3">
          SLA: 15 dias úteis para processamento + período de carência de 7 dias antes da deleção
          definitiva.
        </p>
      </Modal>
    </div>
  );
}
