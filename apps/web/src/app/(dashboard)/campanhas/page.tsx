'use client';

import { Target, Plus, Pause, Edit2, Copy, Play, Loader2, Info, X, Trash2, ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { campaignsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import { toast } from '@prospix/ui';

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
}

const PROF_ICON: Record<string, string> = {
  DOCTOR: '🏥', LAWYER: '⚖️', DENTIST: '🦷', BUSINESS_OWNER: '🏢', OTHER: '📋',
};
const PROF_LABEL: Record<string, string> = {
  DOCTOR: 'Médicos', LAWYER: 'Advogados', DENTIST: 'Dentistas', BUSINESS_OWNER: 'Empresários', OTHER: 'Outros',
};

export default function Campaigns() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'ACTIVE' | 'PAUSED' | 'DRAFT'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [icpOpen, setIcpOpen] = useState(false);
  const [newCamp, setNewCamp] = useState({
    name: '', profession: 'DOCTOR', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18',
    icpMinScore: '3',
    icpWeightProfession: '3',
    icpWeightWhatsapp: '2',
    icpWeightOwner: '2',
    icpWeightArea: '1',
    icpWeightCnpjYears: '1',
    icpWeightGoogle: '1',
    icpHighValueAreas: '',
    icpMinGoogleRating: '4',
    icpMinReviews: '5',
  });

  const fetchCampaigns = async () => {
    if (!tenantId) return;
    try {
      const result = await campaignsQueries.list(tenantId);
      if (result.error) throw new Error(result.error.message);
      setCampaigns((result.data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        profession: c.profession,
        cities: c.cities || [],
        neighborhoods: c.neighborhoods || [],
        dailyLimit: c.daily_limit,
        hourWindowStart: c.hour_window_start,
        hourWindowEnd: c.hour_window_end,
        status: c.status,
        createdAt: c.created_at,
        filters: c.filters,
      })));
    } catch (err) {
      console.error('Failed to fetch campaigns', err);
      toast.error('Erro ao carregar', 'Não foi possível carregar as campanhas.');
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, [tenantId]);

  const handlePause = async (id: string) => {
    if (!tenantId) return;
    setActionLoading(id);
    try {
      const result = await campaignsQueries.pause(tenantId, id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha pausada');
      await fetchCampaigns();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível pausar a campanha.'); }
    setActionLoading(null);
  };

  const handleResume = async (id: string) => {
    if (!tenantId) return;
    setActionLoading(id);
    try {
      const result = await campaignsQueries.resume(tenantId, id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha ativada');
      await fetchCampaigns();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível ativar a campanha.'); }
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
        filters: camp.filters,
      });
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha duplicada');
      await fetchCampaigns();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível duplicar a campanha.'); }
    setActionLoading(null);
  };

  const handleEdit = (camp: Campaign) => {
    setEditingCampaign(camp);
    const f = camp.filters || {} as any;
    const w = f.weights || {};
    setNewCamp({
      name: camp.name,
      profession: camp.profession,
      cities: camp.cities?.join(', ') || '',
      dailyLimit: String(camp.dailyLimit),
      hourStart: String(camp.hourWindowStart),
      hourEnd: String(camp.hourWindowEnd),
      icpMinScore: String(f.min_fit_score ?? 3),
      icpWeightProfession: String(w.profession_match ?? 3),
      icpWeightWhatsapp: String(w.whatsapp_valid ?? 2),
      icpWeightOwner: String(w.is_owner ?? 2),
      icpWeightArea: String(w.high_value_area ?? 1),
      icpWeightCnpjYears: String(w.cnpj_years ?? 1),
      icpWeightGoogle: String(w.google_reputation ?? 1),
      icpHighValueAreas: (f.high_value_areas || []).join(', '),
      icpMinGoogleRating: String(f.min_google_rating ?? 4),
      icpMinReviews: String(f.min_reviews ?? 5),
    });
    setIcpOpen(true);
    setIsCreateOpen(true);
  };

  const handleDelete = async (camp: Campaign) => {
    if (!window.confirm(`Tem certeza que deseja excluir a campanha "${camp.name}"? Esta ação não pode ser desfeita.`)) return;
    if (!tenantId) return;
    setActionLoading(camp.id);
    try {
      const result = await campaignsQueries.delete(tenantId, camp.id);
      if (result.error) throw new Error(result.error.message);
      toast.success('Campanha excluída');
      await fetchCampaigns();
    } catch (err) { console.error(err); toast.error('Erro', 'Não foi possível excluir a campanha.'); }
    setActionLoading(null);
  };

  const handleCreateOrEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCamp.name.trim()) { toast.error('Nome obrigatório', 'Dê um nome à campanha.'); return; }
    if (!tenantId) return;
    setIsCreating(true);
    const payload = {
      name: newCamp.name.trim(),
      profession: newCamp.profession as any,
      cities: newCamp.cities.split(',').map(c => c.trim()).filter(Boolean),
      dailyLimit: Number(newCamp.dailyLimit) || 20,
      hourWindowStart: Number(newCamp.hourStart) || 8,
      hourWindowEnd: Number(newCamp.hourEnd) || 18,
      filters: {
        min_fit_score: Number(newCamp.icpMinScore) || 3,
        weights: {
          profession_match: Number(newCamp.icpWeightProfession) || 3,
          whatsapp_valid: Number(newCamp.icpWeightWhatsapp) || 2,
          is_owner: Number(newCamp.icpWeightOwner) || 2,
          high_value_area: Number(newCamp.icpWeightArea) || 1,
          cnpj_years: Number(newCamp.icpWeightCnpjYears) || 1,
          google_reputation: Number(newCamp.icpWeightGoogle) || 1,
        },
        high_value_areas: newCamp.icpHighValueAreas.split(',').map(s => s.trim()).filter(Boolean),
        min_google_rating: Number(newCamp.icpMinGoogleRating) || 4,
        min_reviews: Number(newCamp.icpMinReviews) || 5,
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
      setEditingCampaign(null);
      setNewCamp({ name: '', profession: 'DOCTOR', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18', icpMinScore: '3', icpWeightProfession: '3', icpWeightWhatsapp: '2', icpWeightOwner: '2', icpWeightArea: '1', icpWeightCnpjYears: '1', icpWeightGoogle: '1', icpHighValueAreas: '', icpMinGoogleRating: '4', icpMinReviews: '5' });
      setIcpOpen(false);
      await fetchCampaigns();
    } catch (err) {
      console.error(err);
      toast.error('Erro', editingCampaign ? 'Não foi possível atualizar a campanha.' : 'Não foi possível criar a campanha.');
    } finally {
      setIsCreating(false);
    }
  };

  const filtered = filter === 'all' ? campaigns : campaigns.filter(c => c.status === filter);
  const activeCount = campaigns.filter(c => c.status === 'ACTIVE').length;
  const pausedCount = campaigns.filter(c => c.status === 'PAUSED').length;
  const draftCount = campaigns.filter(c => c.status === 'DRAFT').length;

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  };

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
        <div><strong>Suas campanhas de prospecção ativa.</strong> Cada campanha busca profissionais por especialidade + cidade e dispara a IA via WhatsApp.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <button onClick={() => setFilter('all')} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium ${filter === 'all' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Todas · {campaigns.length}</button>
        <button onClick={() => setFilter('ACTIVE')} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium ${filter === 'ACTIVE' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Ativas · {activeCount}</button>
        <button onClick={() => setFilter('PAUSED')} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium ${filter === 'PAUSED' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Pausadas · {pausedCount}</button>
        <button onClick={() => setFilter('DRAFT')} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium ${filter === 'DRAFT' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Rascunhos · {draftCount}</button>
        <button onClick={() => setIsCreateOpen(true)} className="h-8 px-3.5 rounded-md text-[12px] font-semibold bg-[#1B3A6B] text-white ml-auto flex items-center gap-1.5 hover:bg-[#142C52] transition-all shadow-sm">
          <Plus className="w-3.5 h-3.5" />
          Nova campanha
        </button>
      </div>

      {/* Campaign cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map(camp => {
          const isActive = camp.status === 'ACTIVE';
          const isPaused = camp.status === 'PAUSED';
          const icon = PROF_ICON[camp.profession] || '📋';

          return (
            <div key={camp.id} className={`bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-[#1B3A6B] cursor-pointer ${isPaused ? 'opacity-75' : ''}`}>
              {/* Header */}
              <div className="px-4 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center text-lg shrink-0">
                    {icon}
                  </div>
                  <div>
                    <div className="text-[14px] font-semibold text-[#0F172A]">{camp.name}</div>
                    <div className="text-[11px] text-[#64748B]">Criada em {fmtDate(camp.createdAt)}</div>
                  </div>
                </div>
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
              </div>

              {/* Body */}
              <div className="p-4">
                {/* Metrics */}
                <div className="grid grid-cols-3 gap-3 mb-3.5 pb-3.5 border-b border-[#EEF0F3]">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Profissão</div>
                    <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{PROF_LABEL[camp.profession] || camp.profession}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Cidades</div>
                    <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{camp.cities?.join(', ') || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">Meta diária</div>
                    <div className="text-[15px] font-bold text-[#027A48] font-mono mt-0.5">{camp.dailyLimit}</div>
                  </div>
                </div>

                {/* Schedule info */}
                <div className="text-[11.5px] text-[#64748B] mt-1">
                  📍 {camp.cities?.join(', ')} {camp.neighborhoods?.length ? `· ${camp.neighborhoods.join(', ')}` : ''} · ⏰ {camp.hourWindowStart}h–{camp.hourWindowEnd}h
                </div>

                {/* Actions */}
                <div className="flex gap-2 mt-3.5">
                  {isActive ? (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handlePause(camp.id); }}
                      disabled={actionLoading === camp.id}
                      className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#F1F3F6] text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-[#E5E7EB] transition-all disabled:opacity-50"
                    >
                      {actionLoading === camp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                      Pausar
                    </button>
                  ) : (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleResume(camp.id); }}
                      disabled={actionLoading === camp.id}
                      className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#ECFDF3] text-[#027A48] flex items-center justify-center gap-1.5 hover:bg-[#D1FAE5] transition-all disabled:opacity-50"
                    >
                      {actionLoading === camp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                      Ativar
                    </button>
                  )}
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDuplicate(camp); }}
                    disabled={actionLoading === camp.id}
                    className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#F1F3F6] text-[#0F172A] flex items-center justify-center gap-1.5 hover:bg-[#E5E7EB] transition-all disabled:opacity-50"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicar
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleEdit(camp); }}
                    className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#1B3A6B] text-white flex items-center justify-center gap-1.5 hover:bg-[#142C52] transition-all"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDelete(camp); }}
                    disabled={actionLoading === camp.id}
                    className="h-8 w-8 rounded-lg text-[12px] font-semibold bg-[#FEF3F2] text-[#D92D20] flex items-center justify-center hover:bg-[#FEE4E2] transition-all disabled:opacity-50 shrink-0"
                    title="Excluir campanha"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Create new card */}
        <div onClick={() => setIsCreateOpen(true)} className="bg-white border-2 border-dashed border-[#D0D5DD] rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:bg-[rgba(27,58,107,0.04)] text-[#64748B] hover:text-[#1B3A6B] min-h-[220px]">
          <Plus className="w-9 h-9 mb-2" />
          <h4 className="text-[14px] font-semibold text-[#0F172A]">Criar nova campanha</h4>
          <p className="text-[12px] text-[#64748B] mt-1">Escolha profissão, cidade, volume e roteiro</p>
        </div>
      </div>

      {campaigns.length === 0 && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 bg-[rgba(27,58,107,0.04)] rounded-lg text-[12px] text-[#475569]">
          <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
          Nenhuma campanha criada ainda. Clique em "Nova campanha" para começar a prospectar.
        </div>
      )}
      {/* Create Campaign Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setIsCreateOpen(false); setEditingCampaign(null); }}>
          <form onSubmit={handleCreateOrEdit} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[16px] font-bold text-[#0F172A]">{editingCampaign ? 'Editar Campanha' : 'Nova Campanha'}</h3>
              <button type="button" onClick={() => { setIsCreateOpen(false); setEditingCampaign(null); }} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#64748B]"><X className="w-4 h-4" /></button>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Nome da campanha</label>
              <input value={newCamp.name} onChange={e => setNewCamp(p => ({...p, name: e.target.value}))} placeholder="Ex: Médicos SJRP" className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none" autoFocus />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Profissão alvo</label>
              <select value={newCamp.profession} onChange={e => setNewCamp(p => ({...p, profession: e.target.value}))} className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none">
                <option value="DOCTOR">Médicos</option>
                <option value="LAWYER">Advogados</option>
                <option value="DENTIST">Dentistas</option>
                <option value="BUSINESS_OWNER">Empresários</option>
                <option value="OTHER">Outros</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Cidades (separadas por vírgula)</label>
              <input value={newCamp.cities} onChange={e => setNewCamp(p => ({...p, cities: e.target.value}))} placeholder="São José do Rio Preto, Votuporanga" className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Leads/dia</label>
                <input type="number" value={newCamp.dailyLimit} onChange={e => setNewCamp(p => ({...p, dailyLimit: e.target.value}))} className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Início</label>
                <input type="number" min="0" max="23" value={newCamp.hourStart} onChange={e => setNewCamp(p => ({...p, hourStart: e.target.value}))} className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Fim</label>
                <input type="number" min="0" max="23" value={newCamp.hourEnd} onChange={e => setNewCamp(p => ({...p, hourEnd: e.target.value}))} className="w-full h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[13px] focus:border-[#1B3A6B] outline-none" />
              </div>
            </div>

            {/* ICP Section */}
            <div className="border border-[#E5E7EB] rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setIcpOpen(!icpOpen)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.03)] to-[rgba(232,152,28,0.04)] hover:from-[rgba(27,58,107,0.06)] hover:to-[rgba(232,152,28,0.08)] transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[14px]">⚡</span>
                  <span className="text-[12px] font-semibold text-[#0F172A]">Perfil de Cliente Ideal (ICP)</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ECFDF3] text-[#027A48] font-medium">Novo</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-[#64748B] transition-transform ${icpOpen ? 'rotate-180' : ''}`} />
              </button>

              {icpOpen && (
                <div className="px-4 py-3 space-y-3.5 border-t border-[#EEF0F3] bg-[#FAFBFC]">
                  {/* Min Fit Score Slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider">Score mínimo para aceitar lead</label>
                      <span className="text-[13px] font-bold text-[#1B3A6B] font-mono bg-[rgba(27,58,107,0.08)] px-2 py-0.5 rounded">{newCamp.icpMinScore}</span>
                    </div>
                    <input
                      type="range" min="0" max="10" step="1"
                      value={newCamp.icpMinScore}
                      onChange={e => setNewCamp(p => ({...p, icpMinScore: e.target.value}))}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer accent-[#1B3A6B] bg-[#E5E7EB]"
                    />
                    <div className="flex justify-between text-[9px] text-[#94A3B8] mt-0.5">
                      <span>0 — aceita todos</span>
                      <span>10 — muito restritivo</span>
                    </div>
                    <p className="text-[10px] text-[#64748B] mt-1">Leads com score abaixo deste valor serão arquivados automaticamente.</p>
                  </div>

                  {/* Score Weights */}
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-2">Pesos dos critérios de avaliação</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: 'icpWeightProfession', label: 'Profissão bate', icon: '🎯', tip: 'Profissão do lead = profissão da campanha' },
                        { key: 'icpWeightWhatsapp', label: 'WhatsApp válido', icon: '📱', tip: 'Lead tem WhatsApp ativo e verificado' },
                        { key: 'icpWeightOwner', label: 'Sócio/proprietário', icon: '👤', tip: 'Lead é dono ou sócio do negócio' },
                        { key: 'icpWeightArea', label: 'Bairro premium', icon: '📍', tip: 'Lead está em bairro de alto valor' },
                        { key: 'icpWeightCnpjYears', label: 'Tempo de atuação', icon: '📅', tip: 'Anos desde abertura do CNPJ (máx 5+)' },
                        { key: 'icpWeightGoogle', label: 'Reputação Google', icon: '⭐', tip: 'Rating ≥ 4.5 com 10+ avaliações' },
                      ].map(({ key, label, icon, tip }) => (
                        <div key={key} className="flex items-center gap-2 bg-white rounded-lg border border-[#E5E7EB] px-2.5 py-2" title={tip}>
                          <span className="text-[13px]">{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10.5px] font-medium text-[#0F172A] truncate">{label}</div>
                          </div>
                          <input
                            type="number" min="0" max="5" step="1"
                            value={(newCamp as any)[key]}
                            onChange={e => setNewCamp(p => ({...p, [key]: e.target.value}))}
                            className="w-10 h-7 text-center rounded bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] font-bold text-[#1B3A6B] focus:border-[#1B3A6B] outline-none"
                          />
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const maxScore = Number(newCamp.icpWeightProfession) + Number(newCamp.icpWeightWhatsapp) + Number(newCamp.icpWeightOwner) + Number(newCamp.icpWeightArea) + Number(newCamp.icpWeightCnpjYears) + Number(newCamp.icpWeightGoogle);
                      const minScore = Number(newCamp.icpMinScore);
                      const pct = maxScore > 0 ? Math.round((minScore / maxScore) * 100) : 0;
                      return (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: pct > 80 ? '#D92D20' : pct > 50 ? '#E8981C' : '#027A48' }} />
                          </div>
                          <span className="text-[10px] font-mono text-[#64748B] whitespace-nowrap">mín {minScore} / máx {maxScore}</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* High Value Areas */}
                  <div>
                    <label className="text-[11px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Bairros de alto valor (opcional)</label>
                    <input
                      value={newCamp.icpHighValueAreas}
                      onChange={e => setNewCamp(p => ({...p, icpHighValueAreas: e.target.value}))}
                      placeholder="Centro, Jardim Paulista, Vila Nova"
                      className="w-full h-8 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none"
                    />
                    <p className="text-[10px] text-[#64748B] mt-0.5">Leads nesses bairros ganham pontos extras. Separe por vírgula.</p>
                  </div>

                  {/* Google Reputation Config */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Rating mínimo Google</label>
                      <input
                        type="number" min="0" max="5" step="0.5"
                        value={newCamp.icpMinGoogleRating}
                        onChange={e => setNewCamp(p => ({...p, icpMinGoogleRating: e.target.value}))}
                        className="w-full h-8 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px] focus:border-[#1B3A6B] outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-[#475569] uppercase tracking-wider block mb-1">Avaliações mínimas</label>
                      <input
                        type="number" min="0" max="100"
                        value={newCamp.icpMinReviews}
                        onChange={e => setNewCamp(p => ({...p, icpMinReviews: e.target.value}))}
                        className="w-full h-8 px-3 rounded-lg bg-white border border-[#E5E7EB] text-[12px] focus:border-[#1B3A6B] outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button type="submit" disabled={isCreating} className="w-full h-10 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : editingCampaign ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {isCreating ? (editingCampaign ? 'Salvando...' : 'Criando...') : (editingCampaign ? 'Salvar Alterações' : 'Criar Campanha')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
