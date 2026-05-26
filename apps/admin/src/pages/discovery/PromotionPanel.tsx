import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { Shield, Rocket, CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { adminApiClient } from '../../lib/api-client';
import { AxiosError } from 'axios';

interface GateField {
  count: number;
  required: number;
  ok: boolean;
}

interface ScriptGate {
  variations: number;
  nodes: number;
  ok: boolean;
}

interface QualityReport {
  voiceProfile: {
    objections: GateField;
    complianceNever: GateField;
  };
  scripts: {
    medicos: ScriptGate;
    advogados: ScriptGate;
    empresarios: ScriptGate;
  };
  approvalProof: boolean;
  pmAssigned: boolean;
  statusApproved: boolean;
  allOk: boolean;
  blockingReasons: string[];
}

interface PromotionPanelProps {
  tenantId: string;
  discoveryStatus: string;
  validationRounds: number;
  onChanged: () => void;
}

export function PromotionPanel({ tenantId, discoveryStatus, validationRounds, onChanged }: PromotionPanelProps) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState<'validate' | 'approve' | 'promote' | null>(null);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const response = await adminApiClient.get(`/admin/tenants/${tenantId}/discovery/quality`);
      setReport(response.data?.data ?? null);
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao calcular gates.'
        : 'Falha ao calcular gates.';
      toast.error('Erro de gates', message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleValidate = async () => {
    if (validationRounds >= 2) {
      toast.error('Rodadas esgotadas', 'Máximo de 2 rodadas atingido. Reavalie escopo.');
      return;
    }
    setBusy('validate');
    try {
      await adminApiClient.post(`/admin/tenants/${tenantId}/discovery/validate`);
      toast.success('Validação registrada', `Rodada ${validationRounds + 1}/2 confirmada.`);
      onChanged();
      await fetchReport();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao validar.'
        : 'Falha ao validar.';
      toast.error('Erro', message);
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (!confirm('Confirmar aprovação formal? O tenant é marcado como APPROVED e habilita promoção.')) return;
    setBusy('approve');
    try {
      await adminApiClient.post(`/admin/tenants/${tenantId}/discovery/approve`);
      toast.success('Discovery aprovada', 'Status agora é APPROVED.');
      onChanged();
      await fetchReport();
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao aprovar.'
        : 'Falha ao aprovar.';
      toast.error('Erro', message);
    } finally {
      setBusy(null);
    }
  };

  const handlePromote = async () => {
    if (!confirm('PROMOVER PARA PRODUÇÃO?\n\nIsso vai:\n- Criar 3 Scripts ACTIVE (médicos/advogados/empresários)\n- Substituir Tenant.aiVoiceProfile\n- Registrar audit log\n\nNão pode ser desfeito automaticamente.')) return;
    setBusy('promote');
    try {
      const response = await adminApiClient.post(`/admin/tenants/${tenantId}/discovery/promote`);
      const created = response.data?.data?.scriptsCreated ?? [];
      toast.success('Promovido!', `${created.length} scripts criados · voice profile aplicado.`);
      onChanged();
      await fetchReport();
    } catch (err: unknown) {
      const blockingReasons = err instanceof AxiosError ? err.response?.data?.blockingReasons : null;
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Falha ao promover.'
        : 'Falha ao promover.';
      if (Array.isArray(blockingReasons) && blockingReasons.length > 0) {
        toast.error('Gates bloquearam promoção', blockingReasons.slice(0, 2).join(' · '));
      } else {
        toast.error('Erro', message);
      }
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6" role="status">
        <Loader2 className="w-4 h-4 animate-spin text-text-secondary" aria-label="Carregando gates" />
      </div>
    );
  }

  if (!report) return null;

  return (
    <Card className="bg-white border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" aria-hidden />
              Gates de qualidade + ações
            </CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Validate → Approve → Promote. Promoção criará 3 Scripts ACTIVE + aplicará voice profile no tenant.
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={fetchReport}
            className="text-text-secondary hover:text-text p-1 rounded"
            aria-label="Recarregar gates"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
          <GateRow label="objections ≥6" current={report.voiceProfile.objections.count} required={6} ok={report.voiceProfile.objections.ok} />
          <GateRow label="compliance_never ≥3" current={report.voiceProfile.complianceNever.count} required={3} ok={report.voiceProfile.complianceNever.ok} />
          <GateRow label="médicos · ≥3 var + ≥5 nodes" current={`${report.scripts.medicos.variations}/${report.scripts.medicos.nodes}`} required="3/5" ok={report.scripts.medicos.ok} />
          <GateRow label="advogados · ≥3 var + ≥5 nodes" current={`${report.scripts.advogados.variations}/${report.scripts.advogados.nodes}`} required="3/5" ok={report.scripts.advogados.ok} />
          <GateRow label="empresários · ≥3 var + ≥5 nodes" current={`${report.scripts.empresarios.variations}/${report.scripts.empresarios.nodes}`} required="3/5" ok={report.scripts.empresarios.ok} />
          <GateRow label="prova de aprovação carregada" current={report.approvalProof ? 'sim' : 'não'} required="sim" ok={report.approvalProof} />
          <GateRow label="PM atribuído" current={report.pmAssigned ? 'sim' : 'não'} required="sim" ok={report.pmAssigned} />
          <GateRow label="status APPROVED" current={report.statusApproved ? 'sim' : `atual: ${discoveryStatus}`} required="APPROVED" ok={report.statusApproved} />
        </div>

        {report.blockingReasons.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-[10px] text-amber-900 space-y-1" role="status">
            <div className="font-semibold flex items-center gap-1">
              <AlertCircle className="w-3 h-3" aria-hidden />
              Bloqueios para promoção:
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {report.blockingReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
          <Button
            onClick={handleValidate}
            disabled={busy !== null || validationRounds >= 2}
            className="bg-white hover:bg-surface-sunken text-text border border-border font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
            aria-label={`Marcar rodada de validação ${validationRounds + 1}/2`}
          >
            {busy === 'validate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Marcar validação ({validationRounds}/2)
          </Button>
          <Button
            onClick={handleApprove}
            disabled={busy !== null || !report.approvalProof || !report.pmAssigned || report.statusApproved}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
            Aprovar formalmente
          </Button>
          <Button
            onClick={handlePromote}
            disabled={busy !== null || !report.allOk}
            className="bg-primary hover:bg-primary-hover text-white font-bold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy === 'promote' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
            PROMOVER PRA PRODUÇÃO
          </Button>
          {report.allOk && (
            <Badge className="bg-success-soft text-success-text border border-success/30 text-[10px] px-2">
              Gates OK
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GateRow({ label, current, required, ok }: { label: string; current: string | number; required: string | number; ok: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded border ${
        ok ? 'bg-success-soft/40 border-success/30 text-success-text' : 'bg-amber-50 border-amber-300 text-amber-900'
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {ok ? <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden /> : <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />}
        <span className="font-medium truncate">{label}</span>
      </div>
      <span className="font-mono whitespace-nowrap text-[9px]">
        {current} <span className="opacity-60">/ req: {required}</span>
      </span>
    </div>
  );
}

export default PromotionPanel;
