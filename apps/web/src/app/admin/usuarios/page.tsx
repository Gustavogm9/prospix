'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, toast } from '@prospix/ui';
import { Users as UsersIcon, Plus, Loader2, Search, RefreshCw, KeyRound, UserX, UserCheck, Pencil, AlertCircle, Copy, Eye, EyeOff } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { adminTenantsQueries, adminUsersQueries } from '@/lib/admin-queries';
import { AxiosError } from 'axios';

interface UserItem {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  role: string;
  tenantId: string | null;
  susep: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tenant: { id: string; name: string; slug: string; status: string } | null;
}

interface Pagination { total: number; limit: number; offset: number; hasMore: boolean; }

const PAGE_SIZE = 50;

const ROLE_STYLES: Record<string, string> = {
  OWNER: 'bg-blue-50 text-blue-700 border-blue-200',
  ASSISTANT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  GUILDS_ADMIN: 'bg-amber-50 text-amber-800 border-amber-300',
};

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'ProprietÃ¡rio',
  ASSISTANT: 'Assistente',
  GUILDS_ADMIN: 'Super-Admin',
};

export default function UserManagement() {
  const [items, setItems] = useState<UserItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: PAGE_SIZE, offset: 0, hasMore: false });
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ tenantId: '', name: '', email: '', whatsapp: '', role: 'OWNER' as string, susep: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [showTempPassword, setShowTempPassword] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', whatsapp: '', role: '', susep: '' });
  const [editLoading, setEditLoading] = useState(false);

  // Reset password state
  const [resetResult, setResetResult] = useState<{ userId: string; tempPassword: string } | null>(null);

  // Tenants for dropdown
  const [tenants, setTenants] = useState<{ id: string; name: string; slug: string }[]>([]);

  const fetchUsers = async (newOffset = 0) => {
    setIsLoading(true);
    try {
      const result = await adminUsersQueries.list({
        ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
        ...(filterRole !== 'all' ? { role: filterRole } : {}),
      });
      if (result.error) throw new Error(result.error.message);
      // Apply client-side pagination since adminUsersQueries.list() returns all
      const allItems = (result.data ?? []).map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        whatsapp: u.whatsapp,
        role: u.role,
        tenantId: u.tenant_id,
        susep: u.susep,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        deletedAt: u.deleted_at,
        tenant: u.tenants ? { id: u.tenant_id, name: u.tenants.name, slug: u.tenants.slug, status: '' } : null,
      }));
      const total = allItems.length;
      const paged = allItems.slice(newOffset, newOffset + PAGE_SIZE);
      setItems(paged);
      setPagination({ total, limit: PAGE_SIZE, offset: newOffset, hasMore: newOffset + PAGE_SIZE < total });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar usuários.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTenants = async () => {
    const result = await adminTenantsQueries.list();
    if (!result.error) {
      setTenants(result.data.map((t) => ({ id: t.id, name: t.name, slug: t.slug })));
    }
  };

  useEffect(() => {
    fetchUsers(0);
    fetchTenants();
  }, [filterRole]);

  useEffect(() => {
    const timeout = setTimeout(() => fetchUsers(0), 300);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  const handleCreate = async () => {
    if (!createForm.tenantId || !createForm.name || !createForm.email) {
      toast.error('Erro', 'Tenant, nome e email sÃ£o obrigatÃ³rios.');
      return;
    }
    setCreateLoading(true);
    try {
      const response = await adminApiClient.post('/admin/users', createForm);
      const user = response.data?.data;
      setTempPassword(user?.tempPassword ?? null);
      toast.success('UsuÃ¡rio criado', `${user?.name} foi criado com sucesso.`);
      await fetchUsers(0);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha ao criar usuÃ¡rio.' : 'Falha ao criar usuÃ¡rio.';
      toast.error('Erro', message);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editUser) return;
    setEditLoading(true);
    try {
      await adminApiClient.patch(`/admin/users/${editUser.id}`, editForm);
      toast.success('Atualizado', 'UsuÃ¡rio atualizado com sucesso.');
      setShowEditModal(false);
      await fetchUsers(pagination.offset);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!confirm('Resetar senha deste usuÃ¡rio? Todas as sessÃµes ativas serÃ£o revogadas.')) return;
    setBusyId(userId);
    try {
      const response = await adminApiClient.post(`/admin/users/${userId}/reset-password`);
      const result = response.data?.data;
      setResetResult({ userId, tempPassword: result?.tempPassword ?? '' });
      toast.success('Senha resetada', 'Nova senha temporÃ¡ria gerada.');
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeactivate = async (userId: string) => {
    if (!confirm('Desativar este usuÃ¡rio? Ele serÃ¡ removido do sistema e todas as sessÃµes serÃ£o revogadas.')) return;
    setBusyId(userId);
    try {
      await adminApiClient.delete(`/admin/users/${userId}`);
      toast.success('Desativado', 'UsuÃ¡rio desativado com sucesso.');
      await fetchUsers(pagination.offset);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReactivate = async (userId: string) => {
    setBusyId(userId);
    try {
      await adminApiClient.post(`/admin/users/${userId}/reactivate`);
      toast.success('Reativado', 'UsuÃ¡rio reativado com sucesso.');
      await fetchUsers(pagination.offset);
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setBusyId(null);
    }
  };

  const openEditModal = (user: UserItem) => {
    setEditUser(user);
    setEditForm({ name: user.name, email: user.email, whatsapp: user.whatsapp ?? '', role: user.role, susep: user.susep ?? '' });
    setShowEditModal(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success('Copiado!'));
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary" aria-hidden />
            GestÃ£o de UsuÃ¡rios
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            CRUD completo cross-tenant Â· criar, editar, resetar senha, desativar/reativar
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fetchUsers(pagination.offset)} disabled={isLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} aria-hidden /> Atualizar
          </Button>
          <Button onClick={() => { setShowCreateModal(true); setTempPassword(null); setCreateForm({ tenantId: '', name: '', email: '', whatsapp: '', role: 'OWNER', susep: '' }); }} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Novo UsuÃ¡rio
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-white border-border shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome, email ou WhatsApp..."
                className="w-full pl-9 pr-3 h-9 text-xs rounded-lg border border-border bg-white text-text placeholder:text-text-muted focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div className="flex gap-1.5">
              {(['all', 'OWNER', 'ASSISTANT', 'GUILDS_ADMIN'] as const).map((r) => (
                <Button
                  key={r}
                  onClick={() => setFilterRole(r)}
                  className={`text-[10px] px-3 h-8 rounded-lg ${filterRole === r ? 'bg-primary text-white' : 'bg-white text-text border border-border hover:bg-surface-sunken'}`}
                >
                  {r === 'all' ? 'Todos' : ROLE_LABELS[r] ?? r}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Total count */}
      <p className="text-xs text-text-secondary">{pagination.total} usuÃ¡rio(s) encontrado(s)</p>

      {/* User list */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold font-heading text-text">UsuÃ¡rios</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-text-secondary" /></div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <UsersIcon className="w-6 h-6 text-text-secondary mx-auto mb-2" />
              <p className="text-sm font-semibold text-text">Nenhum usuÃ¡rio encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">UsuÃ¡rio</th>
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Tenant</th>
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Role</th>
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">WhatsApp</th>
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Status</th>
                    <th className="text-left py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Criado</th>
                    <th className="text-right py-2 px-2 text-text-secondary font-semibold uppercase tracking-wider text-[10px]">AÃ§Ãµes</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((user) => {
                    const isDeactivated = !!user.deletedAt;
                    return (
                      <tr key={user.id} className={`border-b border-border/50 hover:bg-surface-sunken/30 transition-colors ${isDeactivated ? 'opacity-50' : ''}`}>
                        <td className="py-2.5 px-2">
                          <div className="font-semibold text-text">{user.name}</div>
                          <div className="text-text-secondary text-[10px]">{user.email}</div>
                          {user.susep && <div className="text-text-muted text-[10px] font-mono">SUSEP: {user.susep}</div>}
                        </td>
                        <td className="py-2.5 px-2">
                          {user.tenant ? (
                            <Link href={`/admin/tenants/${user.tenant.id}`} className="text-primary hover:underline font-medium">
                              {user.tenant.name}
                            </Link>
                          ) : (
                            <span className="text-text-secondary italic">â€”</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <Badge className={`text-[9px] px-1.5 py-0 border ${ROLE_STYLES[user.role] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                            {ROLE_LABELS[user.role] ?? user.role}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2 text-text-secondary font-mono text-[10px]">{user.whatsapp ?? 'â€”'}</td>
                        <td className="py-2.5 px-2">
                          {isDeactivated ? (
                            <Badge className="bg-red-50 text-red-700 border-red-200 text-[9px] px-1.5 py-0 border">Desativado</Badge>
                          ) : (
                            <Badge className="bg-success-soft text-success-text border-success/30 text-[9px] px-1.5 py-0 border">Ativo</Badge>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-text-secondary text-[10px]">{new Date(user.createdAt).toLocaleDateString('pt-BR')}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex justify-end gap-1">
                            {!isDeactivated && (
                              <>
                                <button onClick={() => openEditModal(user)} disabled={busyId !== null} className="p-1.5 rounded hover:bg-surface-sunken text-text-secondary hover:text-text transition-colors" title="Editar">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => handleResetPassword(user.id)} disabled={busyId !== null} className="p-1.5 rounded hover:bg-amber-50 text-text-secondary hover:text-amber-700 transition-colors" title="Resetar Senha">
                                  {busyId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                                </button>
                                {user.role !== 'GUILDS_ADMIN' && (
                                  <button onClick={() => handleDeactivate(user.id)} disabled={busyId !== null} className="p-1.5 rounded hover:bg-red-50 text-text-secondary hover:text-red-600 transition-colors" title="Desativar">
                                    <UserX className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                            {isDeactivated && (
                              <button onClick={() => handleReactivate(user.id)} disabled={busyId !== null} className="p-1.5 rounded hover:bg-success-soft text-text-secondary hover:text-success-text transition-colors" title="Reativar">
                                {busyId === user.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                          {resetResult?.userId === user.id && (
                            <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded text-[10px]">
                              <span className="font-semibold text-amber-800">Senha temporÃ¡ria:</span>
                              <div className="flex items-center gap-1 mt-0.5">
                                <code className="font-mono text-amber-900 bg-amber-100 px-1 rounded">{resetResult.tempPassword}</code>
                                <button onClick={() => copyToClipboard(resetResult.tempPassword)} className="text-amber-700 hover:text-amber-900"><Copy className="w-3 h-3" /></button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {pagination.total > PAGE_SIZE && (
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
              <span className="text-[10px] text-text-secondary">
                Mostrando {pagination.offset + 1}â€“{Math.min(pagination.offset + PAGE_SIZE, pagination.total)} de {pagination.total}
              </span>
              <div className="flex gap-1.5">
                <Button
                  onClick={() => fetchUsers(Math.max(0, pagination.offset - PAGE_SIZE))}
                  disabled={pagination.offset === 0 || isLoading}
                  className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border hover:bg-surface-sunken disabled:opacity-40"
                >
                  Anterior
                </Button>
                <Button
                  onClick={() => fetchUsers(pagination.offset + PAGE_SIZE)}
                  disabled={!pagination.hasMore || isLoading}
                  className="text-[10px] px-3 h-7 rounded bg-white text-text border border-border hover:bg-surface-sunken disabled:opacity-40"
                >
                  PrÃ³ximo
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!tempPassword) setShowCreateModal(false); }} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 border border-border animate-fadeIn">
            {tempPassword ? (
              <>
                <h3 className="text-lg font-bold font-heading text-text mb-4 flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-success-text" /> UsuÃ¡rio Criado!
                </h3>
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
                  <p className="text-xs text-amber-800 font-semibold mb-2">Senha TemporÃ¡ria (copie agora!):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-sm text-amber-900 bg-amber-100 px-3 py-2 rounded-lg">
                      {showTempPassword ? tempPassword : 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢'}
                    </code>
                    <button onClick={() => setShowTempPassword(!showTempPassword)} className="p-2 hover:bg-amber-100 rounded-lg text-amber-700">
                      {showTempPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button onClick={() => copyToClipboard(tempPassword)} className="p-2 hover:bg-amber-100 rounded-lg text-amber-700">
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-text-secondary mb-4">
                  <AlertCircle className="w-3 h-3 inline mr-1" />
                  Envie esta senha ao usuÃ¡rio. Ela nÃ£o poderÃ¡ ser visualizada novamente.
                </p>
                <Button onClick={() => { setShowCreateModal(false); setTempPassword(null); setShowTempPassword(false); }} className="w-full bg-primary hover:bg-primary-hover text-white h-10 rounded-xl text-sm font-semibold">
                  Fechar
                </Button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-bold font-heading text-text mb-4 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-primary" /> Criar Novo UsuÃ¡rio
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Tenant *</label>
                    <select
                      value={createForm.tenantId}
                      onChange={(e) => setCreateForm({ ...createForm, tenantId: e.target.value })}
                      className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50"
                    >
                      <option value="">Selecione o tenant...</option>
                      {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Nome *</label>
                    <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" placeholder="Nome completo" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Email *</label>
                    <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" placeholder="usuario@email.com" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">WhatsApp</label>
                      <input type="text" value={createForm.whatsapp} onChange={(e) => setCreateForm({ ...createForm, whatsapp: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" placeholder="5511999999999" />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Role *</label>
                      <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50">
                        <option value="OWNER">ProprietÃ¡rio</option>
                        <option value="ASSISTANT">Assistente</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">SUSEP</label>
                    <input type="text" value={createForm.susep} onChange={(e) => setCreateForm({ ...createForm, susep: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" placeholder="Opcional" />
                  </div>
                </div>
                <div className="flex gap-2 mt-5">
                  <Button onClick={() => setShowCreateModal(false)} className="flex-1 bg-white hover:bg-surface-sunken text-text border border-border h-10 rounded-xl text-sm">
                    Cancelar
                  </Button>
                  <Button onClick={handleCreate} disabled={createLoading} className="flex-1 bg-primary hover:bg-primary-hover text-white h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                    {createLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Criar UsuÃ¡rio
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowEditModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 border border-border animate-fadeIn">
            <h3 className="text-lg font-bold font-heading text-text mb-4 flex items-center gap-2">
              <Pencil className="w-5 h-5 text-primary" /> Editar UsuÃ¡rio
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Nome</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Email</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">WhatsApp</label>
                  <input type="text" value={editForm.whatsapp} onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Role</label>
                  <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" disabled={editUser.role === 'GUILDS_ADMIN'}>
                    <option value="OWNER">ProprietÃ¡rio</option>
                    <option value="ASSISTANT">Assistente</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">SUSEP</label>
                <input type="text" value={editForm.susep} onChange={(e) => setEditForm({ ...editForm, susep: e.target.value })} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Button onClick={() => setShowEditModal(false)} className="flex-1 bg-white hover:bg-surface-sunken text-text border border-border h-10 rounded-xl text-sm">Cancelar</Button>
              <Button onClick={handleEdit} disabled={editLoading} className="flex-1 bg-primary hover:bg-primary-hover text-white h-10 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
