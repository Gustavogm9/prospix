'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, toast } from '@prospix/ui';
import { UserCheck, Shield, Loader2, RefreshCw, AlertTriangle, ExternalLink, Clock, X } from 'lucide-react';
import { adminApiClient } from '@/lib/admin-api-client';
import { adminTenantsQueries, adminUsersQueries } from '@/lib/admin-queries';
import { AxiosError } from 'axios';

interface Tenant { id: string; name: string; slug: string; status: string; }
interface TenantUser { id: string; name: string; email: string; role: string; }
interface ActiveSession {
  sessionId: string;
  admin: { id: string; name: string; email: string } | null;
  targetUserName: string;
  targetTenantName: string;
  mode: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}

const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:5173';

export default function Impersonation() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>('');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'READ_ONLY' | 'FULL_ACCESS'>('READ_ONLY');
  const [isLoading, setIsLoading] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [impResult, setImpResult] = useState<{ token: string; tenant: string; user: string; mode: string; expiresAt: string } | null>(null);

  const fetchTenants = async () => {
    const result = await adminTenantsQueries.list();
    if (!result.error) {
      setTenants(result.data.map((t) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status })));
    }
  };

  const fetchActiveSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await adminApiClient.get('/admin/impersonate/active');
      setActiveSessions(res.data?.data ?? []);
    } catch { /* swallow */ }
    setSessionsLoading(false);
  };

  const fetchUsers = async (tenantId: string) => {
    const result = await adminUsersQueries.list({ tenantId });
    if (!result.error) {
      setUsers(result.data.map((u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
    } else {
      setUsers([]);
    }
  };

  useEffect(() => {
    fetchTenants();
    fetchActiveSessions();
  }, []);

  useEffect(() => {
    if (selectedTenant) {
      fetchUsers(selectedTenant);
      setSelectedUser('');
    } else {
      setUsers([]);
      setSelectedUser('');
    }
  }, [selectedTenant]);

  const handleStart = async () => {
    if (!selectedTenant || !selectedUser || reason.length < 5) {
      toast.error('Erro', 'Selecione tenant, usuÃ¡rio e preencha o motivo (mÃ­n. 5 caracteres).');
      return;
    }

    setIsLoading(true);
    try {
      const res = await adminApiClient.post(`/admin/impersonate/${selectedTenant}/${selectedUser}`, { reason, mode });
      const data = res.data?.data;
      setImpResult({
        token: data.impersonationToken,
        tenant: data.targetTenant.name,
        user: data.targetUser.name,
        mode: data.mode,
        expiresAt: data.expiresAt,
      });
      toast.success('SessÃ£o iniciada', `Impersonando ${data.targetUser.name} em ${data.targetTenant.name}`);
      await fetchActiveSessions();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnd = async (sessionId: string) => {
    try {
      await adminApiClient.post('/admin/impersonate/end', { sessionId });
      toast.success('Encerrada', 'SessÃ£o de impersonificaÃ§Ã£o encerrada.');
      await fetchActiveSessions();
    } catch (err: unknown) {
      const message = err instanceof AxiosError ? err.response?.data?.message || 'Falha.' : 'Falha.';
      toast.error('Erro', message);
    }
  };

  const openImpersonation = () => {
    if (!impResult) return;
    // Open web app with impersonation token in URL
    const url = `${WEB_URL}?imp_token=${impResult.token}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-heading text-text tracking-tight flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden />
            Sistema de ImpersonificaÃ§Ã£o
          </h2>
          <p className="text-text-secondary text-xs mt-1">
            Acesse o sistema como qualquer usuÃ¡rio Â· auditado Â· com controle de modo
          </p>
        </div>
        <Button onClick={fetchActiveSessions} disabled={sessionsLoading} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-3 h-9 rounded-lg flex items-center gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${sessionsLoading ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {/* Warning */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-900">AtenÃ§Ã£o: AÃ§Ãµes auditadas</p>
          <p className="text-[11px] text-amber-800 mt-0.5">
            Toda sessÃ£o de impersonificaÃ§Ã£o Ã© registrada no audit log com IP, motivo e horÃ¡rio.
            O proprietÃ¡rio do tenant serÃ¡ notificado automaticamente.
            SessÃµes expiram em 2 horas.
          </p>
        </div>
      </div>

      {/* Active Sessions */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">SessÃµes Ativas</CardTitle>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-text-secondary" /></div>
          ) : activeSessions.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-4">Nenhuma sessÃ£o de impersonificaÃ§Ã£o ativa.</p>
          ) : (
            <div className="space-y-2">
              {activeSessions.map((s) => (
                <div key={s.sessionId} className="p-3 rounded-lg border border-amber-200 bg-amber-50/50 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[9px] px-1.5 py-0 border">{s.mode}</Badge>
                      <span className="text-xs font-semibold text-text">{s.admin?.name ?? 'Admin'} â†’ {s.targetUserName}</span>
                      <span className="text-[10px] text-text-secondary">({s.targetTenantName})</span>
                    </div>
                    <div className="text-[10px] text-text-secondary mt-1 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      Iniciada: {new Date(s.startedAt).toLocaleString('pt-BR')} Â· Expira: {new Date(s.expiresAt).toLocaleString('pt-BR')}
                    </div>
                    <div className="text-[10px] text-text-secondary mt-0.5">Motivo: {s.reason}</div>
                  </div>
                  <Button onClick={() => handleEnd(s.sessionId)} className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-[10px] px-2 h-7 rounded flex items-center gap-1 shrink-0">
                    <X className="w-3 h-3" /> Encerrar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Start New Session */}
      <Card className="bg-white border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold font-heading text-text">Iniciar Nova SessÃ£o</CardTitle>
          <CardDescription className="text-text-secondary text-xs">Selecione o tenant e o usuÃ¡rio que deseja impersonificar</CardDescription>
        </CardHeader>
        <CardContent>
          {impResult ? (
            <div className="space-y-4">
              <div className="p-4 bg-success-soft border border-success/30 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <UserCheck className="w-5 h-5 text-success-text" />
                  <span className="text-sm font-bold text-success-text">SessÃ£o iniciada com sucesso!</span>
                </div>
                <div className="text-xs text-text space-y-1">
                  <p><strong>Tenant:</strong> {impResult.tenant}</p>
                  <p><strong>UsuÃ¡rio:</strong> {impResult.user}</p>
                  <p><strong>Modo:</strong> <Badge className={`text-[9px] px-1.5 py-0 border ${impResult.mode === 'READ_ONLY' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{impResult.mode}</Badge></p>
                  <p><strong>Expira:</strong> {new Date(impResult.expiresAt).toLocaleString('pt-BR')}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={openImpersonation} className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-10 rounded-xl flex items-center gap-1.5">
                  <ExternalLink className="w-4 h-4" /> Abrir como UsuÃ¡rio
                </Button>
                <Button onClick={() => setImpResult(null)} className="bg-white hover:bg-surface-sunken text-text border border-border text-xs px-4 h-10 rounded-xl">
                  Nova SessÃ£o
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Tenant *</label>
                  <select value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50">
                    <option value="">Selecione o tenant...</option>
                    {tenants.filter((t) => t.status === 'ACTIVE').map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">UsuÃ¡rio *</label>
                  <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} disabled={!selectedTenant} className="w-full h-9 px-3 text-xs rounded-lg border border-border bg-white text-text focus:outline-none focus:border-primary/50 disabled:opacity-50">
                    <option value="">Selecione o usuÃ¡rio...</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email}) â€” {u.role}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Motivo * (mÃ­n. 5 caracteres)</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-20 px-3 py-2 text-xs rounded-lg border border-border bg-white text-text resize-none focus:outline-none focus:border-primary/50" placeholder="Descreva o motivo da impersonificaÃ§Ã£o (ex: Investigar bug reportado pelo cliente)" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block mb-1">Modo de Acesso</label>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'READ_ONLY' ? 'border-primary bg-primary/5' : 'border-border hover:border-border/70'}`}>
                    <input type="radio" name="mode" value="READ_ONLY" checked={mode === 'READ_ONLY'} onChange={() => setMode('READ_ONLY')} className="sr-only" />
                    <div className={`w-3 h-3 rounded-full border-2 ${mode === 'READ_ONLY' ? 'border-primary bg-primary' : 'border-border'}`} />
                    <div>
                      <span className="text-xs font-semibold text-text block">Somente Leitura</span>
                      <span className="text-[10px] text-text-secondary">NÃ£o pode criar, editar ou excluir dados</span>
                    </div>
                  </label>
                  <label className={`flex items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all ${mode === 'FULL_ACCESS' ? 'border-amber-500 bg-amber-50/50' : 'border-border hover:border-border/70'}`}>
                    <input type="radio" name="mode" value="FULL_ACCESS" checked={mode === 'FULL_ACCESS'} onChange={() => setMode('FULL_ACCESS')} className="sr-only" />
                    <div className={`w-3 h-3 rounded-full border-2 ${mode === 'FULL_ACCESS' ? 'border-amber-500 bg-amber-500' : 'border-border'}`} />
                    <div>
                      <span className="text-xs font-semibold text-text block">Acesso Completo</span>
                      <span className="text-[10px] text-amber-700">Pode realizar todas as aÃ§Ãµes como o usuÃ¡rio</span>
                    </div>
                  </label>
                </div>
              </div>
              <Button onClick={handleStart} disabled={isLoading || !selectedTenant || !selectedUser || reason.length < 5} className="bg-primary hover:bg-primary-hover text-white font-semibold text-sm px-6 h-10 rounded-xl flex items-center gap-1.5 disabled:opacity-50">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Iniciar ImpersonificaÃ§Ã£o
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
