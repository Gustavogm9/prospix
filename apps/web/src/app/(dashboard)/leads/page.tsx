'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from '@prospix/ui';
import { Download, RefreshCw, ChevronRight, ChevronLeft, Info, Search, X } from 'lucide-react';
import { leadsQueries, campaignsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import LeadDrawer from '../funil/lead-drawer';

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
  campaignId?: string;
}

interface Campaign {
  id: string;
  name: string;
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

// ── Constants ──────────────────────────────────────────────────────────────
const PROFESSION_LABELS: Record<string, string> = {
  DOCTOR: 'Médico(a)', LAWYER: 'Advogado(a)', DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empresário(a)', ENGINEER: 'Engenheiro(a)',
  ARCHITECT: 'Arquiteto(a)', ACCOUNTANT: 'Contador(a)', OTHER: 'Outro',
};

const STATUS_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string; border: string }> = {
  CAPTURED:           { label: 'Capturados',    emoji: '📥', color: 'text-[#475569]', bg: 'bg-[#F1F5F9]', border: 'border-[#CBD5E1]' },
  ENRICHED:           { label: 'Enriquecidos',  emoji: '🔍', color: 'text-[#1B3A6B]', bg: 'bg-[#EFF6FF]', border: 'border-[#93C5FD]' },
  CONTACTED:          { label: 'Contatados',    emoji: '💬', color: 'text-[#B8740E]', bg: 'bg-[#FFF8F0]', border: 'border-[#FDE68A]' },
  IN_CONVERSATION:    { label: 'Em conversa',   emoji: '🗣️', color: 'text-[#7C3AED]', bg: 'bg-[#F5F3FF]', border: 'border-[#C4B5FD]' },
  MEETING_SCHEDULED:  { label: 'Reunião',       emoji: '📅', color: 'text-[#0891B2]', bg: 'bg-[#ECFEFF]', border: 'border-[#67E8F9]' },
  WON:                { label: 'Ganhos',        emoji: '✅', color: 'text-[#027A48]', bg: 'bg-[#ECFDF3]', border: 'border-[#A7F3D0]' },
  LOST:               { label: 'Perdidos',      emoji: '❌', color: 'text-[#D92D20]', bg: 'bg-[#FEF3F2]', border: 'border-[#FECACA]' },
};

const SCORE_OPTIONS = [
  { label: 'Qualquer score', value: undefined },
  { label: '≥ 5', value: 5 },
  { label: '≥ 6', value: 6 },
  { label: '≥ 7', value: 7 },
  { label: '≥ 8', value: 8 },
];

const PAGE_SIZE = 25;

const AVATAR_COLORS = ['#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151'];

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
    campaignId: lead.campaign_id || undefined,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
