'use client';

import { Star, Copy, Users, Loader2, ChevronRight, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { referralsQueries, leadsQueries } from '@/lib/queries';
import { toast, Badge } from '@prospix/ui';
import { useAuthStore } from '@/store/auth-store';

interface Referral {
  id: string;
  name: string;
  status: string;
  phone: string;
  createdAt: string;
}

const BROKER_STEPS = [
  { step: '1', title: 'Indique um corretor', desc: 'Compartilhe seu link de indicação' },
  { step: '2', title: 'Ele se cadastra', desc: 'E começa a usar o Prospix' },
  { step: '3', title: 'Vocês ganham', desc: 'Ambos recebem 30 dias grátis' },
  { step: '4', title: 'Upgrade', desc: 'A cada 5 indicações, ganhe mais benefícios' },
];

const CLIENT_STEPS = [
  { step: '1', title: 'Reunião fechada', desc: 'Apólice fechada ou 2ª reunião marcada' },
  { step: '2', title: 'IA agradece (24h depois)', desc: 'Mensagem natural de follow-up' },
  { step: '3', title: 'Pede 2-3 indicações', desc: '"Tem sócios/colegas no mesmo perfil?"' },
  { step: '4', title: 'Aborda os indicados', desc: '"Fulano me passou seu contato" - 3x mais' },
];

type Tab = 'CLIENTS' | 'BROKERS';

export default function ReferralsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('CLIENTS');
  
  // -- Broker State
  const [brokerReferrals, setBrokerReferrals] = useState<Referral[]>([]);
  const [loadingBrokers, setLoadingBrokers] = useState(false);
  const [stats, setStats] = useState({ totalClicks: 0, totalSignups: 0, conversionRate: 0 });
  const [rewardTier, setRewardTier] = useState<string>('bronze');
  
  // -- Client State
  const [clientReferrals, setClientReferrals] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const { tenantId, user } = useAuthStore();
  const refCode = tenantId ? tenantId.substring(0, 8) : (user?.id?.substring(0, 8) || 'default');
  const referralLink = typeof window !== 'undefined' ? `${window.location.origin}/ref/${refCode}` : '';

  useEffect(() => {
    if (activeTab === 'BROKERS') {
      fetchBrokerReferrals();
    } else {
      fetchClientReferrals();
    }
  }, [activeTab, user?.id, tenantId]);

  const fetchBrokerReferrals = async () => {
    if (!user?.id) return;
    setLoadingBrokers(true);
    try {
      await referralsQueries.registerCode(user.id, refCode).catch(() => {});
      const result = await referralsQueries.get(user.id);
      if (result.data) {
        const partnerCode = result.data.partner_code || refCode;
        const referredResult = await referralsQueries.listReferred(partnerCode);
        const referred = referredResult.data || [];
        const totalSignups = referred.length;
        const conversionRate = totalSignups > 0 ? Math.round((totalSignups / Math.max(totalSignups, 1)) * 100) : 0;

        setStats({ totalClicks: 0, totalSignups, conversionRate });
        setRewardTier(totalSignups >= 20 ? 'gold' : totalSignups >= 10 ? 'silver' : 'bronze');
        setBrokerReferrals(referred.map((u: any) => ({
          id: u.id,
          name: u.name || 'Sem nome',
          status: 'QUALIFIED',
          phone: u.whatsapp || '',
          createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—',
        })));
      }
    } catch (err) {
      toast.error('Erro ao carregar', 'Não foi possível carregar indicações.');
    } finally {
      setLoadingBrokers(false);
    }
  };

  const fetchClientReferrals = async () => {
    if (!tenantId) return;
    setLoadingClients(true);
    try {
      const { data, error } = await leadsQueries.listClientReferrals(tenantId);
      if (!error && data) {
        setClientReferrals(data);
      }
    } catch (err) {
      toast.error('Erro', 'Não foi possível carregar as indicações de clientes.');
    } finally {
      setLoadingClients(false);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    toast.success('Link copiado!', 'Compartilhe com corretores que você conhece.');
  };

  // UI Components
  const renderClientTab = () => (
    <div className="space-y-5 animate-fadeIn">
      {/* Banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#F8F9FB] border border-[#EEF0F3] rounded-xl text-[12.5px] text-[#475569]">
        <Star className="w-4 h-4 text-[#64748B] shrink-0" />
        <div><strong>*Todo cliente vem por recomendação*</strong> — você falou na rede. A IA dispara loop pós-reunião pedindo 2-3 indicações. Aqui está o resultado.</div>
      </div>

      {/* How it works */}
      <div>
        <h3 className="text-[14px] font-bold text-[#0F172A] mb-3">Como o loop de indicações funciona</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CLIENT_STEPS.map(s => (
            <div key={s.step} className="bg-white border border-[#E5E7EB] rounded-xl p-4 text-center shadow-sm">
              <div className="w-8 h-8 rounded-full bg-[#1B3A6B] text-white font-bold text-[13px] flex items-center justify-center mx-auto mb-2">{s.step}</div>
              <div className="text-[12.5px] font-bold text-[#0F172A]">{s.title}</div>
              <div className="text-[11px] text-[#64748B] mt-0.5">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-[#EEF0F3] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-bold text-[#0F172A] flex items-center gap-2">
              {clientReferrals.length} indicações recebidas
            </h3>
            <p className="text-[12px] text-[#64748B] mt-0.5">Indicações têm taxa de fechamento 3x maior que prospecção fria</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[#ECFDF3] border border-[#D1FADF] rounded-full text-[11px] font-bold text-[#027A48]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#12B76A]"></div>
            Loop ativo
          </div>
        </div>

        {loadingClients ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-[#1B3A6B] animate-spin" /></div>
        ) : clientReferrals.length > 0 ? (
          <div className="divide-y divide-[#EEF0F3]">
            {clientReferrals.map((lead: any) => {
              const referredBy = (lead.metadata as any)?.referred_by_name || 'Alguém';
              const isConversing = lead.status === 'CONVERSING';
              return (
                <div key={lead.id} className="px-5 py-4 hover:bg-[#F8F9FB] transition-colors flex items-center justify-between group">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#1B3A6B] text-white font-bold text-[13px] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                      {lead.name ? lead.name.split(' ').map((n: string) => n[0]).join('').substring(0,2).toUpperCase() : '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[14px] font-bold text-[#0F172A]">{lead.name || 'Sem nome'}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ECFDF3] text-[#027A48]">
                          Indicado por {referredBy}
                        </span>
                      </div>
                      <div className="text-[12px] text-[#64748B] mb-1.5">
                        {lead.profession ? lead.profession.replace('_', ' ') : 'Profissão não informada'} {lead.age_estimate ? `· ${lead.age_estimate} anos` : ''}
                      </div>
                      <div className="text-[12px] italic text-[#475569] flex items-center gap-1">
                        {isConversing ? (
                          <Badge className="bg-[#FEF9F0] text-[#B8740E] border-[#FDEBCE] text-[9px] px-1.5 py-0">✦ IA conversando</Badge>
                        ) : (
                          `"Oi! O ${referredBy.split(' ')[0]} me recomendou falar com você..."`
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 text-right">
                    <div className="hidden sm:block">
                      <div className="text-[12px] font-semibold text-[#0F172A]">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                      </div>
                      {lead.fit_score !== null && (
                        <div className="text-[11px] text-[#64748B] mt-0.5">Fit {lead.fit_score.toFixed(1)}</div>
                      )}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-white border border-[#E5E7EB] flex items-center justify-center text-[#94A3B8] group-hover:border-[#CBD5E1] group-hover:text-[#1B3A6B] transition-colors cursor-pointer shadow-sm">
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-10 text-center">
            <MessageSquare className="w-10 h-10 text-[#CBD5E1] mx-auto mb-3" />
            <h4 className="text-[14px] font-bold text-[#0F172A]">Nenhuma indicação de cliente ainda</h4>
            <p className="text-[12px] text-[#64748B] mt-1 max-w-sm mx-auto">Feche reuniões para que a IA possa ativar o loop pós-reunião e pedir indicações aos seus novos clientes.</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderBrokerTab = () => (
    <div className="space-y-5 animate-fadeIn">
      {/* Banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-[rgba(27,58,107,0.04)] to-[rgba(232,152,28,0.06)] border border-[rgba(27,58,107,0.08)] rounded-xl text-[12.5px] text-[#0F172A]">
        <Star className="w-4 h-4 text-[#E8981C] shrink-0" />
        <div><strong>Programa de Indicações.</strong> Indique colegas corretores e ganhe benefícios exclusivos no Prospix.</div>
      </div>

      {/* How it works */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {BROKER_STEPS.map(s => (
          <div key={s.step} className="bg-white border border-[#E5E7EB] rounded-xl p-4 text-center hover:-translate-y-0.5 transition-all shadow-sm">
            <div className="w-8 h-8 rounded-full bg-[rgba(27,58,107,0.08)] text-[#1B3A6B] font-bold text-[13px] flex items-center justify-center mx-auto mb-2">{s.step}</div>
            <div className="text-[12.5px] font-semibold text-[#0F172A]">{s.title}</div>
            <div className="text-[11px] text-[#64748B] mt-0.5">{s.desc}</div>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Cliques no link</div>
          <div className="text-[22px] font-bold text-[#0F172A] mt-1">{stats.totalClicks}</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Cadastros</div>
          <div className="text-[22px] font-bold text-[#027A48] mt-1">{stats.totalSignups}</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Conversão</div>
          <div className="text-[22px] font-bold text-[#1B3A6B] mt-1">{stats.conversionRate}%</div>
        </div>
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium">Seu tier</div>
          <div className={`text-[22px] font-bold mt-1 capitalize ${rewardTier === 'gold' ? 'text-[#E8981C]' : rewardTier === 'silver' ? 'text-[#475569]' : 'text-[#B8740E]'}`}>{rewardTier}</div>
        </div>
      </div>

      {/* Referral link */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 shadow-sm">
        <div className="text-[13px] font-semibold text-[#0F172A] mb-2">Seu link de indicação</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input readOnly value={referralLink} className="flex-1 h-9 px-3 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] text-[12px] text-[#475569] font-mono" />
          <button onClick={handleCopyLink} className="h-9 px-3 rounded-lg text-[12px] font-medium bg-[#F1F3F6] text-[#0F172A] hover:bg-[#E5E7EB] flex items-center gap-1.5 transition-all">
            <Copy className="w-3.5 h-3.5" /> Copiar
          </button>
          <button 
            className="h-9 px-3 rounded-lg text-[12px] font-medium bg-[#25D366] text-white hover:bg-[#1FAD54] flex items-center gap-1.5 transition-colors"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Conheça o Prospix! Use meu link: ${referralLink}`)}`, '_blank')}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            WhatsApp
          </button>
        </div>
      </div>

      {/* Broker List */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-[#EEF0F3] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1B3A6B]" />
            <span className="text-[14px] font-semibold text-[#0F172A]">Suas indicações</span>
            <span className="text-[11px] font-mono text-[#64748B]">· {brokerReferrals.length}</span>
          </div>
        </div>

        {loadingBrokers ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 text-[#1B3A6B] animate-spin" /></div>
        ) : brokerReferrals.length > 0 ? (
          <div className="divide-y divide-[#EEF0F3]">
            {brokerReferrals.map(ref => (
              <div key={ref.id} className="px-4 py-3 flex items-center gap-3 hover:bg-[#F9FAFB] transition-colors">
                <div className="w-8 h-8 rounded-full bg-[rgba(232,152,28,0.14)] text-[#A56B0A] flex items-center justify-center text-[11px] font-bold shrink-0">
                  {ref.name.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[#0F172A]">{ref.name}</div>
                  <div className="text-[11px] text-[#64748B]">{ref.createdAt} · {ref.phone || 'Sem telefone'}</div>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF3] text-[#027A48]">Qualificado</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <Star className="w-8 h-8 text-[#E5E7EB] mx-auto mb-2" />
            <div className="text-[13px] font-semibold text-[#0F172A]">Nenhuma indicação ainda</div>
            <div className="text-[11px] text-[#64748B] mt-1">Compartilhe seu link acima para começar a indicar corretores!</div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto pb-10">
      {/* Page Tabs */}
      <div className="flex border-b border-[#E5E7EB] mb-6">
        <button
          onClick={() => setActiveTab('CLIENTS')}
          className={`px-5 py-3.5 text-[14px] font-bold transition-all border-b-[3px] flex items-center gap-2 ${activeTab === 'CLIENTS' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
        >
          Clientes (Loop)
        </button>
        <button
          onClick={() => setActiveTab('BROKERS')}
          className={`px-5 py-3.5 text-[14px] font-bold transition-all border-b-[3px] flex items-center gap-2 ${activeTab === 'BROKERS' ? 'border-[#1B3A6B] text-[#1B3A6B]' : 'border-transparent text-[#64748B] hover:text-[#0F172A]'}`}
        >
          Corretores (Parcerias)
        </button>
      </div>

      {/* Content */}
      {activeTab === 'CLIENTS' ? renderClientTab() : renderBrokerTab()}
    </div>
  );
}
