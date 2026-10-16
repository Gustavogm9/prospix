'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, Loader2, RefreshCw, Shield, X } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, toast } from '@prospix/ui';
import { AdminApiError, adminNextApi } from '@/lib/admin-api-fetch';

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

export default function Impersonation() {
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);

  const fetchActiveSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const response = await adminNextApi.get('/api/admin/impersonate');
      setActiveSessions(response.data?.data ?? []);
    } catch {
      setActiveSessions([]);
      toast.error('Erro', 'Não foi possível consultar as sessões administrativas anteriores.');
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchActiveSessions();
  }, [fetchActiveSessions]);

  const handleEnd = async (sessionId: string) => {
    setEndingSessionId(sessionId);
    try {
      await adminNextApi.post('/api/admin/impersonate', { action: 'end', sessionId });
      toast.success('Sessão encerrada', 'O registro administrativo foi encerrado.');
      await fetchActiveSessions();
    } catch (error: unknown) {
      const message =
        error instanceof AdminApiError
          ? (error.response?.data as any)?.message || 'Não foi possível encerrar a sessão.'
          : 'Não foi possível encerrar a sessão.';
      toast.error('Erro', message);
    } finally {
      setEndingSessionId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-text font-heading">
            <Shield className="h-5 w-5 text-primary" aria-hidden />
            Acesso administrativo assistido
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            Recurso bloqueado até a ativação de uma sessão segura e isolada
          </p>
        </div>
        <Button
          onClick={fetchActiveSessions}
          disabled={sessionsLoading}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-3 text-xs text-text hover:bg-surface-sunken"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sessionsLoading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
        <div>
          <p className="text-xs font-semibold text-red-900">Impersonificação temporariamente desativada</p>
          <p className="mt-1 text-[11px] leading-relaxed text-red-800">
            A versão anterior colocava um identificador não assinado na URL e não criava uma sessão
            autenticada de verdade. O início de novas sessões agora falha de forma segura e não registra
            acesso nem notifica o cliente por uma ação que não aconteceu.
          </p>
        </div>
      </div>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-text font-heading">Sessões anteriores ainda abertas</CardTitle>
          <CardDescription className="text-xs text-text-secondary">
            Apenas registros válidos, não encerrados e dentro do prazo de duas horas aparecem aqui.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-text-secondary" />
            </div>
          ) : activeSessions.length === 0 ? (
            <p className="py-4 text-center text-xs text-text-secondary">Nenhuma sessão anterior ativa.</p>
          ) : (
            <div className="space-y-2">
              {activeSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="border border-amber-300 bg-amber-100 px-1.5 py-0 text-[9px] text-amber-800">
                        {session.mode}
                      </Badge>
                      <span className="text-xs font-semibold text-text">
                        {session.admin?.name ?? 'Administrador'} → {session.targetUserName}
                      </span>
                      <span className="text-[10px] text-text-secondary">({session.targetTenantName})</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-secondary">
                      <Clock className="h-3 w-3" />
                      Iniciada: {new Date(session.startedAt).toLocaleString('pt-BR')} · Expira:{' '}
                      {new Date(session.expiresAt).toLocaleString('pt-BR')}
                    </div>
                    <div className="mt-0.5 text-[10px] text-text-secondary">Motivo: {session.reason}</div>
                  </div>
                  <Button
                    onClick={() => void handleEnd(session.sessionId)}
                    disabled={endingSessionId === session.sessionId}
                    className="flex h-7 shrink-0 items-center gap-1 rounded border border-red-200 bg-white px-2 text-[10px] text-red-600 hover:bg-red-50"
                  >
                    {endingSessionId === session.sessionId ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    Encerrar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold text-text font-heading">Novo acesso administrativo</CardTitle>
          <CardDescription className="text-xs text-text-secondary">
            Para reativar, a sessão deve ser assinada, HttpOnly, curta, revogável e separada da sessão do administrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button disabled className="h-10 rounded-xl bg-surface-sunken px-5 text-sm text-text-muted opacity-100">
            Indisponível até ativação segura
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
