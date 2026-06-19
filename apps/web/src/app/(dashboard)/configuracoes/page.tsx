'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Input, Badge, toast } from '@prospix/ui';
import { Settings as SettingsIcon, Shield, CreditCard, Key, Calendar, Phone, Loader2, CheckCircle2, AlertCircle, RefreshCw, FileText, ExternalLink, Bell } from 'lucide-react';
import { useAuthStore } from '@/store/auth-store';
import { profileQueries, billingQueries } from '@/lib/queries';
import { apiFetch } from '@/lib/api-fetch';
import { z } from 'zod';
import PrivacyTab from './settings/PrivacyTab';
import AIContextPage from './contexto/page';

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
    tavily?: { configured: boolean };
    firecrawl?: { configured: boolean };
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
  invoiceUrl?: string | null;
  paymentMethod?: string | null;
  externalInvoiceId?: string | null;
};

type TenantBillingData = {
  tenant: {
    id?: string;
    name?: string;
    plan?: string;
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

type TabKey = 'perfil' | 'integracoes' | 'agenda' | 'credenciais' | 'financeiro' | 'privacidade' | 'contexto';

import { BrainCircuit } from 'lucide-react';

const tabConfig: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'perfil', label: 'Meu Perfil', icon: SettingsIcon },
  { key: 'contexto', label: 'Contexto IA', icon: BrainCircuit },
  { key: 'integracoes', label: 'Conexões', icon: Shield },
  { key: 'agenda', label: 'Agenda', icon: Calendar },
  { key: 'credenciais', label: 'Credenciais & APIs', icon: Key },
  { key: 'financeiro', label: 'Faturamento', icon: CreditCard },
  { key: 'privacidade', label: 'Privacidade & Dados', icon: FileText },
];

