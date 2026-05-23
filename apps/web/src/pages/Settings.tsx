import { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Tabs, TabsList, TabsTrigger, TabsContent, Badge, toast } from '@prospix/ui';
import { Settings as SettingsIcon, Shield, CreditCard, Key, Calendar, Phone, Copy, Loader2, CheckCircle2, AlertCircle, RefreshCw, FileText } from 'lucide-react';
import { useAuthStore } from '../store/auth-store';
import { apiClient } from '../lib/api-client';
import { canUseMockFallbacks } from '../lib/demo-mode';
import PrivacyTab from './settings/PrivacyTab';

export default function Settings() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState('perfil');

  // Profile fields state
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [susep, setSusep] = useState('');

  // Integrations states
  const [whatsappStatus, setWhatsappStatus] = useState<'connected' | 'disconnected' | 'loading'>('loading');
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [isGeneratingQr, setIsGeneratingQr] = useState(false);
  const [openaiKey, setOpenaiKey] = useState(canUseMockFallbacks ? '••••••••••••••••••••••••••••••••' : '');
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Billing Mock Data (Asaas integration)
  const billingData = canUseMockFallbacks ? {
    planName: 'Prospix Premium',
    mrr: 'R$ 399,00 / mês',
    aiUsage: { used: 720, total: 1000, percentage: 72 },
    invoices: [
      { id: '1', dueDate: '10/06/2026', value: 'R$ 399,00', status: 'pendente', pixCode: '00020126360014BR.GOV.BCB.PIX0114prospixbilling' },
      { id: '2', dueDate: '10/05/2026', value: 'R$ 399,00', status: 'pago' },
      { id: '3', dueDate: '10/04/2026', value: 'R$ 399,00', status: 'pago' },
    ]
  } : null;

  const handleCopyPix = (pixCode: string) => {
    if (!canUseMockFallbacks) {
      toast.error('Faturamento indisponível', 'As faturas reais ainda não estão conectadas neste ambiente.');
      return;
    }

    navigator.clipboard.writeText(pixCode);
    toast.success('Pix Copiado', 'Código Pix Copia e Cola copiado para a área de transferência!');
  };

  const handleGoogleConnect = async () => {
    try {
      const response = await apiClient.get('/tenant/integrations/google/oauth');
      if (response.data?.auth_url) {
        window.location.href = response.data.auth_url;
      } else {
        toast.error('Erro de Conexão', 'Erro ao obter link de autorização do Google Agenda.');
      }
    } catch (err: any) {
      console.error('Error connecting Google Calendar:', err);
      toast.error('Erro de Conexão', err.response?.data?.message || 'Erro ao conectar ao Google Agenda.');
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
    if (activeTab === 'integracoes') {
      checkStatus();
    }
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
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
      
      // Start polling status every 3 seconds to see if they scanned it
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = setInterval(() => {
        checkStatus(true);
      }, 3000);
    } catch (err: any) {
      console.error('Error generating WhatsApp QR code:', err);
      toast.error('Erro no Gateway', err.response?.data?.message || 'Ocorreu um erro ao conectar com o servidor da Evolution API.');
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
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Nome Completo</label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">E-mail Profissional</label>
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">Código SUSEP</label>
                    <Input value={susep} onChange={(e) => setSusep(e.target.value)} className="bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10" />
                  </div>
                </div>
                <Button
                  disabled={!canUseMockFallbacks}
                  onClick={() => {
                    if (canUseMockFallbacks) {
                      toast.info('Modo demo', 'Alterações de perfil não são persistidas no modo demo.');
                    }
                  }}
                  className="bg-primary hover:bg-primary-hover text-white font-semibold text-xs px-4 h-10 rounded-xl mt-4 shadow-md shadow-primary/10 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Salvar Alterações
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
                <CardDescription className="text-text-secondary text-xs">Insira suas chaves proprietárias para LLMs corporativas.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block mb-1">OpenAI API Key (AES-256-GCM Criptografada)</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
                      <Input
                        type="password"
                        value={openaiKey}
                        disabled={!canUseMockFallbacks}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        placeholder={canUseMockFallbacks ? undefined : 'Credenciais indisponíveis neste ambiente'}
                        className="pl-10 bg-white border-border text-text placeholder-text-secondary text-xs focus:border-border-strong h-10 font-mono disabled:opacity-70"
                      />
                    </div>
                    <Button
                      disabled={!canUseMockFallbacks}
                      onClick={() => {
                        if (canUseMockFallbacks) {
                          toast.info('Modo demo', 'Chaves de API não são persistidas no modo demo.');
                        }
                      }}
                      className="bg-surface-sunken hover:bg-border text-text-secondary border border-border/80 text-xs font-semibold px-4 h-10 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Salvar Chave
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: BILLING */}
          <TabsContent value="faturamento" className="m-0 space-y-6">
            <Card className="bg-white border-border shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-bold font-heading text-text">Assinatura Ativa (Asaas)</CardTitle>
                <CardDescription className="text-text-secondary text-xs">Gerencie faturas corporativas e limites de uso de IA.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!billingData ? (
                  <div className="rounded-xl border border-border bg-surface-sunken p-6 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="p-3 bg-white border border-border rounded-xl text-text-secondary w-fit">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-text font-heading">Faturamento indisponível neste ambiente</h4>
                      <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                        Faturas, Pix e limites financeiros reais serão exibidos apenas quando a integração de cobrança estiver conectada ao backend.
                      </p>
                    </div>
                  </div>
                ) : (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-surface-sunken border border-border">
                    <span className="text-[10px] text-text-secondary font-semibold uppercase tracking-wider block">Plano Atual</span>
                    <h4 className="text-sm font-bold text-text mt-1">{billingData.planName}</h4>
                    <p className="text-xs text-text-secondary mt-0.5">{billingData.mrr}</p>
                  </div>

                  <div className="p-4 rounded-xl bg-surface-sunken border border-border space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-secondary font-semibold uppercase tracking-wider text-[10px]">Uso da Franquia de IA</span>
                      <span className="text-text-secondary font-mono font-medium">{billingData.aiUsage.used} / {billingData.aiUsage.total} conversas</span>
                    </div>
                    <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                      <div className="bg-primary h-full rounded-full" style={{ width: `${billingData.aiUsage.percentage}%` }} />
                    </div>
                  </div>
                </div>

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
                            <td className="py-3 font-medium text-text-secondary">{inv.dueDate}</td>
                            <td className="py-3 font-mono font-medium text-text">{inv.value}</td>
                            <td className="py-3">
                              <Badge className={inv.status === 'pago' ? 'bg-success-soft text-success-text border border-success/20' : 'bg-warning-soft text-warning-text border border-warning/20'}>
                                {inv.status === 'pago' ? 'Pago' : 'Pendente'}
                              </Badge>
                            </td>
                            <td className="py-3 text-right">
                              {inv.status === 'pendente' && inv.pixCode && (
                                <Button
                                  onClick={() => handleCopyPix(inv.pixCode!)}
                                  className="bg-success hover:bg-success/90 text-white text-[10px] font-bold h-7 px-2.5 rounded-lg flex items-center gap-1.5 ml-auto shadow-md shadow-success/10 animate-pulse"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Pix Copia e Cola</span>
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
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
