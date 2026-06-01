'use client';

import { Info, MapPin, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@prospix/ui';

interface LeadSource {
  id: string;
  name: string;
  description: string;
  profession: string;
  cities: string[];
  status: 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'ARCHIVED';
  dailyLimit: number;
  icon: string;
}

const PROF_ICONS: Record<string, string> = {
  DOCTOR: '🏥', LAWYER: '⚖️', DENTIST: '🦷', BUSINESS_OWNER: '🏢', OTHER: '📋',
};

export default function LeadSources() {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [leadsCount, setLeadsCount] = useState(0);
  const [leadsByCampaign, setLeadsByCampaign] = useState<Record<string, number>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const campaignsRes = await apiClient.get('/tenant/campaigns');
        const camps = Array.isArray(campaignsRes.data) ? campaignsRes.data : campaignsRes.data?.data ?? [];
        
        setSources(camps.map((c: any) => ({
          id: c.id,
          name: c.name,
          description: `${c.cities?.join(', ') || '—'} · Meta: ${c.dailyLimit}/dia`,
          profession: c.profession || 'OTHER',
          cities: c.cities || [],
          status: c.status,
          dailyLimit: c.dailyLimit || 0,
          icon: PROF_ICONS[c.profession] || '📋',
        })));

        // Use _count from campaign response or totalCaptured field
        const counts: Record<string, number> = {};
        let total = 0;
        camps.forEach((c: any) => {
          const cnt = c._count?.leads ?? c.totalCaptured ?? c.leadsCount ?? 0;
          counts[c.id] = cnt;
          total += cnt;
        });
        setLeadsByCampaign(counts);
        setLeadsCount(total);
      } catch (err) {
        console.error('Failed to fetch lead sources', err);
        toast.error('Erro ao carregar', 'Não foi possível carregar as fontes de leads.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = filter === 'all' ? sources : sources.filter(s => 
    filter === 'active' ? s.status === 'ACTIVE' : s.status === 'PAUSED' || s.status === 'DRAFT'
  );

  const activeCount = sources.filter(s => s.status === 'ACTIVE').length;
  const pausedCount = sources.filter(s => s.status !== 'ACTIVE').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-60">
        <Loader2 className="w-6 h-6 text-[#1B3A6B] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Info banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <MapPin className="w-4 h-4 text-[#1B3A6B] shrink-0" />
        <div><strong>Fontes de leads ativas.</strong> Cada campanha de prospecção funciona como uma fonte que captura leads automaticamente por profissão + cidade.</div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-[#E5E7EB] rounded-lg p-2.5 flex items-center gap-2 flex-wrap shadow-sm">
        <button onClick={() => setFilter('all')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'all' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Todas · {sources.length}</button>
        <button onClick={() => setFilter('active')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'active' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Ativas · {activeCount}</button>
        <button onClick={() => setFilter('paused')} className={`h-8 px-3 rounded-md text-[12px] font-medium ${filter === 'paused' ? 'bg-[#1B3A6B] text-white' : 'text-[#475569] border border-[#E5E7EB] hover:bg-[#F1F3F6]'}`}>Pausadas · {pausedCount}</button>
        <span className="text-[11px] text-[#64748B] ml-auto">{leadsCount} leads capturados no total</span>
      </div>

      {/* Sources grid */}
      <div className="space-y-3">
        {filtered.map(src => {
          const isActive = src.status === 'ACTIVE';
          return (
            <div key={src.id} className={`bg-white border rounded-xl p-4 flex items-center gap-4 transition-all hover:-translate-y-0.5 hover:shadow-md cursor-pointer ${isActive ? 'border-[#E5E7EB] hover:border-[#1B3A6B]' : 'border-[#F1F3F6] opacity-60'}`}>
              <div className="w-11 h-11 rounded-lg bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] flex items-center justify-center text-xl shrink-0">
                {src.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-[#0F172A] mb-0.5">{src.name}</div>
                <div className="text-[12px] text-[#64748B]">{src.description}</div>
                <div className="text-[11px] text-[#1B3A6B] font-medium mt-0.5">{leadsByCampaign[src.id] || 0} leads capturados</div>
              </div>
              <div className="flex items-center gap-3">
                {isActive ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48] flex items-center gap-1.5">
                    <span className="w-[5px] h-[5px] rounded-full bg-[#039855] animate-pulse" />
                    Ativa
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F1F3F6] text-[#64748B]">
                    {src.status === 'PAUSED' ? 'Pausada' : 'Rascunho'}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="flex items-center gap-2 px-4 py-6 bg-[rgba(27,58,107,0.04)] rounded-xl text-[12px] text-[#475569] justify-center">
            <Info className="w-4 h-4 text-[#1B3A6B] shrink-0" />
            Nenhuma fonte de leads encontrada. Crie campanhas em "Campanhas" para começar a capturar leads.
          </div>
        )}
      </div>
    </div>
  );
}
