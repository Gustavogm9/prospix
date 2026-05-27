import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Badge, Drawer, toast } from '@prospix/ui';
import { Filter, Download, RefreshCw, User, Phone, DollarSign, MessageSquare, ChevronRight, Info } from 'lucide-react';
import { apiClient } from '../lib/api-client';
import { AxiosError } from 'axios';


interface Lead {
  id: string;
  name: string;
  phone: string;
  company: string;
  faturamento: string;
  fitScore: number;
  city: string;
  status: string;
  createdAt: string;
  profession?: string;
}

const mapBackendLead = (lead: any): Lead => {
  const metadata = lead.metadata || {};
  const address = lead.address || {};

  return {
    id: lead.id,
    name: lead.name || 'Sem nome',
    phone: lead.whatsapp || '',
    company: metadata.company || lead.name || 'N/A',
    faturamento: metadata.faturamento || 'N/A',
    fitScore: Number(lead.fitScore) || 0,
    city: address.city || 'N/A',
    status: lead.status || 'N/A',
    createdAt: lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('pt-BR') : 'N/A',
    profession: metadata.profession || '',
  };
};

const AVATAR_COLORS = ['#1B3A6B', '#5A2A82', '#B8740E', '#075E54', '#9E2A2B', '#1F4E5F', '#374151'];

const CATEGORY_CARDS = [
  { label: 'Médicos', filter: 'medicos', icon: '🏥', desc: 'Cardio, ortopedia, dermato, pediatria', bg: 'rgba(27,58,107,0.15)' },
  { label: 'Advogados', filter: 'advogados', icon: '⚖️', desc: 'Sócios de escritório, autônomos', bg: 'rgba(232,152,28,0.15)' },
  { label: 'Dentistas', filter: 'dentistas', icon: '🦷', desc: 'Clínica própria, sócios', bg: 'rgba(90,42,130,0.12)' },
  { label: 'Empresários', filter: 'empresarios', icon: '🏢', desc: '2-10 funcionários, dono ativo', bg: 'rgba(7,94,84,0.12)' },
];