export default function Leads() {
  const tenantId = useAuthStore(state => state.tenantId);

  // Data
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCounts | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');
  const [scoreFilter, setScoreFilter] = useState<number | undefined>(undefined);

  // Pagination
  const [page, setPage] = useState(0);

  // UI
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const activeFilterCount = [statusFilter, campaignFilter, scoreFilter, debouncedSearch].filter(Boolean).length;

  // ── Debounce search ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debouncedSearch, statusFilter, campaignFilter, scoreFilter]);

  // ── Load campaigns (once) ──────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    campaignsQueries.list(tenantId).then(result => {
      if (!result.error && result.data) {
        setCampaigns(result.data.map((c: any) => ({ id: c.id, name: c.name })));
      }
    });
  }, [tenantId]);

  // ── Load status counts ─────────────────────────────────────────────────
  const fetchCounts = useCallback(async () => {
    if (!tenantId) return;
    const counts = await leadsQueries.count(tenantId, {
      campaign_id: campaignFilter || undefined,
    });
    setStatusCounts(counts);
  }, [tenantId, campaignFilter]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  // ── Load leads ─────────────────────────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    try {
      const result = await leadsQueries.list(tenantId, {
        search: debouncedSearch || undefined,
        status: (statusFilter || undefined) as any,
        campaign_id: campaignFilter || undefined,
        fit_score_gte: scoreFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });

      if (result.error) throw new Error(result.error.message);
      setLeads((result.data || []).map(mapBackendLead));
      setTotalCount(result.totalCount ?? 0);
    } catch (err) {
      console.error(err);
      setLeads([]);
      toast.error('Erro de Conexão', 'Não foi possível carregar os leads.');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, debouncedSearch, statusFilter, campaignFilter, scoreFilter, page]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // ── CSV Export ─────────────────────────────────────────────────────────
  const handleExportCsv = async () => {
    if (!tenantId) return;
    setIsExporting(true);
    try {
      const allLeads = await leadsQueries.exportAll(tenantId, {
        search: debouncedSearch || undefined,
        status: (statusFilter || undefined) as any,
        campaign_id: campaignFilter || undefined,
        fit_score_gte: scoreFilter,
      });

      if (allLeads.length === 0) {
        toast.error('Nenhum lead', 'Não há leads para exportar com os filtros atuais.');
        return;
      }

      const escapeCsv = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const headers = ['Nome', 'Empresa', 'WhatsApp', 'Profissão', 'Cidade', 'Status', 'Fit Score', 'Avaliação Google', 'Campanha', 'Criado em'];
      const rows = allLeads.map((lead: any) => {
        const metadata = (lead.metadata || {}) as Record<string, any>;
        const address = lead.address || {};
        const rawData = (lead.source_raw_data || {}) as Record<string, any>;
        return [
          lead.name || '',
          metadata.cnpj_info?.nomeFantasia || metadata.cnpj_info?.razaoSocial || rawData.name || lead.name || '',
          lead.whatsapp || '',
          lead.profession ? (PROFESSION_LABELS[lead.profession] || lead.profession) : '',
          address.city || '',
          lead.status || '',
          lead.fit_score || 0,
          lead.google_rating || '',
          lead.campaign_id || '',
          lead.created_at ? new Date(lead.created_at).toLocaleDateString('pt-BR') : '',
        ];
      });

      const BOM = '\uFEFF';
      const csv = BOM + [headers, ...rows].map(row => row.map(escapeCsv).join(';')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `leads-prospix-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('CSV exportado', `${allLeads.length} leads exportados com sucesso.`);
    } catch (err) {
      console.error(err);
      toast.error('Erro na exportação', 'Não foi possível gerar o CSV.');
    } finally {
      setIsExporting(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const clearFilters = () => {
    setStatusFilter('');
    setCampaignFilter('');
    setScoreFilter(undefined);
    setSearch('');
  };

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

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>{statusCounts?.total ?? '...'} leads</strong> no total, organizados por etapa do funil. Use os filtros para encontrar leads específicos.</div>
      </div>

      {/* ── Status Cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, config]) => {
          const count = statusCounts ? (statusCounts as any)[key] ?? 0 : '—';
          const isActive = statusFilter === key;
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(isActive ? '' : key)}
              className={`bg-white border rounded-xl p-3 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md shadow-sm text-left ${
                isActive ? 'border-[#1B3A6B] ring-2 ring-[#1B3A6B]/20 shadow-md' : 'border-[#E5E7EB] hover:border-[#1B3A6B]'
              }`}
            >
              <div className="text-[16px] mb-1">{config.emoji}</div>
              <div className="text-[22px] font-bold text-[#0F172A] font-mono leading-none">{count}</div>
              <div className="text-[11px] font-semibold text-[#475569] mt-1 truncate">{config.label}</div>
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        {/* Campaign filter */}
        <select
          value={campaignFilter}
          onChange={e => setCampaignFilter(e.target.value)}
          className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] bg-white hover:bg-[#F1F3F6] outline-none focus:border-[#1B3A6B] min-w-[140px]"
        >
          <option value="">Todas campanhas</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] bg-white hover:bg-[#F1F3F6] outline-none focus:border-[#1B3A6B] min-w-[130px]"
        >
          <option value="">Todos status</option>
          {Object.entries(STATUS_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>{config.emoji} {config.label}</option>
          ))}
        </select>

        {/* Score filter */}
        <select
          value={scoreFilter ?? ''}
          onChange={e => setScoreFilter(e.target.value ? Number(e.target.value) : undefined)}
          className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] bg-white hover:bg-[#F1F3F6] outline-none focus:border-[#1B3A6B] min-w-[120px]"
        >
          {SCORE_OPTIONS.map(opt => (
            <option key={opt.label} value={opt.value ?? ''}>{opt.label}</option>
          ))}
        </select>

        <div className="w-px h-6 bg-[#E5E7EB] mx-0.5" />

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#D92D20] border border-[#FECACA] bg-[#FEF3F2] hover:bg-[#FEE2E2] flex items-center gap-1.5 transition-all">
            <X className="w-3 h-3" /> Limpar ({activeFilterCount})
          </button>
        )}

        {/* Export */}
        <button
          onClick={handleExportCsv}
          disabled={isExporting}
          className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1.5 disabled:opacity-50"
        >
          <Download className="w-3 h-3" />
          {isExporting ? 'Exportando...' : 'Exportar CSV'}
        </button>

        {/* Search */}
        <div className="ml-auto relative">
          <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar lead, telefone..."
            className="h-8 pl-8 pr-3 rounded-md text-[12px] border border-[#E5E7EB] bg-white text-[#0F172A] placeholder-[#94A3B8] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none w-56"
          />
        </div>
      </div>

      {/* ── Leads Table ─────────────────────────────────────────────── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[#0F172A]">Todos os leads</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">
              {totalCount.toLocaleString('pt-BR')} leads encontrados
              {activeFilterCount > 0 && ` · ${activeFilterCount} filtro${activeFilterCount > 1 ? 's' : ''} ativo${activeFilterCount > 1 ? 's' : ''}`}
            </div>
          </div>
          <button onClick={() => { fetchLeads(); fetchCounts(); }} className="p-2 rounded-lg hover:bg-[#F1F3F6] text-[#64748B] hover:text-[#1B3A6B] transition-all" title="Atualizar">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Table header */}
        <div className="hidden md:grid grid-cols-[1fr_1fr_120px_100px_90px_80px_40px] px-5 py-2 border-b border-[#EEF0F3] bg-[#FAFBFC] text-[10px] font-semibold text-[#64748B] uppercase tracking-wider">
          <div>Lead</div>
          <div>Empresa / Cidade</div>
          <div>Status</div>
          <div>Campanha</div>
          <div>Score</div>
          <div>Data</div>
          <div></div>
        </div>

        {/* Loading */}
        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-5 h-5 animate-spin text-[#64748B] mx-auto mb-2" />
            <div className="text-[12px] text-[#64748B]">Carregando leads...</div>
          </div>
        ) : leads.length > 0 ? (
          leads.map((lead, i) => (
            <div
              key={lead.id}
              className="px-5 py-3 border-b border-[#EEF0F3] grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_100px_90px_80px_40px] items-center gap-2 md:gap-3 cursor-pointer transition-all hover:bg-[rgba(27,58,107,0.03)] border-l-[3px] border-l-transparent hover:border-l-[#1B3A6B]"
              onClick={() => setSelectedLeadId(lead.id)}
            >
              {/* Lead name + phone */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                  {getInitials(lead.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A] truncate">{lead.name}</div>
                  <div className="text-[11px] text-[#64748B] font-mono truncate">{lead.phone || '—'}</div>
                </div>
              </div>

              {/* Company + city */}
              <div className="min-w-0 hidden md:block">
                <div className="text-[12px] text-[#0F172A] truncate">{lead.company}</div>
                <div className="text-[11px] text-[#64748B] truncate">{lead.profession ? `${lead.profession} · ` : ''}{lead.city}</div>
              </div>

              {/* Status */}
              <div className="hidden md:block">{getStatusBadge(lead.status)}</div>

              {/* Campaign */}
              <div className="hidden md:block text-[11px] text-[#64748B] truncate">
                {campaigns.find(c => c.id === lead.campaignId)?.name || '—'}
              </div>

              {/* Score */}
              <div className="hidden md:block">{getScoreBadge(lead.fitScore)}</div>

              {/* Date */}
              <div className="hidden md:block text-[11px] text-[#64748B]">{lead.createdAt}</div>

              {/* Arrow */}
              <div className="hidden md:flex items-center justify-center">
                <ChevronRight className="w-4 h-4 text-[#CBD5E1]" />
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center text-[12.5px] text-[#64748B]">Nenhum lead encontrado com os filtros selecionados.</div>
        )}

        {/* ── Pagination ────────────────────────────────────────────── */}
        {totalCount > 0 && (
          <div className="px-5 py-3 bg-[#FAFBFC] border-t border-[#EEF0F3] flex items-center justify-between">
            <span className="text-[12px] text-[#64748B]">
              Mostrando {Math.min(page * PAGE_SIZE + 1, totalCount).toLocaleString('pt-BR')}–{Math.min((page + 1) * PAGE_SIZE, totalCount).toLocaleString('pt-BR')} de {totalCount.toLocaleString('pt-BR')}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft className="w-3 h-3" /> Anterior
              </button>
              <span className="text-[12px] font-semibold text-[#0F172A] tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Próximo <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Lead Drawer (full 4-tab version from funil) ──────────── */}
      {selectedLeadId && (
        <LeadDrawer
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
    </div>
  );
}
