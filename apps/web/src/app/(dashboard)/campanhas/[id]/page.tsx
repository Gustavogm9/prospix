'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from '@prospix/ui';
import {
  ArrowLeft, RefreshCw, ChevronRight, ChevronLeft, Pause, Play, X,
  Loader2, Settings, Clock, MapPin, Tag, Target, Calendar, TrendingUp,
  BarChart3, Users, FileText, History,
} from 'lucide-react';
import { campaignsQueries, leadsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import LeadDrawer from '../../funil/lead-drawer';

// ── Types ──────────────────────────────────────────────────────────────────
interface Lead {
  id: string;
  name: string;
  phone: string;
  company: string;
  googleRating: string;
  fitScore: number;
  city: string;
  status: string;
  createdAt: string;
  profession?: string;
}

interface StatusCounts {
  total: number;
  CAPTURED: number;
  ENRICHED: number;
  CONTACTED: number;
  IN_CONVERSATION: number;
  MEETING_SCHEDULED: number;
  WON: number;
  LOST: number;
}

type Tab = 'overview' | 'leads' | 'config' | 'history';

// ── Constants ──────────────────────────────────────────────────────────────
const PROFESSION_LABELS: Record<string, string> = {
  DOCTOR: 'Médico(a)', LAWYER: 'Advogado(a)', DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empresário(a)', ENGINEER: 'Engenheiro(a)',
  ARCHITECT: 'Arquiteto(a)', ACCOUNTANT: 'Contador(a)', OTHER: 'Outro',
  BUSINESS_OWNER: 'Empresário(a)',
};

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string; border: string; hex: string }> = {
  CAPTURED:          { label: 'Capturados',   emoji: '📥', color: 'text-[#475569]', bg: 'bg-[#F1F5F9]', border: 'border-[#CBD5E1]', hex: '#475569' },
  ENRICHED:          { label: 'Enriquecidos', emoji: '🔍', color: 'text-[#1B3A6B]', bg: 'bg-[#EFF6FF]', border: 'border-[#93C5FD]', hex: '#1B3A6B' },
  CONTACTED:         { label: 'Contatados',   emoji: '💬', color: 'text-[#B8740E]', bg: 'bg-[#FFF8F0]', border: 'border-[#FDE68A]', hex: '#B8740E' },
  IN_CONVERSATION:   { label: 'Em conversa',  emoji: '🗣️', color: 'text-[#7C3AED]', bg: 'bg-[#F5F3FF]', border: 'border-[#C4B5FD]', hex: '#7C3AED' },
  MEETING_SCHEDULED: { label: 'Reunião',      emoji: '📅', color: 'text-[#0891B2]', bg: 'bg-[#ECFEFF]', border: 'border-[#67E8F9]', hex: '#0891B2' },
  WON:               { label: 'Ganhos',       emoji: '✅', color: 'text-[#027A48]', bg: 'bg-[#ECFDF3]', border: 'border-[#A7F3D0]', hex: '#027A48' },
  LOST:              { label: 'Perdidos',     emoji: '❌', color: 'text-[#D92D20]', bg: 'bg-[#FEF3F2]', border: 'border-[#FECACA]', hex: '#D92D20' },
};

const CAMPAIGN_STATUS_BADGE: Record<string, { label: string; class: string }> = {
  ACTIVE:   { label: 'Ativa',     class: 'bg-[#ECFDF3] text-[#027A48]' },
  PAUSED:   { label: 'Pausada',   class: 'bg-[#FFFAEB] text-[#B54708]' },
  DRAFT:    { label: 'Rascunho',  class: 'bg-[#F1F3F6] text-[#475569]' },
  ARCHIVED: { label: 'Arquivada', class: 'bg-[#F1F3F6] text-[#94A3B8]' },
};

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Visão Geral',   icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: 'leads',    label: 'Leads',          icon: <Users className="w-3.5 h-3.5" /> },
  { id: 'config',   label: 'Configuração',   icon: <Settings className="w-3.5 h-3.5" /> },
  { id: 'history',  label: 'Histórico',      icon: <History className="w-3.5 h-3.5" /> },
];

const AVATAR_COLORS = ['#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151'];

const PAGE_SIZE = 25;

