import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input, toast } from '@prospix/ui';
import { ToggleLeft, ToggleRight, Plus, Trash2, Loader2, AlertCircle, RefreshCw, Globe, Building } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';
import { AxiosError } from 'axios';

interface FeatureFlag {
  id: string;
  key: string;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  enabled: boolean;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

const SUGGESTED_KEYS = [
  'evolution.outbound_disabled',
  'ai.disabled',
  'lead_capture.disabled',
  'webhook.evolution.disabled',
  'billing.suspension_check.disabled',
  'maintenance.read_only',
];

export default function FeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'tenant'>('global');
  const [newTenantId, setNewTenantId] = useState('');
  const [newEnabled, setNewEnabled] = useState(true);
  const [newReason, setNewReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchAll = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [flagsResponse, tenantsResponse] = await Promise.all([
        adminApiClient.get('/admin/feature-flags'),
        adminApiClient.get('/admin/tenants'),
      ]);
      setFlags(flagsResponse.data?.data ?? []);
      const tList = (tenantsResponse.data?.data ?? []) as Array<{ id: string; name: string; slug: string }>;
      setTenants(tList.map((t) => ({ id: t.id, name: t.name, slug: t.slug })));
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao carregar.' : 'Falha ao carregar.';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleToggle = async (flag: FeatureFlag) => {
    setBusyId(flag.id);
    try {
      await adminApiClient.patch(`/admin/feature-flags/${flag.id}`, { enabled: !flag.enabled });
      toast.success('Flag atualizada', `${flag.key} → ${!flag.enabled ? 'ON' : 'OFF'}`);
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (flag: FeatureFlag) => {
    if (!confirm(`Remover a flag "${flag.key}"${flag.tenant ? ` para o tenant ${flag.tenant.name}` : ' global'}?\n\nCódigo voltará ao comportamento default.`)) return;
    setBusyId(flag.id);
    try {
      await adminApiClient.delete(`/admin/feature-flags/${flag.id}`);
      toast.success('Flag removida');
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(trimmedKey)) {
      toast.error('Chave inválida', 'Use formato snake_case com pontos · ex: ai.disabled');
      return;
    }
    if (newScope === 'tenant' && !newTenantId) {
      toast.error('Selecione um tenant', 'Para escopo "tenant" o campo é obrigatório.');
      return;
    }
    setIsSaving(true);
    try {
      await adminApiClient.post('/admin/feature-flags', {
        key: trimmedKey,
        tenantId: newScope === 'tenant' ? newTenantId : null,
        enabled: newEnabled,
        reason: newReason.trim() || undefined,
      });
      toast.success('Flag salva', trimmedKey);
      setCreateOpen(false);
      setNewKey(''); setNewTenantId(''); setNewReason(''); setNewEnabled(true); setNewScope('global');
      await fetchAll();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setIsSaving(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, FeatureFlag[]>();
    for (const f of flags) {
      const arr = map.get(f.key) ?? [];
      arr.push(f);
      map.set(f.key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [flags]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <ToggleRight className="w-5 h-5 text-primary" aria-hidden />
            Feature Flags / Kill Switches
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Controle remoto sem deploy. Override por tenant tem precedência sobre flag global. Cache runtime de 30s.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchAll} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" aria-hidden /> Nova flag
          </Button>
        </div>
      </div>

      {createOpen && (
        <Card className="bg-white border-primary/30 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold font-heading text-text">Criar / atualizar flag</CardTitle>
            <CardDescription className="text-text-secondary text-xs">
              Se a combinação (key + scope/tenant) já existir, é atualizada in-place.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="fk-key" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Chave (snake_case.com.pontos)</label>
                <Input
                  id="fk-key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="ex: ai.disabled"
                  className="bg-white border-border text-text text-xs h-9 font-mono"
                  list="suggested-flag-keys"
                />
                <datalist id="suggested-flag-keys">
                  {SUGGESTED_KEYS.map((k) => <option key={k} value={k} />)}
                </datalist>
              </div>
              <div>
                <label htmlFor="fk-scope" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Escopo</label>
                <select
                  id="fk-scope"
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value as 'global' | 'tenant')}
                  className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none"
                >
                  <option value="global">Global (todos tenants)</option>
                  <option value="tenant">Tenant específico</option>
                </select>
              </div>
              {newScope === 'tenant' && (
                <div>
                  <label htmlFor="fk-tenant" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Tenant</label>
                  <select
                    id="fk-tenant"
                    value={newTenantId}
                    onChange={(e) => setNewTenantId(e.target.value)}
                    className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none"
                  >
                    <option value="">— selecione —</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="fk-enabled" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Estado</label>
                <select
                  id="fk-enabled"
                  value={newEnabled ? 'on' : 'off'}
                  onChange={(e) => setNewEnabled(e.target.value === 'on')}
                  className="w-full bg-white border border-border rounded-lg px-2 py-1.5 text-xs text-text focus:border-border-strong focus:outline-none"
                >
                  <option value="on">ON (habilitado)</option>
                  <option value="off">OFF (desabilitado)</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="fk-reason" className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Motivo (audit trail)</label>
              <Input
                id="fk-reason"
                value={newReason}
                onChange={(e) => setNewReason(e.target.value)}
                placeholder="ex: Pausando outbound por incidente Evolution 504"
                className="bg-white border-border text-text text-xs h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={isSaving} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-9 rounded-lg flex items-center gap-1.5">
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Salvar
              </Button>
              <Button onClick={() => setCreateOpen(false)} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg">
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10" role="status">
          <Loader2 className="w-5 h-5 animate-spin text-text-secondary" aria-label="Carregando" />
        </div>
      ) : loadError ? (
        <Card className="bg-white border-error/30 shadow-sm">
          <CardContent className="py-10 text-center">
            <AlertCircle className="w-8 h-8 text-error-text mx-auto mb-2" aria-hidden />
            <p className="text-sm text-text font-semibold">{loadError}</p>
          </CardContent>
        </Card>
      ) : grouped.length === 0 ? (
        <Card className="bg-white border-border shadow-sm">
          <CardContent className="py-10 text-center">
            <p className="text-sm font-semibold text-text">Nenhuma flag configurada.</p>
            <p className="text-[11px] text-text-secondary mt-1">Crie a primeira flag clicando em "Nova flag" acima.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([key, entries]) => (
            <Card key={key} className="bg-white border-border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold font-heading text-text font-mono">{key}</CardTitle>
                <CardDescription className="text-text-secondary text-xs">
                  {entries.length} configuração(ões) · {entries.filter((e) => !e.tenantId).length} global, {entries.filter((e) => !!e.tenantId).length} por tenant
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {entries.map((flag) => (
                  <div
                    key={flag.id}
                    className={`flex items-start justify-between gap-3 px-3 py-2 rounded-lg border ${
                      flag.enabled ? 'bg-success-soft/40 border-success/30' : 'bg-surface-sunken border-border'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      {flag.tenant ? (
                        <Building className="w-3.5 h-3.5 text-text-secondary mt-0.5 shrink-0" aria-hidden />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-text-secondary mt-0.5 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${flag.enabled ? 'bg-success-soft text-success-text border-success/30' : 'bg-surface-sunken text-text-secondary border-border/60'}`}>
                            {flag.enabled ? 'ON' : 'OFF'}
                          </Badge>
                          <span className="text-xs font-semibold text-text">
                            {flag.tenant ? `${flag.tenant.name} (${flag.tenant.slug})` : 'GLOBAL'}
                          </span>
                          <span className="text-[9px] text-text-secondary font-mono">
                            atualizado {new Date(flag.updatedAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        {flag.reason && (
                          <div className="text-[11px] text-text-secondary mt-1 italic">"{flag.reason}"</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        onClick={() => handleToggle(flag)}
                        disabled={busyId !== null}
                        className="bg-white hover:bg-surface-sunken text-text border border-border text-[10px] px-2 h-7 rounded flex items-center gap-1"
                        aria-label={`${flag.enabled ? 'Desabilitar' : 'Habilitar'} ${flag.key}`}
                      >
                        {busyId === flag.id ? <Loader2 className="w-3 h-3 animate-spin" /> : flag.enabled ? <ToggleRight className="w-3 h-3 text-success-text" /> : <ToggleLeft className="w-3 h-3 text-text-secondary" />}
                        Toggle
                      </Button>
                      <Button
                        onClick={() => handleDelete(flag)}
                        disabled={busyId !== null}
                        className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[10px] px-2 h-7 rounded flex items-center gap-1"
                        aria-label={`Remover flag ${flag.key}`}
                      >
                        <Trash2 className="w-3 h-3" aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