export default function Settings() {
  const { user, tenantId } = useAuthStore();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tab = searchParams.get('tab');
    if (tab && ['perfil', 'contexto', 'integracoes', 'agenda', 'credenciais', 'financeiro', 'privacidade'].includes(tab)) {
      return tab;
    }
    return 'perfil';
  });

  // Profile fields state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [susep, setSusep] = useState('');
  const [profileErrors, setProfileErrors] = useState<ProfileErrors>({});
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);

  // Notification toggles
  const [notifications, setNotifications] = useState([
    { label: 'Lead respondeu', desc: 'Quando um lead responde a mensagem da IA', checked: true },
    { label: 'Pediu ligação', desc: 'Quando um lead pede para falar com você', checked: true },
    { label: 'Reunião agendada', desc: 'Quando a IA agenda uma reunião', checked: true },
    { label: 'Resumo diário', desc: 'Email com resumo do dia às 18h', checked: false },
  ]);

  // Integrations states
  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<number>(0);
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
    tavilyApiKey: '',
    firecrawlApiKey: '',
  });
  const [isCredentialsLoading, setIsCredentialsLoading] = useState(false);
  const [isCredentialsSaving, setIsCredentialsSaving] = useState(false);
  const [billingData, setBillingData] = useState<TenantBillingData | null>(null);
  const [isBillingLoading, setIsBillingLoading] = useState(false);
  const [googleCalendars, setGoogleCalendars] = useState<Array<{id: string; summary: string; primary?: boolean; backgroundColor?: string}>>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('primary');
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const canManageCredentials = user?.role !== 'ASSISTANT';

  // Agenda settings state
  const [agendaSettings, setAgendaSettings] = useState({
    availableDays: [1, 2, 3, 4, 5] as number[], // 0=Dom, 1=Seg... 6=Sab
    startHour: '08:00',
    endHour: '18:00',
    lunchStart: '12:00',
    lunchEnd: '13:30',
    defaultDuration: 30,
    bufferMinutes: 15,
  });
  const [isAgendaSaving, setIsAgendaSaving] = useState(false);

  const formatBRL = (cents: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
  };

  const formatDate = (value: string) => {
    return new Date(value).toLocaleDateString('pt-BR');
  };

  const fetchProfile = useCallback(async () => {
    if (!user?.id || !tenantId) return;
    setIsProfileLoading(true);
    try {
      const result = await profileQueries.get(user.id, tenantId);
      if (result.error) throw new Error(result.error.message);
      const profile = result.data;
      setName(profile?.name || '');
      setEmail(profile?.email || '');
      setSusep(profile?.susep || '');
    } catch (err: unknown) {
      console.error('Error loading profile:', err);
      const message = err instanceof Error
        ? err.message || 'Não foi possível carregar os dados do perfil.'
        : 'Não foi possível carregar os dados do perfil.';
      toast.error('Erro ao carregar perfil', message);
    } finally {
      setIsProfileLoading(false);
    }
  }, [user?.id, tenantId]);

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
    if (!user?.id || !tenantId) return;
    setIsProfileSaving(true);
    try {
      const result = await profileQueries.update(user.id, tenantId, {
        name: parsed.data.name,
        email: parsed.data.email,
        susep: parsed.data.susep || null,
      });
      if (result.error) throw new Error(result.error.message);
      const profile = result.data;
      setName(profile?.name || name);
      setEmail(profile?.email || email);
      setSusep(profile?.susep || '');
      toast.success('Perfil salvo', 'As informações cadastrais foram atualizadas.');
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message || 'Não foi possível salvar o perfil.'
        : 'Não foi possível salvar o perfil.';
      toast.error('Erro ao salvar perfil', message);
    } finally {
      setIsProfileSaving(false);
    }
  };

  const fetchCredentialState = useCallback(async () => {
    setIsCredentialsLoading(true);
    try {
      const res = await apiFetch('/api/integrations/credentials');
      const json = await res.json();
      const data = json?.data || emptyCredentialState;
      setCredentialState(data);
      setCredentialDraft((draft) => ({
        ...draft,
        aiProvider: data.aiProvider || 'GUILDS_SHARED',
        evolutionBaseUrl: '',
      }));

      // If Google Calendar is connected, load calendar list
      if (data.google?.calendarConnected) {
        setSelectedCalendarId(data.google.calendarId || 'primary');
        setIsLoadingCalendars(true);
        try {
          const calRes = await apiFetch('/api/integrations/calendar/calendars');
          if (calRes.ok) {
            const calJson = await calRes.json();
            setGoogleCalendars(calJson.calendars || []);
          }
        } catch (calErr) {
          console.warn('Failed to load Google Calendars:', calErr);
        } finally {
          setIsLoadingCalendars(false);
        }
      }
    } catch (err: unknown) {
      console.error('Error loading credentials:', err);
      toast.error('Erro ao carregar credenciais', 'Não foi possível carregar o estado das credenciais.');
    } finally {
      setIsCredentialsLoading(false);
    }
  }, []);

  const fetchAgendaSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/integrations/agenda');
      const json = await res.json();
      const data = json?.data;
      if (data) {
        setAgendaSettings({
          availableDays: data.availableDays || [1, 2, 3, 4, 5],
          startHour: data.startHour || '09:00',
          endHour: data.endHour || '18:00',
          lunchStart: data.lunchStart || '12:00',
          lunchEnd: data.lunchEnd || '13:30',
          defaultDuration: data.defaultDuration || 30,
          bufferMinutes: data.bufferMinutes || 15,
        });
      }
    } catch (err) {
      console.error('Error loading agenda settings:', err);
    }
  }, []);

  const fetchBilling = useCallback(async () => {
    if (!tenantId) return;
    setIsBillingLoading(true);
    try {
      const result = await billingQueries.get(tenantId);
      if (result.error) throw new Error(result.error.message);
      setBillingData(result.data || null);
    } catch (err: unknown) {
      console.error('Error loading billing:', err);
      setBillingData(null);
      const message = err instanceof Error
        ? err.message || 'Não foi possível carregar as faturas reais.'
        : 'Não foi possível carregar as faturas reais.';
      toast.error('Erro ao carregar faturamento', message);
    } finally {
      setIsBillingLoading(false);
    }
  }, [tenantId]);

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
      const res = await apiFetch('/api/integrations/credentials', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message || 'Erro ao salvar credenciais');
      setCredentialState(json?.data || emptyCredentialState);
      setCredentialDraft({
        aiProvider: json?.data?.aiProvider || credentialDraft.aiProvider,
        openaiApiKey: '',
        anthropicApiKey: '',
        googleAiApiKey: '',
        googleMapsApiKey: '',
        evolutionApiKey: '',
        evolutionBaseUrl: '',
        tavilyApiKey: '',
        firecrawlApiKey: '',
      });
      toast.success('Credenciais salvas', 'As chaves foram criptografadas e vinculadas ao tenant.');
    } catch (err: unknown) {
      console.error('Error saving credentials:', err);
      const message = err instanceof Error ? err.message : 'Não foi possível salvar as credenciais.';
      toast.error('Erro ao salvar credenciais', message);
    } finally {
      setIsCredentialsSaving(false);
    }
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await apiFetch('/api/integrations/google/oauth');
      const json = await res.json();
      if (json?.auth_url) {
        window.location.href = json.auth_url;
      } else {
        toast.error('Erro de Conexão', 'Erro ao obter link de autorização do Google Agenda.');
      }
    } catch (err: unknown) {
      console.error('Error connecting Google Calendar:', err);
      toast.error('Erro de Conexão', 'Erro ao conectar ao Google Agenda.');
    }
  };

  const handleDisconnectGoogle = async () => {
    try {
      const res = await apiFetch('/api/integrations/google/disconnect', { method: 'POST' });
      if (res.ok) {
        toast.success('Agenda Desconectada', 'Sua agenda do Google foi desconectada.');
        fetchCredentialState(); // Refresh state
      } else {
        toast.error('Erro', 'Não foi possível desconectar a agenda.');
      }
    } catch (err) {
      console.error('Error disconnecting Google Calendar:', err);
      toast.error('Erro de Conexão', 'Erro ao desconectar o Google Agenda.');
    }
  };
  const checkStatus = useCallback(async (silent = false) => {
    if (!silent) setWhatsappStatus('loading');
    try {
      const res = await apiFetch('/api/integrations/whatsapp/status');
      const data = await res.json();
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
  }, []);

  useEffect(() => {
    if (activeTab === 'perfil') {
      fetchProfile();
      // Fetch notification preferences from API
      apiFetch('/api/notifications/preferences')
        .then(res => res.json())
        .then(json => {
          const prefs = json?.data ?? json;
          if (Array.isArray(prefs) && prefs.length > 0) {
            const EVENT_TYPES = ['lead_replied', 'lead_callback', 'meeting_scheduled', 'daily_summary'];
            setNotifications(prev => prev.map((n, i) => {
              const pref = prefs.find((p: any) => p.eventType === EVENT_TYPES[i]);
              return pref ? { ...n, checked: pref.enabled } : n;
            }));
          }
        })
        .catch(() => { /* endpoint may not exist yet, keep defaults */ });
    }

    // Handle OAuth redirects
    const errorMsg = searchParams.get('error');
    const successMsg = searchParams.get('success');
    if (errorMsg) {
      setTimeout(() => {
        if (errorMsg === 'no_refresh_token') {
          toast.error('Erro de Permissão', 'O Google não enviou o token de atualização. Por favor, remova o acesso do Prospix na sua conta Google e tente novamente.');
        } else if (errorMsg === 'google_token_exchange_failed') {
          toast.error('Erro de Configuração', 'Falha ao trocar o código. Verifique se o GOOGLE_CLIENT_SECRET está correto na Vercel.');
        } else {
          toast.error('Erro na Conexão', `Não foi possível conectar a agenda (${errorMsg}).`);
        }
        // Clean URL
        window.history.replaceState({}, document.title, '/configuracoes?tab=integracoes');
        setActiveTab('integracoes');
      }, 500);
    } else if (successMsg === 'google_connected') {
      setTimeout(() => {
        toast.success('Agenda Conectada!', 'Sua agenda do Google foi vinculada com sucesso.');
        window.history.replaceState({}, document.title, '/configuracoes?tab=integracoes');
        setActiveTab('integracoes');
      }, 500);
    }

    if (activeTab === 'integracoes') {
      checkStatus();
      fetchCredentialState();
    }

    if (activeTab === 'credenciais') {
      fetchCredentialState();
    }

    if (activeTab === 'agenda') {
      fetchAgendaSettings();
    }

    if (activeTab === 'financeiro') {
      fetchBilling();
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearTimeout(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [activeTab, fetchProfile, checkStatus, fetchCredentialState, fetchBilling, fetchAgendaSettings]);

  useEffect(() => {
    if (qrCountdown <= 0 || !qrCode) return;
    const t = setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(t);
          handleConnectWhatsapp(); // Auto-refresh QR code
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [qrCountdown, qrCode]);

  const handleConnectWhatsapp = async () => {
    setIsGeneratingQr(true);
    setQrCode(null);
    try {
      const res = await apiFetch('/api/integrations/whatsapp/connect', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Erro ao conectar');
      setQrCode(data.qrcode);
      setQrCountdown(40); // Set 40 seconds timer
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
      const message = err instanceof Error ? err.message : 'Ocorreu um erro ao conectar com o servidor da Evolution API.';
      toast.error('Erro no Gateway', message);
      setIsGeneratingQr(false);
    }
  };

  const handleDisconnectWhatsapp = async () => {
    setWhatsappStatus('loading');
    setIsConfirmingDisconnect(false);
    try {
      await apiFetch('/api/integrations/whatsapp/disconnect', { method: 'POST' });
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

  const toggleNotification = async (index: number) => {
    const EVENT_TYPES = ['lead_replied', 'lead_callback', 'meeting_scheduled', 'daily_summary'];
    setNotifications((prev) =>
      prev.map((n, i) => (i === index ? { ...n, checked: !n.checked } : n))
    );
    try {
      const eventType = EVENT_TYPES[index] || `notification_${index}`;
      const newChecked = !notifications[index]?.checked;
      await apiFetch('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify({
          eventType,
          channels: ['PUSH', 'EMAIL'],
          enabled: newChecked,
        }),
      });
    } catch (err) {
      console.error('Failed to save notification preference', err);
    }
  };

  return (
    <div className="space-y-6 flex flex-col h-full animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <SettingsIcon className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Configurações da sua conta e integrações.</strong> Gerencie perfil, credenciais, WhatsApp, Google Calendar e faturamento.</div>
      </div>

      {/* 2-column layout: sidebar pills + content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left sidebar pills */}
        <div className="w-full lg:w-48 shrink-0 flex lg:flex-col overflow-x-auto lg:overflow-visible gap-1">
          {tabConfig.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                data-testid={key === 'privacidade' ? 'settings-privacy-tab' : undefined}
                className={`w-full shrink-0 text-left flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                  activeTab === key
                    ? 'bg-[#1B3A6B] text-white shadow-sm'
                    : 'text-[#475569] hover:bg-[#F1F3F6]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
        </div>

        {/* Right content */}
        <div className="flex-1 w-full min-w-0 space-y-5">

          {/* ─── TAB: CONTEXTO IA ─── */}
          {activeTab === 'contexto' && (
            <AIContextPage />
          )}

          {/* ─── TAB: PERFIL ─── */}
          {activeTab === 'perfil' && (
            <>
              {/* Informações Cadastrais */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="text-[14px] font-semibold text-[#0F172A]">Informações Cadastrais</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Atualize os dados pessoais de exibição do corretor.</div>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="profile-name" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Nome Completo</label>
                      <Input
                        id="profile-name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (profileErrors.name) setProfileErrors((p) => ({ ...p, name: undefined }));
                        }}
                        aria-invalid={!!profileErrors.name}
                        aria-describedby={profileErrors.name ? 'profile-name-error' : undefined}
                        className={`bg-white text-[#0F172A] placeholder-[#64748B] text-[13px] h-10 rounded-lg ${profileErrors.name ? 'border-[#D92D20] focus:border-[#D92D20]' : 'border-[#E5E7EB] focus:border-[#1B3A6B]'}`}
                      />
                      {profileErrors.name && (
                        <p id="profile-name-error" className="text-[10px] text-[#D92D20] mt-1" role="alert">{profileErrors.name}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="profile-email" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">E-mail de Login</label>
                      <Input
                        id="profile-email"
                        type="email"
                        value={email}
                        readOnly
                        disabled
                        className="bg-[#F8FAFC] text-[#64748B] text-[13px] h-10 rounded-lg border-[#E5E7EB] cursor-not-allowed"
                      />
                      <p className="text-[10px] text-[#94A3B8] mt-1">Este é o e-mail usado para login e não pode ser alterado por aqui.</p>
                    </div>
                    <div>
                      <label htmlFor="profile-susep" className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Registro Profissional</label>
                      <Input
                        id="profile-susep"
                        value={susep}
                        placeholder="SUSEP, OAB, CRM, CRECI… (opcional)"
                        onChange={(e) => {
                          setSusep(e.target.value);
                          if (profileErrors.susep) setProfileErrors((p) => ({ ...p, susep: undefined }));
                        }}
                        aria-invalid={!!profileErrors.susep}
                        aria-describedby={profileErrors.susep ? 'profile-susep-error' : undefined}
                        className={`bg-white text-[#0F172A] placeholder-[#64748B] text-[13px] h-10 rounded-lg ${profileErrors.susep ? 'border-[#D92D20] focus:border-[#D92D20]' : 'border-[#E5E7EB] focus:border-[#1B3A6B]'}`}
                      />
                      {profileErrors.susep && (
                        <p id="profile-susep-error" className="text-[10px] text-[#D92D20] mt-1" role="alert">{profileErrors.susep}</p>
                      )}
                    </div>
                  </div>
                  <Button
                    disabled={isProfileLoading || isProfileSaving}
                    onClick={handleSaveProfile}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-semibold text-[13px] px-5 h-10 rounded-xl mt-2 shadow-md shadow-[#1B3A6B]/10 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isProfileSaving ? 'Salvando...' : 'Salvar Alterações'}
                  </Button>
                </div>
              </div>

              {/* Notificações */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-[#1B3A6B]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Notificações</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Configure quais alertas você deseja receber.</div>
                </div>
                <div className="p-5 space-y-1">
                  {notifications.map((n, i) => (
                    <div key={i} className="flex items-center justify-between py-3 border-b border-[#F1F5F9] last:border-0">
                      <div>
                        <div className="text-[13px] font-medium text-[#0F172A]">{n.label}</div>
                        <div className="text-[11px] text-[#64748B]">{n.desc}</div>
                      </div>
                      <button
                        onClick={() => toggleNotification(i)}
                        className={`w-10 h-6 rounded-full transition-colors ${
                          n.checked ? 'bg-[#1B3A6B]' : 'bg-[#E5E7EB]'
                        } relative`}
                        aria-label={`Toggle ${n.label}`}
                      >
                        <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          n.checked ? 'right-1' : 'left-1'
                        }`} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: INTEGRAÇÕES ─── */}
          {activeTab === 'integracoes' && (
            <>
              {/* Integration Status Overview */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="text-[14px] font-semibold text-[#0F172A]">Status de Conexão</div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Visão geral das integrações ativas e inativas.</div>
                </div>
                <div className="p-5 space-y-4">
                  {/* WhatsApp status inline */}
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[#F1F5F9] hover:bg-[#FAFBFC] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                        <Phone className="w-5 h-5 text-[#25D366]" />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#0F172A]">WhatsApp Business</div>
                        <div className="text-[11px] text-[#64748B]">Envio e recebimento de mensagens</div>
                      </div>
                    </div>
                    {whatsappStatus === 'loading' ? (
                      <Loader2 className="w-4 h-4 text-[#1B3A6B] animate-spin" />
                    ) : whatsappStatus === 'connected' ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48]">
                        ● Conectado
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3F2] text-[#D92D20]">
                        ● Desconectado
                      </span>
                    )}
                  </div>

                  {/* Google Calendar status inline */}
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[#F1F5F9] hover:bg-[#FAFBFC] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#4285F4]/10 flex items-center justify-center">
                        <Calendar className="w-5 h-5 text-[#4285F4]" />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#0F172A]">Google Calendar</div>
                        <div className="text-[11px] text-[#64748B]">Sincronização de reuniões e agenda</div>
                      </div>
                    </div>
                    {credentialState.google.calendarConnected ? (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48]">
                        ● Conectado
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FEF3F2] text-[#D92D20]">
                        ● Desconectado
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* WhatsApp Integration Detail */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-[#25D366]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">WhatsApp (Evolution API)</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Conectividade e status do gateway de envio para disparos e IA.</div>
                </div>
                <div className="p-5">
                  {/* 1. Loading State */}
                  {whatsappStatus === 'loading' && (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
                      <span className="text-[12px] text-[#64748B] mt-3 font-semibold">Verificando conexão da instância...</span>
                    </div>
                  )}

                  {/* 2. Connected State */}
                  {whatsappStatus === 'connected' && (
                    <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#ECFDF3] border border-[#A7F3D0] rounded-xl p-5">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-[#D1FAE5] text-[#027A48] rounded-xl">
                            <CheckCircle2 className="w-6 h-6 animate-pulse" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2.5">
                              <h4 className="text-[14px] font-bold text-[#0F172A]">WhatsApp Ativo</h4>
                              <Badge className="bg-[#D1FAE5] text-[#027A48] border border-[#A7F3D0] text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                                Sincronizado
                              </Badge>
                            </div>
                            <p className="text-[12px] text-[#64748B] mt-1 font-mono">
                              Instância: <span className="text-[#027A48] font-bold">{instanceName}</span>
                            </p>
                            <p className="text-[10px] text-[#64748B] mt-0.5">
                              O bot do Prospix está monitorando ativamente este número e respondendo leads em tempo real.
                            </p>
                          </div>
                        </div>
                        
                        {!isConfirmingDisconnect ? (
                          <Button
                            onClick={() => setIsConfirmingDisconnect(true)}
                            className="bg-[#FEF3F2] hover:bg-[#D92D20] hover:text-white text-[#D92D20] text-[12px] font-semibold px-4 h-9 rounded-xl transition-all duration-300 w-full sm:w-auto border border-[#FECACA]"
                          >
                            Desconectar WhatsApp
                          </Button>
                        ) : (
                          <div className="flex items-center gap-2 shrink-0 bg-white p-3 rounded-xl border border-[#E5E7EB] shadow-sm">
                            <span className="text-[12px] text-[#D92D20] font-bold">Desconectar?</span>
                            <Button
                              onClick={handleDisconnectWhatsapp}
                              className="bg-[#D92D20] hover:bg-[#B91C1C] text-white text-[10px] font-bold h-7 px-3 rounded-lg"
                            >
                              Sim
                            </Button>
                            <Button
                              onClick={() => setIsConfirmingDisconnect(false)}
                              className="bg-white border border-[#E5E7EB] text-[#64748B] text-[10px] font-bold h-7 px-3 rounded-lg"
                            >
                              Não
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Status Details */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Webhooks</span>
                          <Badge className="bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[9px] font-bold">
                            100% Configurado
                          </Badge>
                        </div>
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Taxa de Resposta da IA</span>
                          <span className="text-[12px] text-[#0F172A] font-semibold font-mono">Real-time / Instantânea</span>
                        </div>
                        <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                          <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Status do Servidor</span>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="w-1.5 h-1.5 bg-[#039855] rounded-full animate-ping" />
                            <span className="text-[12px] text-[#027A48] font-bold">Online</span>
                          </div>
                        </div>
                      </div>

                      {/* Anti-ban Info */}
                      <div className="p-5 rounded-xl border border-[#E5E7EB] bg-white">
                        <div className="flex items-center gap-2 mb-3">
                          <Shield className="w-4 h-4 text-[#1B3A6B]" />
                          <h4 className="text-[13px] font-bold text-[#0F172A]">Proteção Anti-banimento Automática</h4>
                        </div>
                        <p className="text-[12px] text-[#64748B] mb-4 leading-relaxed">
                          Diferente de outras ferramentas, o Prospix já possui um motor antiban nativo que roda 100% no backend. Não é necessário configurar intervalos manualmente.
                        </p>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Limite Diário de Envios</span>
                            <div className="text-[12px] text-[#0F172A] font-semibold">Configurado por Campanha</div>
                            <p className="text-[10px] text-[#64748B] mt-1">A IA para automaticamente ao atingir o limite definido nas suas campanhas.</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Intervalo entre Mensagens</span>
                            <div className="text-[12px] text-[#0F172A] font-semibold">45 a 90 segundos (Aleatório)</div>
                            <p className="text-[10px] text-[#64748B] mt-1">O motor sorteia um tempo diferente a cada envio para imitar comportamento humano.</p>
                          </div>
                          <div>
                            <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Aquecimento Gradual</span>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="w-7 h-4 bg-[#039855] rounded-full relative shadow-inner">
                                <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow" />
                              </div>
                              <span className="text-[12px] text-[#039855] font-bold">Sempre Ativo</span>
                            </div>
                            <p className="text-[10px] text-[#64748B] mt-1">O fluxo fracionado garante que a sua instância "esquente" naturalmente.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3. Disconnected State */}
                  {whatsappStatus === 'disconnected' && (
                    <>
                      {/* A. If QR Code is visible or is generating */}
                      {isGeneratingQr || qrCode ? (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-[#F8FAFC] border border-[#E5E7EB] p-6 rounded-xl">
                          {/* Left Side: Step by step instructions */}
                          <div className="lg:col-span-7 space-y-6">
                            <div>
                              <Badge className="bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[9px] uppercase font-bold tracking-wider mb-2">
                                Aguardando Leitura
                              </Badge>
                              <h4 className="text-[15px] font-bold text-[#0F172A]">Como conectar o seu WhatsApp?</h4>
                              <p className="text-[12px] text-[#64748B] mt-1">
                                Siga as instruções passo a passo para conectar o robô de IA do Prospix ao seu número.
                              </p>
                            </div>

                            <div className="space-y-4">
                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  1
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Abra o WhatsApp no seu smartphone (Android ou iPhone).
                                </p>
                              </div>
                              
                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  2
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Toque no menu <span className="font-semibold text-[#0F172A]">Aparelhos Conectados</span> (ou Configurações &gt; Aparelhos Conectados).
                                </p>
                              </div>

                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  3
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Selecione <span className="font-semibold text-[#0F172A]">Conectar um Aparelho</span> e valide com sua biometria ou senha.
                                </p>
                              </div>

                              <div className="flex items-start gap-3.5">
                                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EFF6FF] text-[#1B3A6B] border border-[#1B3A6B]/20 text-[11px] font-bold shrink-0">
                                  4
                                </div>
                                <p className="text-[12px] text-[#64748B] leading-relaxed mt-0.5">
                                  Aponte a câmera do seu celular para o QR Code ao lado para realizar o escaneamento.
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-2 text-[10px] text-[#64748B]">
                              <Loader2 className="w-3.5 h-3.5 text-[#1B3A6B] animate-spin" />
                              <span>Aguardando a confirmação do escaneamento do QR Code...</span>
                            </div>
                          </div>

                          {/* Right Side: QR Code frame */}
                          <div className="lg:col-span-5 flex flex-col items-center justify-center">
                            <div className="relative p-6 bg-white border border-[#E5E7EB] rounded-xl shadow-xl flex items-center justify-center w-[240px] h-[240px] overflow-hidden">
                              {isGeneratingQr ? (
                                <div className="flex flex-col items-center justify-center text-center">
                                  <Loader2 className="w-8 h-8 text-[#1B3A6B] animate-spin" />
                                  <span className="text-[10px] text-[#64748B] mt-2">Criando instância...</span>
                                </div>
                              ) : qrCode ? (
                                <img
                                  src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                                  alt="WhatsApp QR Code"
                                  className="w-full h-full object-contain rounded-lg"
                                />
                              ) : (
                                <div className="text-center p-4">
                                  <AlertCircle className="w-8 h-8 text-[#D92D20] mx-auto" />
                                  <span className="text-[12px] text-[#64748B] mt-2 block">Erro ao carregar QR Code</span>
                                </div>
                              )}
                            </div>
                            
                            {qrCode && (
                              <Button
                                onClick={handleConnectWhatsapp}
                                disabled={isGeneratingQr}
                                className="mt-3.5 text-[10px] font-bold h-7 px-3 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F8FAFC] text-[#64748B] disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3 h-3 mr-1.5 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                                {isGeneratingQr ? 'Gerando...' : qrCountdown > 0 ? `Atualizar automático em ${qrCountdown}s` : 'Atualizar QR Code'}
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : (
                        // B. Landing View - No QR Code active
                        <div className="flex flex-col items-center justify-center text-center py-10 px-4 max-w-md mx-auto">
                          <div className="p-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl text-[#64748B] shadow-sm">
                            <Phone className="w-8 h-8" />
                          </div>
                          
                          <h4 className="text-[16px] font-bold text-[#0F172A] mt-5">Conecte o seu WhatsApp Comercial</h4>
                          <p className="text-[12px] text-[#64748B] mt-2 leading-relaxed">
                            Conectando seu dispositivo móvel, o Prospix poderá disparar mensagens de prospecção ativa automaticamente e qualificar todos os seus leads em tempo real através da nossa Inteligência Artificial integrada.
                          </p>
                          
                          <Button
                            onClick={handleConnectWhatsapp}
                            className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-bold text-[13px] px-6 h-10 rounded-xl mt-6 shadow-lg shadow-[#1B3A6B]/10 w-full sm:w-auto"
                          >
                            Conectar WhatsApp
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Google Calendar */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#4285F4]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Google Agenda OAuth</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Sincronize reuniões e agendamentos com seu calendário pessoal.</div>
                </div>
                <div className="p-5">
                  {credentialState.google.calendarConnected ? (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#ECFDF3] border border-[#A7F3D0] rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-[#059669]/10 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-[#059669]" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-[13px] font-bold text-[#0F172A]">Google Agenda Ativa</h4>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-[#059669] text-white uppercase tracking-wider">
                                Sincronizado
                              </span>
                            </div>
                            <p className="text-[11px] text-[#059669] mt-0.5">A IA do Prospix está autorizada a ler conflitos e agendar reuniões.</p>
                          </div>
                        </div>
                        <Button onClick={handleDisconnectGoogle} className="bg-[#FEF3F2] hover:bg-[#FEE4E2] text-[#D92D20] text-[12px] font-semibold px-4 h-9 rounded-xl transition-colors border border-[#FEE4E2]">
                          Desconectar Agenda
                        </Button>
                      </div>

                      {/* Calendar selector */}
                      <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                        <label className="block space-y-2">
                          <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider">Calendário para sincronização</span>
                          <select
                            value={selectedCalendarId}
                            onChange={async (e) => {
                              const newId = e.target.value;
                              setSelectedCalendarId(newId);
                              try {
                                await apiFetch('/api/integrations/credentials', {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ googleCalendarId: newId }),
                                });
                                toast.success('Calendário atualizado', 'A sincronização usará este calendário.');
                              } catch {
                                toast.error('Erro', 'Não foi possível salvar a preferência de calendário.');
                              }
                            }}
                            disabled={isLoadingCalendars}
                            className="w-full bg-white border border-[#E5E7EB] text-[12px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none disabled:opacity-60"
                          >
                            {isLoadingCalendars ? (
                              <option>Carregando calendários...</option>
                            ) : googleCalendars.length > 0 ? (
                              googleCalendars.map((cal) => (
                                <option key={cal.id} value={cal.id}>
                                  {cal.summary}{cal.primary ? ' (Principal)' : ''}
                                </option>
                              ))
                            ) : (
                              <option value="primary">Calendário principal</option>
                            )}
                          </select>
                          <p className="text-[10px] text-[#94A3B8]">A IA agendará reuniões e verificará conflitos neste calendário.</p>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#4285F4]/10 flex items-center justify-center">
                          <Calendar className="w-5 h-5 text-[#4285F4]" />
                        </div>
                        <div>
                          <h4 className="text-[13px] font-bold text-[#0F172A]">Google Calendar API</h4>
                          <p className="text-[11px] text-[#64748B] mt-0.5">Permite checar conflitos e marcar slots de 30min.</p>
                        </div>
                      </div>
                      <Button onClick={handleGoogleConnect} className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[12px] font-semibold px-4 h-9 rounded-xl shadow-lg shadow-[#1B3A6B]/10">
                        Conectar Agenda
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: AGENDA ─── */}
          {activeTab === 'agenda' && (
            <>
              {/* Horários de Atendimento */}
              <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#1B3A6B]" />
                    <div className="text-[14px] font-semibold text-[#0F172A]">Horários de Atendimento</div>
                  </div>
                  <div className="text-[11px] text-[#64748B] mt-0.5">Defina quando você está disponível para reuniões agendadas pela IA.</div>
                </div>
                <div className="p-5 space-y-6">
                  {/* Dias disponíveis */}
                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-2.5">Dias Disponíveis</label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { value: 1, label: 'Seg' },
                        { value: 2, label: 'Ter' },
                        { value: 3, label: 'Qua' },
                        { value: 4, label: 'Qui' },
                        { value: 5, label: 'Sex' },
                        { value: 6, label: 'Sáb' },
                        { value: 0, label: 'Dom' },
                      ].map(day => {
                        const isActive = agendaSettings.availableDays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            onClick={() => {
                              setAgendaSettings(prev => ({
                                ...prev,
                                availableDays: isActive
                                  ? prev.availableDays.filter(d => d !== day.value)
                                  : [...prev.availableDays, day.value].sort(),
                              }));
                            }}
                            className={`h-10 w-14 rounded-xl text-[13px] font-semibold border transition-all ${
                              isActive
                                ? 'bg-[#1B3A6B] text-white border-[#1B3A6B] shadow-sm'
                                : 'bg-[#F8FAFC] text-[#94A3B8] border-[#E5E7EB] hover:bg-[#F1F3F6] hover:text-[#475569]'
                            }`}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Horário início/fim */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Início do expediente</label>
                      <select
                        value={agendaSettings.startHour}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, startHour: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['06:00','06:30','07:00','07:30','08:00','08:30','09:00','09:30','10:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Fim do expediente</label>
                      <select
                        value={agendaSettings.endHour}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, endHour: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['15:00','16:00','17:00','17:30','18:00','18:30','19:00','19:30','20:00','21:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Almoço */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Início do almoço</label>
                      <select
                        value={agendaSettings.lunchStart}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, lunchStart: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['11:00','11:30','12:00','12:30','13:00'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Fim do almoço</label>
                      <select
                        value={agendaSettings.lunchEnd}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, lunchEnd: e.target.value }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        {['12:30','13:00','13:30','14:00','14:30'].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Duração e Buffer */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Duração padrão da reunião</label>
                      <select
                        value={agendaSettings.defaultDuration}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, defaultDuration: Number(e.target.value) }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        <option value={15}>15 minutos</option>
                        <option value={30}>30 minutos</option>
                        <option value={45}>45 minutos</option>
                        <option value={60}>60 minutos</option>
                        <option value={90}>90 minutos</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Intervalo entre reuniões</label>
                      <select
                        value={agendaSettings.bufferMinutes}
                        onChange={e => setAgendaSettings(prev => ({ ...prev, bufferMinutes: Number(e.target.value) }))}
                        className="w-full bg-white border border-[#E5E7EB] text-[13px] rounded-xl px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                      >
                        <option value={0}>Sem intervalo</option>
                        <option value={5}>5 minutos</option>
                        <option value={10}>10 minutos</option>
                        <option value={15}>15 minutos</option>
                        <option value={30}>30 minutos</option>
                      </select>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4">
                    <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider mb-2">Resumo da sua disponibilidade</div>
                    <div className="text-[13px] text-[#0F172A] space-y-1">
                      <p>📅 <strong>{agendaSettings.availableDays.length} dias</strong> por semana ({agendaSettings.availableDays.map(d => ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d]).join(', ')})</p>
                      <p>⏰ Horário: <strong>{agendaSettings.startHour}</strong> às <strong>{agendaSettings.endHour}</strong></p>
                      <p>🍽️ Almoço: <strong>{agendaSettings.lunchStart}</strong> às <strong>{agendaSettings.lunchEnd}</strong></p>
                      <p>📝 Reuniões de <strong>{agendaSettings.defaultDuration} min</strong> com intervalo de <strong>{agendaSettings.bufferMinutes} min</strong></p>
                    </div>
                  </div>

                  <Button
                    disabled={isAgendaSaving}
                    onClick={async () => {
                      setIsAgendaSaving(true);
                      try {
                        const res = await apiFetch('/api/integrations/agenda', {
                          method: 'PATCH',
                          body: JSON.stringify({ agendaSettings }),
                        });
                        if (!res.ok) {
                          const errData = await res.json().catch(() => ({}));
                          throw new Error(errData?.message || 'Erro ao processar requisição no servidor.');
                        }
                        toast.success('Agenda configurada', 'Seus horários de disponibilidade foram salvos.');
                      } catch (err: any) {
                        toast.error('Erro ao salvar', err?.message || 'Não foi possível salvar as configurações de agenda.');
                      } finally {
                        setIsAgendaSaving(false);
                      }
                    }}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white font-semibold text-[13px] px-5 h-10 rounded-xl shadow-md shadow-[#1B3A6B]/10 disabled:opacity-60"
                  >
                    {isAgendaSaving ? 'Salvando...' : 'Salvar Configurações'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ─── TAB: CREDENCIAIS ─── */}
          {activeTab === 'credenciais' && (
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Chaves de API (Bring Your Own Key)</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Insira suas chaves proprietárias para IA, enriquecimento e integrações. Os valores são armazenados criptografados.</div>
              </div>
              <div className="p-5 space-y-5">
                {/* Status badges */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Provedor IA</span>
                    <select
                      value={credentialDraft.aiProvider}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, aiProvider: e.target.value as 'GUILDS_SHARED' | 'TENANT_OWN' })}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      className="w-full bg-white border border-[#E5E7EB] text-[12px] rounded-lg px-3 h-10 text-[#0F172A] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none disabled:opacity-60"
                    >
                      <option value="GUILDS_SHARED">Guilds compartilhado</option>
                      <option value="TENANT_OWN">Chaves próprias</option>
                    </select>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">OpenAI</span>
                    <Badge className={credentialState.keys.openai.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.openai.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Google Maps</span>
                    <Badge className={credentialState.keys.googleMaps.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.googleMaps.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Tavily Search</span>
                    <Badge className={credentialState.keys.tavily?.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.tavily?.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-bold uppercase tracking-wider block mb-1">Firecrawl</span>
                    <Badge className={credentialState.keys.firecrawl?.configured ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : 'bg-white border-[#E5E7EB] text-[#64748B]'}>
                      {credentialState.keys.firecrawl?.configured ? 'Configurada' : 'Não configurada'}
                    </Badge>
                  </div>
                </div>

                {/* API Key inputs */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">OpenAI API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.openaiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, openaiApiKey: e.target.value })}
                        placeholder={credentialState.keys.openai.configured ? 'Nova chave para substituir a atual' : 'sk-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Anthropic API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.anthropicApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, anthropicApiKey: e.target.value })}
                        placeholder={credentialState.keys.anthropic.configured ? 'Nova chave para substituir a atual' : 'sk-ant-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Google AI / Gemini API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.googleAiApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleAiApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleAi.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Google Maps API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.googleMapsApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, googleMapsApiKey: e.target.value })}
                        placeholder={credentialState.keys.googleMaps.configured ? 'Nova chave para substituir a atual' : 'AIza...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Evolution API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.evolutionApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionApiKey: e.target.value })}
                        placeholder={credentialState.keys.evolution.configured ? 'Nova chave para substituir a atual' : 'Token da Evolution API'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Tavily API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.tavilyApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, tavilyApiKey: e.target.value })}
                        placeholder={credentialState.keys.tavily?.configured ? 'Nova chave para substituir a atual' : 'tvly-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Firecrawl API Key</label>
                    <div className="relative">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
                      <Input
                        type="password"
                        value={credentialDraft.firecrawlApiKey}
                        disabled={!canManageCredentials || isCredentialsLoading}
                        onChange={(e) => setCredentialDraft({ ...credentialDraft, firecrawlApiKey: e.target.value })}
                        placeholder={credentialState.keys.firecrawl?.configured ? 'Nova chave para substituir a atual' : 'fc-...'}
                        className="pl-10 bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 font-mono disabled:opacity-70 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block mb-1.5">Evolution Base URL</label>
                    <Input
                      value={credentialDraft.evolutionBaseUrl}
                      disabled={!canManageCredentials || isCredentialsLoading}
                      onChange={(e) => setCredentialDraft({ ...credentialDraft, evolutionBaseUrl: e.target.value })}
                      placeholder={credentialState.whatsapp.baseUrlConfigured ? 'Nova URL para substituir a atual' : 'https://evo.seudominio.com.br'}
                      className="bg-white border-[#E5E7EB] text-[#0F172A] placeholder-[#64748B] text-[12px] focus:border-[#1B3A6B] h-10 disabled:opacity-70 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-[#EEF0F3]">
                  <p className="text-[10px] text-[#64748B] leading-relaxed">
                    {canManageCredentials
                      ? 'Após salvar, os campos ficam vazios por segurança; a tela mostra apenas o estado configurado.'
                      : 'Sua função não permite alterar credenciais do tenant.'}
                  </p>
                  <Button
                    disabled={!canManageCredentials || isCredentialsSaving || isCredentialsLoading}
                    onClick={handleSaveCredentials}
                    className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[12px] font-semibold px-5 h-10 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isCredentialsSaving ? 'Salvando...' : 'Salvar Credenciais'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB: FINANCEIRO ─── */}
          {activeTab === 'financeiro' && (
            <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#EEF0F3]">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-[#1B3A6B]" />
                  <div className="text-[14px] font-semibold text-[#0F172A]">Assinatura Ativa (Asaas)</div>
                </div>
                <div className="text-[11px] text-[#64748B] mt-0.5">Acompanhe assinatura, faturas e consumo operacional do tenant.</div>
              </div>
              <div className="p-5 space-y-6">
                {isBillingLoading ? (
                  <div className="flex items-center gap-2 text-[12px] text-[#64748B] py-8">
                    <Loader2 className="w-4 h-4 animate-spin text-[#1B3A6B]" />
                    <span>Carregando faturamento real...</span>
                  </div>
                ) : !billingData ? (
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="p-3 bg-white border border-[#E5E7EB] rounded-xl text-[#64748B] w-fit">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-[14px] font-bold text-[#0F172A]">Faturamento não encontrado</h4>
                      <p className="text-[12px] text-[#64748B] mt-1 leading-relaxed">
                        Nenhuma fatura foi localizada para este tenant. Assim que o Asaas gerar cobranças, elas aparecerão aqui.
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB]">
                    <span className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider block">Plano Atual</span>
                    <h4 className="text-[14px] font-bold text-[#0F172A] mt-1">{billingData.tenant.planName}</h4>
                    <p className="text-[12px] text-[#64748B] mt-0.5">{formatBRL(billingData.tenant.mrrCents)} / mês</p>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] space-y-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="text-[#64748B] font-semibold uppercase tracking-wider text-[10px]">Uso de IA no mês</span>
                      <span className="text-[#64748B] font-mono font-medium">
                        {(billingData.usage.llmTokensInput + billingData.usage.llmTokensOutput).toLocaleString('pt-BR')} tokens
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">IA</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.llmCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">WhatsApp</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.whatsappCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] text-[#64748B] uppercase font-bold">Maps</p>
                        <p className="text-[12px] text-[#0F172A] font-mono">{formatBRL(billingData.usage.googleMapsCostCents)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {billingData.currentInvoice && (
                  <div className="rounded-xl border border-[#E5E7EB] bg-[#F8FAFC] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider block">Fatura atual</span>
                      <p className="text-[14px] font-bold text-[#0F172A] mt-1">{formatBRL(billingData.currentInvoice.totalCents)}</p>
                      <p className="text-[12px] text-[#64748B] mt-0.5">
                        Vencimento em {formatDate(billingData.currentInvoice.dueAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={billingData.currentInvoice.status === 'PAID' ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : billingData.currentInvoice.status === 'OVERDUE' ? 'bg-[#FEF3F2] text-[#D92D20] border border-[#FECACA]' : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'}>
                        {billingData.currentInvoice.status === 'PAID' ? 'Pago' : billingData.currentInvoice.status === 'OVERDUE' ? 'Em atraso' : 'Pendente'}
                      </Badge>
                      {billingData.currentInvoice.invoiceUrl && (
                        <Button
                          onClick={() => window.open(billingData.currentInvoice!.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                          className="bg-[#1B3A6B] hover:bg-[#15305A] text-white text-[10px] font-bold h-8 px-3 rounded-lg flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Abrir fatura
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">Histórico de Cobrança (Faturas Asaas)</span>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[10px] text-[#64748B] uppercase font-bold tracking-wider text-left">
                          <th className="py-2.5">Data de Vencimento</th>
                          <th className="py-2.5">Valor</th>
                          <th className="py-2.5">Status</th>
                          <th className="py-2.5 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F1F5F9]">
                        {billingData.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-3 font-medium text-[#64748B]">{formatDate(inv.dueAt)}</td>
                            <td className="py-3 font-mono font-medium text-[#0F172A]">{formatBRL(inv.totalCents)}</td>
                            <td className="py-3">
                              <Badge className={inv.status === 'PAID' ? 'bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0]' : inv.status === 'OVERDUE' ? 'bg-[#FEF3F2] text-[#D92D20] border border-[#FECACA]' : 'bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]'}>
                                {inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Em atraso' : inv.status === 'WAIVED' ? 'Isenta' : inv.status === 'REFUNDED' ? 'Estornada' : 'Pendente'}
                              </Badge>
                            </td>
                            <td className="py-3 text-right">
                              {inv.invoiceUrl && (
                                <Button
                                  onClick={() => window.open(inv.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                                  className="bg-[#F8FAFC] hover:bg-[#E5E7EB] text-[#0F172A] border border-[#E5E7EB] text-[10px] font-bold h-7 px-2.5 rounded-lg flex items-center gap-1.5 ml-auto"
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
                            <td colSpan={4} className="py-8 text-center text-[12px] text-[#64748B]">
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
              </div>
            </div>
          )}

          {/* ─── TAB: PRIVACIDADE ─── */}
          {activeTab === 'privacidade' && (
            <PrivacyTab />
          )}
        </div>
      </div>
    </div>
  );
}
