'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, toast } from '@prospix/ui';
import { AlertCircle, X, Info, Columns, LayoutList, Star, ChevronRight } from 'lucide-react';
import { leadsQueries, campaignsQueries } from '@/lib/queries';
import { useAuthStore } from '@/store/auth-store';
import LeadDrawer from './lead-drawer';

interface LeadCard {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  profession: string;
  rawProfession: string;
  fitScore: number;
  stage: 'capturado' | 'contatado' | 'qualificado' | 'agendado' | 'negociacao' | 'fechado';
  when: string;
  createdAt: string;
  tags: string[];
  whatsappValid: boolean | null;
  googleRating: number | null;
  googleReviewsCount: number | null;
  address: any;
  metadata: any;
  campaignId: string | null;
}

interface Campaign {
  id: string;
  name: string;
  profession: string;
}

const AVATAR_COLORS = ['#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151'];

const COLUMNS = [
  { id: 'capturado', name: 'Capturado', color: '#64748B' },
  { id: 'contatado', name: '1ª mensagem enviada', color: '#0EA5E9' },
  { id: 'qualificado', name: 'Em conversa com IA', color: '#E8981C' },
  { id: 'agendado', name: 'Aguardando você', color: '#F79009' },
  { id: 'negociacao', name: 'Reunião agendada', color: '#039855' },
  { id: 'fechado', name: 'Apólice fechada · mês', color: '#1B3A6B' },
] as const;

const STAGE_TO_STATUS: Record<LeadCard['stage'], string> = {
  capturado: 'CAPTURED',
  contatado: 'CONTACTED',
  qualificado: 'QUALIFIED',
  agendado: 'MEETING_SCHEDULED',
  negociacao: 'MEETING_SCHEDULED',
  fechado: 'CLOSED_WON',
};

const STATUS_TO_STAGE: Record<string, LeadCard['stage']> = {
  CAPTURED: 'capturado',
  ENRICHED: 'capturado',
  CONTACTED: 'contatado',
  CONVERSING: 'qualificado',
  QUALIFIED: 'qualificado',
  MEETING_SCHEDULED: 'agendado',
  ESCALATED_HUMAN: 'agendado',
  NEGOTIATION: 'negociacao',
  CLOSED_WON: 'fechado',
};

const PROFESSION_LABELS_PIPE: Record<string, string> = {
  DOCTOR: 'Médico(a)', LAWYER: 'Advogado(a)', DENTIST: 'Dentista',
  ENTREPRENEUR: 'Empresário(a)', ENGINEER: 'Engenheiro(a)',
  ARCHITECT: 'Arquiteto(a)', ACCOUNTANT: 'Contador(a)', OTHER: 'Outro',
};

