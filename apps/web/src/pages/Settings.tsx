import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Tabs, TabsList, TabsTrigger, TabsContent, Badge, toast } from '@prospix/ui';
import { Settings as SettingsIcon, Shield, CreditCard, Key, Calendar, Phone, Loader2, CheckCircle2, AlertCircle, RefreshCw, FileText, ExternalLink } from 'lucide-react';
import { useAuthStore } from '../store/auth-store';
import { apiClient } from '../lib/api-client';
import { AxiosError } from 'axios';
import { z } from 'zod';
import PrivacyTab from './settings/PrivacyTab';

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome completo (mínimo 2 caracteres).').max(120, 'Nome muito longo (máximo 120).'),
  email: z.string().trim().toLowerCase().email('E-mail inválido. Use o formato exemplo@dominio.com.'),
  susep: z
    .string()
    .trim()
    .max(40, 'SUSEP muito longo.')
    .optional()
    .or(z.literal('')),
});

type ProfileErrors = Partial<Record<'name' | 'email' | 'susep', string>>;

type CredentialState = {
  aiProvider: 'GUILDS_SHARED' | 'TENANT_OWN';
  keys: {
    openai: { configured: boolean };
    anthropic: { configured: boolean };
    googleAi: { configured: boolean };
    googleMaps: { configured: boolean };
    evolution: { configured: boolean };
  };
  whatsapp: {
    baseUrlConfigured: boolean;
    instanceConfigured: boolean;
    webhookConfigured: boolean;
  };
  google: {
    calendarConnected: boolean;
    calendarId: string | null;
    oauthScope: string | null;
  };
  updatedAt: string | null;
};

const emptyCredentialState: CredentialState = {
  aiProvider: 'GUILDS_SHARED',
  keys: {
    openai: { configured: false },
    anthropic: { configured: false },
    googleAi: { configured: false },
    googleMaps: { configured: false },
    evolution: { configured: false },
  },
  whatsapp: {
    baseUrlConfigured: false,
    instanceConfigured: false,
    webhookConfigured: false,
  },
  google: {
    calendarConnected: false,
    calendarId: null,
    oauthScope: null,
  },
  updatedAt: null,
};

type BillingInvoice = {
  id: string;
  periodMonth: string;
  mrrCents: number;
  excessCents: number;
  totalCents: number;
  status: 'PENDING' | 'PAID' | 'OVERDUE' | 'REFUNDED' | 'WAIVED';
  paidAt: string | null;
  dueAt: string;
  invoiceUrl: string | null;
  paymentMethod: string | null;
  externalInvoiceId: string | null;
};

type TenantBillingData = {
  tenant: {
    planName: string;
    mrrCents: number;
    status: string;
  };
  usage: {
    periodMonth: string;
    llmTokensInput: number;
    llmTokensOutput: number;
    llmCostCents: number;
    whatsappMessagesSent: number;
    whatsappCostCents: number;
    googleMapsCalls: number;
    googleMapsCostCents: number;
    conversationsStarted: number;
    meetingsScheduled: number;
  };
  currentInvoice: BillingInvoice | null;
  invoices: BillingInvoice[];
};