export default function Leads() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [fitFilter, setFitFilter] = useState<'all' | 'medicos' | 'advogados' | 'dentistas' | 'empresarios'>('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const categoryCounts = {
    medicos: leads.filter(l => /méd|doctor|cardio|ortop|derm|pediat|cirurg|ginec/i.test(l.profession || '')).length,
    advogados: leads.filter(l => /advog|lawyer|oab/i.test(l.profession || '')).length,
    dentistas: leads.filter(l => /dent|cro|odont/i.test(l.profession || '')).length,
    empresarios: leads.filter(l => /empres|business|filial|loja|com[eé]rc/i.test(l.profession || '')).length,
  };

  const handleExportCsv = () => {
    if (leads.length === 0) {
      toast.error('Exportação indisponível', 'Não há leads carregados para exportar.');
      return;
    }

    const escapeCsv = (value: string | number) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const headers = ['ID', 'Empresa', 'Lead', 'Telefone', 'Faturamento', 'Fit Score', 'Cidade', 'Status', 'Cadastro'];
    const rows = leads.map((lead) => [
      lead.id, lead.company, lead.name, lead.phone, lead.faturamento, lead.fitScore, lead.city, lead.status, lead.createdAt,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success('CSV exportado', 'Arquivo gerado com os leads carregados na tela.');
  };

  const handleStartConversation = async () => {
    if (!selectedLead) return;
    setIsStartingChat(true);
    try {
      await apiClient.post('/tenant/conversations', { leadId: selectedLead.id });
      toast.success('Conversa criada', 'O lead está pronto para atendimento manual.');
      setSelectedLead(null);
      navigate('/conversas');
    } catch (error: unknown) {
      const message = error instanceof AxiosError
        ? error.response?.data?.message || 'Não foi possível criar a conversa para este lead.'
        : 'Não foi possível criar a conversa para este lead.';
      toast.error('Erro ao iniciar conversa', message);
    } finally {
      setIsStartingChat(false);
    }
  };

  // Debounce logic for search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    const fetchLeads = async () => {
      setIsLoading(true);
      try {
        const profMap: Record<string, string> = {
          medicos: 'DOCTOR', advogados: 'LAWYER', dentistas: 'DENTIST', empresarios: 'BUSINESS_OWNER'
        };
        const response = await apiClient.get('/tenant/leads', {
          params: {
            search: debouncedSearch || undefined,
            profession: fitFilter !== 'all' ? profMap[fitFilter] : undefined,
            limit: 50,
          }
        });

        if (response?.data) {
          const list = Array.isArray(response.data) ? response.data : response.data.data;
          const mapped = (list || []).map(mapBackendLead);
          setLeads(mapped);
          setNextCursor(response.data.nextCursor || null);
        } else {
          setLeads([]);
        }
      } catch (err) {
        console.error(err);
        setLeads([]);
        toast.error('Erro de Conexão', 'Não foi possível carregar os leads.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeads();
  }, [debouncedSearch, fitFilter]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const profMap: Record<string, string> = {
        medicos: 'DOCTOR', advogados: 'LAWYER', dentistas: 'DENTIST', empresarios: 'BUSINESS_OWNER'
      };
      const response = await apiClient.get('/tenant/leads', {
        params: {
          search: debouncedSearch || undefined,
          profession: fitFilter !== 'all' ? profMap[fitFilter] : undefined,
          limit: 50,
          cursor: nextCursor,
        }
      });
      const list = Array.isArray(response.data) ? response.data : response.data?.data;
      const mapped = (list || []).map(mapBackendLead);
      setLeads(prev => [...prev, ...mapped]);
      setNextCursor(response.data.nextCursor || null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>{leads.length} leads capturados pela IA</strong>, organizados por especialidade. Cada um tem WhatsApp validado, fit score e está em alguma etapa do funil.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <button onClick={() => setFitFilter('all')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${fitFilter === 'all' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Todos · {leads.length}</button>
        <button onClick={() => setFitFilter('medicos')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${fitFilter === 'medicos' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Médicos · {categoryCounts.medicos}</button>
        <button onClick={() => setFitFilter('advogados')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${fitFilter === 'advogados' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Advogados · {categoryCounts.advogados}</button>
        <button onClick={() => setFitFilter('dentistas')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${fitFilter === 'dentistas' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Dentistas · {categoryCounts.dentistas}</button>
        <button onClick={() => setFitFilter('empresarios')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${fitFilter === 'empresarios' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Empresários · {categoryCounts.empresarios}</button>
        <div className="w-px h-6 bg-[#E5E7EB] mx-1" />
        <button className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1.5">
          <Filter className="w-3 h-3" /> Filtros (3)
        </button>
        <button onClick={handleExportCsv} className="h-8 px-3 rounded-md text-[12px] font-medium text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6] flex items-center gap-1.5">
          <Download className="w-3 h-3" /> Exportar CSV
        </button>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar lead..." className="ml-auto h-8 px-3 rounded-md text-[12px] border border-[#E5E7EB] bg-white text-[#0F172A] placeholder-[#94A3B8] focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] outline-none w-48" />
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {CATEGORY_CARDS.map((cat, i) => (
          <div key={i} onClick={() => setFitFilter(cat.filter as any)} className={`bg-white border rounded-xl p-4 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md shadow-sm ${fitFilter === cat.filter ? 'border-[#1B3A6B] ring-1 ring-[#1B3A6B]' : 'border-[#E5E7EB] hover:border-[#1B3A6B]'}`}>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-lg" style={{ background: cat.bg }}>{cat.icon}</div>
            <div className="text-[28px] font-bold text-[#0F172A] font-mono leading-none tracking-tight">{(categoryCounts as any)[cat.filter] || 0}</div>
            <div className="text-[13.5px] font-semibold text-[#0F172A] mt-1.5">{cat.label}</div>
            <div className="text-[12px] text-[#475569] mt-1">{cat.desc}</div>
          </div>
        ))}
      </div>

      {/* Leads list panel */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-[#0F172A]">Leads capturados hoje</div>
            <div className="text-[11px] text-[#94A3B8] mt-0.5">{leads.length} leads carregados{nextCursor ? ' · mais disponíveis' : ''}</div>
          </div>
          <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48] flex items-center gap-1.5">
            <span className="w-[5px] h-[5px] rounded-full bg-[#039855] animate-pulse" />
            Capturando
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <RefreshCw className="w-5 h-5 animate-spin text-[#94A3B8] mx-auto mb-2" />
            <div className="text-[12px] text-[#94A3B8]">Carregando leads...</div>
          </div>
        ) : leads.length > 0 ? (
          leads.map((lead, i) => (
            <div
              key={lead.id}
              className="px-5 py-3.5 border-b border-[#EEF0F3] flex items-center gap-3 cursor-pointer transition-all hover:bg-[rgba(27,58,107,0.04)] border-l-[3px] border-l-transparent hover:border-l-[#1B3A6B]"
              onClick={() => setSelectedLead(lead)}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {getInitials(lead.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-[#0F172A] flex items-center gap-2 flex-wrap">
                  {lead.name}
                  <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-[rgba(27,58,107,0.08)] text-[#1B3A6B]">{lead.status}</span>
                </div>
                <div className="text-[11.5px] text-[#475569]">{lead.profession || lead.company} · {lead.city}</div>
              </div>
              <div className="text-right shrink-0 min-w-[70px]">
                <div className="text-[11.5px] font-semibold text-[#0F172A]">{lead.createdAt}</div>
                <div className="text-[11px] text-[#94A3B8] mt-0.5">Fit {lead.fitScore}</div>
              </div>
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#F1F3F6] text-[#94A3B8] shrink-0 hover:bg-[#1B3A6B] hover:text-white transition-all">
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          ))
        ) : (
          <div className="p-12 text-center text-[12.5px] text-[#94A3B8]">Nenhum lead encontrado com os filtros selecionados.</div>
        )}

        {leads.length > 0 && (
          <div className="px-5 py-3 bg-[#F1F3F6] border-t border-[#EEF0F3] flex items-center justify-between">
            <span className="text-[12px] text-[#475569]">
              Mostrando {leads.length} leads
            </span>
            {nextCursor && (
              <button onClick={loadMore} disabled={isLoadingMore} className="text-[12px] font-semibold text-[#1B3A6B] hover:underline disabled:opacity-50">
                {isLoadingMore ? 'Carregando...' : 'Carregar mais →'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Lead Drawer */}
      {selectedLead && (
        <Drawer
          isOpen={!!selectedLead}
          onClose={() => setSelectedLead(null)}
          title="Ficha Cadastral da Lead"
        >
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-text">{selectedLead.name}</h3>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 border rounded-full ${
                  selectedLead.fitScore >= 8.0 
                    ? 'bg-success-soft text-success-text border-success/20' 
                    : 'bg-surface-sunken text-text-secondary border-border/80'
                }`}>
                  {selectedLead.fitScore} Fit Score
                </span>
              </div>
            </div>
            <div className="bg-surface-sunken p-4 border border-border rounded-xl space-y-3.5">
              <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Dados de Contato</span>
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-3"><User className="w-4 h-4 text-text-secondary shrink-0" /><div><p className="text-[10px] text-text-secondary mb-0.5">Representante</p><p className="text-text font-medium">{selectedLead.name}</p></div></div>
                <div className="flex items-center gap-3"><Phone className="w-4 h-4 text-text-secondary shrink-0" /><div><p className="text-[10px] text-text-secondary mb-0.5">WhatsApp</p><p className="text-text font-mono font-medium">{selectedLead.phone}</p></div></div>
                <div className="flex items-center gap-3"><DollarSign className="w-4 h-4 text-text-secondary shrink-0" /><div><p className="text-[10px] text-text-secondary mb-0.5">Faturamento</p><p className="text-text font-medium">{selectedLead.faturamento}</p></div></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-sunken p-3.5 border border-border rounded-xl">
                <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Estágio</span>
                <Badge className="bg-white border border-border text-text-secondary text-[10px] px-2 py-0.5 mt-1">{selectedLead.status}</Badge>
              </div>
              <div className="bg-surface-sunken p-3.5 border border-border rounded-xl">
                <span className="text-[9px] font-semibold text-text-secondary uppercase tracking-wider block">Cidade</span>
                <p className="text-xs text-text font-medium mt-1">{selectedLead.city}</p>
              </div>
            </div>
            <div className="pt-4 border-t border-border/60">
              <Button className="w-full bg-primary hover:bg-primary-hover text-white font-semibold h-11 rounded-xl transition-all shadow-lg shadow-primary/10 flex items-center justify-center gap-2 disabled:opacity-50" disabled={isStartingChat} onClick={handleStartConversation}>
                <MessageSquare className="w-4 h-4" />
                <span>{isStartingChat ? 'Abrindo conversa...' : 'Iniciar Chat de Prospecção'}</span>
              </Button>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
