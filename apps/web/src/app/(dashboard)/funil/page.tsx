'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, toast } from '@prospix/ui';
import { AlertCircle, X, Info, Columns, LayoutList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { AxiosError } from 'axios';

interface LeadCard {
  id: string;
  name: string;
  phone: string;
  company: string;
  profession: string;
  fitScore: number;
  stage: 'capturado' | 'contatado' | 'qualificado' | 'agendado' | 'negociacao' | 'fechado';
  when: string;
  tags: string[];
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
  CONTACTED: 'contatado',
  QUALIFIED: 'qualificado',
  MEETING_SCHEDULED: 'agendado',
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
  const rawData = (lead.sourceRawData || {}) as Record<string, any>;
  const stage = STATUS_TO_STAGE[lead.status] || 'capturado';
  return {
    id: lead.id,
    name: lead.name || 'Sem nome',
    phone: lead.whatsapp || '',
    company: metadata.cnpj_info?.nomeFantasia || metadata.cnpj_info?.razaoSocial || rawData.name || lead.name || '',
    profession: lead.profession ? (PROFESSION_LABELS_PIPE[lead.profession] || lead.profession) : '',
    fitScore: Number(lead.fitScore) || 0,
    stage,
    when: lead.createdAt ? new Date(lead.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
    tags: [],
  };
};

export default function PipelinePage() {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadCard[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null);
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [filter, setFilter] = useState('all');
  const [newLead, setNewLead] = useState({ name: '', company: '', whatsapp: '', email: '', city: '', faturamento: '' });

  const fetchLeads = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await apiClient.get('/tenant/leads', { signal });
      if (signal?.aborted) return;
      const list = Array.isArray(response.data) ? response.data : response.data?.data;
      setLeads((list || []).map(mapBackendLeadToCard));
    } catch (error) {
      if (signal?.aborted) return;
      console.error('Error fetching pipeline leads:', error);
      setLeads([]);
      toast.error('Erro de Conexão', 'Não foi possível carregar o pipeline.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLeads(controller.signal);
    return () => controller.abort();
  }, [fetchLeads]);

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
    const lead = leads.find(l => l.id === id);
    if (!lead || lead.stage === targetStage) return;
    const originalStage = lead.stage;
    setLeads(leads.map(l => l.id === id ? { ...l, stage: targetStage } : l));
    try {
      await apiClient.patch(`/tenant/leads/${id}`, { status: STAGE_TO_STATUS[targetStage] });
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
    setIsCreatingLead(true);
    try {
      await apiClient.post('/tenant/leads', {
        name: newLead.name.trim() || newLead.company.trim() || undefined,
        whatsapp: newLead.whatsapp.trim(),
        email: newLead.email.trim() || undefined,
        address: newLead.city.trim() ? { city: newLead.city.trim() } : undefined,
        metadata: { company: newLead.company.trim() || undefined, faturamento: newLead.faturamento.trim() || undefined, source: 'pipeline_manual' },
      });
      toast.success('Lead criado', 'O novo lead entrou no pipeline.');
      setIsCreateLeadOpen(false);
      setNewLead({ name: '', company: '', whatsapp: '', email: '', city: '', faturamento: '' });
      await fetchLeads();
    } catch (error: unknown) {
      const message = error instanceof AxiosError ? error.response?.data?.message || 'Erro ao salvar.' : 'Erro ao salvar.';
      toast.error('Erro ao criar lead', message);
    } finally { setIsCreatingLead(false); }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-4 h-[calc(100dvh-120px)] flex flex-col animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A] shrink-0">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Arraste os cards entre colunas</strong> para mover o lead no funil. Clique em qualquer card para ver detalhes. A IA atualiza automaticamente conforme avança a conversa.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm shrink-0">
        {['all', 'semana', 'medicos', 'advogados', 'empresarios'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`h-8 min-h-[44px] sm:min-h-0 px-3 rounded-md text-[12px] font-medium ${filter === f ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>
            {f === 'all' ? 'Todos os leads' : f === 'semana' ? 'Esta semana' : f === 'medicos' ? 'Médicos' : f === 'advogados' ? 'Advogados' : 'Empresários'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 bg-[#F1F3F6] p-0.5 rounded-lg border border-[#E5E7EB]">
          <button onClick={() => router.push('/conversas')} className="h-7 px-2.5 rounded text-[11px] font-semibold text-[#475569] flex items-center gap-1 hover:bg-white transition-all">
            <LayoutList className="w-3 h-3" /> Tabela
          </button>
          <button className="h-7 px-2.5 rounded text-[11px] font-semibold bg-white text-[#0F172A] flex items-center gap-1 shadow-sm">
            <Columns className="w-3 h-3" /> Kanban
          </button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 flex gap-3 overflow-x-auto pb-4 items-stretch select-none snap-x snap-mandatory scroll-pl-2.5">
        {COLUMNS.map((column) => {
          const columnLeads = leads.filter(l => l.stage === column.id);
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
                    className={`bg-white border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group ${
                      isWarning && lead.tags.some(t => t.includes('⚠')) ? 'border-[#F79009] bg-[rgba(247,144,9,0.06)]' : 'border-[#E5E7EB]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                        {getInitials(lead.name)}
                      </div>
                      <div className="text-[12.5px] font-semibold text-[#0F172A] line-clamp-1">{lead.name}</div>
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
