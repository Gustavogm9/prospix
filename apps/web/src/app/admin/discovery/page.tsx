'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Badge, Button, Input, toast } from '@prospix/ui';
import { Compass, Loader2, AlertCircle, Save, FileText } from 'lucide-react';
import { supabaseAdmin } from '@/lib/supabase';
import { adminTenantsQueries } from '@/lib/admin-queries';
import { MaterialsUploader } from './discovery/MaterialsUploader';
import { DraftsEditor } from './discovery/DraftsEditor';
import { PromotionPanel } from './discovery/PromotionPanel';

type DiscoveryStatus =
  | 'NOT_STARTED'
  | 'SCHEDULED'
  | 'IN_SESSION'
  | 'CONSOLIDATING'
  | 'VALIDATING'
  | 'APPROVED'
  | 'CHURNED_BEFORE_APPROVAL';

const STATUS_FLOW: DiscoveryStatus[] = ['NOT_STARTED', 'SCHEDULED', 'IN_SESSION', 'CONSOLIDATING', 'VALIDATING', 'APPROVED'];

const STATUS_LABEL: Record<DiscoveryStatus, string> = {
  NOT_STARTED: 'Não iniciada',
  SCHEDULED: 'Agendada',
  IN_SESSION: 'Em sessão',
  CONSOLIDATING: 'Consolidando',
  VALIDATING: 'Validando',
  APPROVED: 'Aprovada',
  CHURNED_BEFORE_APPROVAL: 'Churn pré-aprovação',
};

const STATUS_COLOR: Record<DiscoveryStatus, string> = {
  NOT_STARTED: 'bg-surface-sunken text-text-secondary border-border/60',
  SCHEDULED: 'bg-blue-50 text-blue-700 border-blue-200',
  IN_SESSION: 'bg-amber-50 text-amber-800 border-amber-200',
  CONSOLIDATING: 'bg-purple-50 text-purple-700 border-purple-200',
  VALIDATING: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  APPROVED: 'bg-success-soft text-success-text border-success/30',
  CHURNED_BEFORE_APPROVAL: 'bg-red-50 text-red-700 border-red-200',
};

interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface DiscoveryPayload {
  tenantId: string;
  status: DiscoveryStatus;
  scheduledFor: string | null;
  conductedAt: string | null;
  validatedAt: string | null;
  validationRounds: number;
  approvedAt: string | null;
  pmUserId: string | null;
  notes: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  hasTranscript: boolean;
  hasVoiceProfileDraft: boolean;
  hasScriptsDraft: boolean;
  hasApprovalProof: boolean;
  createdAt: string;
  updatedAt: string;
}

function toInputDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function fromInputDateTime(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function mapRowToPayload(row: any): DiscoveryPayload {
  return {
    tenantId: row.tenant_id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    conductedAt: row.conducted_at,
    validatedAt: row.validated_at,
    validationRounds: row.validation_rounds ?? 0,
    approvedAt: row.approved_at,
    pmUserId: row.pm_user_id,
    notes: row.notes,
    hasAudio: row.has_audio ?? false,
    hasVideo: row.has_video ?? false,
    hasTranscript: row.has_transcript ?? false,
    hasVoiceProfileDraft: row.has_voice_profile_draft ?? false,
    hasScriptsDraft: row.has_scripts_draft ?? false,
    hasApprovalProof: row.has_approval_proof ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default function Discovery() {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [isLoadingTenants, setIsLoadingTenants] = useState(true);

  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [discovery, setDiscovery] = useState<DiscoveryPayload | null>(null);
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const [draftStatus, setDraftStatus] = useState<DiscoveryStatus>('NOT_STARTED');
  const [draftScheduledFor, setDraftScheduledFor] = useState('');
  const [draftConductedAt, setDraftConductedAt] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoadingTenants(true);
      setTenantsError(null);
      try {
        const result = await adminTenantsQueries.list();
        if (result.error) throw new Error(result.error.message);
        const list: TenantSummary[] = (result.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
        }));
        setTenants(list);
        if (list[0]) setSelectedTenantId(list[0].id);
      } catch (err: unknown) {
        const message = err instanceof Error
          ? err.message
          : 'Falha ao carregar tenants.';
        setTenantsError(message);
      } finally {
        setIsLoadingTenants(false);
      }
    })();
  }, []);

  const refreshDiscovery = async (id: string, silent = false) => {
    if (!silent) setIsLoadingDiscovery(true);
    setDiscoveryError(null);
    try {
      const { data: row, error } = await supabaseAdmin
        .from('discoveries')
        .select('*')
        .eq('tenant_id', id)
        .maybeSingle();

      if (error) throw error;

      if (!row) {
        // No discovery record yet — create a fresh default
        const { data: newRow, error: insertError } = await supabaseAdmin
          .from('discoveries')
          .insert({ tenant_id: id, status: 'NOT_STARTED' })
          .select('*')
          .single();
        if (insertError) throw insertError;
        const payload = mapRowToPayload(newRow);
        setDiscovery(payload);
        if (!silent) {
          setDraftStatus(payload.status);
          setDraftScheduledFor(toInputDateTime(payload.scheduledFor));
          setDraftConductedAt(toInputDateTime(payload.conductedAt));
          setDraftNotes(payload.notes ?? '');
        }
        return;
      }

      const payload = mapRowToPayload(row);
      setDiscovery(payload);
      if (!silent) {
        setDraftStatus(payload.status);
        setDraftScheduledFor(toInputDateTime(payload.scheduledFor));
        setDraftConductedAt(toInputDateTime(payload.conductedAt));
        setDraftNotes(payload.notes ?? '');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar discovery.';
      setDiscoveryError(message);
      if (!silent) setDiscovery(null);
    } finally {
      if (!silent) setIsLoadingDiscovery(false);
    }
  };

  useEffect(() => {
    if (!selectedTenantId) return;
    refreshDiscovery(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  const progressIndex = useMemo(() => STATUS_FLOW.indexOf(draftStatus), [draftStatus]);
  const progressPercent = progressIndex >= 0 ? Math.round(((progressIndex + 1) / STATUS_FLOW.length) * 100) : 0;

  const handleSave = async () => {
    if (!selectedTenantId) return;
    setIsSaving(true);
    try {
      const updateData: Record<string, any> = {
        status: draftStatus,
        scheduled_for: fromInputDateTime(draftScheduledFor),
        conducted_at: fromInputDateTime(draftConductedAt),
        notes: draftNotes || null,
      };

      const { data: updatedRow, error } = await supabaseAdmin
        .from('discoveries')
        .update(updateData)
        .eq('tenant_id', selectedTenantId)
        .select('*')
        .single();

      if (error) throw error;

      const payload = mapRowToPayload(updatedRow);
      setDiscovery(payload);
      toast.success('Discovery atualizada', `Status: ${STATUS_LABEL[payload.status]}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao salvar discovery.';
      toast.error('Erro ao salvar', message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Compass className="w-5 h-5 text-primary" aria-hidden />
            Discovery &amp; Onboarding
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Frente G · Nível 1 · tracking manual da sessão de descoberta até a aprovação para promoção.
          </p>
        </div>
      </div>

      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">Selecionar tenant</CardTitle>
          <CardDescription className="text-text-secondary text-xs">
            Escolha o tenant para visualizar e atualizar o progresso da discovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTenants ? (
            <div className="flex items-center gap-2 text-text-secondary text-xs">
              <Loader2 className="w-4 h-4 animate-spin" aria-label="Carregando tenants" />
              Carregando tenants...
            </div>
          ) : tenantsError ? (
            <div className="flex items-center gap-2 text-error-text text-xs" role="alert">
              <AlertCircle className="w-4 h-4" aria-hidden />
              {tenantsError}
            </div>
          ) : (
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs text-text focus:border-border-strong focus:outline-none"
              aria-label="Selecionar tenant"
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {t.slug} · {t.status}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {selectedTenantId && (
        <>
          {isLoadingDiscovery ? (
            <div className="flex items-center justify-center py-10" role="status">
              <Loader2 className="w-5 h-5 animate-spin text-text-secondary" aria-label="Carregando discovery" />
            </div>
          ) : discoveryError ? (
            <Card className="bg-white border-error/30 shadow-sm">
              <CardContent className="py-10 text-center">
                <AlertCircle className="w-8 h-8 text-error-text mx-auto mb-2" aria-hidden />
                <p className="text-sm text-text font-semibold">{discoveryError}</p>
              </CardContent>
            </Card>
          ) : discovery ? (
            <>
              <Card className="bg-white border-border shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold font-heading text-text">
                        Estado atual
                      </CardTitle>
                      <CardDescription className="text-text-secondary text-xs">
                        Atualizado em {new Date(discovery.updatedAt).toLocaleString('pt-BR')}
                      </CardDescription>
                    </div>
                    <Badge className={`text-[10px] px-2 py-0.5 border ${STATUS_COLOR[discovery.status]}`}>
                      {STATUS_LABEL[discovery.status]}
                    </Badge>
                  </div>
                  <div
                    className="w-full bg-surface-sunken rounded-full h-1.5 mt-3 overflow-hidden"
                    role="progressbar"
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Progresso da discovery"
                  >
                    <div className="bg-primary h-full transition-all" style={{ width: `${progressPercent}%` }} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="d-status" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                        Status
                      </label>
                      <select
                        id="d-status"
                        value={draftStatus}
                        onChange={(e) => setDraftStatus(e.target.value as DiscoveryStatus)}
                        className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs text-text focus:border-border-strong focus:outline-none"
                      >
                        {(Object.keys(STATUS_LABEL) as DiscoveryStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="d-scheduled" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                        Agendada para
                      </label>
                      <Input
                        id="d-scheduled"
                        type="datetime-local"
                        value={draftScheduledFor}
                        onChange={(e) => setDraftScheduledFor(e.target.value)}
                        className="bg-white border-border text-text text-xs h-10"
                      />
                    </div>
                    <div>
                      <label htmlFor="d-conducted" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                        Realizada em
                      </label>
                      <Input
                        id="d-conducted"
                        type="datetime-local"
                        value={draftConductedAt}
                        onChange={(e) => setDraftConductedAt(e.target.value)}
                        className="bg-white border-border text-text text-xs h-10"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                        Rodadas de validação
                      </label>
                      <Input
                        readOnly
                        value={`${discovery.validationRounds}/2`}
                        className="bg-surface-sunken border-border text-text-secondary text-xs h-10"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="d-notes" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">
                      Anotações
                    </label>
                    <textarea
                      id="d-notes"
                      value={draftNotes}
                      onChange={(e) => setDraftNotes(e.target.value)}
                      maxLength={8000}
                      rows={6}
                      className="w-full bg-white border border-border rounded-lg px-3 py-2 text-xs text-text focus:border-border-strong focus:outline-none resize-y"
                      placeholder="Observações sobre a sessão, follow-ups pendentes, pontos sensíveis..."
                    />
                  </div>

                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-10 rounded-xl flex items-center gap-2 disabled:opacity-60"
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {isSaving ? 'Salvando...' : 'Salvar alterações'}
                  </Button>
                </CardContent>
              </Card>

              <Card className="bg-white border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                    <FileText className="w-4 h-4 text-text-secondary" aria-hidden />
                    Materiais da sessão
                  </CardTitle>
                  <CardDescription className="text-text-secondary text-xs">
                    Áudio/vídeo/transcrição da call + prova de aprovação do owner. Uploads diretos ao Cloudflare R2 (presigned).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <MaterialsUploader
                    tenantId={selectedTenantId}
                    presentMaterials={{
                      hasAudio: discovery.hasAudio,
                      hasVideo: discovery.hasVideo,
                      hasTranscript: discovery.hasTranscript,
                      hasApprovalProof: discovery.hasApprovalProof,
                    }}
                    onMaterialChanged={() => refreshDiscovery(selectedTenantId, true)}
                  />
                </CardContent>
              </Card>

              <DraftsEditor
                tenantId={selectedTenantId}
                onSaved={() => refreshDiscovery(selectedTenantId, true)}
              />

              <PromotionPanel
                tenantId={selectedTenantId}
                discoveryStatus={discovery.status}
                validationRounds={discovery.validationRounds}
                onChanged={() => refreshDiscovery(selectedTenantId, true)}
              />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