// ── Mapper ─────────────────────────────────────────────────────────────────
const mapBackendLead = (lead: any): Lead => {
  const metadata = (lead.metadata || {}) as Record<string, any>;
  const address = lead.address || {};
  const rawData = (lead.source_raw_data || {}) as Record<string, any>;
  return {
    id: lead.id,
    name: lead.name || 'Sem nome',
    phone: lead.whatsapp || '',
    company: metadata.cnpj_info?.nomeFantasia || metadata.cnpj_info?.razaoSocial || rawData.name || lead.name || '',
    googleRating: lead.google_rating ? `⭐ ${Number(lead.google_rating).toFixed(1)}` : '—',
    fitScore: Number(lead.fit_score) || 0,
    city: address.city || '—',
    status: lead.status || '—',
    createdAt: lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '—',
    profession: lead.profession ? (PROFESSION_LABELS[lead.profession] || lead.profession) : '',
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function CampaignDetail() {
  const params = useParams();
  const id = params.id as string;
  const tenantId = useAuthStore(state => state.tenantId);

  // Campaign data
  const [campaign, setCampaign] = useState<any>(null);
  const [stats, setStats] = useState<StatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Leads tab state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsStatusFilter, setLeadsStatusFilter] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(leadsTotal / PAGE_SIZE));

  // ── Load campaign + stats ──────────────────────────────────────────────
  const fetchCampaign = useCallback(async () => {
    if (!tenantId || !id) return;
    setLoading(true);
    try {
      const [campResult, statsResult] = await Promise.all([
        campaignsQueries.getById(tenantId, id),
        campaignsQueries.getStats(tenantId, id),
      ]);
      if (campResult.error) throw new Error(campResult.error.message);
      setCampaign(campResult.data);
      setStats(statsResult);
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Não foi possível carregar a campanha.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, id]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);

  // ── Load leads (for Leads tab) ─────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    if (!tenantId || !id) return;
    setLeadsLoading(true);
    try {
      const result = await leadsQueries.list(tenantId, {
        campaign_id: id,
        status: (leadsStatusFilter || undefined) as any,
        limit: PAGE_SIZE,
        offset: leadsPage * PAGE_SIZE,
      });
      if (result.error) throw new Error(result.error.message);
      setLeads((result.data || []).map(mapBackendLead));
      setLeadsTotal(result.totalCount ?? 0);
    } catch (err) {
      console.error(err);
      setLeads([]);
      toast.error('Erro', 'Não foi possível carregar os leads.');
    } finally {
      setLeadsLoading(false);
    }
  }, [tenantId, id, leadsStatusFilter, leadsPage]);

  useEffect(() => {
    if (activeTab === 'leads') fetchLeads();
  }, [fetchLeads, activeTab]);

  useEffect(() => { setLeadsPage(0); }, [leadsStatusFilter]);

  // ── Pause / Resume ─────────────────────────────────────────────────────
  const handleToggleStatus = async () => {
    if (!tenantId || !campaign) return;
    setActionLoading(true);
    try {
      if (campaign.status === 'ACTIVE') {
        const result = await campaignsQueries.pause(tenantId, id);
        if (result.error) throw new Error(result.error.message);
        toast.success('Campanha pausada');
      } else {
        const result = await campaignsQueries.resume(tenantId, id);
        if (result.error) throw new Error(result.error.message);
        toast.success('Campanha ativada');
      }
      await fetchCampaign();
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Não foi possível alterar o status da campanha.');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status];
    if (!config) return <span className="bg-[#F1F5F9] text-[#475569] border border-[#E5E7EB] text-[10px] px-1.5 py-0.5 rounded-full">{status}</span>;
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${config.bg} ${config.color} ${config.border}`}>{config.label}</span>;
  };

  const getScoreBadge = (score: number) => {
    const color = score >= 8 ? 'text-[#027A48] bg-[#ECFDF3] border-[#A7F3D0]'
      : score >= 6 ? 'text-[#1B3A6B] bg-[#EFF6FF] border-[#93C5FD]'
      : 'text-[#64748B] bg-[#F8FAFC] border-[#E5E7EB]';
    return <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full border ${color}`}>Fit {score.toFixed(1)}</span>;
  };

  const convRate = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';

  // ── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-10 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
        <div className="h-14 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />
        <div className="h-10 bg-white animate-pulse rounded-lg border border-[#E5E7EB]" />
        <div className="grid grid-cols-7 gap-3">
          {[1,2,3,4,5,6,7].map(i => <div key={i} className="h-24 bg-white animate-pulse rounded-xl border border-[#E5E7EB]" />)}
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <Link href="/campanhas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1B3A6B] hover:text-[#142C52] transition-colors">
          <ArrowLeft className="w-4 h-4" /> Campanhas
        </Link>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-12 text-center shadow-sm">
          <div className="text-[14px] font-semibold text-[#0F172A] mb-1">Campanha não encontrada</div>
          <div className="text-[12px] text-[#64748B]">A campanha solicitada não existe ou foi removida.</div>
        </div>
      </div>
    );
  }

  const statusBadge = CAMPAIGN_STATUS_BADGE[campaign.status] ?? { label: campaign.status, class: 'bg-[#F1F3F6] text-[#475569]' };
  const filters = (campaign.filters || {}) as Record<string, any>;
  const weights = filters.weights || {};

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 animate-fadeIn">
      {/* ── Back + Header ────────────────────────────────────────────── */}
      <Link href="/campanhas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#1B3A6B] hover:text-[#142C52] transition-colors">
        <ArrowLeft className="w-4 h-4" /> Campanhas
      </Link>

      <div className="bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 shadow-sm flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center text-lg shrink-0">
            <Target className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-bold text-[#0F172A] truncate">{campaign.name}</h1>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${statusBadge.class}`}>
                {statusBadge.label}
              </span>
            </div>
            <div className="text-[12px] text-[#64748B] mt-0.5">
              {PROFESSION_LABELS[campaign.profession] || campaign.profession} · {(campaign.cities || []).join(', ') || '—'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(campaign.status === 'ACTIVE' || campaign.status === 'PAUSED' || campaign.status === 'DRAFT') && (
            <button
              onClick={handleToggleStatus}
              disabled={actionLoading}
              className={`h-8 px-3.5 rounded-md text-[12px] font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 ${
                campaign.status === 'ACTIVE'
                  ? 'bg-[#FFFAEB] text-[#B54708] hover:bg-[#FEF3C7] border border-[#FDE68A]'
                  : 'bg-[#ECFDF3] text-[#027A48] hover:bg-[#D1FAE5] border border-[#A7F3D0]'
              }`}
            >
              {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : campaign.status === 'ACTIVE' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {campaign.status === 'ACTIVE' ? 'Pausar' : 'Ativar'}
            </button>
          )}
          <button onClick={fetchCampaign} className="p-2 rounded-lg hover:bg-[#F1F3F6] text-[#64748B] hover:text-[#1B3A6B] transition-all" title="Atualizar">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-1 flex gap-1 shadow-sm">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-md text-[12px] font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-[#1B3A6B] text-white shadow-sm'
                : 'text-[#475569] hover:bg-[#F1F3F6]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────── */}
      {activeTab === 'overview' && <OverviewTab stats={stats} campaign={campaign} convRate={convRate} />}
      {activeTab === 'leads' && (
        <LeadsTab
          leads={leads}
          leadsTotal={leadsTotal}
          leadsPage={leadsPage}
          setLeadsPage={setLeadsPage}
          totalPages={totalPages}
          leadsLoading={leadsLoading}
          leadsStatusFilter={leadsStatusFilter}
          setLeadsStatusFilter={setLeadsStatusFilter}
          getStatusBadge={getStatusBadge}
          getScoreBadge={getScoreBadge}
          getInitials={getInitials}
          setSelectedLeadId={setSelectedLeadId}
          fetchLeads={fetchLeads}
        />
      )}
      {activeTab === 'config' && <ConfigTab campaign={campaign} filters={filters} weights={weights} />}
      {activeTab === 'history' && <HistoryTab campaign={campaign} stats={stats} />}

      {/* ── Lead Drawer ──────────────────────────────────────────────── */}
      {selectedLeadId && (
        <LeadDrawer
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: VISÃO GERAL
// ═══════════════════════════════════════════════════════════════════════════
function OverviewTab({ stats, campaign, convRate }: { stats: StatusCounts | null; campaign: any; convRate: (a: number, b: number) => string }) {
  if (!stats) return null;

  const statusKeys = Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[];
  const funnelTotal = Math.max(stats.total, 1);

  return (
    <div className="space-y-4">
      {/* ── KPI Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {statusKeys.map(key => {
          const config = STATUS_CONFIG[key]!;
          const count = (stats as any)[key] ?? 0;
          return (
            <div
              key={key}
              className="bg-white border border-[#E5E7EB] rounded-xl p-3 shadow-sm text-left"
            >
              <div className="text-[16px] mb-1">{config.emoji}</div>
              <div className="text-[22px] font-bold text-[#0F172A] font-mono leading-none">{count}</div>
              <div className="text-[11px] font-semibold text-[#475569] mt-1 truncate">{config.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Funnel Visualization ───────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#1B3A6B]" />
          Funil de Conversão
        </div>
        {/* Horizontal bar */}
        <div className="h-8 rounded-lg overflow-hidden flex bg-[#F1F3F6]">
          {statusKeys.map(key => {
            const config = STATUS_CONFIG[key]!;
            const count = (stats as any)[key] ?? 0;
            const pct = (count / funnelTotal) * 100;
            if (pct === 0) return null;
            return (
              <div
                key={key}
                className="h-full flex items-center justify-center text-white text-[10px] font-bold transition-all"
                style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: config.hex }}
                title={`${config.label}: ${count} (${pct.toFixed(1)}%)`}
              >
                {pct >= 6 ? count : ''}
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-3">
          {statusKeys.map(key => {
            const config = STATUS_CONFIG[key]!;
            const count = (stats as any)[key] ?? 0;
            return (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-[#475569]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: config.hex }} />
                {config.label} ({count})
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Conversion Rates ───────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#1B3A6B]" />
          Taxas de Conversão
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Enriquecidos / Capturados', value: convRate(stats.ENRICHED, stats.CAPTURED), emoji: '🔍→📥' },
            { label: 'Contatados / Enriquecidos', value: convRate(stats.CONTACTED, stats.ENRICHED), emoji: '💬→🔍' },
            { label: 'Reunião / Contatados', value: convRate(stats.MEETING_SCHEDULED, stats.CONTACTED), emoji: '📅→💬' },
            { label: 'Ganhos / Reunião', value: convRate(stats.WON, stats.MEETING_SCHEDULED), emoji: '✅→📅' },
          ].map(item => (
            <div key={item.label} className="bg-[#F8FAFC] rounded-lg border border-[#E5E7EB] p-3">
              <div className="text-[14px] mb-1">{item.emoji}</div>
              <div className="text-[20px] font-bold text-[#0F172A] font-mono leading-none">{item.value}</div>
              <div className="text-[10px] text-[#64748B] mt-1.5 leading-tight">{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Campaign Info Card ─────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#1B3A6B]" />
          Informações da Campanha
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InfoItem icon={<MapPin className="w-3.5 h-3.5" />} label="Cidades" value={(campaign.cities || []).join(', ') || '—'} />
          <InfoItem icon={<Tag className="w-3.5 h-3.5" />} label="Tags de busca" value={(campaign.search_tags || []).join(', ') || '—'} />
          <InfoItem icon={<Target className="w-3.5 h-3.5" />} label="Meta diária" value={`${campaign.daily_limit ?? '—'} leads/dia`} />
          <InfoItem icon={<Clock className="w-3.5 h-3.5" />} label="Horário" value={`${campaign.hour_window_start ?? '—'}h – ${campaign.hour_window_end ?? '—'}h`} />
          <InfoItem icon={<Calendar className="w-3.5 h-3.5" />} label="Criada em" value={campaign.created_at ? new Date(campaign.created_at).toLocaleDateString('pt-BR') : '—'} />
        </div>
      </div>
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2 px-3 bg-[#F8FAFC] rounded-lg border border-[#E5E7EB]">
      <span className="text-[#64748B] mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider">{label}</div>
        <div className="text-[13px] text-[#0F172A] mt-0.5 break-words">{value}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: LEADS
// ═══════════════════════════════════════════════════════════════════════════
function LeadsTab({
  leads, leadsTotal, leadsPage, setLeadsPage, totalPages, leadsLoading,
  leadsStatusFilter, setLeadsStatusFilter, getStatusBadge, getScoreBadge,
  getInitials, setSelectedLeadId, fetchLeads,
}: {
  leads: Lead[]; leadsTotal: number; leadsPage: number; setLeadsPage: (fn: (p: number) => number) => void;
  totalPages: number; leadsLoading: boolean;
  leadsStatusFilter: string; setLeadsStatusFilter: (v: string) => void;
  getStatusBadge: (s: string) => React.ReactNode; getScoreBadge: (s: number) => React.ReactNode;
  getInitials: (n: string) => string; setSelectedLeadId: (id: string) => void;
  fetchLeads: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <select
          value={leadsStatusFilter}
          onChange={e => setLeadsStatusFilter(e.target.value)}
          className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] bg-white hover:bg-[#F1F3F6] outline-none focus:border-[#1B3A6B] min-w-[130px]"
        >
          <option value="">Todos status</option>
          {Object.entries(STATUS_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>{config.emoji} {config.label}</option>
          ))}
        </select>
        {leadsStatusFilter && (
          <button onClick={() => setLeadsStatusFilter('')} className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#D92D20] border border-[#FECACA] bg-[#FEF3F2] hover:bg-[#FEE2E2] flex items-center gap-1.5 transition-all">
            <X className="w-3 h-3" /> Limpar
          </button>
        )}
        <div className="ml-auto text-[12px] text-[#64748B]">
          {leadsTotal.toLocaleString('pt-BR')} leads nesta campanha
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[#0F172A]">Leads da campanha</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">{leadsTotal.toLocaleString('pt-BR')} leads encontrados</div>
          </div>
          <button onClick={fetchLeads} className="p-2 rounded-lg hover:bg-[#F1F3F6] text-[#64748B] hover:text-[#1B3A6B] transition-all" title="Atualizar">
            <RefreshCw className={`w-4 h-4 ${leadsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1fr_1fr_120px_90px_80px_40px] px-5 py-2 border-b border-[#EEF0F3] bg-[#FAFBFC] text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">
          <div>Lead</div>
          <div>Empresa / Cidade</div>
          <div>Status</div>
          <div>Score</div>
          <div>Data</div>
          <div></div>
        </div>

        {/* Loading */}
        {leadsLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-5 h-5 animate-spin text-[#64748B] mx-auto mb-2" />
            <div className="text-[12px] text-[#64748B]">Carregando leads...</div>
          </div>
        ) : leads.length > 0 ? (
          leads.map((lead, i) => (
            <div
              key={lead.id}
              className="px-5 py-3 border-b border-[#EEF0F3] grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_90px_80px_40px] items-center gap-2 md:gap-3 cursor-pointer transition-all hover:bg-[rgba(27,58,107,0.03)] border-l-[3px] border-l-transparent hover:border-l-[#1B3A6B]"
              onClick={() => setSelectedLeadId(lead.id)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                  {getInitials(lead.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A] truncate">{lead.name}</div>
                  <div className="text-[11px] text-[#64748B] font-mono truncate">{lead.phone || '—'}</div>
                </div>
              </div>
              <div className="min-w-0 hidden md:block">
                <div className="text-[12px] text-[#0F172A] truncate">{lead.company}</div>
                <div className="text-[11px] text-[#64748B] truncate">{lead.profession ? `${lead.profession} · ` : ''}{lead.city}</div>
              </div>
              <div className="hidden md:block">{getStatusBadge(lead.status)}</div>
              <div className="hidden md:block">{getScoreBadge(lead.fitScore)}</div>
              <div className="hidden md:block text-[11px] text-[#64748B]">{lead.createdAt}</div>
              <div className="hidden md:flex items-center justify-center">
                <ChevronRight className="w-4 h-4 text-[#CBD5E1]" />
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center text-[12.5px] text-[#64748B]">Nenhum lead encontrado nesta campanha.</div>
        )}

        {/* Pagination */}
        {leadsTotal > 0 && (
          <div className="px-5 py-3 bg-[#FAFBFC] border-t border-[#EEF0F3] flex items-center justify-between">
            <span className="text-[12px] text-[#64748B]">
              Mostrando {Math.min(leadsPage * PAGE_SIZE + 1, leadsTotal).toLocaleString('pt-BR')}–{Math.min((leadsPage + 1) * PAGE_SIZE, leadsTotal).toLocaleString('pt-BR')} de {leadsTotal.toLocaleString('pt-BR')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLeadsPage(p => Math.max(0, p - 1))}
                disabled={leadsPage === 0}
                className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-3 h-3" /> Anterior
              </button>
              <span className="text-[12px] font-semibold text-[#0F172A] tabular-nums">
                {leadsPage + 1} / {totalPages}
              </span>
              <button
                onClick={() => setLeadsPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={leadsPage >= totalPages - 1}
                className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Próximo <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: CONFIGURAÇÃO
// ═══════════════════════════════════════════════════════════════════════════
function ConfigTab({ campaign, filters, weights }: { campaign: any; filters: Record<string, any>; weights: Record<string, any> }) {
  return (
    <div className="space-y-4">
      {/* General settings */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
          <Settings className="w-4 h-4 text-[#1B3A6B]" />
          Configurações Gerais
        </div>
        <div className="space-y-3">
          <ConfigRow label="Nome" value={campaign.name} />
          <ConfigRow label="Segmento / Profissão" value={PROFESSION_LABELS[campaign.profession] || campaign.profession || '—'} />
          <ConfigRow label="Cidades" value={(campaign.cities || []).join(', ') || '—'} />
          <ConfigRow label="Bairros" value={(campaign.neighborhoods || []).length > 0 ? campaign.neighborhoods.join(', ') : 'Todos'} />
          <div>
            <div className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider mb-1.5">Tags de busca</div>
            <div className="flex flex-wrap gap-1.5">
              {(campaign.search_tags || []).length > 0 ? (
                (campaign.search_tags as string[]).map((tag: string) => (
                  <span key={tag} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#1B3A6B] border border-[#93C5FD]">{tag}</span>
                ))
              ) : (
                <span className="text-[12px] text-[#64748B]">Nenhuma tag definida</span>
              )}
            </div>
          </div>
          <ConfigRow label="Meta diária" value={`${campaign.daily_limit ?? '—'} leads/dia`} />
          <ConfigRow label="Horário" value={`${campaign.hour_window_start ?? '—'}h – ${campaign.hour_window_end ?? '—'}h`} />
        </div>
      </div>

      {/* ICP Config */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-[#1B3A6B]" />
          Perfil de Cliente Ideal (ICP)
        </div>
        <div className="space-y-3">
          <ConfigRow label="Score mínimo" value={String(filters.min_fit_score ?? 3)} />
          <div>
            <div className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider mb-1.5">Pesos dos critérios</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                { key: 'profession_match', label: 'Profissão bate', icon: '🎯' },
                { key: 'whatsapp_valid', label: 'WhatsApp válido', icon: '📱' },
                { key: 'is_owner', label: 'Sócio/proprietário', icon: '👤' },
                { key: 'high_value_area', label: 'Bairro premium', icon: '📍' },
                { key: 'cnpj_years', label: 'Tempo de atuação', icon: '📅' },
                { key: 'google_reputation', label: 'Reputação Google', icon: '⭐' },
              ].map(item => (
                <div key={item.key} className="flex items-center gap-2 bg-[#F8FAFC] rounded-lg border border-[#E5E7EB] px-3 py-2">
                  <span className="text-[13px]">{item.icon}</span>
                  <span className="text-[11px] text-[#0F172A] font-medium flex-1">{item.label}</span>
                  <span className="text-[12px] font-bold text-[#1B3A6B] font-mono bg-[rgba(27,58,107,0.08)] px-1.5 py-0.5 rounded">{weights[item.key] ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider mb-1.5">Bairros de alto valor</div>
            <div className="flex flex-wrap gap-1.5">
              {(filters.high_value_areas || []).length > 0 ? (
                (filters.high_value_areas as string[]).map((area: string) => (
                  <span key={area} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-[#FFF8F0] text-[#B8740E] border border-[#FDE68A]">{area}</span>
                ))
              ) : (
                <span className="text-[12px] text-[#64748B]">Nenhum definido</span>
              )}
            </div>
          </div>
          <ConfigRow label="Rating mínimo Google" value={String(filters.min_google_rating ?? 4)} />
          <ConfigRow label="Avaliações mínimas" value={String(filters.min_reviews ?? 5)} />
        </div>
      </div>

      {/* Script */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
        <div className="text-[14px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#1B3A6B]" />
          Roteiro Vinculado
        </div>
        <div className="text-[13px] text-[#0F172A]">
          {campaign.active_script_id ? (
            <span className="font-mono text-[12px] bg-[#F8FAFC] border border-[#E5E7EB] px-2.5 py-1 rounded">{campaign.active_script_id}</span>
          ) : (
            <span className="text-[#64748B]">Nenhum roteiro vinculado</span>
          )}
        </div>
      </div>

      {/* Edit button */}
      <div className="flex justify-end">
        <Link
          href="/campanhas"
          className="h-9 px-5 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all flex items-center gap-2 shadow-sm"
        >
          <Settings className="w-4 h-4" />
          Editar
        </Link>
      </div>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 bg-[#F8FAFC] rounded-lg border border-[#E5E7EB]">
      <div className="text-[10px] text-[#64748B] font-semibold uppercase tracking-wider w-36 shrink-0 pt-0.5">{label}</div>
      <div className="text-[13px] text-[#0F172A] break-words">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB: HISTÓRICO
// ═══════════════════════════════════════════════════════════════════════════
function HistoryTab({ campaign, stats }: { campaign: any; stats: StatusCounts | null }) {
  const timelineItems: { date: string; label: string; detail?: string; emoji: string; color: string }[] = [];

  // Campaign creation
  if (campaign.created_at) {
    timelineItems.push({
      date: new Date(campaign.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),
      label: 'Campanha criada',
      detail: `Status inicial: ${CAMPAIGN_STATUS_BADGE[campaign.status]?.label || campaign.status}`,
      emoji: '🚀',
      color: '#1B3A6B',
    });
  }

  // Status info
  if (campaign.status === 'ACTIVE') {
    timelineItems.push({
      date: campaign.updated_at ? new Date(campaign.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      label: 'Campanha ativada',
      detail: 'A campanha está buscando e contatando leads automaticamente.',
      emoji: '▶️',
      color: '#027A48',
    });
  } else if (campaign.status === 'PAUSED') {
    timelineItems.push({
      date: campaign.updated_at ? new Date(campaign.updated_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      label: 'Campanha pausada',
      detail: 'A prospecção foi pausada.',
      emoji: '⏸️',
      color: '#B54708',
    });
  }

  // Key metrics
  if (stats) {
    if (stats.CAPTURED > 0) {
      timelineItems.push({
        date: '—',
        label: `${stats.CAPTURED} leads capturados`,
        detail: `Total capturado desde a criação da campanha.`,
        emoji: '📥',
        color: '#475569',
      });
    }
    if (stats.IN_CONVERSATION > 0) {
      timelineItems.push({
        date: '—',
        label: `${stats.IN_CONVERSATION} em conversa`,
        detail: 'Leads em conversa ativa com a IA.',
        emoji: '🗣️',
        color: '#7C3AED',
      });
    }
    if (stats.MEETING_SCHEDULED > 0) {
      timelineItems.push({
        date: '—',
        label: `${stats.MEETING_SCHEDULED} reuniões agendadas`,
        detail: 'Reuniões marcadas com sucesso.',
        emoji: '📅',
        color: '#0891B2',
      });
    }
    if (stats.WON > 0) {
      timelineItems.push({
        date: '—',
        label: `${stats.WON} leads ganhos`,
        detail: 'Leads convertidos com sucesso.',
        emoji: '✅',
        color: '#027A48',
      });
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-5">
      <div className="text-[14px] font-semibold text-[#0F172A] mb-5 flex items-center gap-2">
        <History className="w-4 h-4 text-[#1B3A6B]" />
        Linha do Tempo
      </div>

      {timelineItems.length === 0 ? (
        <div className="text-center text-[12.5px] text-[#64748B] py-8">Nenhum evento registrado.</div>
      ) : (
        <div className="relative pl-6">
          {/* Vertical line */}
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[#E5E7EB]" />

          <div className="space-y-6">
            {timelineItems.map((item, i) => (
              <div key={i} className="relative flex gap-4">
                {/* Dot */}
                <div
                  className="absolute -left-6 top-1 w-[18px] h-[18px] rounded-full border-[3px] border-white flex items-center justify-center shrink-0 shadow-sm"
                  style={{ backgroundColor: item.color }}
                >
                  <span className="text-[8px]">{item.emoji}</span>
                </div>
                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-[#0F172A]">{item.label}</span>
                    <span className="text-[10px] text-[#94A3B8] font-mono">{item.date}</span>
                  </div>
                  {item.detail && (
                    <div className="text-[12px] text-[#64748B] mt-0.5">{item.detail}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
