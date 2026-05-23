import React, { useState, useEffect } from 'react';
import { Button, toast } from '@prospix/ui';
import { Phone, DollarSign, Calendar, AlertCircle, Flame, Plus } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { canUseMockFallbacks } from '../lib/demo-mode';

interface LeadCard {
  id: string;
  name: string;
  phone: string;
  company: string;
  faturamento: string;
  fitScore: number;
  stage: 'capturado' | 'contatado' | 'qualificado' | 'agendado' | 'negociacao' | 'fechado';
  createdAt: string;
}

const COLUMNS = [
  { id: 'capturado', name: 'Capturado', color: 'border-t-blue-500 bg-blue-50/20' },
  { id: 'contatado', name: '1ª msg', color: 'border-t-indigo-500 bg-indigo-50/20' },
  { id: 'qualificado', name: 'Em conversa', color: 'border-t-purple-500 bg-purple-50/20' },
  { id: 'agendado', name: 'Aguardando você', color: 'border-t-cyan-500 bg-cyan-50/20' },
  { id: 'negociacao', name: 'Agendada', color: 'border-t-amber-500 bg-amber-50/20' },
  { id: 'fechado', name: 'Fechado', color: 'border-t-emerald-500 bg-emerald-50/20' },
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

const MOCK_LEADS: LeadCard[] = [
  { id: '1', name: 'Marcos de Oliveira', phone: '+55 11 98888-7777', company: 'Oliveira Consultoria', faturamento: 'R$ 150k/mês', fitScore: 9.4, stage: 'qualificado', createdAt: '21/05 09:30' },
  { id: '2', name: 'Ana Beatriz Reis', phone: '+55 21 97777-6666', company: 'Reis Arquitetura', faturamento: 'R$ 80k/mês', fitScore: 8.8, stage: 'contatado', createdAt: '20/05 10:15' },
  { id: '3', name: 'Metalúrgica Alfa', phone: '+55 19 96666-5555', company: 'Alfa Ltda', faturamento: 'R$ 450k/mês', fitScore: 8.5, stage: 'capturado', createdAt: '21/05 08:20' },
  { id: '4', name: 'Dra. Julia Silveira', phone: '+55 31 95555-4444', company: 'Clinica Silveira', faturamento: 'R$ 60k/mês', fitScore: 7.2, stage: 'agendado', createdAt: '19/05 14:00' },
  { id: '5', name: 'Supermercado Central', phone: '+55 11 94444-3333', company: 'Central Alimentos', faturamento: 'R$ 1.2M/mês', fitScore: 9.9, stage: 'negociacao', createdAt: '18/05 11:30' },
  { id: '6', name: 'Consultório Dr. Pedro', phone: '+55 11 93333-2222', company: 'Odonto Pedro', faturamento: 'R$ 40k/mês', fitScore: 6.8, stage: 'fechado', createdAt: '15/05 16:45' },
];

const mapBackendLeadToCard = (lead: any): LeadCard => {
  const metadata = lead.metadata || {};
  const stage = STATUS_TO_STAGE[lead.status] || 'capturado';

  return {
    id: lead.id,
    name: lead.name || 'Sem nome',
    phone: lead.whatsapp || '',
    company: metadata.company || lead.name || 'N/A',
    faturamento: metadata.faturamento || 'N/A',
    fitScore: Number(lead.fitScore) || 0,
    stage,
    createdAt: lead.createdAt ? new Date(lead.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'N/A',
  };
};

export default function Pipeline() {
  const [leads, setLeads] = useState<LeadCard[]>([]);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<string | null>(null);
  const [activeMobileColumn, setActiveMobileColumn] = useState<string>('capturado');

  useEffect(() => {
    const fetchLeads = async () => {
      try {
        const response = await apiClient.get('/tenant/leads');
        const list = Array.isArray(response.data) ? response.data : response.data?.data;
        setLeads((list || []).map(mapBackendLeadToCard));
      } catch (error) {
        console.error('Error fetching pipeline leads:', error);
        if (canUseMockFallbacks) {
          setLeads(MOCK_LEADS);
        } else {
          setLeads([]);
          toast.error('Erro de Conexão', 'Não foi possível carregar o pipeline real da API.');
        }
      }
    };

    fetchLeads();
  }, []);

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
    const updatedLeads = leads.map(l => l.id === id ? { ...l, stage: targetStage } : l);
    setLeads(updatedLeads);

    toast.info('Atualizando estágio', `Movendo ${lead.name} para ${COLUMNS.find(c => c.id === targetStage)?.name}...`);

    try {
      await apiClient.patch(`/tenant/leads/${id}`, { status: STAGE_TO_STATUS[targetStage] });
      toast.success('Sucesso', 'Estágio atualizado no servidor.');
    } catch (error) {
      setLeads(leads.map(l => l.id === id ? { ...l, stage: originalStage } : l));
      toast.error('Falha na conexão', 'Erro ao salvar alterações no servidor.');
    } finally {
      setDraggedId(null);
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-120px)] flex flex-col animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold font-heading text-text tracking-tight">Pipeline de Negócios</h2>
          <p className="text-text-secondary text-sm mt-1">Gerencie suas apólices arrastando os cards entre as etapas do funil.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={!canUseMockFallbacks}
            title={!canUseMockFallbacks ? 'Use a base de leads ou integrações para criar leads reais.' : undefined}
            onClick={() => {
              if (canUseMockFallbacks) {
                toast.info('Modo demo', 'A criação manual de lead não é executada nesta visualização.');
              }
            }}
            className="bg-white border border-border text-text-secondary hover:text-text text-xs font-semibold px-4 h-10 rounded-xl flex items-center gap-2 hover:bg-surface-sunken disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4 text-primary" />
            <span>Adicionar Lead</span>
          </Button>
        </div>
      </div>

      <div className="flex md:hidden overflow-x-auto gap-1 p-1 bg-surface-sunken border border-border rounded-xl shrink-0">
        {COLUMNS.map(col => (
          <button
            key={col.id}
            onClick={() => setActiveMobileColumn(col.id)}
            className={`text-xs px-3 py-1.5 rounded-lg font-bold whitespace-nowrap transition-all ${
              activeMobileColumn === col.id ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text'
            }`}
          >
            {col.name} ({leads.filter(l => l.stage === col.id).length})
          </button>
        ))}
      </div>

      <div className="flex-1 flex gap-4 overflow-x-auto pb-4 items-stretch select-none">
        {COLUMNS.map((column) => {
          const columnLeads = leads.filter(l => l.stage === column.id);
          const totalValue = columnLeads.length;

          return (
            <div
              key={column.id}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={() => setIsDraggingOver(null)}
              onDrop={(e) => handleDrop(e, column.id)}
              className={`w-full md:w-[260px] rounded-2xl border border-border flex flex-col shrink-0 transition-all ${column.color} ${
                activeMobileColumn === column.id ? 'flex' : 'hidden md:flex'
              } ${
                isDraggingOver === column.id ? 'ring-2 ring-primary/40 border-primary/30' : ''
              }`}
            >
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    column.id === 'fechado' ? 'bg-success' : column.id === 'negociacao' ? 'bg-warning' : 'bg-primary'
                  }`} />
                  <h3 className="text-xs font-bold text-text uppercase tracking-wider">{column.name}</h3>
                </div>
                <span className="text-[10px] font-mono font-bold bg-white border border-border text-text-secondary px-2 py-0.5 rounded-full">
                  {totalValue}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[300px]">
                {columnLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lead.id)}
                    className="bg-white border border-border hover:border-border-strong rounded-xl p-3.5 space-y-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group relative overflow-hidden shadow-sm"
                  >
                    {lead.fitScore >= 8.5 && (
                      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-success" />
                    )}

                    <div className="flex justify-between items-start gap-2">
                      <h4 className="text-xs font-bold text-text transition-colors line-clamp-1">
                        {lead.name}
                      </h4>
                      {lead.fitScore >= 8.5 && (
                        <Flame className="w-3.5 h-3.5 text-orange-500 shrink-0 fill-orange-500" />
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[10px] text-text-secondary leading-none truncate font-medium">{lead.company}</p>
                      <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                        <Phone className="w-3 h-3 text-text-secondary/70 font-mono" />
                        <span className="font-mono truncate">{lead.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                        <DollarSign className="w-3 h-3 text-text-secondary/70" />
                        <span>Faturamento: {lead.faturamento}</span>
                      </div>
                    </div>

                    <div className="block md:hidden pt-1">
                      <select
                        value={lead.stage}
                        onChange={(e) => {
                          const target = e.target.value as LeadCard['stage'];
                          handleMoveLead(lead.id, target);
                        }}
                        className="w-full bg-surface-sunken border border-border text-[10px] rounded-lg px-2 py-1 text-text-secondary font-semibold focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      >
                        {COLUMNS.map(col => (
                          <option key={col.id} value={col.id}>
                            Mover para: {col.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="pt-2 border-t border-border/65 flex items-center justify-between">
                      <div className="flex items-center gap-1 text-[9px] text-text-secondary">
                        <Calendar className="w-2.5 h-2.5" />
                        <span>{lead.createdAt}</span>
                      </div>
                      <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        lead.fitScore >= 8.5 ? 'bg-success-soft text-success-text' : 'bg-surface-sunken text-text-secondary'
                      }`}>
                        {lead.fitScore} Fit
                      </span>
                    </div>
                  </div>
                ))}

                {columnLeads.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 border border-dashed border-border rounded-xl py-12">
                    <AlertCircle className="w-6 h-6 text-text-secondary/60 mb-1.5" />
                    <p className="text-[10px] text-text-secondary">Nenhum card aqui</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
