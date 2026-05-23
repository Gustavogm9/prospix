import { useState, useEffect } from 'react';
import { Card, CardContent, Button, Badge, Table, TableHeader, TableBody, TableRow, TableHead, TableCell, toast, Input, Modal, Skeleton } from '@prospix/ui';
import { Search, Ban, Play, Inbox, AlertCircle, RotateCw } from 'lucide-react';
import { adminApiClient } from '../lib/api-client';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  mrr: string;
  status: 'active' | 'suspended' | 'grace_period';
  health: 'excellent' | 'good' | 'fair' | 'critical';
  ownerName: string;
  ownerWhatsapp: string;
}

export default function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
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

        let displayHealth: 'excellent' | 'good' | 'fair' | 'critical' = 'excellent';
        if (t.status === 'SUSPENDED') displayHealth = 'critical';
        if (t.status === 'CHURNING') displayHealth = 'fair';

        const formattedMRR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((t.mrrCents || 0) / 100);

        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          plan: displayPlan,
          mrr: formattedMRR,
          status: displayStatus,
          health: displayHealth,
          ownerName: owner?.name || 'N/A',
          ownerWhatsapp: owner?.whatsapp || 'N/A',
        };
      });

      setTenants(mapped);
    } catch (err: any) {
      console.error('Error fetching tenants:', err);
      const message = err?.response?.data?.error?.message || err?.message || 'Não foi possível carregar a lista de tenants.';
      setLoadError(message);
      toast.error('Erro de Conexão', message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
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
    } catch (error: any) {
      toast.error('Erro ao suspender', error?.message || 'Ocorreu um erro ao suspender o tenant no servidor.');
      fetchTenants();
    }
  };

  const handleActivate = async (tenantId: string) => {
    // Optimistic Update
    setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, status: 'active', health: 'good' } : t));

    try {
      await adminApiClient.post(`/admin/tenants/${tenantId}/resume`);
      toast.success('Tenant Ativado', 'Sessão e limites liberados.');
    } catch (error: any) {
      toast.error('Erro ao ativar', error?.message || 'Ocorreu um erro ao reativar o tenant no servidor.');
      fetchTenants();
    }
  };

  const getHealthBadge = (health: Tenant['health']) => {
    switch (health) {
      case 'excellent':
        return <Badge variant="success">Excelente</Badge>;
      case 'good':
        return <Badge variant="primary">Saudável</Badge>;
      case 'fair':
        return <Badge variant="warning">Regular</Badge>;
      case 'critical':
        return <Badge variant="error" className="animate-pulse">Crítico</Badge>;
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
            Lista completa de corretoras clientes. Administre acessos, cobranças e integridade dos workspaces.
          </p>
        </div>
      </div>

      {/* Filter and Search */}
      <Card className="bg-surface border-border shrink-0">
        <CardContent className="py-4 px-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              placeholder="Buscar por imobiliária, corretora ou owner..."
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
                <TableHead className="py-3 px-6 text-left">Saúde (QR)</TableHead>
                <TableHead className="py-3 px-6 text-right">Ações</TableHead>
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
                  <TableCell colSpan={6} className="py-16 px-6">
                    <div className="flex flex-col items-center justify-center gap-3 text-center" data-testid="tenants-error-state">
                      <div className="w-12 h-12 rounded-full bg-error-soft flex items-center justify-center">
                        <AlertCircle className="w-6 h-6 text-error-text" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">Não conseguimos carregar a lista</div>
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
                  <TableCell colSpan={6} className="py-16 px-6">
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
                            ? 'Use o botão "Novo Tenant" para criar o primeiro workspace e enviar o código de convite.'
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
                    <div>
                      <div className="text-xs font-bold text-text">{t.name}</div>
                      <div className="text-[10px] text-text-muted font-mono mt-0.5">slug: {t.slug}</div>
                    </div>
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
                  <TableCell className="py-3.5 px-6">{getHealthBadge(t.health)}</TableCell>
                  <TableCell className="py-3.5 px-6 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      {t.status === 'suspended' ? (
                        <Button
                          onClick={() => handleActivate(t.id)}
                          variant="outline"
                          size="compact"
                          className="text-[10px] font-bold flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5 text-success fill-current" />
                          <span>Reativar</span>
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleSuspendClick(t.id)}
                          variant="ghost"
                          size="compact"
                          className="hover:bg-error-soft/60 text-text-secondary hover:text-error-text border border-transparent hover:border-error-soft text-[10px] font-bold flex items-center gap-1"
                        >
                          <Ban className="w-3.5 h-3.5 shrink-0" />
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
        title="Confirmar Suspensão"
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
              Confirmar Suspensão
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-secondary">
          Deseja realmente <strong>SUSPENDER</strong> este tenant?
        </p>
        <p className="text-xs text-text-muted mt-2">
          O acesso de todos os corretores e administradores desse workspace será bloqueado imediatamente. As conexões ativas do WhatsApp podem ser interrompidas.
        </p>
      </Modal>
    </div>
  );
}
