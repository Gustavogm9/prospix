import { Target, Plus, Pause, Edit2, Copy, Play, Loader2, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api-client';
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'ACTIVE' | 'PAUSED' | 'DRAFT'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newCamp, setNewCamp] = useState({
    name: '', profession: 'DOCTOR', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18',
  });

  const fetchCampaigns = async () => {
    try {
      const res = await apiClient.get('/tenant/campaigns');
      const data = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
      setCampaigns(data);
    } catch (err) {
      console.error('Failed to fetch campaigns', err);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handlePause = async (id: string) => {
    setActionLoading(id);
    try {
      await apiClient.post(`/tenant/campaigns/${id}/pause`);
      await fetchCampaigns();
    } catch (err) { console.error(err); }
    setActionLoading(null);
  };

  const handleResume = async (id: string) => {
    setActionLoading(id);
    try {
      await apiClient.post(`/tenant/campaigns/${id}/resume`);
      await fetchCampaigns();
    } catch (err) { console.error(err); }
    setActionLoading(null);
  };

  const handleDuplicate = async (camp: Campaign) => {
    setActionLoading(camp.id);
    try {
      await apiClient.post('/tenant/campaigns', {
        name: `${camp.name} (cópia)`,
        profession: camp.profession,
        cities: camp.cities,
        neighborhoods: camp.neighborhoods || [],
        dailyLimit: camp.dailyLimit,
        hourWindowStart: camp.hourWindowStart,
        hourWindowEnd: camp.hourWindowEnd,
      });
      await fetchCampaigns();
    } catch (err) { console.error(err); }
    setActionLoading(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCamp.name.trim()) { toast.error('Nome obrigatório', 'Dê um nome à campanha.'); return; }
    setIsCreating(true);
    try {
      await apiClient.post('/tenant/campaigns', {
        name: newCamp.name.trim(),
        profession: newCamp.profession,
        cities: newCamp.cities.split(',').map(c => c.trim()).filter(Boolean),
        dailyLimit: Number(newCamp.dailyLimit) || 20,
        hourWindowStart: Number(newCamp.hourStart) || 8,
        hourWindowEnd: Number(newCamp.hourEnd) || 18,
      });
      toast.success('Campanha criada!', 'Ela começará a capturar leads automaticamente.');
      setIsCreateOpen(false);
      setNewCamp({ name: '', profession: 'DOCTOR', cities: '', dailyLimit: '20', hourStart: '8', hourEnd: '18' });
      await fetchCampaigns();
    } catch (err) {
      console.error(err);
      toast.error('Erro', 'Não foi possível criar a campanha.');
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
                    <div className="text-[11px] text-[#94A3B8]">Criada em {fmtDate(camp.createdAt)}</div>
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
                    <div className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold">Profissão</div>
                    <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{PROF_LABEL[camp.profession] || camp.profession}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold">Cidades</div>
                    <div className="text-[13px] font-semibold text-[#0F172A] mt-0.5">{camp.cities?.join(', ') || '-'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold">Meta diária</div>
                    <div className="text-[15px] font-bold text-[#027A48] font-mono mt-0.5">{camp.dailyLimit}</div>
                  </div>
                </div>

                {/* Schedule info */}
                <div className="text-[11.5px] text-[#94A3B8] mt-1">
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
                  <button className="flex-1 h-8 rounded-lg text-[12px] font-semibold bg-[#1B3A6B] text-white flex items-center justify-center gap-1.5 hover:bg-[#142C52] transition-all">
                    <Edit2 className="w-3.5 h-3.5" />
                    Editar
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Create new card */}
        <div className="bg-white border-2 border-dashed border-[#D0D5DD] rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all hover:border-[#1B3A6B] hover:bg-[rgba(27,58,107,0.04)] text-[#94A3B8] hover:text-[#1B3A6B] min-h-[220px]">
          <Plus className="w-9 h-9 mb-2" />
          <h4 className="text-[14px] font-semibold text-[#0F172A]">Criar nova campanha</h4>
          <p className="text-[12px] text-[#94A3B8] mt-1">Escolha profissão, cidade, volume e roteiro</p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setIsCreateOpen(false)}>
          <form onSubmit={handleCreate} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[16px] font-bold text-[#0F172A]">Nova Campanha</h3>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[#F1F3F6] text-[#94A3B8]"><X className="w-4 h-4" /></button>
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
            <button type="submit" disabled={isCreating} className="w-full h-10 rounded-lg text-[13px] font-semibold bg-[#1B3A6B] text-white hover:bg-[#142C52] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {isCreating ? 'Criando...' : 'Criar Campanha'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
