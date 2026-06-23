'use client';

import { Target, Plus, Pause, Edit2, Copy, Play, Loader2, Info, X, Trash2, ChevronDown, Lock, Zap, Tag, ChevronRight, AlertTriangle, ArrowRight } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { campaignsQueries, tenantAddonsQueries, icpsQueries, scriptsQueries } from '@/lib/queries';
import type { ICP } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast, Tooltip } from '@prospix/ui';
import { apiFetch } from '@/lib/api-fetch';

interface Campaign {
  id: string;
  name: string;
  profession: string;
  cities: string[];
  neighborhoods: string[];
  dailyLimit: number;
  hourWindowStart: number;
  hourWindowEnd: number;
  status: 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ARCHIVED';
  createdAt: string;
  filters?: Record<string, any>;
  searchTags?: string[];
  captureSources?: string[];
  state?: string;
  icpId: string;
  icpName?: string;
}

const BRAZILIAN_STATES = [
  { value: 'AC', label: 'AC – Acre' }, { value: 'AL', label: 'AL – Alagoas' },
  { value: 'AP', label: 'AP – Amapá' }, { value: 'AM', label: 'AM – Amazonas' },
  { value: 'BA', label: 'BA – Bahia' }, { value: 'CE', label: 'CE – Ceará' },
  { value: 'DF', label: 'DF – Distrito Federal' }, { value: 'ES', label: 'ES – Espírito Santo' },
  { value: 'GO', label: 'GO – Goiás' }, { value: 'MA', label: 'MA – Maranhão' },
  { value: 'MT', label: 'MT – Mato Grosso' }, { value: 'MS', label: 'MS – Mato Grosso do Sul' },
  { value: 'MG', label: 'MG – Minas Gerais' }, { value: 'PA', label: 'PA – Pará' },
  { value: 'PB', label: 'PB – Paraíba' }, { value: 'PR', label: 'PR – Paraná' },
  { value: 'PE', label: 'PE – Pernambuco' }, { value: 'PI', label: 'PI – Piauí' },
  { value: 'RJ', label: 'RJ – Rio de Janeiro' }, { value: 'RN', label: 'RN – Rio Grande do Norte' },
  { value: 'RS', label: 'RS – Rio Grande do Sul' }, { value: 'RO', label: 'RO – Rondônia' },
  { value: 'RR', label: 'RR – Roraima' }, { value: 'SC', label: 'SC – Santa Catarina' },
  { value: 'SP', label: 'SP – São Paulo' }, { value: 'SE', label: 'SE – Sergipe' },
  { value: 'TO', label: 'TO – Tocantins' },
];

