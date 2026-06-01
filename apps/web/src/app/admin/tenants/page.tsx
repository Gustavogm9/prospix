'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, CardContent, Button, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, toast, Input, Modal, Skeleton } from '@prospix/ui';
import { Search, Ban, Play, Inbox, AlertCircle, RotateCw } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { AxiosError } from 'axios';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  mrr: string;
  status: 'active' | 'suspended' | 'grace_period';
  health: 'excellent' | 'good' | 'fair' | 'critical';
  healthMissing: string[];
  ownerName: string;
  ownerWhatsapp: string;
}

interface ChurnRiskEntry {
  tenantId: string;
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [churnRisks, setChurnRisks] = useState<Record<string, ChurnRiskEntry>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [suspendModal, setSuspendModal] = useState<{ isOpen: boolean; tenantId: string | null }>({
    isOpen: false,
    tenantId: null,
  });

  const fetchTenants = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await adminApiClient.get('/admin/tenants');
      const data = response.data.data || [];
      
      const mapped = data.map((t: any) => {
        const owner = t.users?.[0];
        
        let displayPlan = 'Premium Multi';
        if (t.plan === 'STARTER') displayPlan = 'Start';
        if (t.plan === 'ENTERPRISE') displayPlan = 'Enterprise';
        
        let displayStatus: 'active' | 'suspended' | 'grace_period' = 'active';
        if (t.status === 'SUSPENDED') displayStatus = 'suspended';
        if (t.status === 'CHURNING') displayStatus = 'grace_period';

        const displayHealth: 'excellent' | 'good' | 'fair' | 'critical' =
          t.integrationHealth?.status || (t.status === 'SUSPENDED' ? 'critical' : t.status === 'CHURNING' ? 'fair' : 'excellent');
        const healthMissing = Array.isArray(t.integrationHealth?.missing) ? t.integrationHealth.missing : [];

        const formattedMRR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((t.mrrCents || 0) / 100);

        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          plan: displayPlan,
          mrr: formattedMRR,
          status: displayStatus,
          health: displayHealth,
          healthMissing,
          ownerName: owner?.name || 'N/A',
          ownerWhatsapp: owner?.whatsapp || 'N/A',
        };
      });

      setTenants(mapped);
    } catch (err: unknown) {
      console.error('Error fetching tenants:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.error?.message || err.message || 'NÃ£o foi possÃ­vel carregar a lista de tenants.'
        : err instanceof Error ? err.message : 'NÃ£o foi possÃ­vel carregar a lista de tenants.';
      setLoadError(message);
      toast.error('Erro de ConexÃ£o', message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchChurnRisk = async () => {
    try {
      const response = await adminApiClient.get('/admin/churn-risk');
      const list: ChurnRiskEntry[] = response.data?.data?.tenants ?? [];
      const map: Record<string, ChurnRiskEntry> = {};
      for (const r of list) map[r.tenantId] = r;
      setChurnRisks(map);
    } catch (err) {
      console.error('churn risk fetch failed:', err);
    }
  };

  useEffect(() => {
    fetchTenants();
    fetchChurnRisk();
  }, []);

  const handleSuspendClick = (tenantId: string) => {
    setSuspendModal({ isOpen: true, tenantId });
  };

  const handleConfirmSuspend = async () => {
    const tenantId = suspendModal.tenantId;
    if (!tenantId) return;

    setSuspendModal({ isOpen: false, tenantId: null });

    // Optimistic Update
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: 'suspended', health: 'critical' } : t));

    try {
      await adminApiClient.post(`/admin/tenants/${tenantId}/suspend`);
      toast.success('Tenant Suspenso', 'Status atualizado via role CONNECTION guilds_admin.');
    } catch (error: unknown) {
      const message = error instanceof AxiosError
        ? error.response?.data?.message || error.message || 'Ocorreu um erro ao suspender o tenant no servidor.'
        : error instanceof Error ? error.message : 'Ocorreu um erro ao suspender o tenant no servidor.';
      toast.error('Erro ao suspender', message);
      fetchTenants();
    }
  };

  const handleActivate = async (tenantId: string) => {
    // Optimistic Update
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: 'active' } : t));

    try {
      await adminApiClient.post(`/admin/tenants/${tenantId}/resume`);
      toast.success('Tenant Ativado', 'SessÃ£o e limites liberados.');
    } catch (error: unknown) {
      const message = error instanceof AxiosError
        ? error.response?.data?.message || error.message || 'Ocorreu um erro ao reativar o tenant no servidor.'
        : error instanceof Error ? error.message : 'Ocorreu um erro ao reativar o tenant no servidor.';
      toast.error('Erro ao ativar', message);
      fetchTenants();
    }
  };

  const getHealthBadge = (health: Tenant['health']) => {
    switch (health) {
      case 'excellent':
        return <Badge variant="success">Excelente</Badge>;
      case 'good':
        return <Badge variant="primary">SaudÃ¡vel</Badge>;
      case 'fair':
        return <Badge variant="warning">Regular</Badge>;
      case 'critical':
        return <Badge variant="error" className="animate-pulse">CrÃ­tico</Badge>;
    }
  };

  const getStatusBadge = (status: Tenant['status']) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">Ativo</Badge>;
      case 'suspended':
        return <Badge variant="error">Suspenso</Badge>;
      case 'grace_period':
        return <Badge variant="warning">Atraso D+15</Badge>;
    }
  };

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch = t.name.toLowerCase().includes(search.toLowerCase()) || t.ownerName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || (filterStatus === 'active' && t.status === 'active') || (filterStatus === 'suspended' && t.status === 'suspended');
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Gerenciamento de Tenants</h2>
          <p className="text-text-secondary text-sm mt-1">
            Lista completa de corretoras clientes. Administre acessos, cobranÃ§as e integridade dos workspaces.
          </p>
        </div>
      </div>

      {/* Filter and Search */}
      <Card className="bg-surface border-border shrink-0">
        <CardContent className="py-4 px-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              placeholder="Buscar por imobiliÃ¡ria, corretora ou owner..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-surface border-border text-xs focus:border-primary/50 h-10 text-text"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-surface-sunken border border-border rounded-xl p-0.5">
              <button
                onClick={() => setFilterStatus('all')}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  filterStatus === 'all' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  filterStatus === 'active' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
              >
                Ativos
              </button>
              <button
                onClick={() => setFilterStatus('suspended')}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  filterStatus === 'suspended' ? 'bg-surface text-text shadow-sm' : 'text-text-secondary hover:text-text'
                }`}
              >
                Suspensos
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tenants Table */}
      <Card className="bg-surface border-border flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <Table className="text-sm">
            <TableHeader className="bg-surface-sunken/40 sticky top-0 z-10">
              <TableRow className="border-b border-border text-[10px] text-text-muted uppercase font-bold tracking-wider hover:bg-transparent">
                <TableHead className="py-3 px-6 text-left">Workspace / Slug</TableHead>
                <TableHead className="py-3 px-6 text-left">Representante Owner</TableHead>
                <TableHead className="py-3 px-6 text-left">Plano / MRR</TableHead>
                <TableHead className="py-3 px-6 text-left">Status</TableHead>
                <TableHead className="py-3 px-6 text-left">SaÃºde (QR)</TableHead>
                <TableHead className="py-3 px-6 text-left">Risco</TableHead>
                <TableHead className="py-3 px-6 text-right">AÃ§Ãµes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border-subtle/40">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow key={`skeleton-${idx}`} className="hover:bg-transparent" data-testid="tenants-loading-row">
                    <TableCell className="py-3.5 px-6"><Skeleton className="h-3.5 w-40 mb-1.5" /><Skeleton className="h-2.5 w-24" /></TableCell>
                    <TableCell className="py-3.5 px-6"><Skeleton className="h-3.5 w-32 mb-1.5" /><Skeleton className="h-2.5 w-28" /></TableCell>
                    <TableCell className="py-3.5 px-6"><Skeleton className="h-3.5 w-20 mb-1.5" /><Skeleton className="h-2.5 w-16" /></TableCell>
                    <TableCell className="py-3.5 px-6"><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell className="py-3.5 px-6"><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                    <TableCell className="py-3.5 px-6 text-right"><Skeleton className="h-7 w-24 rounded-md ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : loadError ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-16 px-6">
                    <div className="flex flex-col items-center justify-center gap-3 text-center" data-testid="tenants-error-state">
                      <div className="w-12 h-12 rounded-full bg-error-soft flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-error-text" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">NÃ£o conseguimos carregar a lista</div>
                        <div className="text-xs text-text-secondary mt-1 max-w-md">{loadError}</div>
                      </div>
                      <Button
                        variant="outline"
                        size="compact"
                        onClick={fetchTenants}
                        className="mt-2 flex items-center gap-1.5"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Tentar novamente</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredTenants.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-16 px-6">
                    <div className="flex flex-col items-center justify-center gap-3 text-center" data-testid="tenants-empty-state">
                      <div className="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center">
                        <Inbox className="w-6 h-6 text-text-muted" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">
                          {tenants.length === 0
                            ? 'Nenhum tenant criado ainda'
                            : 'Nenhum tenant corresponde aos filtros'}
                        </div>
                        <div className="text-xs text-text-secondary mt-1 max-w-md">
                          {tenants.length === 0
                            ? 'Use o botÃ£o "Novo Tenant" para criar o primeiro workspace e enviar o cÃ³digo de convite.'
                            : 'Ajuste a busca ou troque o filtro de status para ver outros tenants.'}
                        </div>
                      </div>
                      {tenants.length > 0 && (search || filterStatus !== 'all') && (
                        <Button
                          variant="ghost"
                          size="compact"
                          onClick={() => {
                            setSearch('');
                            setFilterStatus('all');
                          }}
                          className="mt-2"
                        >
                          Limpar filtros
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredTenants.map((t) => (
                <TableRow key={t.id} className="hover:bg-surface-sunken/40">
                  <TableCell className="py-3.5 px-6 font-medium text-text">
                    <Link href={`/admin/tenants/${t.id}`} className="block hover:text-primary transition-colors">
                      <div className="text-xs font-bold text-text hover:text-primary underline-offset-2 hover:underline">{t.name}</div>
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">slug: {t.slug}</div>
                    </Link>
                  </TableCell>
                  <TableCell className="py-3.5 px-6 text-text-secondary text-xs">
                    <div>
                      <div className="font-semibold text-text">{t.ownerName}</div>
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">{t.ownerWhatsapp}</div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5 px-6 text-text-secondary text-xs">
                    <div>
                      <div className="font-semibold text-text">{t.plan}</div>
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">{t.mrr}</div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5 px-6">{getStatusBadge(t.status)}</TableCell>
                  <TableCell className="py-3.5 px-6" title={t.healthMissing.length ? `Pendente: ${t.healthMissing.join(', ')}` : 'IntegraÃ§Ãµes essenciais configuradas'}>
                    {getHealthBadge(t.health)}
                  </TableCell>
                  <TableCell className="py-3.5 px-6">
                    {(() => {
                      const risk = churnRisks[t.id];
                      if (!risk) return <span className="text-text-secondary text-[10px]">â€”</span>;
                      const toneClass =
                        risk.level === 'critical' ? 'bg-red-50 text-red-700 border-red-200' :
                        risk.level === 'high' ? 'bg-amber-50 text-amber-800 border-amber-300' :
                        risk.level === 'medium' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-success-soft/40 text-success-text border-success/30';
                      return (
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${toneClass}`}
                          title={risk.reasons.join(' Â· ') || 'Sem sinais de risco'}
                        >
                          {risk.level.toUpperCase()} Â· {risk.score}
                        </span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="py-3.5 px-6 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      {t.status === 'suspended' ? (
                        <Button
                          onClick={() => handleActivate(t.id)}
                          variant="outline"
                          size="compact"
                          aria-label={`Reativar tenant ${t.name}`}
                          className="text-[10px] font-bold flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5 text-success fill-current" aria-hidden="true" />
                          <span>Reativar</span>
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleSuspendClick(t.id)}
                          variant="ghost"
                          size="compact"
                          aria-label={`Suspender tenant ${t.name}`}
                          className="hover:bg-error-soft/60 text-text-secondary hover:text-error-text border border-transparent hover:border-error-soft text-[10px] font-bold flex items-center gap-1"
                        >
                          <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Suspender</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Confirmation Modal */}
      <Modal
        isOpen={suspendModal.isOpen}
        onClose={() => setSuspendModal({ isOpen: false, tenantId: null })}
        title="Confirmar SuspensÃ£o"
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="compact"
              onClick={() => setSuspendModal({ isOpen: false, tenantId: null })}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="compact"
              onClick={handleConfirmSuspend}
            >
              Confirmar SuspensÃ£o
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-secondary">
          Deseja realmente <strong>SUSPENDER</strong> este tenant?
        </p>
        <p className="text-xs text-text-muted mt-2">
          O acesso de todos os corretores e administradores desse workspace serÃ¡ bloqueado imediatamente. As conexÃµes ativas do WhatsApp podem ser interrompidas.
        </p>
      </Modal>
    </div>
  );
}