export default function Settings() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('perfil');

  // Profile fields state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [susep, setSusep] = useState('');
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // Integrations states
  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const [credentialState, setCredentialState] = useState<CredentialState>(emptyCredentialState);
  const [credentialDraft, setCredentialDraft] = useState({
    aiProvider: 'GUILDS_SHARED' as 'GUILDS_SHARED' | 'TENANT_OWN',
    openaiApiKey: '',
    anthropicApiKey: '',
    googleAiApiKey: '',
    googleMapsApiKey: '',
    evolutionApiKey: '',
    evolutionBaseUrl: '',
  });
  const [isCredentialsLoading, setIsCredentialsLoading] = useState(false);
  const [isCredentialsSaving, setIsCredentialsSaving] = useState(false);
  const [billingData, setBillingData] = useState<TenantBillingData | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canManageCredentials = user?.role !== 'ASSISTANT';

  const formatBRL = (cents: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  };

  const formatDate = (value: string) => {
    return new Date(value).toLocaleDateString('pt-BR');
  };

  const fetchProfile = async () => {
    setIsProfileLoading(true);
    try {
      const response = await apiClient.get('/tenant/profile');
      const profile = response.data?.data;
      setName(profile?.name || '');
      setEmail(profile?.email || '');
      setSusep(profile?.susep || '');
    } catch (err: unknown) {
      console.error('Error loading profile:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível carregar os dados do perfil.'
        : 'Não foi possível carregar os dados do perfil.';
      toast.error('Erro ao carregar perfil', message);
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    const parsed = profileSchema.safeParse({ name, email, susep });
    if (!parsed.success) {
      const errs: ProfileErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof ProfileErrors | undefined;
        if (field && !errs[field]) errs[field] = issue.message;
      }
      setProfileErrors(errs);
      toast.error('Corrija os campos destacados', 'Há informações inválidas no formulário.');
      return;
    }
    setProfileErrors({});
    setIsProfileSaving(true);
    try {
      const response = await apiClient.patch('/tenant/profile', {
        name: parsed.data.name,
        email: parsed.data.email,
        susep: parsed.data.susep || null,
      });
      const profile = response.data?.data;
      setName(profile?.name || name);
      setEmail(profile?.email || email);
      setSusep(profile?.susep || '');
      toast.success('Perfil salvo', 'As informações cadastrais foram atualizadas.');
    } catch (err: unknown) {
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível salvar o perfil.'
        : 'Não foi possível salvar o perfil.';
      toast.error('Erro ao salvar perfil', message);
    } finally {
      setIsProfileSaving(false);
    }
  };

  const fetchCredentialState = async () => {
    setIsCredentialsLoading(true);
    try {
      const response = await apiClient.get('/tenant/integrations/credentials');
      const data = response.data?.data || emptyCredentialState;
      setCredentialState(data);
      setCredentialDraft((draft) => ({
        ...draft,
        aiProvider: data.aiProvider || 'GUILDS_SHARED',
        evolutionBaseUrl: '',
      }));
    } catch (err: unknown) {
      console.error('Error loading credentials:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível carregar o estado das credenciais.'
        : 'Não foi possível carregar o estado das credenciais.';
      toast.error('Erro ao carregar credenciais', message);
    } finally {
      setIsCredentialsLoading(false);
    }
  };

  const fetchBilling = async () => {
    setIsBillingLoading(true);
    try {
      const response = await apiClient.get('/tenant/billing');
      setBillingData(response.data?.data || null);
    } catch (err: unknown) {
      console.error('Error loading billing:', err);
      setBillingData(null);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível carregar as faturas reais.'
        : 'Não foi possível carregar as faturas reais.';
      toast.error('Erro ao carregar faturamento', message);
    } finally {
      setIsBillingLoading(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!canManageCredentials) {
      toast.error('Permissão insuficiente', 'Somente proprietários podem alterar credenciais de integração.');
      return;
    }

    const payload: Record<string, string> = {
      aiProvider: credentialDraft.aiProvider,
    };

    Object.entries({
      openaiApiKey: credentialDraft.openaiApiKey,
      anthropicApiKey: credentialDraft.anthropicApiKey,
      googleAiApiKey: credentialDraft.googleAiApiKey,
      googleMapsApiKey: credentialDraft.googleMapsApiKey,
      evolutionApiKey: credentialDraft.evolutionApiKey,
      evolutionBaseUrl: credentialDraft.evolutionBaseUrl,
    }).forEach(([key, value]) => {
      if (value.trim()) {
        payload[key] = value.trim();
      }
    });

    setIsCredentialsSaving(true);
    try {
      const response = await apiClient.patch('/tenant/integrations/credentials', payload);
      setCredentialState(response.data?.data || emptyCredentialState);
      setCredentialDraft({
        aiProvider: response.data?.data?.aiProvider || credentialDraft.aiProvider,
        openaiApiKey: '',
        anthropicApiKey: '',
        googleAiApiKey: '',
        googleMapsApiKey: '',
        evolutionApiKey: '',
        evolutionBaseUrl: '',
      });
      toast.success('Credenciais salvas', 'As chaves foram criptografadas e vinculadas ao tenant.');
    } catch (err: unknown) {
      console.error('Error saving credentials:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Não foi possível salvar as credenciais.'
        : 'Não foi possível salvar as credenciais.';
      toast.error('Erro ao salvar credenciais', message);
    } finally {
      setIsCredentialsSaving(false);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      const response = await apiClient.get('/tenant/integrations/google/oauth');
      if (response.data?.auth_url) {
        window.location.href = response.data.auth_url;
      } else {
        toast.error('Erro de Conexão', 'Erro ao obter link de autorização do Google Agenda.');
      }
    } catch (err: unknown) {
      console.error('Error connecting Google Calendar:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Erro ao conectar ao Google Agenda.'
        : 'Erro ao conectar ao Google Agenda.';
      toast.error('Erro de Conexão', message);
    }
  };

  const checkStatus = async (silent = false) => {
    if (!silent) setWhatsappStatus('loading');
    try {
      const response = await apiClient.get('/tenant/integrations/whatsapp/status');
      const data = response.data;
      if (data.status === 'connected') {
        setWhatsappStatus('connected');
        setInstanceName(data.instanceName);
        setQrCode(null);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      } else {
        setWhatsappStatus('disconnected');
        setInstanceName(data.instanceName);
      }
    } catch (err) {
      console.error('Error checking WhatsApp status:', err);
      if (!silent) setWhatsappStatus('disconnected');
    }
  };

  useEffect(() => {
    if (activeTab === 'perfil') {
      fetchProfile();
    }

    if (activeTab === 'integracoes') {
      checkStatus();
      fetchCredentialState();
    }

    if (activeTab === 'faturamento') {
      fetchBilling();
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [activeTab]);

  const handleConnectWhatsapp = async () => {
    setIsGeneratingQr(true);
    setQrCode(null);
    try {
      const response = await apiClient.post('/tenant/integrations/whatsapp/connect');
      const data = response.data;
      setQrCode(data.qrcode);
      setInstanceName(data.instanceName);
      setIsGeneratingQr(false);
      
      // Backoff incremental 3s → 5s → 10s (cap) para reduzir carga no Evolution
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      const delays = [3000, 3000, 5000, 5000, 10000];
      let attempt = 0;
      const schedule = () => {
        const delay = delays[Math.min(attempt, delays.length - 1)];
        pollingIntervalRef.current = setTimeout(async () => {
          attempt += 1;
          await checkStatus(true);
          // checkStatus limpa pollingIntervalRef.current quando conecta · só reagenda se ainda ativo
          if (pollingIntervalRef.current) schedule();
        }, delay) as unknown as NodeJS.Timeout;
      };
      schedule();
    } catch (err: unknown) {
      console.error('Error generating WhatsApp QR code:', err);
      const message = err instanceof AxiosError
        ? err.response?.data?.message || 'Ocorreu um erro ao conectar com o servidor da Evolution API.'
        : 'Ocorreu um erro ao conectar com o servidor da Evolution API.';
      toast.error('Erro no Gateway', message);
      setIsGeneratingQr(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setWhatsappStatus('loading');
    setIsConfirmingDisconnect(false);
    try {
      await apiClient.post('/tenant/integrations/whatsapp/disconnect');
      setWhatsappStatus('disconnected');
      setInstanceName(null);
      setQrCode(null);
      toast.success('WhatsApp Desconectado', 'WhatsApp desconectado com sucesso!');
    } catch (err) {
      console.error('Error disconnecting WhatsApp:', err);
      toast.error('Erro de Instância', 'Erro ao desconectar WhatsApp.');
      setWhatsappStatus('disconnected');
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Header Settings */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Configurações Gerais</h2>
          <p className="text-text-secondary text-sm mt-1">
            Gerencie as preferências da sua conta, credenciais de APIs, conexões e faturamento financeiro.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col lg:flex-row gap-6 items-start">
        <Card className="bg-white border-border w-full lg:w-[260px] shrink-0 p-2 text-text-secondary shadow-sm">
          <TabsList className="bg-transparent flex flex-col w-full h-auto space-y-1 p-0 rounded-none border-0">
            <TabsTrigger
              value="perfil"
              className="w-full text-left justify-start px-3 py-2.5 rounded-xl text-xs font-semibold hover:bg-surface-sunken text-text-secondary data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
            >
              <SettingsIcon className="w-4 h-4 mr-2.5" />
              Meu Perfil
            </TabsTrigger>
            <TabsTrigger
              value="integracoes"
              className="w-full text-left justify-start px-3 py-2.5 rounded-xl text-xs font-semibold hover:bg-surface-sunken text-text-secondary data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
            >
              <Shield className="w-4 h-4 mr-2.5" />
              Conexões e APIs
            </TabsTrigger>
            <TabsTrigger
              value="faturamento"
              className="w-full text-left justify-start px-3 py-2.5 rounded-xl text-xs font-semibold hover:bg-surface-sunken text-text-secondary data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
            >
              <CreditCard className="w-4 h-4 mr-2.5" />
              Faturamento Asaas
            </TabsTrigger>
            <TabsTrigger
              value="privacidade"
              className="w-full text-left justify-start px-3 py-2.5 rounded-xl text-xs font-semibold hover:bg-surface-sunken text-text-secondary data-[state=active]:bg-primary data-[state=active]:text-white transition-all"
              data-testid="settings-privacy-tab"
            >
              <FileText className="w-4 h-4 mr-2.5" />
              Privacidade & Dados
            </TabsTrigger>
          </TabsList>
        </Card>

        <div className="flex-1 w-full min-w-0">
          {/* TAB 1: PROFILE */}
          <TabsContent value="perfil" className="m-0 space-y-6">
            <Card className="bg-white border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text">Informações Cadastrais</CardTitle>
                <CardDescription className="text-text-secondary text-xs">Atualize os dados pessoais de exibição do corretor.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="profile-name" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Nome Completo</label>
                    <Input
                      id="profile-name"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        if (profileErrors.name) setProfileErrors((p) => ({ ...p, name: undefined }));
                      }}
                      aria-invalid={!!profileErrors.name}
                      aria-describedby={profileErrors.name ? 'profile-name-error' : undefined}
                      className={`bg-white text-text placeholder-text-secondary text-xs h-10 ${profileErrors.name ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border-strong'}`}
                    />
                    {profileErrors.name && (
                      <p id="profile-name-error" className="text-[10px] text-red-600 mt-1" role="alert">{profileErrors.name}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="profile-email" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">E-mail Profissional</label>
                    <Input
                      id="profile-email"
                      type="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (profileErrors.email) setProfileErrors((p) => ({ ...p, email: undefined }));
                      }}
                      aria-invalid={!!profileErrors.email}
                      aria-describedby={profileErrors.email ? 'profile-email-error' : undefined}
                      className={`bg-white text-text placeholder-text-secondary text-xs h-10 ${profileErrors.email ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border-strong'}`}
                    />
                    {profileErrors.email && (
                      <p id="profile-email-error" className="text-[10px] text-red-600 mt-1" role="alert">{profileErrors.email}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="profile-susep" className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Código SUSEP</label>
                    <Input
                      id="profile-susep"
                      value={susep}
                      onChange={(e) => {
                        setSusep(e.target.value);
                        if (profileErrors.susep) setProfileErrors((p) => ({ ...p, susep: undefined }));
                      }}
                      aria-invalid={!!profileErrors.susep}
                      aria-describedby={profileErrors.susep ? 'profile-susep-error' : undefined}
                      className={`bg-white text-text placeholder-text-secondary text-xs h-10 ${profileErrors.susep ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-border-strong'}`}
                    />
                    {profileErrors.susep && (
                      <p id="profile-susep-error" className="text-[10px] text-red-600 mt-1" role="alert">{profileErrors.susep}</p>
                    )}
                  </div>
                </div>
                <Button
                  disabled={isProfileLoading || isProfileSaving}
                  onClick={handleSaveProfile}
                  className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-10 rounded-xl mt-4 shadow-md shadow-primary/10 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isProfileSaving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: INTEGRATIONS */}
          <TabsContent value="integracoes" className="m-0 space-y-6">
            {/* WhatsApp Integration Status */}
            <Card className="bg-white border-border overflow-hidden shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text flex items-center gap-2">
                  <Phone className="w-5 h-5 text-success" />
                  <span>WhatsApp (Evolution API)</span>
                </CardTitle>
                <CardDescription className="text-text-secondary text-xs">Conectividade e status do gateway móvel de envio para disparos e IA.</CardDescription>
              </CardHeader>
              
              <CardContent className="border-t border-border/60 p-0 bg-surface-sunken/10">
                {/* 1. Loading State */}
                {whatsappStatus === 'loading' && (
                  <div className="flex flex-col items-center justify-center py-12 px-6">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <span className="text-xs text-text-secondary mt-3 font-semibold">Verificando conexão da instância...</span>
                  </div>
                )}

                {/* 2. Connected State */}
                {whatsappStatus === 'connected' && (
                  <div className="p-6 space-y-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-success-soft/20 border border-success/10 rounded-2xl p-5">
                      <div className="flex items-center gap-4">
                        <div className="p-3.5 bg-success-soft text-success-text rounded-2xl border border-success/20">
                          <CheckCircle2 className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2.5">
                            <h4 className="text-sm font-bold text-text font-heading">WhatsApp Ativo</h4>
                            <Badge className="bg-success-soft text-success-text border border-success/20 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                              Sincronizado
                            </Badge>
                          </div>
                          <p className="text-xs text-text-secondary mt-1 font-mono">
                            Instância: <span className="text-success-text font-bold">{instanceName}</span>
                          </p>
                          <p className="text-[10px] text-text-secondary/80 mt-0.5">
                            O bot do Prospix está monitorando ativamente este número e respondendo leads em tempo real.
                          </p>
                        </div>
                      </div>
                      
                      {!isConfirmingDisconnect ? (
                        <Button
                          onClick={() => setIsConfirmingDisconnect(true)}
                          className="bg-red-50 hover:bg-red-600 text-white text-xs font-semibold px-4 h-9.5 rounded-xl transition-all duration-300 shadow-md shadow-red-500/5 w-full sm:w-auto"
                        >
                          Desconectar WhatsApp
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 shrink-0 bg-white p-3 rounded-xl border border-border shadow-sm">
                          <span className="text-xs text-red-500 font-bold">Desconectar?</span>
                          <Button
                            onClick={handleDisconnectWhatsapp}
                            className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold h-7 px-3 rounded-lg"
                          >
                            Sim
                          </Button>
                          <Button
                            onClick={() => setIsConfirmingDisconnect(false)}
                            className="bg-white border border-border text-text-secondary text-[10px] font-bold h-7 px-3 rounded-lg"
                          >
                            Não
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Premium Status Details */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                        <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">Webhooks</span>
                        <Badge className="bg-primary-soft text-primary border border-primary/20 text-[9px] font-bold">
                          100% Configurado
                        </Badge>
                      </div>
                      <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                        <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">Taxa de Resposta da IA</span>
                        <span className="text-xs text-text font-semibold font-mono">Real-time / Instantânea</span>
                      </div>
                      <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                        <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">Status do Servidor</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="w-1.5 h-1.5 bg-success rounded-full animate-ping" />
                          <span className="text-xs text-success-text font-bold">Online</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Disconnected State (Generating QR / QR Ready / Ready to connect) */}
                {whatsappStatus === 'disconnected' && (
                  <div className="p-6">
                    {/* A. If QR Code is visible or is generating */}
                    {isGeneratingQr || qrCode ? (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-surface-sunken border border-border p-6 rounded-2xl">
                        {/* Left Side: Step by step instructions */}
                        <div className="lg:col-span-7 space-y-6">
                          <div>
                            <Badge className="bg-primary-soft text-primary border border-primary/20 text-[9px] uppercase font-bold tracking-wider mb-2">
                              Aguardando Leitura
                            </Badge>
                            <h4 className="text-base font-bold text-text font-heading">Como conectar o seu WhatsApp?</h4>
                            <p className="text-xs text-text-secondary mt-1">
                              Siga as instruções passo a passo para conectar o robô de IA do Prospix ao seu número.
                            </p>
                          </div>

                          <div className="space-y-4">
                            <div className="flex items-start gap-3.5">
                              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary-soft text-primary border border-primary/20 text-xs font-bold shrink-0">
                                1
                              </div>
                              <p className="text-xs text-text-secondary leading-relaxed mt-0.5">
                                Abra o WhatsApp no seu smartphone (Android ou iPhone).
                              </p>
                            </div>
                            
                            <div className="flex items-start gap-3.5">
                              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary-soft text-primary border border-primary/20 text-xs font-bold shrink-0">
                                2
                              </div>
                              <p className="text-xs text-text-secondary leading-relaxed mt-0.5">
                                Toque no menu <span className="font-semibold text-text">Aparelhos Conectados</span> (ou Configurações &gt; Aparelhos Conectados).
                              </p>
                            </div>

                            <div className="flex items-start gap-3.5">
                              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary-soft text-primary border border-primary/20 text-xs font-bold shrink-0">
                                3
                              </div>
                              <p className="text-xs text-text-secondary leading-relaxed mt-0.5">
                                Selecione <span className="font-semibold text-text">Conectar um Aparelho</span> e valide com sua biometria ou senha.
                              </p>
                            </div>

                            <div className="flex items-start gap-3.5">
                              <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-primary-soft text-primary border border-primary/20 text-xs font-bold shrink-0">
                                4
                              </div>
                              <p className="text-xs text-text-secondary leading-relaxed mt-0.5">
                                Aponte a câmera do seu celular para o QR Code ao lado para realizar o escaneamento.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-2 text-[10px] text-text-secondary">
                            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                            <span>Aguardando a confirmação do escaneamento do QR Code...</span>
                          </div>
                        </div>

                        {/* Right Side: QR Code frame */}
                        <div className="lg:col-span-5 flex flex-col items-center justify-center">
                          <div className="relative p-6 bg-white border border-border rounded-2xl shadow-xl flex items-center justify-center w-[240px] h-[240px] overflow-hidden">
                            {isGeneratingQr ? (
                              <div className="flex flex-col items-center justify-center text-center">
                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                                <span className="text-[10px] text-text-secondary mt-2">Criando instância...</span>
                              </div>
                            ) : qrCode ? (
                              <img
                                src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                                alt="WhatsApp QR Code"
                                className="w-full h-full object-contain rounded-lg"
                              />
                            ) : (
                              <div className="text-center p-4">
                                <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
                                <span className="text-xs text-text-secondary mt-2 block">Erro ao carregar QR Code</span>
                              </div>
                            )}
                          </div>
                          
                          {qrCode && (
                            <Button
                              onClick={handleConnectWhatsapp}
                              size="compact"
                              variant="outline"
                              className="mt-3.5 text-[10px] font-bold h-7.5 px-3 rounded-lg border-border bg-white hover:bg-surface-sunken text-text-secondary"
                            >
                              <RefreshCw className="w-3 h-3 mr-1.5" />
                              Atualizar QR Code
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      // B. Landing View - No QR Code active
                      <div className="flex flex-col items-center justify-center text-center py-10 px-4 max-w-md mx-auto">
                        <div className="p-4 bg-surface-sunken border border-border rounded-2xl text-text-secondary shadow-sm">
                          <Phone className="w-8 h-8" />
                        </div>
                        
                        <h4 className="text-lg font-bold text-text mt-5 font-heading">Conecte o seu WhatsApp Comercial</h4>
                        <p className="text-xs text-text-secondary mt-2 leading-relaxed">
                          Conectando seu dispositivo móvel, o Prospix poderá disparar mensagens de prospecção ativa automaticamente e qualificar todos os seus leads em tempo real através da nossa Inteligência Artificial integrada.
                        </p>
                        
                        <Button
                          onClick={handleConnectWhatsapp}
                          className="bg-primary hover:bg-primary-hover text-white font-bold text-xs px-6 h-10.5 rounded-xl mt-6 shadow-lg shadow-primary/10 w-full sm:w-auto"
                        >
                          Conectar WhatsApp
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Google Calendar Consent */}
            <Card className="bg-white border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text">Google Agenda OAuth</CardTitle>
                <CardDescription className="text-text-secondary text-xs">Sincronize reuniões e agendamentos com seu calendário pessoal.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6 bg-surface-sunken/40 border-t border-border">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white border border-border rounded-xl">
                    <Calendar className="w-5 h-5 text-text-secondary" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-text font-heading">Google Calendar API</h4>
                    <p className="text-[10px] text-text-secondary mt-1">Permite checar conflitos e marcar slots de 30min.</p>
                  </div>
                </div>
                <Button onClick={handleGoogleConnect} className="bg-primary hover:bg-primary-hover text-white text-xs font-semibold px-4 h-9 rounded-xl shadow-lg shadow-primary/10">
                  Conectar Agenda
                </Button>
              </CardContent>
            </Card>

            {/* Custom API Credentials */}
            <Card className="bg-white border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text">Chaves de API (Bring Your Own Key)</CardTitle>
                <CardDescription className="text-text-secondary text-xs">Insira suas chaves proprietárias para IA, enriquecimento e integrações. Os valores são armazenados criptografados.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                    <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">Provedor IA</span>
                    <select
                      value={credentialDraft.aiProvider}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, aiProvider: e.target.value as 'GUILDS_SHARED' | 'TENANT_OWN' })}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      className="w-full bg-white border border-border text-xs rounded-xl px-3 h-10 text-text focus:border-primary focus:ring-1 focus:ring-primary outline-none disabled:opacity-60"
                    >
                      <option value="GUILDS_SHARED">Guilds compartilhado</option>
                      <option value="TENANT_OWN">Chaves próprias</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                    <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">OpenAI</span>
                    <Badge className={credentialState.keys.openai.configured ? 'bg-success-soft text-success-text border border-success/20' : 'bg-white border-border text-text-secondary'}>
                      {credentialState.keys.openai.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                    <span className="text-[10px] text-text-secondary font-bold uppercase tracking-wider block mb-1">Google Maps</span>
                    <Badge className={credentialState.keys.googleMaps.configured ? 'bg-success-soft text-success-text border border-success/20' : 'bg-white border-border text-text-secondary'}>
                      {credentialState.keys.googleMaps.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">OpenAI API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={credentialDraft.openaiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, openaiApiKey: e.target.value })}
                        placeholder={credentialState.keys.openai.configured ? 'Nova chave para substituir a atual' : 'sk-...'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Anthropic API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={credentialDraft.anthropicApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, anthropicApiKey: e.target.value })}
                        placeholder={credentialState.keys.anthropic.configured ? 'Nova chave para substituir a atual' : 'sk-ant-...'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Google AI / Gemini API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={credentialDraft.googleAiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleAiApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleAi.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Google Maps API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={credentialDraft.googleMapsApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleMapsApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleMaps.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Evolution API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={credentialDraft.evolutionApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionApiKey: e.target.value })}
                        placeholder={credentialState.keys.evolution.configured ? 'Nova chave para substituir a atual' : 'Token da Evolution API'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Evolution Base URL</label>
                    <Input
                      value={credentialDraft.evolutionBaseUrl}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionBaseUrl: e.target.value })}
                      placeholder={credentialState.whatsapp.baseUrlConfigured ? 'Nova URL para substituir a atual' : 'https://evo.seudominio.com.br'}
                      className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 disabled:opacity-70"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/60">
                  <p className="text-[10px] text-text-secondary leading-relaxed">
                    {canManageCredentials
                      ? 'Após salvar, os campos ficam vazios por segurança; a tela mostra apenas o estado configurado.'
                      : 'Sua função não permite alterar credenciais do tenant.'}
                  </p>
                  <Button
                    disabled={!canManageCredentials || isCredentialsSaving || isCredentialsLoading}
                    onClick={handleSaveCredentials}
                    className="bg-primary hover:bg-primary-hover text-white border border-primary text-xs font-semibold px-4 h-10 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isCredentialsSaving ? 'Salvando...' : 'Salvar Credenciais'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: BILLING */}
          <TabsContent value="faturamento" className="m-0 space-y-6">
            <Card className="bg-white border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text">Assinatura Ativa (Asaas)</CardTitle>
                <CardDescription className="text-text-secondary text-xs">Acompanhe assinatura, faturas e consumo operacional do tenant.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {isBillingLoading ? (
                  <div className="flex items-center gap-2 text-xs text-text-secondary py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Carregando faturamento real...</span>
                  </div>
                ) : !billingData ? (
                  <div className="rounded-xl border border-border bg-surface-sunken p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="p-3 bg-white border border-border rounded-xl text-text-secondary w-fit">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-text font-heading">Faturamento não encontrado</h4>
                      <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                        Nenhuma fatura foi localizada para este tenant. Assim que o Asaas gerar cobranças, elas aparecerão aqui.
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                    <span className="text-[10px] text-text-secondary font-semibold uppercase tracking-wider block">Plano Atual</span>
                    <h4 className="text-sm font-bold text-text mt-1">{billingData.tenant.planName}</h4>
                    <p className="text-xs text-text-secondary mt-0.5">{formatBRL(billingData.tenant.mrrCents)} / mês</p>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-sunken border border-border space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Uso de IA no mês</span>
                      <span className="text-text-secondary font-mono font-medium">
                        {(billingData.usage.llmTokensInput + billingData.usage.llmTokensOutput).toLocaleString('pt-BR')} tokens
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div>
                        <p className="text-[9px] text-text-secondary uppercase font-bold">IA</p>
                        <p className="text-xs text-text font-mono">{formatBRL(billingData.usage.llmCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-text-secondary uppercase font-bold">WhatsApp</p>
                        <p className="text-xs text-text font-mono">{formatBRL(billingData.usage.whatsappCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-text-secondary uppercase font-bold">Maps</p>
                        <p className="text-xs text-text font-mono">{formatBRL(billingData.usage.googleMapsCostCents)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {billingData.currentInvoice && (
                  <div className="rounded-xl border border-border bg-surface-sunken p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-[10px] text-text-secondary font-semibold uppercase tracking-wider block">Fatura atual</span>
                      <p className="text-sm font-bold text-text mt-1">{formatBRL(billingData.currentInvoice.totalCents)}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Vencimento em {formatDate(billingData.currentInvoice.dueAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={billingData.currentInvoice.status === 'PAID' ? 'bg-success-soft text-success-text border border-success/20' : billingData.currentInvoice.status === 'OVERDUE' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-warning-soft text-warning-text border border-warning/20'}>
                        {billingData.currentInvoice.status === 'PAID' ? 'Pago' : billingData.currentInvoice.status === 'OVERDUE' ? 'Em atraso' : 'Pendente'}
                      </Badge>
                      {billingData.currentInvoice.invoiceUrl && (
                        <Button
                          onClick={() => window.open(billingData.currentInvoice!.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                          className="bg-primary hover:bg-primary-hover text-white text-[10px] font-bold h-8 px-3 rounded-lg flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir fatura
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">Histórico de Cobrança (Faturas Asaas)</span>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-[10px] text-text-secondary uppercase font-bold tracking-wider text-left">
                          <th className="py-2.5">Data de Vencimento</th>
                          <th className="py-2.5">Valor</th>
                          <th className="py-2.5">Status</th>
                          <th className="py-2.5 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {billingData.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-3 font-medium text-text-secondary">{formatDate(inv.dueAt)}</td>
                            <td className="py-3 font-mono font-medium text-text">{formatBRL(inv.totalCents)}</td>
                            <td className="py-3">
                              <Badge className={inv.status === 'PAID' ? 'bg-success-soft text-success-text border border-success/20' : inv.status === 'OVERDUE' ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-warning-soft text-warning-text border border-warning/20'}>
                                {inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Em atraso' : inv.status === 'WAIVED' ? 'Isenta' : inv.status === 'REFUNDED' ? 'Estornada' : 'Pendente'}
                              </Badge>
                            </td>
                            <td className="py-3 text-right">
                              {inv.invoiceUrl && (
                                <Button
                                  onClick={() => window.open(inv.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                                  className="bg-surface-sunken hover:bg-border text-text border border-border text-[10px] font-bold h-7 px-2.5 rounded-lg flex items-center gap-1.5 ml-auto"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Abrir</span>
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {billingData.invoices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-xs text-text-secondary">
                              Nenhuma fatura real encontrada para este tenant.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 4: PRIVACIDADE & DADOS (AUD-P2-033) */}
          <TabsContent value="privacidade" className="m-0">
            <PrivacyTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