const PROFESSION_SOURCES: Record<string, string[]> = {
  DOCTOR:       ['GOOGLE_MAPS', 'CNPJ_MINER', 'DOCTORALIA', 'CRM_SP', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  LAWYER:       ['GOOGLE_MAPS', 'CNPJ_MINER', 'OAB_SP', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  DENTIST:      ['GOOGLE_MAPS', 'CNPJ_MINER', 'CRO_SP', 'DOCTORALIA', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  ENTREPRENEUR: ['GOOGLE_MAPS', 'CNPJ_MINER', 'COMPRASNET', 'VIVAREAL', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  ENGINEER:     ['GOOGLE_MAPS', 'CNPJ_MINER', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  ACCOUNTANT:   ['GOOGLE_MAPS', 'CNPJ_MINER', 'INSTAGRAM', 'LANDING_PAGE', 'IMPORTED'],
  OTHER:        ['GOOGLE_MAPS', 'CNPJ_MINER', 'LANDING_PAGE', 'IMPORTED'],
};

interface CampaignLimit {
  plan: string;
  maxActive: number;
  currentActive: number;
  canCreate: boolean;
}

// ── Segment System (replaces rigid profession) ─────────────────────────────
const SEGMENTS = [
  {
    id: 'health',
    label: 'Profissionais de Saúde',
    icon: '🏥',
    profession: 'DOCTOR',
    suggestedTags: ['médicos', 'clínica médica', 'consultório médico', 'especialista', 'CRM'],
  },
  {
    id: 'dental',
    label: 'Odontologia',
    icon: '🦷',
    profession: 'DENTIST',
    suggestedTags: ['dentista', 'clínica odontológica', 'consultório dentário', 'ortodontista', 'CRO'],
  },
  {
    id: 'legal',
    label: 'Advogados e Jurídico',
    icon: '⚖️',
    profession: 'LAWYER',
    suggestedTags: ['advogado', 'escritório de advocacia', 'assessoria jurídica', 'OAB'],
  },
  {
    id: 'business',
    label: 'Empresários e Comércio',
    icon: '🏢',
    profession: 'ENTREPRENEUR',
    suggestedTags: ['empresa', 'comércio', 'loja', 'empreendedor', 'MEI'],
  },
  {
    id: 'engineering',
    label: 'Engenharia e Arquitetura',
    icon: '🏗️',
    profession: 'ENGINEER',
    suggestedTags: ['engenheiro', 'escritório de engenharia', 'construtora', 'arquiteto', 'CREA'],
  },
  {
    id: 'accounting',
    label: 'Contabilidade',
    icon: '📊',
    profession: 'ACCOUNTANT',
    suggestedTags: ['contador', 'escritório de contabilidade', 'CRC', 'assessoria contábil'],
  },
  {
    id: 'custom',
    label: 'Personalizado',
    icon: '🎯',
    profession: 'OTHER',
    suggestedTags: [],
  },
];

const CAPTURE_SOURCES = [
  { id: 'GOOGLE_MAPS', label: 'Google Maps Places', icon: '📍', description: 'Busca por especialidade e geolocalização.' },
  { id: 'CNPJ_MINER', label: 'CNPJ Miner (Receita Federal)', icon: '🔍', description: 'Empresas abertas recentemente na base da RF.' },
  { id: 'DOCTORALIA', label: 'Doctoralia', icon: '🩺', description: 'Médicos, dentistas e clínicas locais.', isComingSoon: true },
  { id: 'CRM_SP', label: 'CRM (Conselho Medicina)', icon: '🏥', description: 'Base do conselho regional de medicina.' },
  { id: 'OAB_SP', label: 'OAB (Ordem Advogados)', icon: '⚖️', description: 'Base da Ordem dos Advogados do Brasil.' },
  { id: 'CRO_SP', label: 'CRO (Conselho Odonto)', icon: '🦷', description: 'Base do conselho regional de odontologia.' },
  { id: 'COMPRASNET', label: 'Comprasnet Licitações', icon: '📜', description: 'Ganhadoras de licitações públicas.', isComingSoon: true },
  { id: 'VIVAREAL', label: 'VivaReal Imóveis', icon: '🏠', description: 'Anúncios de aluguel comercial.', isComingSoon: true },
  { id: 'INSTAGRAM', label: 'Instagram Scraper', icon: '📸', description: 'Perfis profissionais locais.', isComingSoon: true },
  { id: 'LANDING_PAGE', label: 'Landing Page (Webhook)', icon: '🌐', description: 'Leads via formulários externos.' },
  { id: 'IMPORTED', label: 'Importação CSV', icon: '📄', description: 'Leads importados manualmente.' },
];

const PROF_ICON: Record<string, string> = {
  DOCTOR: '🏥', LAWYER: '⚖️', DENTIST: '🦷', ENTREPRENEUR: '🏢', ENGINEER: '🏗️',
  ARCHITECT: '🏗️', ACCOUNTANT: '📊', OTHER: '🎯',
  BUSINESS_OWNER: '🏢', // legacy fallback
};
const PROF_LABEL: Record<string, string> = {
  DOCTOR: 'Saúde', LAWYER: 'Jurídico', DENTIST: 'Odontologia', ENTREPRENEUR: 'Empresários',
  ENGINEER: 'Engenharia', ARCHITECT: 'Arquitetura', ACCOUNTANT: 'Contabilidade', OTHER: 'Personalizado',
  BUSINESS_OWNER: 'Empresários',
};

const PLAN_LABELS: Record<string, string> = { STARTER: 'Starter', STANDARD: 'Standard', PREMIUM: 'Premium' };

const DEFAULT_SEGMENT = { id: 'custom', label: 'Personalizado', icon: '🎯', profession: 'OTHER', suggestedTags: [] as string[] };

export default function Campaigns() {
  const tenantId = useAuthStore(state => state.tenantId);
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'ACTIVE' | 'PAUSED' | 'DRAFT'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [campaignLimit, setCampaignLimit] = useState<CampaignLimit | null>(null);
  const [showAddonModal, setShowAddonModal] = useState(false);
  const [purchasingAddon, setPurchasingAddon] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Onboarding Guardrail states
  const [hasScripts, setHasScripts] = useState<boolean | null>(null);
  const [showGuardrailModal, setShowGuardrailModal] = useState(false);
  const [guardrailTitle, setGuardrailTitle] = useState('');
  const [guardrailDesc, setGuardrailDesc] = useState('');
  const [guardrailActionText, setGuardrailActionText] = useState('');
  const [guardrailActionUrl, setGuardrailActionUrl] = useState('');

  // ICP Data state
  const [icps, setIcps] = useState<ICP[]>([]);
  const [loadingIcps, setLoadingIcps] = useState(false);
  const [selectedIcpId, setSelectedIcpId] = useState<string>('');

  // Script (Roteiro) state
  const [scripts, setScripts] = useState<any[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');

  // Form state
  const [selectedSegment, setSelectedSegment] = useState('health');
  const [captureSources, setCaptureSources] = useState<string[]>(['GOOGLE_MAPS']);
  const [campState, setCampState] = useState('SP');
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [newCamp, setNewCamp] = useState({
    name: '', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18',
    icpMinScore: '',
    icpWeightProfession: '', icpWeightWhatsapp: '', icpWeightOwner: '',
    icpWeightArea: '', icpWeightCnpjYears: '', icpWeightGoogle: '',
    icpHighValueAreas: '', icpMinGoogleRating: '', icpMinReviews: '',
  });

  // ── Data fetching ──────────────────────────────────────────────────────
  const fetchCampaigns = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await campaignsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      setCampaigns((result.data || []).map((c: any) => ({
        id: c.id, name: c.name, profession: c.profession,
        cities: c.cities || [], neighborhoods: c.neighborhoods || [],
        dailyLimit: c.daily_limit, hourWindowStart: c.hour_window_start,
        hourWindowEnd: c.hour_window_end, status: c.status,
        createdAt: c.created_at, filters: c.filters,
        searchTags: c.search_tags || [],
        captureSources: c.capture_sources || ['GOOGLE_MAPS'],
        state: c.state || 'SP',
        icpId: c.icp_id,
        icpName: c.icps?.name || 'Padrão',
        activeScriptId: c.active_script_id,
      })));
    } catch (err) {
      console.error('Failed to fetch campaigns', err);
      toast.error('Erro ao carregar', 'Não foi possível carregar as campanhas.');
      setCampaigns([]);
    } finally { setLoading(false); }
  }, [tenantId]);

  const fetchLimit = useCallback(async () => {
    if (!tenantId) return;
    try {
      const limit = await campaignsQueries.getLimit(tenantId);
      setCampaignLimit(limit);
    } catch (err) { console.error(err); }
  }, [tenantId]);

  const fetchIcps = useCallback(async () => {
    if (!tenantId) return;
    setLoadingIcps(true);
    try {
      const result = await icpsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      setIcps(result.data || []);
    } catch (err) {
      console.error('Failed to fetch ICPs', err);
      toast.error('Erro ao carregar', 'Não foi possível carregar os perfis de cliente ideal (ICP).');
    } finally {
      setLoadingIcps(false);
    }
  }, [tenantId]);

  const fetchScriptsCheck = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await scriptsQueries.list(tenantId);
      const list = result.data || [];
      setScripts(list);
      setHasScripts(list.length > 0);
    } catch (err) {
      console.error(err);
      setScripts([]);
      setHasScripts(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchCampaigns();
    fetchLimit();
    fetchIcps();
    fetchScriptsCheck();
  }, [fetchCampaigns, fetchLimit, fetchIcps, fetchScriptsCheck]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handlePause = async (id: string) => {
    if (!tenantId) return;
    setActionLoading(id);
    try {
      const result = await campaignsQueries.pause(tenantId, id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha pausada');
      await fetchCampaigns(); await fetchLimit();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível pausar a campanha.'); }
    setActionLoading(null);
  };

  const handleResume = async (id: string) => {
    if (!tenantId) return;
    // Check limit before resuming
    if (campaignLimit && !campaignLimit.canCreate) {
      toast.error('Limite atingido', `Seu plano ${PLAN_LABELS[campaignLimit.plan]} permite ${campaignLimit.maxActive} campanhas ativas.`);
      setShowAddonModal(true);
      return;
    }
    setActionLoading(id);
    try {
      const result = await campaignsQueries.resume(tenantId, id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha ativada');
      await fetchCampaigns(); await fetchLimit();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível ativar a campanha.'); }
    setActionLoading(null);
  };

  const handlePauseAll = async () => {
    if (!tenantId) return;
    const activeCamps = campaigns.filter(c => c.status === 'ACTIVE');
    if (activeCamps.length === 0) return toast.info('Nenhuma campanha ativa para pausar.');
    setActionLoading('global_pause');
    try {
      for (const camp of activeCamps) {
        await campaignsQueries.pause(tenantId, camp.id);
      }
      toast.success('Todas as campanhas foram pausadas!');
      await fetchCampaigns();
      await fetchLimit();
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Houve um problema ao pausar as campanhas.');
    }
    setActionLoading(null);
  };

  const handleResumeAll = async () => {
    if (!tenantId) return;
    const pausedCamps = campaigns.filter(c => c.status === 'PAUSED');
    if (pausedCamps.length === 0) return toast.info('Nenhuma campanha pausada para ativar.');
    setActionLoading('global_resume');
    try {
      // Basic limit check
      if (campaignLimit && (campaignLimit.currentActive + pausedCamps.length > campaignLimit.maxActive)) {
        toast.error('Limite excedido', `Seu plano permite no máximo ${campaignLimit.maxActive} campanhas ativas simultâneas.`);
        return;
      }
      for (const camp of pausedCamps) {
        await campaignsQueries.resume(tenantId, camp.id);
      }
      toast.success('Todas as campanhas foram reativadas!');
      await fetchCampaigns();
      await fetchLimit();
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Houve um problema ao reativar as campanhas.');
    }
    setActionLoading(null);
  };

  const handleDuplicate = async (camp: Campaign) => {
    if (!tenantId) return;
    setActionLoading(camp.id);
    try {
      const result = await campaignsQueries.create(tenantId, {
        name: `${camp.name} (cópia)`,
        profession: camp.profession as any,
        cities: camp.cities,
        neighborhoods: camp.neighborhoods || [],
        dailyLimit: camp.dailyLimit,
        hourWindowStart: camp.hourWindowStart,
        hourWindowEnd: camp.hourWindowEnd,
        icpId: camp.icpId,
        filters: camp.filters,
        searchTags: camp.searchTags || [],
        captureSources: camp.captureSources || ['GOOGLE_MAPS'],
        state: camp.state || 'SP',
      });
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha duplicada');
      await fetchCampaigns();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível duplicar a campanha.'); }
    setActionLoading(null);
  };

  const handleEdit = (camp: Campaign) => {
    setEditingCampaign(camp);
    const seg = SEGMENTS.find(s => s.profession === camp.profession) ?? DEFAULT_SEGMENT;
    setSelectedSegment(seg.id);
    setSearchTags(camp.searchTags || seg.suggestedTags);
    setNewCamp({
      name: camp.name,
      cities: camp.cities?.join(', ') || '',
      dailyLimit: String(camp.dailyLimit),
      hourStart: String(camp.hourWindowStart),
      hourEnd: String(camp.hourWindowEnd),
      icpMinScore: '',
      icpWeightProfession: '',
      icpWeightWhatsapp: '',
      icpWeightOwner: '',
      icpWeightArea: '',
      icpWeightCnpjYears: '',
      icpWeightGoogle: '',
      icpHighValueAreas: '',
      icpMinGoogleRating: '',
      icpMinReviews: '',
    });
    setSelectedIcpId(camp.icpId || '');
    setSelectedScriptId((camp as any).active_script_id || (camp as any).activeScriptId || '');
    setCaptureSources(camp.captureSources || []);
    setCampState(camp.state || 'SP');
    setIsCreateOpen(true);
  };

  const handleDelete = async (camp: Campaign) => {
    setCampaignToDelete(camp);
    setDeleteConfirmText('');
  };

  const handleConfirmDelete = async () => {
    if (!campaignToDelete) return;
    if (deleteConfirmText !== 'EXCLUIR') {
      toast.error('Erro', 'Digite EXCLUIR para confirmar.');
      return;
    }
    if (!tenantId) return;
    
    const campId = campaignToDelete.id;
    setActionLoading(campId);
    setCampaignToDelete(null);
    
    try {
      const result = await campaignsQueries.delete(tenantId, campId);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha excluída');
      await fetchCampaigns(); await fetchLimit();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível excluir a campanha.'); }
    setActionLoading(null);
  };

  const handleOpenCreate = async () => {
    if (hasScripts === false) {
      setGuardrailTitle('Roteiro de IA Necessário');
      setGuardrailDesc('Você precisa possuir pelo menos um Roteiro de IA configurado antes de criar uma campanha de prospecção ativa, para que a IA saiba como conduzir a conversa pelo WhatsApp.');
      setGuardrailActionText('Configurar meu primeiro Roteiro');
      setGuardrailActionUrl('/roteiros');
      setShowGuardrailModal(true);
      return;
    }

    try {
      const res = await apiFetch('/api/integrations/whatsapp/status');
      const data = await res.json();
      if (!data?.data?.connected) {
        toast.error('WhatsApp Desconectado', 'Antes de criar campanhas, conecte seu WhatsApp na tela de Configurações para que a IA possa enviar mensagens.');
        return;
      }
    } catch {
      // Falhou na checagem, deixar passar ou alertar? Vamos deixar passar por precaução
    }

    if (campaignLimit && !campaignLimit.canCreate) {
      setShowAddonModal(true);
      return;
    }
    resetForm();
    if (icps.length > 0) {
      setSelectedIcpId(icps[0]?.id || '');
    } else {
      setSelectedIcpId('');
    }
    setIsCreateOpen(true);
  };

  const resetForm = () => {
    setEditingCampaign(null);
    setSelectedSegment('health');
    setSearchTags(DEFAULT_SEGMENT.suggestedTags);
    setTagInput('');
    setNewCamp({ name: '', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18', icpMinScore: '', icpWeightProfession: '', icpWeightWhatsapp: '', icpWeightOwner: '', icpWeightArea: '', icpWeightCnpjYears: '', icpWeightGoogle: '', icpHighValueAreas: '', icpMinGoogleRating: '', icpMinReviews: '' });
    setSelectedIcpId(icps[0]?.id || '');
    setSelectedScriptId('');
    setCaptureSources(['GOOGLE_MAPS']);
    setCampState('SP');
  };

  const handleSegmentChange = (segId: string) => {
    setSelectedSegment(segId);
    const seg = SEGMENTS.find(s => s.id === segId) ?? DEFAULT_SEGMENT;
    setSearchTags(seg.suggestedTags);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !searchTags.includes(tag)) {
      setSearchTags(prev => [...prev, tag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => setSearchTags(prev => prev.filter(t => t !== tag));

  const handleCreateOrEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCamp.name.trim()) { toast.error('Nome obrigatório', 'Dê um nome à campanha.'); return; }
    const dailyLimitNum = Number(newCamp.dailyLimit) || 20;
    if (dailyLimitNum > 100) { toast.error('Volume muito alto', 'Para evitar bloqueios no WhatsApp, o limite máximo é de 100 leads por dia.'); return; }
    
    const hStart = Number(newCamp.hourStart) || 8;
    const hEnd = Number(newCamp.hourEnd) || 18;
    if (hEnd <= hStart) { toast.error('Horário inválido', 'O horário de fim deve ser posterior ao de início.'); return; }

    if (!selectedIcpId) {
      toast.error('ICP Obrigatório', 'Selecione um Perfil de Cliente Ideal (ICP) para a campanha.');
      return;
    }

    if (!tenantId) return;
    setIsCreating(true);
    const segment = SEGMENTS.find(s => s.id === selectedSegment) ?? DEFAULT_SEGMENT;
    const payload = {
      name: newCamp.name.trim(),
      profession: segment.profession as any,
      cities: newCamp.cities.split(',').map(c => c.trim()).filter(Boolean),
      dailyLimit: Number(newCamp.dailyLimit) || 20,
      hourWindowStart: Number(newCamp.hourStart) || 8,
      hourWindowEnd: Number(newCamp.hourEnd) || 18,
      searchTags,
      captureSources,
      state: campState,
      icpId: selectedIcpId,
      activeScriptId: selectedScriptId || undefined,
      filters: {
        min_fit_score: 3,
      },
    };
    try {
      if (editingCampaign) {
        const result = await campaignsQueries.update(tenantId, editingCampaign.id, payload);
        if (result.error) throw new Error(result.error.message);
        toast.success('Campanha atualizada!', 'As alterações foram salvas.');
      } else {
        const result = await campaignsQueries.create(tenantId, payload);
        if (result.error) throw new Error(result.error.message);
        toast.success('Campanha criada!', 'Ela começará a capturar leads automaticamente.');
      }
      setIsCreateOpen(false);
      resetForm();
      await fetchCampaigns();
      await fetchLimit();
    } catch (err) {
      console.error(err);
      toast.error('Erro', editingCampaign ? 'Não foi possível atualizar a campanha.' : 'Não foi possível criar a campanha.');
    } finally { setIsCreating(false); }
  };

  const handlePurchaseAddon = async () => {
    if (!tenantId) return;
    setPurchasingAddon(true);
    try {
      const result = await tenantAddonsQueries.purchase(tenantId, 'extra_campaign');
      if (result.error) throw new Error(result.error.message);
      toast.success('Add-on adquirido!', '+1 campanha ativa liberada.');
      setShowAddonModal(false);
      await fetchLimit();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível adquirir o add-on.'); }
    finally { setPurchasingAddon(false); }
  };

  // ── Computed ───────────────────────────────────────────────────────────
  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);
  const activeCount = campaigns.filter(c => c.status === 'ACTIVE').length;
  const pausedCount = campaigns.filter(c => c.status === 'PAUSED').length;
  const draftCount = campaigns.filter(c => c.status === 'DRAFT').length;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');

  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-12 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
        <div className="h-10 bg-white animate-pulse rounded-lg border border-[#E5E7EB]" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-52 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Target className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Suas campanhas de prospecção ativa.</strong> Cada campanha busca leads por segmento + tags + cidade e dispara a IA via WhatsApp.</div>
      </div>

      {/* Plan limit banner */}
      {campaignLimit && (
        <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border text-[12px] ${
          campaignLimit.canCreate
            ? 'bg-[#ECFDF3] border-[#A7F3D0] text-[#027A48]'
            : 'bg-[#FFF8F0] border-[#FDE68A] text-[#B8740E]'
        }`}>
          <div className="flex items-center gap-2">
            {campaignLimit.canCreate ? <Info className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>
              Plano <strong>{PLAN_LABELS[campaignLimit.plan]}</strong>: {campaignLimit.currentActive}/{campaignLimit.maxActive} campanhas ativas
              {!campaignLimit.canCreate && ' — limite atingido'}
            </span>
          </div>
          {!campaignLimit.canCreate && (
            <button onClick={() => setShowAddonModal(true)} className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all flex items-center gap-1">
              <Zap className="w-3 h-3" /> Comprar +1 campanha
            </button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <button onClick={() => setFilter('all')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'all' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Todas · {campaigns.length}</button>
        <button onClick={() => setFilter('ACTIVE')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'ACTIVE' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Ativas · {activeCount}</button>
        <button onClick={() => setFilter('PAUSED')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'PAUSED' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Pausadas · {pausedCount}</button>
        <button onClick={() => setFilter('DRAFT')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'DRAFT' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Rascunhos · {draftCount}</button>
        <div className="ml-auto flex items-center gap-2">
          {activeCount > 0 && (
            <button onClick={handlePauseAll} disabled={actionLoading === 'global_pause'} className="h-8 px-3.5 rounded-md text-[12px] font-semibold bg-[#FFF4ED] text-[#C4320A] border border-[#FEE4E2] flex items-center gap-1.5 hover:bg-[#FEE4E2] transition-all shadow-sm disabled:opacity-50">
              {actionLoading === 'global_pause' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />} Pausar Fila IA
            </button>
          )}
          {pausedCount > 0 && (
            <button onClick={handleResumeAll} disabled={actionLoading === 'global_resume'} className="h-8 px-3.5 rounded-md text-[12px] font-semibold bg-[#ECFDF3] text-[#027A48] border border-[#A7F3D0] flex items-center gap-1.5 hover:bg-[#D1FAE5] transition-all shadow-sm disabled:opacity-50">
              {actionLoading === 'global_resume' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Retomar Fila IA
            </button>
          )}
          <button
            onClick={() => router.push('/icps')}
            className="h-8 px-3.5 rounded-md text-[12px] font-semibold bg-white text-[#1B3A6B] border border-[#1B3A6B]/20 flex items-center gap-1.5 hover:bg-[#1B3A6B]/5 transition-all shadow-sm"
          >
            <Target className="w-3.5 h-3.5" /> Configurar ICPs
          </button>
          <button onClick={handleOpenCreate} className="h-8 px-3.5 rounded-md text-[12px] font-semibold bg-[#1B3A6B] text-white flex items-center gap-1.5 hover:bg-[#142C52] transition-all shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Nova campanha
          </button>
        </div>
      </div>

      {/* Campaign cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map(camp => {
          const isActive = camp.status === 'ACTIVE';
          const isPaused = camp.status === 'PAUSED';
          const icon = PROF_ICON[camp.profession] || '📋';

          return (
            <div
              key={camp.id}
              onClick={() => router.push(`/campanhas/${camp.id}`)}
              className={`bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-[#1B3A6B] cursor-pointer ${isPaused ? 'opacity-75' : ''}`}
            >
              {/* Header */}
              <div className="px-4 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center text-lg shrink-0">{icon}</div>
                  <div>
                    <div className="text-[14px] font-semibold text-[#0F172A]">{camp.name}</div>
                    <div className="text-[11px] text-[#64748B] flex items-center gap-1.5 flex-wrap">
                      <span>Criada em {fmtDate(camp.createdAt)}</span>
                      {camp.state && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F1F3F6] text-[#475569] font-medium text-[9.5px]">📍 {camp.state}</span>}
                      <span>·</span>
                      {(camp.captureSources || ['GOOGLE_MAPS']).slice(0, 2).map(src => {
                        const srcDef = CAPTURE_SOURCES.find(s => s.id === src);
                        return srcDef ? (
                          <span key={src} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F1F3F6] text-[#475569] font-medium text-[9.5px]">
                            {srcDef.icon} {srcDef.label}
                          </span>
                        ) : null;
                      })}
                      {(camp.captureSources || ['GOOGLE_MAPS']).length > 2 && (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-[#F1F3F6] text-[#64748B] font-medium">+{(camp.captureSources || []).length - 2}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isActive ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48] flex items-center gap-1.5">
                      <span className="w-[5px] h-[5px] rounded-full bg-[#039855] animate-pulse" />
                      Ativa
                    </span>
                  ) : isPaused ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#FFFAEB] text-[#B54708]">Pausada</span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F3F6] text-[#475569]">Rascunho</span>
                  )}
                  <ChevronRight className="w-4 h-4 text-[#CBD5E1]" />
                </div>
              </div>

              {/* Body */}
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3 mb-3 pb-3 border-b border-[#EEF0F3]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Segmento</div>
                      <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{PROF_LABEL[camp.profession] || camp.profession}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Perfil ICP</div>
                      <div className="text-[13px] font-semibold text-[#1B3A6B] mt-0.5 truncate" title={camp.icpName}>{camp.icpName || 'Padrão'}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Cidades</div>
                      <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5 truncate">{camp.cities?.join(', ') || '-'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Meta diária</div>
                      <div className="text-[15px] font-bold text-[#027A48] font-mono mt-0.5">{camp.dailyLimit}</div>
                    </div>
                  </div>
                </div>

                {/* Tags preview */}
                {camp.searchTags && camp.searchTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {camp.searchTags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(27,58,107,0.06)] text-[#1B3A6B] font-medium border border-[rgba(27,58,107,0.1)]">{tag}</span>
                    ))}
                    {camp.searchTags.length > 4 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#F1F3F6] text-[#64748B]">+{camp.searchTags.length - 4}</span>}
                  </div>
                )}

                {/* Schedule */}
                <div className="text-[11.5px] text-[#64748B]">
                  📍 {camp.cities?.join(', ')} · ⏰ {camp.hourWindowStart}h–{camp.hourWindowEnd}h
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-3.5">
                  {isActive ? (
                    <button onClick={(e) => { e.stopPropagation(); handlePause(camp.id); }} disabled={actionLoading === camp.id} className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#F1F3F6] text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-[#E5E7EB] transition-all disabled:opacity-50">
                      {actionLoading === camp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />} Pausar
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); handleResume(camp.id); }} disabled={actionLoading === camp.id} className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#ECFDF3] text-[#027A48] flex items-center justify-center gap-1.5 hover:bg-[#D1FAE5] transition-all disabled:opacity-50">
                      {actionLoading === camp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Ativar
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); handleDuplicate(camp); }} disabled={actionLoading === camp.id} className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#F1F3F6] text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-[#E5E7EB] transition-all disabled:opacity-50">
                    <Copy className="w-3.5 h-3.5" /> Duplicar
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleEdit(camp); }} className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#1B3A6B] text-white flex items-center justify-center gap-1.5 hover:bg-[#142C52] transition-all">
                    <Edit2 className="w-3.5 h-3.5" /> Editar
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(camp); }} disabled={actionLoading === camp.id} className="h-8 w-8 rounded-lg text-[12px] font-semibold bg-[#FEF3F2] text-[#D92D20] flex items-center justify-center hover:bg-[#FEE4E2] transition-all disabled:opacity-50 shrink-0" title="Excluir campanha">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Create new card */}
        <div onClick={handleOpenCreate} className="bg-white border-2 border-dashed border-[#D0D5DD] rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:bg-[rgba(27,58,107,0.04)] text-[#64748B] hover:text-[#1B3A6B] min-h-[220px]">
          <Plus className="w-9 h-9 mb-2" />
          <h4 className="text-[14px] font-semibold text-[#0F172A]">Criar nova campanha</h4>
          <p className="text-[12px] text-[#64748B] mt-1">Defina segmento, tags de busca, cidades e volume</p>
        </div>
      </div>

      {campaigns.length === 0 && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569]">
          <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
          Nenhuma campanha criada ainda. Clique em &quot;Nova campanha&quot; para começar a prospectar.
        </div>
      )}

      {/* ═══ Create/Edit Modal ═══ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setIsCreateOpen(false); setEditingCampaign(null); }}>
          <form onSubmit={handleCreateOrEdit} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[16px] font-bold text-[#0F172A]">{editingCampaign ? 'Editar Campanha' : 'Nova Campanha'}</h3>
              <button type="button" onClick={() => { setIsCreateOpen(false); setEditingCampaign(null); }} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]"><X className="w-4 h-4" /></button>
            </div>

            {/* Name */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Nome da campanha</label>
              <input value={newCamp.name} onChange={e => setNewCamp(p => ({...p, name: e.target.value}))} placeholder="Ex: Prospecção Advogados SJRP" className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none" autoFocus />
            </div>

            {/* Segment (replaces profession) */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1.5">Segmento alvo</label>
              <div className="grid grid-cols-2 gap-2">
                {SEGMENTS.map(seg => (
                  <button
                    key={seg.id}
                    type="button"
                    onClick={() => handleSegmentChange(seg.id)}
                    className={`p-2.5 rounded-lg border text-left transition-all flex items-center gap-2.5 ${
                      selectedSegment === seg.id
                        ? 'border-[#1B3A6B] bg-[rgba(27,58,107,0.04)] ring-1 ring-[#1B3A6B]/20'
                        : 'border-[#E5E7EB] hover:border-[#1B3A6B] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    <span className="text-[16px]">{seg.icon}</span>
                    <span className="text-[11.5px] font-medium text-[#0F172A]">{seg.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Search Tags */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                <Tag className="w-3 h-3" /> Tags de busca (Google Maps)
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px] p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
                {searchTags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#1B3A6B] text-white font-medium">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-200 transition-colors"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
                {searchTags.length === 0 && <span className="text-[11px] text-[#94A3B8]">Nenhuma tag adicionada</span>}
              </div>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="Adicionar tag personalizada..."
                  className="flex-1 h-8 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px] focus:border-[#1B3A6B] outline-none"
                />
                <button type="button" onClick={addTag} className="h-8 px-3 rounded-lg text-[11px] font-semibold bg-[#F1F3F6] text-[#475569] border border-[#E5E7EB] hover:bg-[#E5E7EB] transition-all">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              <p className="text-[10px] text-[#64748B] mt-1">Cada tag vira uma busca separada no Google Maps. Ex: &quot;advogados&quot;, &quot;escritório de advocacia&quot;</p>
            </div>

            {/* State (UF) */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Estado (UF)</label>
              <div className="relative">
                <select
                  value={campState}
                  onChange={e => setCampState(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none appearance-none cursor-pointer font-medium text-[#0F172A]"
                >
                  {BRAZILIAN_STATES.map(st => (
                    <option key={st.value} value={st.value}>{st.label}</option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-[#64748B]">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
              <p className="text-[10px] text-[#64748B] mt-1">Usado para fontes regionais (CRM, OAB, CRO do estado).</p>
            </div>

            {/* Capture Sources (multi-select) */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
                Fontes de Captação
                <Tooltip content="Selecione quais fontes de descoberta esta campanha usará. As opções disponíveis variam conforme o segmento escolhido.">
                  <Info className="w-3 h-3 text-[#CBD5E1] cursor-help" />
                </Tooltip>
              </label>
              <div className="grid grid-cols-1 gap-1.5 max-h-[200px] overflow-y-auto p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
                {(() => {
                  const seg = SEGMENTS.find(s => s.id === selectedSegment) ?? DEFAULT_SEGMENT;
                  const allowed = PROFESSION_SOURCES[seg.profession] || PROFESSION_SOURCES['OTHER'] || [];
                  return CAPTURE_SOURCES.filter(src => allowed.includes(src.id)).map(source => {
                    const checked = captureSources.includes(source.id);
                    const isComingSoon = source.isComingSoon;
                    return (
                      <label
                        key={source.id}
                        className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all ${
                          isComingSoon
                            ? 'opacity-50 cursor-not-allowed border-[#E5E7EB] bg-[#F9FAFB]'
                            : checked
                              ? 'border-[#1B3A6B] bg-[rgba(27,58,107,0.04)] ring-1 ring-[#1B3A6B]/20'
                              : 'border-[#E5E7EB] hover:border-[#1B3A6B]/40 hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isComingSoon}
                          onChange={() => {
                            if (isComingSoon) return;
                            setCaptureSources(prev =>
                              prev.includes(source.id)
                                ? prev.filter(s => s !== source.id)
                                : [...prev, source.id]
                            );
                          }}
                          className="w-3.5 h-3.5 rounded border-[#CBD5E1] text-[#1B3A6B] focus:ring-[#1B3A6B] accent-[#1B3A6B] shrink-0"
                        />
                        <span className="text-[14px] shrink-0">{source.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11.5px] font-medium text-[#0F172A] truncate">
                            {source.label}
                            {isComingSoon && <span className="ml-1 text-[9px] text-[#94A3B8] font-bold uppercase">(Em breve)</span>}
                          </div>
                          <div className="text-[9.5px] text-[#64748B] truncate">{source.description}</div>
                        </div>
                      </label>
                    );
                  });
                })()}
              </div>
              {captureSources.length === 0 && (
                <p className="text-[10px] text-[#D92D20] mt-1 font-medium">⚠ Selecione pelo menos uma fonte.</p>
              )}
            </div>

            {/* Cities */}
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Cidades (separadas por vírgula)</label>
              <input value={newCamp.cities} onChange={e => setNewCamp(p => ({...p, cities: e.target.value}))} placeholder="São José do Rio Preto, Votuporanga" className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none" />
            </div>

            {/* Volume */}
            <div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Leads/dia</label>
                  <input type="number" min="1" max="100" value={newCamp.dailyLimit} onChange={e => setNewCamp(p => ({...p, dailyLimit: e.target.value}))} className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none" />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Início</label>
                  <div className="relative">
                    <select value={newCamp.hourStart} onChange={e => setNewCamp(p => ({...p, hourStart: e.target.value}))} className="w-full h-9 pl-3 pr-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none appearance-none cursor-pointer">
                      {Array.from({length: 24}).map((_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-[#64748B] pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Fim</label>
                  <div className="relative">
                    <select value={newCamp.hourEnd} onChange={e => setNewCamp(p => ({...p, hourEnd: e.target.value}))} className="w-full h-9 pl-3 pr-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none appearance-none cursor-pointer">
                      {Array.from({length: 24}).map((_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-2.5 top-2.5 text-[#64748B] pointer-events-none" />
                  </div>
                </div>
              </div>
              {parseInt(newCamp.hourEnd) <= parseInt(newCamp.hourStart) && (
                 <p className="text-[10px] text-[#D92D20] mt-1.5 font-bold">O horário de fim deve ser posterior ao de início.</p>
              )}
              <p className="text-[10px] text-[#64748B] mt-1.5 font-medium">Recomendamos no máximo 100 leads por dia para manter a saúde do seu WhatsApp.</p>
            </div>

            {/* ICP Selection */}
            {/* Roteiro da Campanha */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider flex items-center gap-1.5">
                📝 Roteiro de Conversa (IA)
              </label>
              <div className="relative">
                <select
                  value={selectedScriptId}
                  onChange={e => setSelectedScriptId(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none appearance-none cursor-pointer font-medium text-[#0F172A]"
                >
                  <option value="">Associar automaticamente por profissão</option>
                  {scripts.map(script => (
                    <option key={script.id} value={script.id}>
                      {script.name} ({script.status === 'ACTIVE' ? 'Ativo' : 'Rascunho'})
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-[#64748B]">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
              <p className="text-[10px] text-[#64748B] mt-1">
                Escolha o roteiro específico que a IA usará. Se omitido, a plataforma buscará um roteiro ativo compatível com a profissão.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider flex items-center gap-1.5">
                  ⚡ Perfil de Cliente Ideal (ICP)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateOpen(false);
                    router.push('/icps');
                  }}
                  className="text-[10.5px] font-semibold text-[#1B3A6B] hover:underline flex items-center gap-0.5"
                >
                  + Gerenciar ICPs
                </button>
              </div>
              <div className="relative">
                <select
                  value={selectedIcpId}
                  onChange={e => setSelectedIcpId(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none appearance-none cursor-pointer font-medium text-[#0F172A]"
                  disabled={loadingIcps}
                >
                  <option value="" disabled>Selecione um perfil de cliente ideal...</option>
                  {icps.map(icp => (
                    <option key={icp.id} value={icp.id}>
                      {icp.name} (Min. Score: {icp.min_fit_score})
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-[#64748B]">
                  {loadingIcps ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
                </div>
              </div>
              {icps.length === 0 && !loadingIcps && (
                <p className="text-[10px] text-[#D92D20] mt-1 font-medium">
                  ⚠ Você não possui nenhum ICP cadastrado. <span className="underline cursor-pointer" onClick={() => { setIsCreateOpen(false); router.push('/icps'); }}>Clique aqui para criar um</span> antes de salvar a campanha.
                </p>
              )}
              <p className="text-[10px] text-[#64748B] mt-1">
                O ICP define as regras de qualificação de leads (pesos, bairros premium, reputação mínima) que a IA usará.
              </p>
            </div>

            <button type="submit" disabled={isCreating} className="w-full h-10 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : editingCampaign ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isCreating ? (editingCampaign ? 'Salvando...' : 'Criando...') : (editingCampaign ? 'Salvar Alterações' : '+ Criar Campanha')}
            </button>
          </form>
        </div>
      )}

      {/* ═══ Add-on Purchase Modal ═══ */}
      {showAddonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowAddonModal(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#0F172A]">Liberar mais campanhas</h3>
              <button onClick={() => setShowAddonModal(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]"><X className="w-4 h-4" /></button>
            </div>

            <div className="text-center py-4">
              <div className="text-[40px] mb-2">🚀</div>
              <div className="text-[14px] font-semibold text-[#0F172A]">+1 Campanha Ativa</div>
              <div className="text-[12px] text-[#64748B] mt-1">Adicione mais uma campanha ao seu plano {campaignLimit ? PLAN_LABELS[campaignLimit.plan] : ''}</div>
              <div className="mt-3">
                <span className="text-[28px] font-bold text-[#1B3A6B]">R$ 49</span>
                <span className="text-[14px] text-[#64748B]">,90/mês</span>
              </div>
            </div>

            <div className="space-y-2 text-[12px] text-[#475569]">
              <div className="flex items-center gap-2"><span className="text-[#027A48]">✓</span> Campanha ativa adicional</div>
              <div className="flex items-center gap-2"><span className="text-[#027A48]">✓</span> Leads ilimitados na campanha</div>
              <div className="flex items-center gap-2"><span className="text-[#027A48]">✓</span> Cancele a qualquer momento</div>
            </div>

            <button
              onClick={handlePurchaseAddon}
              disabled={purchasingAddon}
              className="w-full h-10 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {purchasingAddon ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {purchasingAddon ? 'Processando...' : 'Contratar Add-on'}
            </button>
            <p className="text-[10px] text-center text-[#94A3B8]">O valor será adicionado à sua próxima fatura</p>
          </div>
        </div>
      )}

      {/* ═══ Safe Delete Modal ═══ */}
      {campaignToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setCampaignToDelete(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-bold text-[#D92D20] flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                Excluir Campanha
              </h3>
              <button onClick={() => setCampaignToDelete(null)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]"><X className="w-4 h-4" /></button>
            </div>
            
            <p className="text-[13px] text-[#475569] leading-relaxed">
              Você tem certeza que deseja excluir a campanha <strong>&quot;{campaignToDelete.name}&quot;</strong>? Esta ação apagará as configurações de busca, mas manterá os leads já capturados.
            </p>
            
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">
                Para confirmar, digite <strong>EXCLUIR</strong>
              </label>
              <input 
                type="text" 
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value.toUpperCase())}
                placeholder="EXCLUIR"
                className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#D92D20] focus:ring-1 focus:ring-[#D92D20] outline-none font-bold text-center"
                autoFocus
              />
            </div>
            
            <div className="flex gap-3 mt-4">
              <button onClick={() => setCampaignToDelete(null)} className="flex-1 h-10 rounded-lg text-[13px] font-semibold bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] transition-all">
                Cancelar
              </button>
              <button 
                onClick={handleConfirmDelete}
                disabled={deleteConfirmText !== 'EXCLUIR'}
                className="flex-1 h-10 rounded-lg text-[13px] font-semibold bg-[#D92D20] text-white hover:bg-[#B42318] transition-all disabled:opacity-50"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Guardrail Modal */}
      {showGuardrailModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl w-full max-w-[420px] p-6 shadow-2xl border border-[#EEF0F3] animate-scaleIn space-y-4 text-center">
            <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto text-amber-600 border border-amber-100">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-bold text-[16px] text-[#0F172A]">{guardrailTitle}</h3>
              <p className="text-[12.5px] text-[#64748B] leading-relaxed">{guardrailDesc}</p>
            </div>
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowGuardrailModal(false);
                  router.push(guardrailActionUrl);
                }}
                className="w-full h-10 rounded-xl text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {guardrailActionText} <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowGuardrailModal(false)}
                className="w-full h-9 rounded-xl text-[12.5px] font-semibold bg-white border border-[#E5E7EB] hover:bg-[#F8F9FB] text-[#475569] transition-colors"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