const mapBackendLeadToCard = (lead: any): LeadCard => {
  const metadata = (lead.metadata || {}) as Record<string, any>;
  const rawData = (lead.source_raw_data || {}) as Record<string, any>;
  const stage = STATUS_TO_STAGE[lead.status] || 'capturado';
  const tags: string[] = [];
  if (Number(lead.fit_score) >= 9) tags.push('🔥 Quente');
  if (lead.status === 'MEETING_SCHEDULED') tags.push('✓ Agendada');
  if (lead.first_response_at) tags.push('💬 Respondeu');
  return {
    id: lead.id,
    name: lead.name || 'Sem nome',
    phone: lead.whatsapp || '',
    email: lead.email || '',
    company: metadata.cnpj_info?.nome_fantasia || metadata.cnpj_info?.razao_social || rawData.name || lead.name || '',
    profession: lead.profession ? (PROFESSION_LABELS_PIPE[lead.profession] || lead.profession) : '',
    rawProfession: lead.profession || '',
    fitScore: Number(lead.fit_score) || 0,
    stage,
    when: lead.created_at ? new Date(lead.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    createdAt: lead.created_at || '',
    tags,
    whatsappValid: lead.whatsapp_valid,
    googleRating: lead.google_rating ? Number(lead.google_rating) : null,
    googleReviewsCount: lead.google_reviews_count,
    address: lead.address || {},
    metadata,
    campaignId: lead.campaign_id || null,
  };
};

export default function PipelinePage() {
  const tenantId = useAuthStore(state => state.tenantId);
  const [leads, setLeads] = useState<LeadCard[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null);
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [newLead, setNewLead] = useState({ name: '', company: '', whatsapp: '', email: '', city: '', faturamento: '' });

  // Build dynamic filters from campaigns
  const filterOptions = React.useMemo(() => {
    const base = [
      { key: 'all', label: 'Todos os leads' },
      { key: 'semana', label: 'Esta semana' },
    ];
    // Add unique professions from campaigns
    const seen = new Set<string>();
    for (const c of campaigns) {
      if (c.profession && !seen.has(c.profession)) {
        seen.add(c.profession);
        base.push({ key: `prof_${c.profession}`, label: PROFESSION_LABELS_PIPE[c.profession] || c.profession });
      }
    }
    // Add per-campaign filters if multiple campaigns share same profession
    if (campaigns.length > 2) {
      for (const c of campaigns) {
        base.push({ key: `campaign_${c.id}`, label: c.name.replace('Prospecção ', '') });
      }
    }
    return base;
  }, [campaigns]);

  const fetchLeads = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await leadsQueries.list(tenantId, { limit: 500 });
      if ('error' in result && result.error) throw new Error(result.error.message);
      setLeads((result.data || []).map(mapBackendLeadToCard));
    } catch (error) {
      console.error('Error fetching pipeline leads:', error);
      setLeads([]);
      toast.error('Erro de Conexão', 'Não foi possível carregar o pipeline.');
    }
  }, [tenantId]);

  const fetchCampaigns = useCallback(async () => {
    if (!tenantId) return;
    try {
      const result = await campaignsQueries.list(tenantId);
      if (result.data) {
        setCampaigns(result.data.filter((c: any) => c.status === 'ACTIVE').map((c: any) => ({
          id: c.id,
          name: c.name || '',
          profession: c.profession || '',
        })));
      }
    } catch { /* ignore */ }
  }, [tenantId]);

  useEffect(() => {
    fetchLeads();
    fetchCampaigns();
  }, [fetchLeads, fetchCampaigns]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setIsDraggingOver(columnId);
  };

  const handleDrop = async (e: React.DragEvent, targetStage: LeadCard['stage']) => {
    e.preventDefault();
    setIsDraggingOver(null);
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    if (!id) return;
    handleMoveLead(id, targetStage);
  };

  const handleMoveLead = async (id: string, targetStage: LeadCard['stage']) => {
    if (!tenantId) return;
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.stage === targetStage) return;
    const originalStage = lead.stage;
    setLeads(leads.map(l => l.id === id ? { ...l, stage: targetStage } : l));
    try {
      const result = await leadsQueries.update(tenantId, id, { status: STAGE_TO_STATUS[targetStage] as any });
      if (result.error) throw new Error(result.error.message);
      toast.success('Sucesso', 'Estágio atualizado.');
    } catch {
      setLeads(leads.map(l => l.id === id ? { ...l, stage: originalStage } : l));
      toast.error('Erro', 'Falha ao salvar no servidor.');
    } finally {
      setDraggedId(null);
    }
  };

  const handleCreateLead = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newLead.whatsapp.trim()) { toast.error('WhatsApp obrigatório', 'Informe um WhatsApp.'); return; }
    if (!tenantId) return;
    setIsCreatingLead(true);
    try {
      const result = await leadsQueries.create(tenantId, {
        name: newLead.name.trim() || newLead.company.trim() || undefined,
        whatsapp: newLead.whatsapp.trim(),
        email: newLead.email.trim() || undefined,
        address: newLead.city.trim() ? { city: newLead.city.trim() } : undefined,
        metadata: { company: newLead.company.trim() || undefined, faturamento: newLead.faturamento.trim() || undefined, source: 'pipeline_manual' },
      });
      if (result.error) throw new Error(result.error.message);
      toast.success('Lead criado', 'O novo lead entrou no pipeline.');
      setIsCreateLeadOpen(false);
      setNewLead({ name: '', company: '', whatsapp: '', email: '', city: '', faturamento: '' });
      await fetchLeads();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message || 'Erro ao salvar.' : 'Erro ao salvar.';
      toast.error('Erro ao criar lead', message);
    } finally { setIsCreatingLead(false); }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  const applyFilter = (l: LeadCard) => {
    if (filter === 'all') return true;
    if (filter === 'semana') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return l.createdAt && new Date(l.createdAt) >= sevenDaysAgo;
    }
    if (filter.startsWith('prof_')) {
      return l.rawProfession === filter.replace('prof_', '');
    }
    if (filter.startsWith('campaign_')) {
      return l.campaignId === filter.replace('campaign_', '');
    }
    return true;
  };

  // Exclude ARCHIVED from pipeline view
  const visibleLeads = leads.filter(l => l.stage !== undefined);

  return (
    <div className="space-y-4 h-[calc(100dvh-120px)] flex flex-col animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Arraste os cards entre colunas</strong> para mover o lead no funil. Clique em qualquer card para ver detalhes. A IA atualiza automaticamente conforme avança a conversa.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm shrink-0">
        {filterOptions.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium transition-all ${filter === f.key ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>
            {f.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 bg-[#F1F3F6] p-0.5 rounded-lg border border-[#E5E7EB]">
          <button onClick={() => setViewMode('table')} className={`h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-all ${viewMode === 'table' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#475569] hover:bg-white/60'}`}>
            <LayoutList className="w-3 h-3" /> Tabela
          </button>
          <button onClick={() => setViewMode('kanban')} className={`h-7 px-2.5 rounded text-[11px] font-semibold flex items-center gap-1 transition-all ${viewMode === 'kanban' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#475569] hover:bg-white/60'}`}>
            <Columns className="w-3 h-3" /> Kanban
          </button>
        </div>
      </div>

      {/* View */}
      {viewMode === 'kanban' ? (
        /* Kanban board */
        <div className="flex-1 flex gap-3 overflow-x-auto pb-4 items-stretch select-none snap-x snap-mandatory scroll-pl-2.5">
          {COLUMNS.map((column) => {
            const filteredLeads = visibleLeads.filter(applyFilter);
            const columnLeads = filteredLeads.filter(l => l.stage === column.id);
            const count = columnLeads.length;
            const isWarning = column.id === 'agendado';

            return (
              <div
                key={column.id}
                onDragOver={(e) => handleDragOver(e, column.id)}
                onDragLeave={() => setIsDraggingOver(null)}
                onDrop={(e) => handleDrop(e, column.id as LeadCard['stage'])}
                className={`w-[250px] min-w-[250px] snap-start rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] flex flex-col shrink-0 transition-all ${
                  isDraggingOver === column.id ? 'ring-2 ring-[#1B3A6B]/40 border-[#1B3A6B]/30' : ''
                }`}
              >
                {/* Column header */}
                <div className="px-3.5 py-3 border-b border-[#EEF0F3] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: column.color }} />
                    <span className="text-[12px] font-semibold text-[#0F172A] truncate">{column.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono font-bold bg-white border border-[#E5E7EB] text-[#475569] px-2 py-0.5 rounded-full">{count}</span>
                    {column.id === 'capturado' && (
                      <button onClick={() => setIsCreateLeadOpen(true)} className="w-8 h-8 sm:w-5 sm:h-5 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 rounded-md bg-[#F1F3F6] hover:bg-[#1B3A6B] hover:text-white text-[#64748B] flex items-center justify-center text-[12px] font-bold transition-all" title="Adicionar lead">+</button>
                    )}
                  </div>
                </div>

                {/* Column body */}
                <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5 min-h-[280px]">
                  {columnLeads.map((lead, i) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, lead.id)}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={`bg-white border rounded-xl p-3 cursor-pointer hover:shadow-md hover:border-[#1B3A6B]/30 transition-all group ${
                        isWarning && lead.tags.some(t => t.includes('⚠')) ? 'border-[#F79009] bg-[rgba(247,144,9,0.06)]' : 'border-[#E5E7EB]'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                          {getInitials(lead.name)}
                        </div>
                        <div className="text-[12.5px] font-semibold text-[#0F172A] line-clamp-1 flex-1">{lead.name}</div>
                        <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                      <div className="text-[11px] text-[#475569] mb-1.5">{lead.profession}</div>
                      {lead.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {lead.tags.map((tag, j) => (
                            <span key={j} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              tag.includes('⚠') ? 'bg-[rgba(239,68,68,0.12)] text-[#DC2626]' :
                              tag.includes('Comissão') || tag.includes('Hoje') || tag.includes('Sex') || tag.includes('Qui') ? 'bg-[#ECFDF3] text-[#027A48]' :
                              tag.includes('trocas') ? 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' :
                              'bg-[#F1F3F6] text-[#475569]'
                            }`}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1.5 border-t border-[#EEF0F3]">
                        <span className={`text-[10.5px] ${lead.when === 'retornar hoje' ? 'text-[#DC2626] font-semibold' : 'text-[#64748B]'}`}>{lead.when}</span>
                        <span className="text-[10.5px] font-mono font-bold text-[#A56B0A]">{lead.fitScore}</span>
                      </div>
                    </div>
                  ))}

                  {columnLeads.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-[#D0D5DD] rounded-xl py-8">
                      <AlertCircle className="w-5 h-5 text-[#64748B] mb-1.5" />
                      <p className="text-[11px] text-[#64748B]">Nenhum card aqui</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table view */
        <div className="flex-1 overflow-auto bg-white border border-[#E5E7EB] rounded-xl shadow-sm">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#F8FAFC] border-b border-[#E5E7EB]">
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Lead</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Profissão</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">WhatsApp</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Cidade</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider text-center">Score</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider text-center">Rating</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Etapa</th>
                <th className="py-3 px-4 text-[11px] font-semibold text-[#64748B] uppercase tracking-wider">Data</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F3F6]">
              {visibleLeads.filter(applyFilter).sort((a, b) => b.fitScore - a.fitScore).map((lead, i) => {
                const col = COLUMNS.find(c => c.id === lead.stage);
                return (
                  <tr key={lead.id} onClick={() => setSelectedLeadId(lead.id)} className="hover:bg-[#F8FAFC] cursor-pointer transition-colors group">
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                          {getInitials(lead.name)}
                        </div>
                        <div>
                          <div className="text-[12.5px] font-semibold text-[#0F172A] group-hover:text-[#1B3A6B]">{lead.name}</div>
                          {lead.company && lead.company !== lead.name && (
                            <div className="text-[10.5px] text-[#64748B]">{lead.company}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-[12px] text-[#475569]">{lead.profession}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] text-[#475569] font-mono">{lead.phone}</span>
                        {lead.whatsappValid === true && <span className="w-2 h-2 bg-green-500 rounded-full" title="WhatsApp válido" />}
                        {lead.whatsappValid === false && <span className="w-2 h-2 bg-red-400 rounded-full" title="WhatsApp inválido" />}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-[12px] text-[#475569]">{lead.address?.city || '—'}</td>
                    <td className="py-2.5 px-4 text-center">
                      <span className={`text-[12px] font-mono font-bold px-2 py-0.5 rounded-full ${lead.fitScore >= 8 ? 'bg-[#ECFDF3] text-[#027A48]' : lead.fitScore >= 5 ? 'bg-[rgba(232,152,28,0.14)] text-[#A56B0A]' : 'bg-[#F1F3F6] text-[#64748B]'}`}>
                        {lead.fitScore}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {lead.googleRating ? (
                        <div className="flex items-center justify-center gap-1">
                          <Star className="w-3 h-3 text-[#F59E0B] fill-[#F59E0B]" />
                          <span className="text-[11px] font-semibold text-[#475569]">{lead.googleRating}</span>
                        </div>
                      ) : <span className="text-[11px] text-[#CBD5E1]">—</span>}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="text-[10.5px] font-semibold px-2 py-1 rounded-full" style={{ background: `${col?.color || '#64748B'}18`, color: col?.color || '#64748B' }}>
                        {col?.name || lead.stage}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-[11px] text-[#64748B]">{lead.when}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead Detail Drawer */}
      {selectedLeadId && (
        <LeadDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}

      {/* Create lead modal */}
      {isCreateLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/40 backdrop-blur-sm">
          <form onSubmit={handleCreateLead} className="bg-white border border-border rounded-2xl w-full max-w-[520px] p-6 space-y-5 shadow-2xl animate-scaleIn">
            <div className="flex justify-between items-start">
              <div><h3 className="text-base font-bold text-[#0F172A]">Adicionar lead</h3><p className="text-xs text-[#475569] mt-1">Cadastro manual direto no pipeline.</p></div>
              <button type="button" onClick={() => setIsCreateLeadOpen(false)} className="p-1 rounded-lg hover:bg-[#F1F3F6] text-[#64748B] hover:text-[#0F172A]"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input placeholder="Nome do contato" value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} className="h-10 text-xs" />
              <Input placeholder="Empresa" value={newLead.company} onChange={(e) => setNewLead({ ...newLead, company: e.target.value })} className="h-10 text-xs" />
              <Input placeholder="WhatsApp" value={newLead.whatsapp} onChange={(e) => setNewLead({ ...newLead, whatsapp: e.target.value })} className="h-10 text-xs" required />
              <Input placeholder="E-mail" type="email" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} className="h-10 text-xs" />
              <Input placeholder="Cidade" value={newLead.city} onChange={(e) => setNewLead({ ...newLead, city: e.target.value })} className="h-10 text-xs" />
              <Input placeholder="Faturamento" value={newLead.faturamento} onChange={(e) => setNewLead({ ...newLead, faturamento: e.target.value })} className="h-10 text-xs" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" onClick={() => setIsCreateLeadOpen(false)} className="bg-[#F1F3F6] hover:bg-[#E5E7EB] text-[#0F172A] border border-[#E5E7EB] text-xs font-semibold h-10 rounded-xl px-4">Cancelar</Button>
              <Button type="submit" disabled={isCreatingLead} className="bg-[#1B3A6B] hover:bg-[#142C52] text-white text-xs font-semibold h-10 rounded-xl px-4 disabled:opacity-50">{isCreatingLead ? 'Salvando...' : 'Salvar lead'}</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
